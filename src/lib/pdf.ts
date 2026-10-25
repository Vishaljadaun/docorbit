import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { parsePageRange, parseSplitRanges, safeFileStem, pageNumberLabel, validateWatermarkText } from './pages';

export type ToolId = 'edit' | 'merge' | 'split' | 'rotate' | 'reorder' | 'extract' | 'images' | 'watermark' | 'numbers' | 'pdf-images';
export type OutputFile = { name: string; bytes: Uint8Array };
export type ProcessOptions = {
  ranges: string;
  rotation: 90 | 180 | 270;
  pageOrder: number[];
  watermarkText?: string;
  watermarkOpacity?: number;
  numberStart?: number;
  numberPosition?: 'bottom-center' | 'bottom-right';
  imageFormat?: 'png' | 'jpeg';
  imageScale?: number;
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
  if (tool === 'edit') throw new Error('Open the visual editor to edit PDF pages.');
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
  if (tool === 'pdf-images') {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc=pdfWorkerUrl;
    const task=pdfjs.getDocument({data:new Uint8Array(await files[0].arrayBuffer())});
    try {
      const doc=await task.promise;
      const indexes=options.ranges.trim().toLowerCase()==='all'
        ? Array.from({length:doc.numPages},(_,i)=>i)
        : parsePageRange(options.ranges,doc.numPages);
      if (indexes.length > 20) throw new Error('Export up to 20 pages at once. Select a smaller range.');
      const format=options.imageFormat==='jpeg'?'jpeg':'png';
      const scale=options.imageScale??1.5;
      if (!Number.isFinite(scale) || scale < 1 || scale > 2) throw new Error('Invalid export quality.');
      const out:OutputFile[]=[];
      for (const index of indexes) {
        const page=await doc.getPage(index+1);
        const viewport=page.getViewport({scale});
        if(viewport.width * viewport.height > 20000000) throw new Error('A page is too large to render at this quality.');
        const canvas=document.createElement('canvas');
        canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
        const ctx=canvas.getContext('2d');
        if(!ctx)throw new Error('Image rendering is unsupported in this browser.');
        if(format==='jpeg'){ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);}
        await page.render({canvas,canvasContext:ctx,viewport}).promise;
        const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not export image.')),format==='jpeg'?'image/jpeg':'image/png',0.9));
        out.push({name:`${safeFileStem(files[0].name)}-page-${index+1}.${format==='jpeg'?'jpg':'png'}`,bytes:new Uint8Array(await blob.arrayBuffer())});
        page.cleanup();canvas.width=canvas.height=0;
      }
      return out;
    } finally {await task.destroy();}
  }
  const source = await loadPdf(files[0]);
  const count = source.getPageCount();
  const stem = safeFileStem(files[0].name);
  if (tool === 'watermark') {
    const label = validateWatermarkText(options.watermarkText || '');
    const opacity = options.watermarkOpacity ?? 0.25;
    if (!Number.isFinite(opacity) || opacity < 0.05 || opacity > 0.7) throw new Error('Opacity must be between 5% and 70%.');
    const font = await source.embedFont(StandardFonts.HelveticaBold);
    for (const page of source.getPages()) {
      const {width,height} = page.getSize();
      const size = Math.max(13, Math.min(65, width * 0.105, width * 0.8 / Math.max(font.widthOfTextAtSize(label,1),1)));
      const textWidth = font.widthOfTextAtSize(label,size);
      page.drawText(label,{x:(width-textWidth)/2,y:height/2,size,font,rotate:degrees(0),color:rgb(0.24,0.35,0.48),opacity});
    }
    return [{name:`${stem}-watermarked.pdf`,bytes:await source.save()}];
  }
  if (tool === 'numbers') {
    const start = options.numberStart ?? 1;
    const font = await source.embedFont(StandardFonts.Helvetica);
    source.getPages().forEach((page,index)=>{
      const label=pageNumberLabel(index,start);
      const {width}=page.getSize();
      const size=11, textWidth=font.widthOfTextAtSize(label,size);
      const x=options.numberPosition==='bottom-right'?width-textWidth-36:(width-textWidth)/2;
      page.drawText(label,{x,y:24,size,font,color:rgb(0.23,0.3,0.4)});
    });
    return [{name:`${stem}-numbered.pdf`,bytes:await source.save()}];
  }
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
  const blob = new Blob([new Uint8Array(file.bytes)], { type: /\.png$/i.test(file.name) ? 'image/png' : /\.jpe?g$/i.test(file.name) ? 'image/jpeg' : 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
