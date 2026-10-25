/** Convert a PDF page range like "1-3, 5, 7-9" to zero-based page indexes. */
export function parsePageRange(input: string, pageCount: number): number[] {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) throw new Error('The PDF has no pages.');
  const parts = input.split(',').map(s => s.trim());
  if (parts.length === 0 || parts.some(s => !s)) throw new Error('Enter a page range, such as 1-3, 5.');
  const result: number[] = [];
  for (const token of parts) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(token);
    if (!match) throw new Error(`Invalid range "${token}". Use 1-3, 5.`);
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > pageCount) {
      throw new Error(`Range "${token}" must be between 1 and ${pageCount}.`);
    }
    for (let page = start; page <= end; page++) {
      const index = page - 1;
      if (!result.includes(index)) result.push(index);
    }
  }
  return result;
}

/** Split on comma-delimited ranges, producing one output document for each range. */
export function parseSplitRanges(input: string, pageCount: number): number[][] {
  const parts = input.split(',').map(s => s.trim());
  if (parts.some(s => !s)) throw new Error('Enter comma-separated ranges, such as 1-2, 3-4.');
  return parts.map(part => parsePageRange(part, pageCount));
}

export function safeFileStem(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[^\w\-. ]/g, '_').slice(0, 70) || 'document';
}

export function prettyBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}


/** Consistent labels for numbered PDF pages; start values are 1-based. */
export function pageNumberLabel(index: number, start = 1, total?: number, withTotal = false): string {
  if (!Number.isSafeInteger(index) || index < 0 || !Number.isSafeInteger(start) || start < 1 || start > 999999) {
    throw new Error('Starting page number must be an integer between 1 and 999999.');
  }
  if (withTotal && (!Number.isSafeInteger(total) || (total ?? 0) < 1)) {
    throw new Error('A valid page count is required.');
  }
  return withTotal ? `${start + index} / ${start + (total ?? 1) - 1}` : String(start + index);
}

/** Keep input within the built-in Helvetica encoding supported by pdf-lib. */
export function validateWatermarkText(input: string): string {
  const value = input.trim();
  if (!value || value.length > 80 || /[\r\n\x00-\x1f]/.test(value)) {
    throw new Error('Enter watermark text containing 1–80 characters on one line.');
  }
  return value;
}
