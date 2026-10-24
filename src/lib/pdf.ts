import { degrees, PDFDocument } from 'pdf-lib';
import { parsePageRange, parseSplitRanges, safeFileStem } from './pages';

export type ToolId = 'merge' | 'split' | 'rotate' | 'reorder' | 'extract' | 'images';
export type OutputFile = { name: string; bytes: Uint8Array };
export type ProcessOptions = {
  ranges: string;
  rotation: 90 | 180 | 270;
  pageOrder: number[];
};

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 120 * 1024 * 1024;

export function isImage(file: File): boolean {
  return /\.(png|jpe?g)$/i.test(file.name) && (!file.type || /^image\/(png|jpeg)$/.test(file.type));
}
export function isPdf(file: File): boolean {
  return /\.pdf$/i.test(file.name) && (!file.type || file.type === 'application/pdf');
}

export async function validateFiles(files: File[], tool: ToolId): Promise<void> {
  if (files.length === 0) throw new Error('Choose at least one file.');
  if (files.some(f => f.size === 0)) throw new Error('Empty files cannot be processed.');
  if (files.some(f => f.size > MAX_FILE_BYTES)) throw new Error('A file exceeds the 50 MB per-file limit.');
  if (files.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL_BYTES) throw new Error('Files exceed the 120 MB total limit.');
  for (const file of files) {
    if (tool === 'images') {
      if (!isImage(file)) throw new Error(`"${file.name}" must be a JPG or PNG image.`);
      const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
      const jpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
      const png = head.length === 8 && [137,80,78,71,13,10,26,10].every((b, i) => head[i] === b);
      if (!jpeg && !png) throw new Error(`"${file.name}" has invalid image data.`);
    } else {
      if (!isPdf(file)) throw new Error(`"${file.name}" must be a PDF.`);
      const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
      if (!PDF_SIGNATURE.every((b, i) => head[i] === b)) throw new Error(`"${file.name}" is not a valid PDF.`);
    }
  }
}

async function loadPdf(file: File): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
  } catch {
    throw new Error(`Cannot open "${file.name}". It may be encrypted, damaged, or unsupported.`);
  }
}

export async function readPageCount(file: File): Promise<number> {
  return (await loadPdf(file)).getPageCount();
}

async function fromPages(source: PDFDocument, indexes: number[]): Promise<Uint8Array> {
  const output = await PDFDocument.create();
  const copied = await output.copyPages(source, indexes);
  for (const page of copied) output.addPage(page);
  return output.save();
}

export async function processFiles(tool: ToolId, files: File[], options: ProcessOptions): Promise<OutputFile[]> {
  await validateFiles(files, tool);
  if (tool === 'merge') {
    if (files.length < 2) throw new Error('Select two or more PDFs to merge.');
    const target = await PDFDocument.create();
    for (const file of files) {
      const pdf = await loadPdf(file);
      const pages = await target.copyPages(pdf, pdf.getPageIndices());
      pages.forEach(page => target.addPage(page));
    }
    return [{ name: 'docorbit-merged.pdf', bytes: await target.save() }];
  }
  if (tool === 'images') {
    const doc = await PDFDocument.create();
    for (const file of files) {
      const data = await file.arrayBuffer();
      const signature = new Uint8Array(data.slice(0, 8));
      const img = signature[0] === 0xff ? await doc.embedJpg(data) : await doc.embedPng(data);
      const landscape = img.width > img.height;
      const width = landscape ? 841.89 : 595.28;
      const height = landscape ? 595.28 : 841.89;
      const page = doc.addPage([width, height]);
      const scale = Math.min((width - 48) / img.width, (height - 48) / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h });
    }
    return [{ name: 'docorbit-images.pdf', bytes: await doc.save() }];
  }
  const source = await loadPdf(files[0]);
  const count = source.getPageCount();
  const stem = safeFileStem(files[0].name);
  if (tool === 'split') {
    const groups = parseSplitRanges(options.ranges, count);
    return Promise.all(groups.map(async (indexes, i) => ({
      name: `${stem}-part-${i + 1}.pdf`, bytes: await fromPages(source, indexes),
    })));
  }
  if (tool === 'extract') {
    return [{ name: `${stem}-extracted.pdf`, bytes: await fromPages(source, parsePageRange(options.ranges, count)) }];
  }
  if (tool === 'reorder') {
    const order = options.pageOrder;
    if (order.length !== count || new Set(order).size !== count || order.some(i => !Number.isInteger(i) || i < 0 || i >= count)) {
      throw new Error('Page order must contain every page exactly once.');
    }
    return [{ name: `${stem}-reordered.pdf`, bytes: await fromPages(source, order) }];
  }
  for (const page of source.getPages()) page.setRotation(degrees((page.getRotation().angle + options.rotation) % 360));
  return [{ name: `${stem}-rotated.pdf`, bytes: await source.save() }];
}

export function downloadOutput(file: OutputFile) {
  const blob = new Blob([new Uint8Array(file.bytes)], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
