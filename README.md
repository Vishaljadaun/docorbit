# DocOrbit · v0.2

A private-first document toolkit built with **React, TypeScript, Vite, PDF.js, pdf-lib and Transformers.js**. No user accounts or document uploads are required.

## Features

**Six browser PDF tools:** merge, split, rotate, reorder pages, extract pages, and JPG/PNG-to-PDF. Includes drag-and-drop, previews, dark/light mode, favorites, and local activity metadata.

**NEW · AI Studio (beta)** — open a text-based English PDF, then:

- **Summarize PDF:** make an AI-generated summary from representative excerpts.
- **Key points:** extract important facts from selected document passages.
- **Ask PDF:** retrieve relevant text locally using keyword matching and ask a small language model to formulate an answer.
- View consulted page numbers, copy generated output, or download plain-text notes.

AI uses [FLAN-T5 Small](https://huggingface.co/Xenova/flan-t5-small) running inside a **Web Worker** through [Transformers.js](https://huggingface.co/docs/transformers.js). PDF.js extracts document text in the browser; document text is **not transmitted to an external AI API**. Model weights are downloaded from Hugging Face on first use (roughly 100+ MB, depending on files/runtime) and may be cached by the browser. Browser cache may be evicted, and model loading requires network access the first time.

**Expectations:** This is an experimental, small on-device model, not a production-grade document analyst. It works best for short, well-structured English documents. Results may omit content or be inaccurate. Long documents are *sampled*, not exhaustively summarized. Question lookup is **lexical**, not semantic search. It cannot read scanned/image-only PDFs without OCR. Never rely on AI output alone for legal, financial, medical, or compliance decisions.

## Run locally

Requires **Node.js 22.12+** and npm:

```bash
npm install
npm run dev
```

Open http://localhost:5173; select **AI Studio** in the sidebar, upload a selectable-text PDF, select **Summarize / Key Points / Ask PDF**, and click the action button. Allow the browser to download the model once. CPU inference may be slow, particularly on mobile.

```bash
npm test      # 8 unit tests for PDF ranges, chunking, sampling and question retrieval
npm run build # typecheck + production bundle
npm run preview
```

## Deploy

Deploy the static `dist/` folder to Netlify or Cloudflare Pages with build command `npm run build`. No server, subscription or API key is required. Remote model loading requires users to be online the first time, and security/availability policies must permit fetching model files and ONNX runtime assets. Always serve with HTTPS.

## Privacy & limitations

- PDF bytes and text are processed locally by JavaScript/WebAssembly. No document content is intentionally uploaded by this project. Downloading model files is a separate network request.
- Tool names and counts, favorites, and theme are saved in browser `localStorage`; PDF names and contents are not stored by DocOrbit.
- PDF operations: 50 MB per file, 120 MB total; AI: PDF limit 25 MB and the first 100 pages. Large inputs and the AI model may exceed mobile memory.
- No OCR yet, no password-protected PDF support, no high-fidelity Office conversion, and no redaction or text editing.
- AI outputs can be incomplete or incorrect. Page references are approximate passages used as input, **not verified citations for generated claims**.
- This is a feature implementation. Until dependencies install and the AI model is run in a real browser, end-to-end model behavior and production builds remain **unverified** in the creation environment. Check CI and test actual PDFs before deployment.

## Roadmap

- **v0.1:** six core PDF tools ✅
- **v0.2:** local AI Studio (beta) ✅ code and unit tests; browser inference needs verification
- **v0.3:** signatures, annotations, watermarks and PDF overlays
- **v0.4:** compression and conversion improvements
- **v0.5:** OCR, password tools, secure redaction, comparison
- **v0.6:** better AI models (optional API provider with explicit opt-in), page-grounded citations, offline PWA, end-to-end tests

## Maintainer note

Public demo code is not a claim of medical, legal, financial or production security suitability. Test with non-sensitive sample documents first. The app is intended to demonstrate local document processing and model inference without recurring AI API fees.
