import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { safeFileStem } from './pages';
import { screenToPdf, uprightAngle } from './editorGeometry';

import type { Point, Matrix } from './editorGeometry';
export type { Point, Matrix } from './editorGeometry';
export type EditorKind = 'text' | 'highlight' | 'draw' | 'image';
export type Annotation = {
  id: string;
  page: number; // Zero-based
  kind: EditorKind;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  size: number;
  content: string;
  points: Point[];
  imageData?: string;
};
export type PageMapping = { width: number; height: number; transform: Matrix };

function colorFromHex(hex: string) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('Invalid annotation color.');
  return rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
}

function imageBytes(dataUri: string): { data: Uint8Array; format: 'png' | 'jpg' } {
  const match = /^data:image\/(png|jpeg);base64,([a-z0-9+/=]+)$/i.exec(dataUri);
  if (!match) throw new Error('Only PNG and JPEG image overlays are supported.');
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < bytes.length; i++) bytes[i] = binary.charCodeAt(i);
  return { data: bytes, format: match[1].toLowerCase() === 'png' ? 'png' : 'jpg' };
}

export async function saveEditedPdf(
  file: File,
  annotations: Annotation[],
  getMapping: (page: number) => Promise<PageMapping>,
): Promise<{ name: string; bytes: Uint8Array }> {
  if (!annotations.length) throw new Error('Add at least one edit before exporting.');
  const pdf = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const cache = new Map<number, PageMapping>();
  const images = new Map<string, Awaited<ReturnType<typeof pdf.embedPng>>>();

  for (const ann of annotations) {
    if (ann.page < 0 || ann.page >= pdf.getPageCount()) throw new Error('Invalid annotation page.');
    let mapping = cache.get(ann.page);
    if (!mapping) { mapping = await getMapping(ann.page); cache.set(ann.page, mapping); }
    const page = pdf.getPage(ann.page);
    const matrix = mapping.transform;
    const angle = degrees(uprightAngle(matrix));
    const color = colorFromHex(ann.color);
    if (ann.kind === 'text') {
      const value = ann.content.trim();
      if (!value) continue;
      const base = screenToPdf({ x: ann.x, y: ann.y + ann.size }, matrix);
      try {
        page.drawText(value, {
          x: base.x, y: base.y, rotate: angle,
          size: ann.size, font, color, lineHeight: ann.size * 1.22,
        });
      } catch {
        throw new Error('Some text cannot be encoded in the basic PDF font. Please use Latin letters and common punctuation.');
      }
    } else if (ann.kind === 'highlight') {
      if (ann.width < 2 || ann.height < 2) continue;
      const bottomLeft = screenToPdf({ x: ann.x, y: ann.y + ann.height }, matrix);
      page.drawRectangle({ x: bottomLeft.x, y: bottomLeft.y,
        width: ann.width, height: ann.height, rotate: angle,
        color, opacity: 0.28,
      });
    } else if (ann.kind === 'draw') {
      for (let i = 1; i < ann.points.length; i++) {
        page.drawLine({
          start: screenToPdf(ann.points[i - 1], matrix),
          end: screenToPdf(ann.points[i], matrix),
          thickness: ann.size, color, opacity: 1,
        });
      }
      if (ann.points.length === 1) {
        const center = screenToPdf(ann.points[0], matrix);
        page.drawCircle({ x: center.x, y: center.y, size: ann.size / 2, color });
      }
    } else if (ann.kind === 'image' && ann.imageData) {
      let embedded = images.get(ann.imageData);
      if (!embedded) {
        const { data, format } = imageBytes(ann.imageData);
        embedded = format === 'png' ? await pdf.embedPng(data) : await pdf.embedJpg(data);
        images.set(ann.imageData, embedded);
      }
      const bottomLeft = screenToPdf({ x: ann.x, y: ann.y + ann.height }, matrix);
      page.drawImage(embedded, { x: bottomLeft.x, y: bottomLeft.y,
        width: ann.width, height: ann.height, rotate: angle,
      });
    }
  }
  return { name: `${safeFileStem(file.name)}-edited.pdf`, bytes: await pdf.save() };
}
