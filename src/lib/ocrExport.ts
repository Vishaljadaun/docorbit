/** Plain text exports from OCR. CSV stores one original page per row. */
export type RecognizedPage = { page: number; text: string };
export function ocrToText(pages: RecognizedPage[]): string {
  return pages.map(p => 'Page ' + p.page + '\n' + p.text.trim()).join('\n\n');
}
export function ocrToCsv(pages: RecognizedPage[]): string {
  const quote = (v: string) => '"' + v.replace(/"/g,'""').replace(/^[=+\-@\t\r]/,'\'$&') + '"';
  return '\uFEFFPage,Recognized text\r\n' + pages.map(p => p.page + ',' + quote(p.text)).join('\r\n');
}
