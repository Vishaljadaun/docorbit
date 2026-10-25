/** On-device OCR for images and rendered PDF pages.
 * Tesseract runtime and language data are downloaded on first use; files are not uploaded.
 * The OCR runtime is deliberately lazy-loaded so normal DocOrbit PDF tools stay fast.
 */
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { parsePageRange } from './pages';

const ENGINE_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_PAGES = 12;
const MAX_PIXELS = 12_000_000;

type WorkerResponse = { data: { text: string } };
type OcrWorker = {
  recognize(input: HTMLCanvasElement | File): Promise<WorkerResponse>;
  terminate(): Promise<unknown>;
};
type OcrApi = {
  createWorker(lang: string, oem: number, options: { logger: (data: { status?: string; progress?: number }) => void }): Promise<OcrWorker>;
};
declare global {
  interface Window { Tesseract?: OcrApi; }
}
let enginePromise: Promise<OcrApi> | null = null;

function loadOcrEngine(): Promise<OcrApi> {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (enginePromise) return enginePromise;
  enginePromise = new Promise<OcrApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = ENGINE_URL;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error('OCR engine could not start.'));
    script.onerror = () => reject(new Error('Could not download OCR engine. Check your internet connection or content blocker.'));
    document.head.appendChild(script);
  }).catch(error => { enginePromise = null; throw error; });
  return enginePromise;
}

export function isOcrInput(file: File): boolean {
  const extension = /\.(pdf|png|jpe?g|webp)$/i.test(file.name);
  const validType = !file.type || /^(application\/pdf|image\/png|image\/jpeg|image\/webp)$/.test(file.type);
  return extension && validType;
}
export type OcrPage = { page: number; text: string };
export type OcrResult = { pages: OcrPage[]; totalPages: number; skippedPages: boolean };
type OcrOptions = { range?: string; onProgress?: (message: string) => void; signal?: AbortSignal };

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('OCR cancelled.');
}

/** Extracts OCR text from at most 12 scanned pages; uses one recognition worker per job. */
export async function recognizeDocument(file: File, options: OcrOptions = {}): Promise<OcrResult> {
  if (!isOcrInput(file)) throw new Error('Choose a PDF, JPG, PNG or WebP file.');
  if (file.size === 0 || file.size > MAX_BYTES) throw new Error('Choose a nonempty file up to 25 MB.');
  checkAbort(options.signal);
  options.onProgress?.('Loading OCR language data (first use may take longer)…');
  const engine = await loadOcrEngine();
  checkAbort(options.signal);
  let worker: OcrWorker | undefined;
  let documentTask: { destroy: () => Promise<void> } | undefined;
  try {
    worker = await engine.createWorker('eng', 1, {logger: message => {
      if (message.status === 'recognizing text' && typeof message.progress === 'number')
        options.onProgress?.('Reading text · ' + Math.round(message.progress * 100) + '%');
    }});
    checkAbort(options.signal);
    if (!/\.pdf$/i.test(file.name)) {
      options.onProgress?.('Recognizing image…');
      const result = await worker.recognize(file);
      checkAbort(options.signal);
      return {pages:[{page:1,text:result.data.text.trim()}],totalPages:1,skippedPages:false};
    }
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const task = pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())});
    documentTask = task;
    const document = await task.promise;
    checkAbort(options.signal);
    const totalPages = document.numPages;
    const range = (options.range || '').trim().toLowerCase();
    const selected = range === '' || range === 'all'
      ? Array.from({length:Math.min(totalPages,MAX_PAGES)},(_,index)=>index)
      : parsePageRange(range,totalPages);
    if (selected.length > MAX_PAGES) throw new Error('Choose 12 pages or fewer for each OCR job.');
    const pages: OcrPage[] = [];
    for (let i=0; i<selected.length; i++) {
      checkAbort(options.signal);
      const pageIndex=selected[i];
      options.onProgress?.('OCR page '+(i+1)+' of '+selected.length+' · original page '+(pageIndex+1));
      const page = await document.getPage(pageIndex+1);
      const viewport=page.getViewport({scale:1.6});
      if (viewport.width*viewport.height > MAX_PIXELS) throw new Error('This page is too large to OCR safely in the browser.');
      const canvas=document.createElement('canvas');
      try {
        canvas.width=Math.ceil(viewport.width);
        canvas.height=Math.ceil(viewport.height);
        const context=canvas.getContext('2d',{alpha:false});
        if (!context) throw new Error('Canvas rendering is unavailable.');
        context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
        await page.render({canvas,canvasContext:context,viewport}).promise;
        checkAbort(options.signal);
        const recognized=await worker.recognize(canvas);
        checkAbort(options.signal);
        pages.push({page:pageIndex+1,text:recognized.data.text.trim()});
      } finally {canvas.width=canvas.height=0;page.cleanup();}
    }
    return {pages,totalPages,skippedPages:selected.length<totalPages};
  } catch (err) {
    if (options.signal?.aborted) throw new Error('OCR cancelled.');
    throw err;
  } finally {
    if (documentTask) await documentTask.destroy().catch(()=>undefined);
    if (worker) await worker.terminate().catch(()=>undefined);
  }
}
