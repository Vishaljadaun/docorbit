"""Best-effort public Instagram photo/carousel fallback for yt-dlp's no-video error.

Only explicit single-post URLs validated by main.classify_link reach these functions.
No browser credentials, login cookies, proxy rotation or authentication bypass.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
from zipfile import ZipFile, ZIP_DEFLATED

MAX_GALLERY_FILES = 10
MAX_GALLERY_BYTES = 220 * 1024 * 1024
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


def inspect_gallery(url: str) -> dict:
    """Check for actual public media URLs before promising a photo download."""
    args = _command(url)
    args.insert(-1, "--get-urls")
    result = _run(args, timeout=35)
    urls = [line.strip() for line in result.stdout.splitlines() if line.strip().startswith("https://")]
    if result.returncode != 0 or not urls:
        raise ValueError(
            "This Instagram post has no video, and its images are not accessible to our server without login. "
            "Try Instagram's own download options."
        )
    contains_video = any(urlsplit(item).path.lower().endswith((".mp4", ".webm", ".mov")) for item in urls)
    media_type = "gallery" if contains_video else "photo"
    return {
        "title": "Instagram public media post" if contains_video else (
            "Instagram photo post" if len(urls) == 1 else "Instagram photo carousel"
        ),
        "duration": 0, "resolutions": [], "bestAvailable": None,
        "mediaType": media_type, "downloadMethod": "gallery", "itemCount": len(urls),
    }


def save_gallery(url: str, folder: Path) -> tuple[Path, str]:
    """Download at most 10 public post assets and combine carousels into a ZIP."""
    args = _command(url)
    args[-1:-1] = [
        "--directory", str(folder),
        "--filesize-max", str(MAX_GALLERY_BYTES),
        "--no-part", "--no-mtime",
    ]
    result = _run(args, timeout=155)
    if result.returncode:
        raise ValueError("Instagram would not serve this post's public images to DocOrbit.")
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
