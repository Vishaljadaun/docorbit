# DocOrbit

A practical PDF toolkit with a clean, flat interface. No account required.

**Website:** https://vishaljadaun.github.io/docorbit/

## Features

- PDF tools: edit with text overlays, highlights, signatures and images; merge, split, rotate, reorder and extract pages; convert JPG/PNG images to PDF.
- AI Studio: **Instant** (extractive highlights generated locally without a model download) and **Cloud AI** (PDF summaries, key points, questions based on selected excerpts).
- Browser-first document handling, drag-and-drop, page previews, light/dark themes, responsive layouts and locally stored favorite tools.
- **Scan to Text OCR:** printed and experimental handwriting recognition on supported images and scanned PDFs, with editable TXT and CSV output.
- **Video Downloader (integration preview):** recognizes YouTube, Instagram, X and Threads public post links. Actual HD extraction requires deploying and connecting the separate `media-service/` Python + FFmpeg backend; until configured, no downloads are offered.

## Privacy

Most PDF tools and Instant insights run on your device. Cloud AI sends **selected extracted text passages and the user's question** through a Cloudflare Worker to OpenRouter only after consent. The original PDF is not uploaded by the Cloud AI workflow. The public Worker URL is configured in the frontend source, not shown in user settings; its address can still be inspected in browser network tools. **Never embed an API key in the frontend.** Cloudflare stores the OpenRouter key as a secret.

AI output may contain errors, and summarization uses selected excerpts rather than every page. For scanned PDFs without selectable text, AI Studio can offer a local OCR retry. OCR accuracy varies and requires proofreading. Visual PDF editing overlays annotations and does not rewrite original embedded text.

## Develop

```sh
npm install
npm test
npm run build
npm run dev
```

The frontend is automatically deployed to GitHub Pages by `.github/workflows/deploy-pages.yml`.

## Cloud AI Gateway

The Worker is in `worker/` with configuration `worker/wrangler.jsonc`. The current production Worker is named `docorbit`. Its API key is securely stored as the Cloudflare secret `OPENROUTER_API_KEY`. The gateway is configured to use OpenRouter free-only routing; it is subject to daily limits and availability.

The gateway requires rate-limit bindings and request limits. Cloudflare rate limits are approximate and aren't a strict global budget. Before expanding public usage, add identity-aware quotas, monitoring and global abuse protection. See `worker/README.md` for the developer setup. Do not publish secrets, credentials, or private user files.

## Contributing

Issues and improvements are welcome. Please avoid committing sample PDFs that contain sensitive information.

## License

No license has been selected. Contact the repository owner before redistributing or reusing source code outside the repository.

## Video processing backend (optional)

The GitHub Pages app is static and cannot independently download social video streams or combine HD audio and video. The separate `media-service/` backend provides link inspection, limited-quality selection up to 1080p where available, and temporary single-use download links for media users are authorized to save. See [media-service/README.md](media-service/README.md) for setup, hosting costs, restrictions, privacy and rate-limit notes. Video service URL is configured via the GitHub Actions variable `MEDIA_API_BASE` after deployment. Do not offer public downloading until server abuse protection and hosting quotas have been reviewed.
