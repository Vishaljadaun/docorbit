"""DocOrbit media API.

Downloads publicly accessible videos only where the user has permission and
the platform permits the export. This does not bypass accounts, DRM or paywalls.
Host as a separate service; GitHub Pages / Cloudflare Workers cannot run FFmpeg.
"""
from __future__ import annotations

import asyncio
import ipaddress
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
from gallery_support import is_photo_fallback, inspect_gallery, save_gallery
from cobalt_alternative import extract_with_cobalt
from photo_direct import photo_shortcode, save_public_photo

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
    try:
        with YoutubeDL(basic_options()) as ydl:
            info = ydl.extract_info(url, download=False)
    except DownloadError as error:
        if is_photo_fallback(url, str(error)):
            if "there is no video in this post" in str(error).lower():
                try:
                    photo_shortcode(url)
                    return {
                        "title": "Instagram public photo",
                        "duration": 0, "resolutions": [],
                        "bestAvailable": None, "mediaType": "photo",
                        "downloadMethod": "direct_photo", "itemCount": 1,
                    }
                except ValueError:
                    pass
            return inspect_gallery(url)
        raise
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
        "mediaType": "video", "itemCount": 1,
    }


def save_video(url: str, quality: str, folder: Path) -> tuple[Path, str]:
    cap = 1080 if quality == "best" else int(quality)
    def limit_download_size(progress: dict) -> None:
        downloaded = int(progress.get("downloaded_bytes") or 0)
        if downloaded > MAX_MEDIA_BYTES:
            raise ValueError("Video exceeds the 220 MB download limit.")

    options = basic_options()
    options.update({
        "progress_hooks": [limit_download_size],
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


def _client_identity(request: Request) -> str:
    """Render's proxy presents an internal socket IP; its XFF ends in the actual client.

    Use the rightmost public IP rather than the first header entry so a client
    cannot trivially evade limits by prepending fake addresses. The shared
    service-wide limit remains the final protection against spoofed headers.
    """
    forwarded = request.headers.get("x-forwarded-for", "")
    for item in reversed(forwarded.split(",")):
        try:
            address = ipaddress.ip_address(item.strip())
            if address.is_global:
                return str(address)
        except ValueError:
            continue
    return request.client.host if request.client else "unknown"


def rate_check(request: Request, *, mode: str) -> None:
    limits = {"inspect": (16, 120), "prepare": (4, 30), "alternative": (6, 35)}
    if mode not in limits:
        raise ValueError("Unknown media operation.")
    now = time.monotonic()
    client = _client_identity(request)
    recent = requests_by_client[(client, mode)]
    shared = requests_global[mode]
    while recent and recent[0] < now - 3600:
        recent.popleft()
    while shared and shared[0] < now - 3600:
        shared.popleft()
    per_client, global_limit = limits[mode]
    if len(recent) >= per_client or len(shared) >= global_limit:
        raise HTTPException(429, "This media operation has reached its hourly free-tier limit. Please retry later.")
    recent.append(now)
    shared.append(now)


async def expire_file(token: str) -> None:
    await asyncio.sleep(600)
    job = prepared_files.pop(token, None)
    if job:
        shutil.rmtree(job[1], ignore_errors=True)


def media_file_type(filename: str) -> str:
    """Conservative file type used by the preview UI (never trusted from the URL)."""
    ext = Path(filename).suffix.lower()
    if ext in {".jpg", ".jpeg", ".png", ".webp"}:
        return "photo"
    if ext in {".mp4", ".webm", ".mov", ".mkv"}:
        return "video"
    return "archive" if ext == ".zip" else "file"


def safe_error(error: Exception) -> HTTPException:
    if isinstance(error, HTTPException):
        return error
    if isinstance(error, DownloadError):
        message = str(error).lower()
        if "sign in to confirm you're not a bot" in message or "sign in to confirm you" in message:
            return HTTPException(422, "YouTube is blocking automated requests from this hosting server. Try an official download option where offered.")
        if "no video formats found" in message or "there is no video in this post" in message:
            return HTTPException(422, "The platform returned no playable video stream for this post.")
        return HTTPException(422, "The platform could not provide this public post to our server. It may require login or block automated downloads.")
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
        rate_check(request, mode="inspect")
        async with slots:
            data = await asyncio.to_thread(inspect_video, payload.url)
        return {"platform": platform, **data}
    except Exception as error:
        raise safe_error(error) from None


@app.post("/api/media/alternative")
async def alternative(payload: DownloadRequest, request: Request):
    """Best-effort isolated fallback; never fetches or stores media on this API."""
    try:
        classify_link(payload.url)
        rate_check(request, mode="alternative")
        async with slots:
            return await asyncio.to_thread(extract_with_cobalt, payload.url, payload.quality)
    except Exception as error:
        raise safe_error(error) from None


@app.post("/api/media/download")
async def download(payload: DownloadRequest, request: Request):
    """Single public download action with automatic server-side source selection.

    Prefer an ephemeral direct/tunnel download URL when obtainable. If that
    extractor cannot resolve a post, try the existing bounded yt-dlp/gallery
    path, returning a short-lived local download link. No persistent storage.
    """
    folder: Path | None = None
    try:
        classify_link(payload.url)
        rate_check(request, mode="prepare")
        async with slots:
            # Direct provider links save our free service's file-transfer bandwidth.
            try:
                resolved = await asyncio.to_thread(extract_with_cobalt, payload.url, payload.quality)
            except ValueError:
                resolved = {"status": "error"}
            if resolved.get("status") in ("tunnel", "redirect"):
                filename = resolved.get("filename") or "media"
                kind = media_file_type(filename)
                return {
                    "status": "ready",
                    "url": resolved["url"],
                    "previewUrl": resolved["url"] if kind in ("video", "photo") else None,
                    "mediaType": kind,
                    "filename": filename,
                    "expiresIn": 600,
                }
            if resolved.get("status") == "picker":
                return {"status": "picker", "items": resolved["items"]}

            folder = Path(tempfile.mkdtemp(prefix="docorbit-media-"))
            try:
                inspection = await asyncio.to_thread(inspect_video, payload.url)
                if inspection.get("downloadMethod") == "direct_photo":
                    try:
                        path, name = await asyncio.to_thread(save_public_photo, payload.url, folder)
                    except ValueError:
                        # Other gallery items may still be accessible on some posts.
                        gallery = await asyncio.to_thread(inspect_gallery, payload.url)
                        path, name = await asyncio.to_thread(
                            save_gallery, payload.url, folder, gallery.get("galleryMode", "rest")
                        )
                elif inspection.get("downloadMethod") == "gallery":
                    path, name = await asyncio.to_thread(
                        save_gallery, payload.url, folder, inspection.get("galleryMode", "rest")
                    )
                else:
                    path, name = await asyncio.to_thread(save_video, payload.url, payload.quality, folder)
            except Exception:
                # Exposing provider names would not help the user resolve access
                # restrictions. No success response is returned without a file.
                raise ValueError(
                    "This post could not be downloaded. The source may require login, "
                    "restrict server access, or not provide downloadable media."
                ) from None
        token = secrets.token_urlsafe(28)
        prepared_files[token] = (path, folder, name, time.monotonic() + 600)
        asyncio.create_task(expire_file(token))
        kind = media_file_type(name)
        return {
            "status": "ready",
            "url": "/api/media/file/" + token,
            "previewUrl": "/api/media/preview/" + token if kind in ("photo", "video") else None,
            "mediaType": kind,
            "filename": name,
            "expiresIn": 600,
        }
    except Exception as error:
        if folder is not None:
            # The folder is still needed when a file has successfully been prepared.
            # Successful requests return above, before this handler runs.
            shutil.rmtree(folder, ignore_errors=True)
        raise safe_error(error) from None


@app.post("/api/media/prepare")
async def prepare(payload: DownloadRequest, request: Request):
    folder: Path | None = None
    try:
        classify_link(payload.url)
        rate_check(request, mode="prepare")
        folder = Path(tempfile.mkdtemp(prefix="docorbit-media-"))
        async with slots:
            inspection = await asyncio.to_thread(inspect_video, payload.url)
            if inspection.get("downloadMethod") == "direct_photo":
                path, name = await asyncio.to_thread(save_public_photo, payload.url, folder)
            elif inspection.get("downloadMethod") == "gallery":
                path, name = await asyncio.to_thread(save_gallery, payload.url, folder, inspection.get("galleryMode", "rest"))
            else:
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


@app.get("/api/media/preview/{token}")
async def preview_file(token: str):
    """Allow browser previews without consuming the single-use download token."""
    if not re.fullmatch(r"[A-Za-z0-9_-]{16,90}", token):
        raise HTTPException(404, "Preview unavailable.")
    job = prepared_files.get(token)
    if job is None:
        raise HTTPException(404, "Preview expired.")
    path, _, name, expires = job
    if time.monotonic() >= expires or not path.is_file():
        raise HTTPException(410, "Preview expired.")
    kind = media_file_type(name)
    types = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".webp": "image/webp",
        ".mp4": "video/mp4", ".webm": "video/webm",
        ".mov": "video/quicktime", ".mkv": "video/x-matroska",
    }
    mime = types.get(path.suffix.lower())
    if kind not in ("photo", "video") or not mime:
        raise HTTPException(415, "Preview is unavailable for this file type.")
    # FileResponse supports byte ranges, so HTML5 video can seek and load metadata.
    return FileResponse(
        path, media_type=mime,
        content_disposition_type="inline", filename=name,
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"}
    )


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
