"""Best-effort public Instagram photo/carousel fallback for yt-dlp's no-video error.

Only explicit single-post URLs validated by main.classify_link reach these functions.
No browser credentials, login cookies, proxy rotation or authentication bypass.
"""
from __future__ import annotations

import logging
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
from zipfile import ZipFile, ZIP_DEFLATED

MAX_GALLERY_FILES = 10
MAX_GALLERY_BYTES = 220 * 1024 * 1024
logger = logging.getLogger("docorbit.media.gallery")
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".avif", ".mp4", ".webm", ".mov"}


def is_photo_fallback(url: str, message: str) -> bool:
    """Only try gallery extraction for Instagram post URLs without video formats."""
    parsed = urlsplit(url)
    if (parsed.hostname or "").lower() not in {"instagram.com", "www.instagram.com"}:
        return False
    if not parsed.path.startswith(("/p/", "/reel/", "/tv/")):
        return False
    error = message.lower()
    return "there is no video in this post" in error or "no video formats found" in error


def _command(url: str) -> list[str]:
    parsed = urlsplit(url)
    # Tracking parameters are unnecessary and shouldn't be passed downstream.
    clean_url = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
    return [
        sys.executable, "-m", "gallery_dl", "--config-ignore", "--no-input",
        "--whitelist", "instagram", "--range", f"1-{MAX_GALLERY_FILES}",
        "--http-timeout", "15", "--retries", "1",
        clean_url,
    ]


def _run(command: list[str], timeout: int) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command, capture_output=True, text=True, timeout=timeout,
            check=False, shell=False, cwd="/tmp",
        )
    except subprocess.TimeoutExpired as error:
        raise ValueError("Instagram's public media request timed out. Try again later.") from error


def _failure_category(stderr: str, stdout: str = "") -> str:
    """Classify extractor errors without logging raw URLs, cookies, or page data."""
    combined = (stderr + " " + stdout[:250]).lower()
    if any(term in combined for term in (
        "login required", "login page", "http error 401", "401 unauthorized",
        "redirected to login", "authentication required", "not logged in"
    )):
        return "login_required"
    if any(term in combined for term in ("429", "too many requests", "rate limit")):
        return "rate_limited"
    if any(term in combined for term in ("403", "forbidden", "access denied")):
        return "access_denied"
    if any(term in combined for term in ("unsupported url", "no extractor")):
        return "unsupported"
    if any(term in combined for term in ("error", "exception", "failed")):
        return "extractor_error"
    return "empty_result"


def _probe_gallery(url: str) -> tuple[list[str], str]:
    """Try gallery-dl's documented REST and lower-resolution GraphQL API modes."""
    failures = []
    for api_mode in ("rest", "graphql"):
        args = _command(url)
        args[-1:-1] = ["--get-urls", "--option", "extractor.instagram.api=" + api_mode]
        result = _run(args, timeout=25)
        urls = [
            line.strip() for line in result.stdout.splitlines()
            if line.strip().startswith("https://")
        ]
        if result.returncode == 0 and urls:
            logger.info("Instagram public gallery available: mode=%s count=%d", api_mode, len(urls))
            return urls[:MAX_GALLERY_FILES], api_mode
        reason = _failure_category(result.stderr, result.stdout)
        failures.append(reason)
        logger.warning(
            "Instagram anonymous gallery probe failed: mode=%s reason=%s exit=%s",
            api_mode, reason, result.returncode
        )
    if "rate_limited" in failures:
        raise ValueError("Instagram is rate-limiting this server. Please try later.")
    if "login_required" in failures or "access_denied" in failures:
        raise ValueError(
            "Instagram requires authentication or denies anonymous access from this server. "
            "This post may still be visible in your browser; DocOrbit cannot retrieve it without access."
        )
    raise ValueError(
        "Both Instagram public-media extraction methods failed for this post. "
        "Instagram may restrict requests from this hosting provider."
    )


def inspect_gallery(url: str) -> dict:
    """Check for actual public media URLs before promising a photo download."""
    urls, api_mode = _probe_gallery(url)
    contains_video = any(urlsplit(item).path.lower().endswith((".mp4", ".webm", ".mov")) for item in urls)
    media_type = "gallery" if contains_video else "photo"
    return {
        "title": "Instagram public media post" if contains_video else (
            "Instagram photo post" if len(urls) == 1 else "Instagram photo carousel"
        ),
        "duration": 0, "resolutions": [], "bestAvailable": None,
        "mediaType": media_type, "downloadMethod": "gallery", "galleryMode": api_mode, "itemCount": len(urls),
    }


def save_gallery(url: str, folder: Path, api_mode: str = "rest") -> tuple[Path, str]:
    """Download at most 10 public post assets and combine carousels into a ZIP."""
    if api_mode not in {"rest", "graphql"}:
        raise ValueError("Invalid Instagram extraction method.")
    args = _command(url)
    args[-1:-1] = [
        "--option", "extractor.instagram.api=" + api_mode,
        "--directory", str(folder),
        "--filesize-max", str(MAX_GALLERY_BYTES),
        "--no-part", "--no-mtime",
    ]
    result = _run(args, timeout=155)
    if result.returncode:
        reason = _failure_category(result.stderr, result.stdout)
        logger.warning("Instagram gallery download failed: reason=%s exit=%s", reason, result.returncode)
        if reason in {"login_required", "access_denied"}:
            raise ValueError("Instagram blocked anonymous media access from this server.")
        raise ValueError("Instagram would not serve this post's public media to DocOrbit.")
    root = folder.resolve()
    files = sorted(
        (p for p in folder.rglob("*")
         if p.is_file() and not p.is_symlink()
         and p.suffix.lower() in ALLOWED_EXTENSIONS
         and p.resolve().is_relative_to(root)),
        key=lambda p: p.name,
    )
    if not files:
        raise ValueError("No downloadable photo or video assets were returned by Instagram.")
    if len(files) > MAX_GALLERY_FILES:
        raise ValueError("This post contains too many assets for the free service.")
    total = sum(p.stat().st_size for p in files)
    if total > MAX_GALLERY_BYTES:
        raise ValueError("This post is larger than the 220 MB service limit.")
    if len(files) == 1:
        return files[0], "instagram-post" + files[0].suffix.lower()
    archive = folder / "instagram-post.zip"
    with ZipFile(archive, "w", compression=ZIP_DEFLATED, compresslevel=3) as zip_file:
        for index, item in enumerate(files, 1):
            zip_file.write(item, arcname=f"media-{index:02d}{item.suffix.lower()}")
    if archive.stat().st_size > MAX_GALLERY_BYTES:
        raise ValueError("This carousel is larger than the 220 MB service limit.")
    return archive, "instagram-post.zip"
