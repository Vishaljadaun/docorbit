import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { DocumentPage } from './document';

const MAX_AI_PDF_BYTES = 25 * 1024 * 1024;
const MAX_AI_PAGES = 100;

/** Extract selectable text on-device. Scanned PDFs need OCR (a later feature). */
export async function extractPdfText(file: File, progress?: (message: string) => void): Promise<{ pages: DocumentPage[]; pageCount: number; truncated: boolean }> {
  if (!/\.pdf$/i.test(file.name)) throw new Error('Please choose a PDF file.');
  if (file.size > MAX_AI_PDF_BYTES) throw new Error('AI Studio currently supports files up to 25 MB.');
  if (!file.size) throw new Error('This PDF is empty.');
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const documentTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const document = await documentTask.promise;
    const pages: DocumentPage[] = [];
    const count = Math.min(document.numPages, MAX_AI_PAGES);
    for (let index = 1; index <= count; index++) {
      progress?.(`Reading page ${index} of ${count}…`);
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      // PDF.js TextContent can contain structural markers in addition to TextItems.
      const text = content.items.map(item => ('str' in item ? item.str : '')).join(' ');
      pages.push({ page: index, text });
      page.cleanup();
    }
    return { pages, pageCount: document.numPages, truncated: document.numPages > MAX_AI_PAGES };
  } catch (error) {
    throw new Error(error instanceof Error ? `Could not read PDF text: ${error.message}` : 'Could not read PDF text. It may be encrypted or unsupported.');
  } finally {
    await documentTask.destroy();
  }
}
