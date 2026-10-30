"""DocOrbit media API.

Downloads publicly accessible videos only where the user has permission and
the platform permits the export. This does not bypass accounts, DRM or paywalls.
Host as a separate service; GitHub Pages / Cloudflare Workers cannot run FFmpeg.
"""
from __future__ import annotations

import asyncio
import os
import re
import secrets
import shutil
import tempfile
import time
from collections import defaultdict, deque
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask
from yt_dlp import DownloadError, YoutubeDL

MAX_MEDIA_BYTES = 220 * 1024 * 1024
MAX_DURATION_SECONDS = 15 * 60
ORIGINS = [v.strip() for v in os.getenv("ALLOWED_ORIGINS", "https://vishaljadaun.github.io").split(",") if v.strip()]
app = FastAPI(title="DocOrbit public-media export", docs_url=None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])
slots = asyncio.Semaphore(2)
requests_by_client: dict[tuple[str, str], deque[float]] = defaultdict(deque)
requests_global: dict[str, deque[float]] = defaultdict(deque)
prepared_files: dict[str, tuple[Path, Path, str, float]] = {}


class MediaRequest(BaseModel):
    url: str = Field(min_length=12, max_length=2000)


class DownloadRequest(MediaRequest):
    quality: str = Field(default="best", pattern=r"^(best|1080|720|480)$")


def classify_link(value: str) -> str:
    try:
        parsed = urlsplit(value.strip())
        host = (parsed.hostname or "").lower().rstrip(".")
        path = parsed.path
        if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port is not None:
            raise ValueError("Use a public HTTPS video link.")
        if host in {"youtube.com", "www.youtube.com", "m.youtube.com"}:
            if path == "/watch" and re.search(r"(?:^|&)v=[A-Za-z0-9_-]{11}(?:&|$)", parsed.query):
                return "YouTube"
            if re.fullmatch(r"/(?:shorts|live)/[A-Za-z0-9_-]{11}/?", path):
                return "YouTube"
        if host == "youtu.be" and re.fullmatch(r"/[A-Za-z0-9_-]{11}/?", path):
            return "YouTube"
        if host in {"instagram.com", "www.instagram.com"} and re.fullmatch(r"/(?:reel|p|tv)/[A-Za-z0-9_-]{5,30}/?", path):
            return "Instagram"
        if host in {"x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"} and re.fullmatch(r"/(?:[A-Za-z0-9_]{1,15}|i)/status/\d{5,22}/?", path):
            return "X"
        if host in {"threads.com", "www.threads.com", "threads.net", "www.threads.net"} and (re.fullmatch(r"/@[^/]+/post/[A-Za-z0-9_-]{5,40}/?", path) or re.fullmatch(r"/t/[A-Za-z0-9_-]{5,40}/?", path)):
            return "Threads"
    except (ValueError, AttributeError):
        pass
    raise ValueError("Use a public video post from YouTube, Instagram, X or Threads.")


def basic_options() -> dict:
    return {
        "quiet": True, "no_warnings": True, "noplaylist": True,
        "ignoreerrors": False, "skip_download": True,
        "socket_timeout": 15, "retries": 1, "fragment_retries": 1,
        "extractor_retries": 1, "playlistend": 1,
        "max_filesize": MAX_MEDIA_BYTES, "cachedir": False,
        "age_limit": 17,
    }


def inspect_video(url: str) -> dict:
    with YoutubeDL(basic_options()) as ydl:
        info = ydl.extract_info(url, download=False)
    if not isinstance(info, dict) or info.get("_type") in ("playlist", "url", "url_transparent"):
        raise ValueError("Please use a single video post, not a channel or playlist.")
    if info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming"):
        raise ValueError("Live or upcoming broadcasts are not supported.")
    duration = info.get("duration")
    if duration is not None and float(duration) > MAX_DURATION_SECONDS:
        raise ValueError("Video is longer than the 15-minute limit.")
    entries = info.get("formats") or []
    heights = sorted({
        int(entry.get("height")) for entry in entries
        if entry.get("height") and entry.get("vcodec") not in ("none", None)
        and 144 <= int(entry["height"]) <= 1080
    }, reverse=True)
    size = info.get("filesize") or info.get("filesize_approx")
    if size is not None and int(size) > MAX_MEDIA_BYTES:
        raise ValueError("Video is larger than the 220 MB limit.")
    return {
        "title": str(info.get("title") or "Untitled video")[:180],
        "duration": int(duration or 0),
        "resolutions": heights,
        "bestAvailable": heights[0] if heights else None,
    }


def save_video(url: str, quality: str, folder: Path) -> tuple[Path, str]:
    cap = 1080 if quality == "best" else int(quality)
    options = basic_options()
    options.update({
        "skip_download": False,
        "outtmpl": str(folder / "docorbit.%(ext)s"),
        "format": f"bv*[height<={cap}]+ba/b[height<={cap}]/bv*[height<={cap}]",
        "merge_output_format": "mp4",
        "format_sort": ["vcodec:h264", "acodec:aac", "ext:mp4"],
        "concurrent_fragment_downloads": 1,
        "nopart": True, "overwrites": True,
    })
    with YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=True)
    if not isinstance(info, dict):
        raise ValueError("No video file was returned.")
    matches = [p for p in folder.glob("docorbit.*") if p.is_file() and p.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov"}]
    if not matches:
        raise ValueError("The provider did not return a downloadable video.")
    path = max(matches, key=lambda p: p.stat().st_size)
    if path.stat().st_size > MAX_MEDIA_BYTES:
        raise ValueError("The video exceeds the 220 MB server limit.")
    name = re.sub(r"[^a-zA-Z0-9_.-]", "_", str(info.get("title") or "video"))[:60].strip("._") or "video"
    return path, f"{name}.{path.suffix.lstrip('.')}"


def rate_check(request: Request, *, download: bool) -> None:
    now = time.monotonic()
    client = request.client.host if request.client else "unknown"
    mode = "prepare" if download else "inspect"
    recent = requests_by_client[(client, mode)]
    shared = requests_global[mode]
    while recent and recent[0] < now - 3600:
        recent.popleft()
    while shared and shared[0] < now - 3600:
        shared.popleft()
    if len(recent) >= (4 if download else 16) or len(shared) >= (30 if download else 120):
        raise HTTPException(429, "Media service is busy or its hourly allowance is exhausted.")
    recent.append(now)
    shared.append(now)


async def expire_file(token: str) -> None:
    await asyncio.sleep(600)
    job = prepared_files.pop(token, None)
    if job:
        shutil.rmtree(job[1], ignore_errors=True)


def safe_error(error: Exception) -> HTTPException:
    if isinstance(error, HTTPException):
        return error
    if isinstance(error, DownloadError):
        return HTTPException(422, "This public post could not be retrieved. The provider may block downloading or require login.")
    if isinstance(error, ValueError):
        return HTTPException(422, str(error))
    return HTTPException(502, "The media provider did not return an accessible video. Try another public post.")


@app.get("/health")
async def health():
    return {"ok": True, "service": "docorbit-media", "downloadEnabled": True}


@app.post("/api/media/inspect")
async def inspect(payload: MediaRequest, request: Request):
    try:
        platform = classify_link(payload.url)
        rate_check(request, download=False)
        async with slots:
            data = await asyncio.to_thread(inspect_video, payload.url)
        return {"platform": platform, **data}
    except Exception as error:
        raise safe_error(error) from None


@app.post("/api/media/prepare")
async def prepare(payload: DownloadRequest, request: Request):
    folder: Path | None = None
    try:
        classify_link(payload.url)
        rate_check(request, download=True)
        folder = Path(tempfile.mkdtemp(prefix="docorbit-media-"))
        async with slots:
            await asyncio.to_thread(inspect_video, payload.url)
            path, name = await asyncio.to_thread(save_video, payload.url, payload.quality, folder)
        token = secrets.token_urlsafe(28)
        prepared_files[token] = (path, folder, name, time.monotonic() + 600)
        asyncio.create_task(expire_file(token))
        return {
            "filePath": "/api/media/file/" + token,
            "fileName": name,
            "size": path.stat().st_size,
            "expiresIn": 600
        }
    except Exception as error:
        if folder is not None:
            shutil.rmtree(folder, ignore_errors=True)
        raise safe_error(error) from None


@app.get("/api/media/file/{token}")
async def get_file(token: str):
    job = prepared_files.pop(token, None)
    if not job:
        raise HTTPException(404, "Download link expired or already used.")
    path, folder, name, expires = job
    if time.monotonic() > expires or not path.is_file():
        shutil.rmtree(folder, ignore_errors=True)
        raise HTTPException(410, "Download link expired.")
    return FileResponse(
        path, filename=name, media_type="application/octet-stream",
        background=BackgroundTask(shutil.rmtree, folder, ignore_errors=True),
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
    )
