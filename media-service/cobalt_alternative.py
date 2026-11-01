"""Bounded optional Cobalt extraction. Does not store video bytes.

Calls only our own fixed Cobalt instance, not arbitrary user-selected servers.
Platform URL validation and request quotas live in main.py.
"""
from __future__ import annotations

import ipaddress
import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

COBALT_BASE = "https://docorbit-cobalt-probe.onrender.com"
OUTPUT_LIMIT = 96 * 1024
QUALITY = {"best": "1080", "1080": "1080", "720": "720", "480": "480"}


def is_public_https(url: str) -> bool:
    try:
        value = urlsplit(url)
        host = (value.hostname or "").lower()
        if value.scheme != "https" or not host or value.username or value.password or value.port:
            return False
        if host in {"localhost", "localhost.localdomain"} or host.endswith((".localhost", ".local", ".internal", ".onion")):
            return False
        try:
            address = ipaddress.ip_address(host)
            return address.is_global
        except ValueError:
            return "." in host and not host.endswith(".")
    except (ValueError, AttributeError):
        return False


def extract_with_cobalt(url: str, quality: str = "best") -> dict:
    if quality not in QUALITY:
        raise ValueError("Unsupported quality.")
    body = json.dumps({
        "url": url,
        "videoQuality": QUALITY[quality],
        "downloadMode": "auto",
        "alwaysProxy": True,
        "localProcessing": "disabled",
    }).encode("utf-8")
    req = Request(
        COBALT_BASE + "/",
        data=body,
        method="POST",
        headers={"Accept": "application/json", "Content-Type": "application/json"},
    )
    try:
        with urlopen(req, timeout=28) as response:
            raw = response.read(OUTPUT_LIMIT + 1)
    except HTTPError as error:
        if error.code == 429:
            raise ValueError("Alternative media provider is rate-limiting requests.") from error
        if error.code in (401, 403):
            raise ValueError("Alternative provider requires authorization.") from error
        if error.code not in (400, 404, 422):
            raise ValueError("Alternative media provider could not process this request.") from error
        # Cobalt legitimately returns machine-readable errors with HTTP 400;
        # do not discard these and replace them with a generic 422 response.
        raw = error.read(OUTPUT_LIMIT + 1)
    except (URLError, TimeoutError, OSError) as error:
        raise ValueError("Alternative media provider is currently unavailable.") from error
    if len(raw) > OUTPUT_LIMIT:
        raise ValueError("Alternative provider returned an oversized response.")
    try:
        result = json.loads(raw.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise ValueError("Alternative provider returned an invalid response.") from error
    if not isinstance(result, dict):
        raise ValueError("Alternative provider returned an invalid response.")
    status = result.get("status")
    if status == "error":
        error = result.get("error")
        code = (error or {}).get("code", "unknown") if isinstance(error, dict) else "unknown"
        code = str(code)[:120]
        if code == "error.api.fetch.empty":
            message = "This platform returned no downloadable media to our Cobalt server. Public posts can still block cloud servers."
        elif code.startswith("error.api.rate"):
            message = "Cobalt has hit a request limit. Try again after the limit resets."
        elif code.startswith("error.api.auth"):
            message = "Cobalt requires authorization for this request."
        elif code.startswith("error.api.content"):
            message = "The platform did not provide an accessible media file for this post."
        else:
            message = "Cobalt could not retrieve this post from the source platform."
        return {"status": "error", "message": message, "code": code}
    if status in ("redirect", "tunnel"):
        destination = result.get("url", "")
        if not isinstance(destination, str) or not is_public_https(destination):
            raise ValueError("Alternative provider returned an unsafe download URL.")
        if status == "tunnel" and urlsplit(destination).hostname != urlsplit(COBALT_BASE).hostname:
            raise ValueError("Alternative provider returned an unexpected tunnel host.")
        filename = result.get("filename") or "download"
        return {"status": status, "url": destination, "filename": str(filename)[:180]}
    if status == "picker":
        choices = []
        for entry in result.get("picker", [])[:10]:
            if not isinstance(entry, dict):
                continue
            direct = entry.get("url")
            if isinstance(direct, str) and is_public_https(direct):
                choices.append({"type": str(entry.get("type", "media"))[:20], "url": direct})
        if not choices:
            raise ValueError("Alternative provider did not return any usable media.")
        return {"status": "picker", "items": choices}
    if status == "local-processing":
        return {"status": "error", "message": "This format requires local remuxing, which the experimental mode does not support.", "code": "local_processing"}
    raise ValueError("Alternative provider returned an unsupported response.")
