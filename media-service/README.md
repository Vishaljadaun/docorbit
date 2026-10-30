# DocOrbit Video Downloader — separate media service

This **optional** service powers the Video Downloader screen in the DocOrbit React app. The screen is already part of GitHub Pages, but the quality-check and download controls remain disabled until a real server is connected. **Do not present those controls as working before deployment.**

## Capabilities and honest limitations

- Recognizes individual public YouTube videos/Shorts, Instagram video posts/Reels, X/Twitter video posts and Threads posts by URL.
- Uses yt-dlp to request source formats (availability differs by platform, source, region, account requirements and provider changes).
- Offers the highest available quality up to 1080p; this **does not mean every source has Full HD**. Some formats require FFmpeg to combine video and audio, and the final file may be MP4, MKV or WebM.
- Single videos only; no playlists, login cookies, private content, DRM, age-restricted content or paywalls.
- Server caps: 15-minute videos, 220 MB per file, two concurrent media operations, limited per-client/global hourly requests. Temporary output expires after 10 minutes, is single-use, and is deleted after download.
- Users must own the media or have permission to save it, and the platform must allow that use. Public visibility is not equivalent to creator permission. For YouTube, use official YouTube Studio exports or other expressly authorized downloads where appropriate. X and Instagram creators can restrict downloads.
- The provider may reject some public links. **Threads and YouTube extraction are best-effort, not guaranteed.** Some services require a signed-in session or change how formats are delivered; this server does not bypass those restrictions.

## Backend setup

This is a Python FastAPI service with yt-dlp and system FFmpeg. It does **not** run on GitHub Pages or inside DocOrbit's Cloudflare AI Worker.

Local development (Python 3.12+, FFmpeg installed):

\`\`\`bash
pip install -r media-service/requirements.txt
ALLOWED_ORIGINS=http://localhost:5173 uvicorn main:app --app-dir media-service --host 127.0.0.1 --port 10000
\`\`\`

Render-style Docker deployment: use the repository root as the Docker build context, and set the Dockerfile to \`media-service/Dockerfile\`. Environment variable \`ALLOWED_ORIGINS\` should be \`https://vishaljadaun.github.io\` (exact origin, not the \`/docorbit/\` page path). The service listens on the \`PORT\` supplied by the host.

## Connect GitHub Pages

1. Deploy the media service and verify its own \`/health\` endpoint returns \`ok: true\`.
2. In **GitHub → repository Settings → Secrets and variables → Actions → Variables**, create \`MEDIA_API_BASE\` with your HTTPS service origin, such as \`https://your-media-service.onrender.com\`. This is a public URL, not an API secret.
3. Rerun the **Deploy DocOrbit to GitHub Pages** workflow. Its build passes \`MEDIA_API_BASE\` into Vite as \`VITE_MEDIA_API_BASE\`.
4. Open **Video Downloader**, paste a permitted public video link, select available quality, prepare a short-lived download, and download the file.

## Production security / cost limitations

**Do not operate as an unrestricted high-traffic public downloader.** CORS is not authentication. Current counters are in-memory only (not shared across instances), and the server can still be directly called without a browser. Before offering at scale, implement shared durable rate limits, Cloudflare Turnstile or authenticated quotas, outbound network and storage usage caps, monitoring and abuse reporting. Validate outbound URLs against DNS rebinding and private destinations if the allowed platform list is expanded.

Video files consume hosting egress and disk capacity; 1080p videos may use substantial bandwidth. **Render free instances are for testing, not production-heavy video downloads**. They spin down, have ephemeral storage and quota limits. Avoid enabling billing without checking your Render plan and usage.

To test the validation paths without making external downloads:

\`\`\`bash
python -m unittest discover -s media-service/tests -v
\`\`\`

Media service updates are tested by the separate \`Check DocOrbit Media Service\` GitHub workflow so they do not break DocOrbit PDF deployments.
