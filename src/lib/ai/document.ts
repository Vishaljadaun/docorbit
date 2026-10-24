/** Pure document preparation utilities. No AI service or document upload is involved. */
export type DocumentPage = { page: number; text: string };
export type Passage = { page: number; text: string; score: number };

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

const STOP = new Set('a an the and or but if is are was were to of at by with as from for on in into it its this that these those be been being have has had do does did how what when where which who why can could should would about please tell me explain document pdf page'.split(' '));

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter(w => !STOP.has(w));
}

/** Split into reasonably small prompt-sized slices while preserving page provenance. */
export function makePassages(pages: DocumentPage[], maxChars = 850): Passage[] {
  const out: Passage[] = [];
  for (const page of pages) {
    const text = normalizeText(page.text);
    if (!text) continue;
    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
    let current = '';
    const flush = () => { if (current) { out.push({ page: page.page, text: current.trim(), score: 0 }); current = ''; } };
    for (const raw of sentences) {
      let sentence = normalizeText(raw);
      while (sentence.length > maxChars) {
        flush();
        let cut = sentence.lastIndexOf(' ', maxChars);
        if (cut < maxChars / 2) cut = maxChars;
        out.push({ page: page.page, text: sentence.slice(0, cut).trim(), score: 0 });
        sentence = sentence.slice(cut).trim();
      }
      if (!sentence) continue;
      if (current.length + sentence.length + 1 > maxChars) flush();
      current += (current ? ' ' : '') + sentence;
    }
    flush();
  }
  return out;
}

/** Spread summary samples across the document instead of always reading just page one. */
export function samplePassages(passages: Passage[], maxPassages = 5): { passages: Passage[]; sampled: boolean } {
  if (passages.length <= maxPassages) return { passages, sampled: false };
  if (maxPassages <= 1) return { passages: [passages[0]], sampled: true };
  const indices = new Set<number>();
  for (let i = 0; i < maxPassages; i++) indices.add(Math.round(i * (passages.length - 1) / (maxPassages - 1)));
  return { passages: [...indices].map(index => passages[index]), sampled: true };
}

/** Lexical retrieval is local and does not claim semantic/LLM matching quality. */
export function relevantPassages(passages: Passage[], question: string, limit = 3): Passage[] {
  const query = new Set(tokens(question));
  if (query.size === 0) return [];
  return passages.map(passage => {
    const body = new Set(tokens(passage.text));
    const hits = [...query].filter(word => body.has(word)).length;
    return { ...passage, score: hits / query.size };
  }).filter(p => p.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}
