"""Download a single publicly available Instagram post image via its media endpoint.

Only canonical single-image /p/ posts can reach this URL. The media endpoint
occasionally exposes a JPEG where Instagram's HTML and video APIs require login.
This intentionally does not bypass authenticated content or claim carousel
coverage. Redirects are limited to Instagram's image CDN hosts.
"""
from __future__ import annotations

import re
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

MAX_PHOTO_BYTES = 12 * 1024 * 1024
INSTAGRAM_HOSTS = {"instagram.com", "www.instagram.com"}
IMAGE_SUFFIX_HOSTS = (".cdninstagram.com", ".fbcdn.net")
EXTENSIONS = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36"


def photo_shortcode(url: str) -> str:
    try:
        parsed = urlsplit(url.strip())
        hostname = (parsed.hostname or "").lower()
        if parsed.scheme != "https" or hostname not in INSTAGRAM_HOSTS:
            raise ValueError("A public Instagram photo post URL is required.")
        if parsed.port is not None or parsed.username or parsed.password:
            raise ValueError("A public Instagram photo post URL is required.")
        matched = re.fullmatch(r"/p/([A-Za-z0-9_-]{5,30})/?", parsed.path)
        if matched is None:
            raise ValueError("A single Instagram photo post URL is required.")
        return matched.group(1)
    except (ValueError, AttributeError) as error:
        raise ValueError("A single Instagram photo post URL is required.") from error


def _approved_media_url(url: str) -> bool:
    try:
        parsed = urlsplit(url)
        host = (parsed.hostname or "").lower()
        return (
            parsed.scheme == "https"
            and not parsed.username and not parsed.password and parsed.port is None
            and (host in INSTAGRAM_HOSTS or any(host.endswith(s) for s in IMAGE_SUFFIX_HOSTS))
        )
    except (ValueError, AttributeError):
        return False


class _ImageOnlyRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        resolved = urljoin(req.full_url, newurl)
        if not _approved_media_url(resolved):
            raise ValueError("Instagram returned an unexpected image destination.")
        return super().redirect_request(req, fp, code, msg, headers, resolved)


def save_public_photo(url: str, folder: Path) -> tuple[Path, str]:
    code = photo_shortcode(url)
    # Drop unneeded UTM/link tracking parameters, never follow a supplied URL.
    photo_url = f"https://www.instagram.com/p/{code}/media/?size=l"
    opener = build_opener(_ImageOnlyRedirects())
    req = Request(photo_url, headers={
        "User-Agent": UA,
        "Accept": "image/avif,image/webp,image/*,*/*;q=0.8",
    })
    try:
        with opener.open(req, timeout=16) as response:
            if not _approved_media_url(response.url):
                raise ValueError("Instagram returned an unexpected image destination.")
            mime = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
            ext = EXTENSIONS.get(mime)
            if ext is None:
                raise ValueError("Instagram did not return a public image file.")
            header_length = response.headers.get("Content-Length")
            if header_length and int(header_length) > MAX_PHOTO_BYTES:
                raise ValueError("This photo exceeds the free service's size limit.")
            content = response.read(MAX_PHOTO_BYTES + 1)
    except ValueError:
        raise
    except (HTTPError, URLError, TimeoutError, OSError) as error:
        raise ValueError("This Instagram photo could not be accessed anonymously from our server.") from error
    if len(content) > MAX_PHOTO_BYTES:
        raise ValueError("This photo exceeds the free service's size limit.")
    if len(content) < 100 or not (
        (mime == "image/jpeg" and content.startswith(b"\\xff\\xd8\\xff"))
        or (mime == "image/png" and content.startswith(b"\\x89PNG\\r\\n\\x1a\\n"))
        or (mime == "image/webp" and content[:4] == b"RIFF" and content[8:12] == b"WEBP")
    ):
        raise ValueError("Instagram returned invalid photo data.")
    filename = f"instagram-{code}{ext}"
    path = folder / filename
    path.write_bytes(content)
    return path, filename
