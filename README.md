# DocOrbit

A practical PDF toolkit with a clean, flat interface. No account required.

**Website:** https://vishaljadaun.github.io/docorbit/

## Features

- PDF tools: edit with text overlays, highlights, signatures and images; merge, split, rotate, reorder and extract pages; convert JPG/PNG images to PDF.
- AI Studio: **Instant** (extractive highlights generated locally without a model download) and **Cloud AI** (PDF summaries, key points, questions based on selected excerpts).
- Browser-first document handling, drag-and-drop, page previews, light/dark themes, responsive layouts and locally stored favorite tools.

## Privacy

Most PDF tools and Instant insights run on your device. Cloud AI sends **selected extracted text passages and the user's question** through a Cloudflare Worker to OpenRouter only after consent. The original PDF is not uploaded by the Cloud AI workflow. The public Worker URL is configured in the frontend source, not shown in user settings; its address can still be inspected in browser network tools. **Never embed an API key in the frontend.** Cloudflare stores the OpenRouter key as a secret.

AI output may contain errors, and summarization uses selected excerpts rather than every page. Scanned PDFs without selectable text are not supported in AI Studio yet. Visual PDF editing overlays annotations and does not rewrite original embedded text.

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
