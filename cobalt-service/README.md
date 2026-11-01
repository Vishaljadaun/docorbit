# DocOrbit Cobalt backend experiment

This is an **optional, separate** open-source media extraction backend. It has **no imports or shared deployment configuration** with DocOrbit's PDF, OCR, or AI features. Do not route user traffic to it until tested against actual permitted public media links.

Image: `ghcr.io/imputnet/cobalt:11` (official major-version image).

Expected Render configuration: `runtime=docker`, Dockerfile `cobalt-service/Dockerfile`, Docker context `.`, plan `free`, region `singapore`, `API_URL=https://docorbit-cobalt-probe.onrender.com/`, `API_PORT=9000`, `RATELIMIT_WINDOW=60`, `RATELIMIT_MAX=3`, `TUNNEL_RATELIMIT_MAX=8`, `DURATION_LIMIT=900`, `CORS_WILDCARD=0`, `CORS_URL=https://vishaljadaun.github.io`, `API_INSTANCE_COUNT=1`. Automatic deploys disabled to avoid unnecessary restarts and resource usage.

## Benchmark

`GET /` returns Cobalt's service information. To test extraction, `POST /` with `Accept: application/json`, `Content-Type: application/json`, body `{"url":"https://www.instagram.com/p/<public-shortcode>/","videoQuality":"1080"}`. Results can have status `tunnel`, `redirect`, `picker`, or `error`. A successful URL response must still be tested for real downloadability, appropriate format, and expiry. Do not use an unrelated third-party Cobalt instance without the owner's authorization.

Self-hosting does **not** guarantee success. Anonymous access can still be blocked by Instagram or YouTube. Exposing an unprotected downloader can consume significant bandwidth; the small rate limit is suitable only for proof-of-concept testing. Before public use, add Turnstile or API-key protection and enforce quotas on the DocOrbit gateway. See official upstream docs for details: https://github.com/imputnet/cobalt/blob/main/docs/run-an-instance.md and https://github.com/imputnet/cobalt/blob/main/docs/api.md.
