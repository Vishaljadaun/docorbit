#!/usr/bin/env python3
"""Non-destructive checks against the live DocOrbit media API.

Tests service health, CORS, and invalid-input rejection. Does not fetch third-party media.
Runs on a GitHub-hosted runner, not on the user's computer.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("DOCORBIT_MEDIA_BASE", "https://docorbit-media.onrender.com").rstrip("/")
ORIGIN = "https://vishaljadaun.github.io"


def call(path, method="GET", data=None, headers=None, timeout=20):
    payload = json.dumps(data).encode() if data is not None else None
    request_headers = {"User-Agent": "DocOrbit-live-smoke/1.0", **(headers or {})}
    if payload is not None:
        request_headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
        BASE + path, data=payload, headers=request_headers, method=method
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, dict(response.headers.items()), response.read(3000)
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers.items()), error.read(3000)


def main():
    print("Checking backend:", BASE, flush=True)
    # Render's free plan can be sleeping: allow several attempts to wake it.
    last_error = None
    for attempt in range(1, 9):
        try:
            status, _, body = call("/health", timeout=35)
            obj = json.loads(body)
            if status == 200 and obj.get("ok") is True and obj.get("service") == "docorbit-media":
                print("PASS: GET /health (service is ready)", flush=True)
                break
            last_error = f"HTTP {status} {body[:150]!r}"
        except (OSError, TimeoutError, json.JSONDecodeError) as error:
            last_error = str(error)
        if attempt == 8:
            raise RuntimeError("Backend health check failed: " + str(last_error))
        print(f"Attempt {attempt}/8: waiting for backend to wake...", flush=True)
        time.sleep(12)

    status, headers, _ = call(
        "/api/media/inspect",
        method="OPTIONS",
        headers={
            "Origin": ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    cors = {key.lower(): value for key, value in headers.items()}
    if status not in (200, 204) or cors.get("access-control-allow-origin") != ORIGIN:
        raise RuntimeError(f"Bad CORS preflight: status={status}, origin={cors.get('access-control-allow-origin')}")
    print("PASS: allowed GitHub Pages origin can call API", flush=True)

    status, _, body = call(
        "/api/media/inspect",
        method="POST",
        data={"url": "https://example.com/invalid-video"},
        headers={"Origin": ORIGIN},
    )
    if status != 422:
        raise RuntimeError(f"Expected invalid URL to be rejected with 422, got {status}: {body[:120]!r}")
    print("PASS: unsupported URLs rejected, no third-party video fetched", flush=True)
    print("All live API smoke checks passed.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("FAIL:", error, file=sys.stderr)
        sys.exit(1)
