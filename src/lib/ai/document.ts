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


/** A local-only provenance index. The gateway receives global page numbers, not filenames. */
export type SourcePage = { page: number; document: string; originalPage: number };
export function combineDocuments(documents: { name: string; pages: DocumentPage[] }[]): { pages: DocumentPage[]; sources: SourcePage[] } {
  const pages: DocumentPage[] = [];
  const sources: SourcePage[] = [];
  for (const document of documents) {
    for (const entry of document.pages) {
      const page = pages.length + 1;
      pages.push({ page, text: entry.text });
      sources.push({ page, document: document.name, originalPage: entry.page });
    }
  }
  return { pages, sources };
}
export function sourceLabel(sources: SourcePage[], page: number): string {
  const found = sources.find(source => source.page === page);
  return found ? `${found.document} · p. ${found.originalPage}` : `Unknown source page ${page}`;
}
/** Global excerpts are sampled round-robin so one long file cannot hide the others. */
export function balancedPassages(passages: Passage[], sources: SourcePage[], limit = 7): { passages: Passage[]; sampled: boolean } {
  if (limit < 1) return { passages: [], sampled: passages.length > 0 };
  const grouped = new Map<string, Passage[]>();
  const byPage = new Map(sources.map(source => [source.page, source.document]));
  for (const passage of passages) {
    const document = byPage.get(passage.page) ?? '';
    if (!grouped.has(document)) grouped.set(document, []);
    grouped.get(document)!.push(passage);
  }
  const selected: Passage[] = [];
  let position = 0;
  // Round-robin positions are spread throughout each document, including its ending.
  const distributions = [...grouped.values()].map(group => samplePassages(group, Math.min(limit, group.length)).passages);
  while (selected.length < limit && distributions.some(group => position < group.length)) {
    for (const group of distributions) {
      if (selected.length === limit) break;
      if (group[position]) selected.push(group[position]);
    }
    position++;
  }
  return { passages: selected, sampled: passages.length > selected.length };
}
/** Rank question evidence using local lexical overlap, rare-term weighting, and per-PDF coverage.
 *  Comparisons deliberately include evidence from each document when <= 5 PDFs are selected.
 *  This is extractive retrieval, not a factual correctness or semantic verification guarantee.
 */
export function retrieveQuestionPassages(passages: Passage[], sources: SourcePage[], question: string, limit = 7): Passage[] {
  if (!passages.length || limit < 1) return [];
  const words = new Set(tokens(question));
  const sourceByPage = new Map(sources.map(item => [item.page, item.document]));
  const documents = [...new Set(sources.map(item => item.document))];
  const comparing = documents.length > 1 && /\b(compare|comparison|difference|different|versus|vs\.?|across|between|each|both|all|change|changed)\b/i.test(question);
  const normalizedNames = new Map(documents.map(name => [name, new Set(tokens(name.replace(/\.pdf$/i, '')))]));
  const frequency = new Map<string, number>();
  for (const passage of passages) {
    for (const term of new Set(tokens(passage.text))) frequency.set(term, (frequency.get(term) ?? 0) + 1);
  }
  const scored = passages.map((passage, index) => {
    const wordsInPassage = new Set(tokens(passage.text));
    const matches = [...words].filter(term => wordsInPassage.has(term));
    const doc = sourceByPage.get(passage.page) ?? '';
    const nameMatches = [...words].filter(term => normalizedNames.get(doc)?.has(term)).length;
    const score = matches.reduce((sum, term) => sum + 1 / Math.log2(2 + (frequency.get(term) ?? 1)), 0)
      + Math.min(2, nameMatches) * 0.45;
    return { passage, index, doc, score, matches: matches.length };
  });
  if (!comparing && !scored.some(item => item.score > 0)) return [];
  const sorted = scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const selected: typeof sorted = [];
  const used = new Set<number>();
  const add = (item: typeof sorted[number]) => {
    if (used.has(item.index) || selected.length >= limit) return;
    used.add(item.index); selected.push(item);
  };
  if (comparing && documents.length <= limit) {
    for (const doc of documents) {
      const matches = sorted.filter(item => item.doc === doc);
      const best = matches.find(item => item.score > 0) ?? matches[0];
      if (best) add(best);
    }
  }
  for (const item of sorted) {
    if (item.score <= 0) continue;
    add(item);
  }
  if (comparing && selected.length < limit) {
    for (const item of sorted) add(item);
  }
  return selected.map(item => ({ ...item.passage, score: item.score }));
}

export type CheckedCitations = {
  answer: string;
  citedPages: number[];
  rejectedCount: number;
  hasPageCitations: boolean;
};
/** Verify page attribution against the exact passages sent to the model.
 *  Page attribution is NOT verification that a generated factual claim is true.
 */
export function checkModelCitations(answer: string, sources: SourcePage[], consulted: number[]): CheckedCitations {
  const available = new Set(sources.map(source => source.page));
  const allowed = new Set(consulted.filter(page => Number.isSafeInteger(page) && available.has(page)));
  const cited = new Set<number>();
  let rejectedCount = 0;
  let hasPageCitations = false;
  const output = answer.replace(/\[Page\s+(\d+)\]/gi, (_whole, id: string) => {
    hasPageCitations = true;
    const page = Number(id);
    if (!allowed.has(page)) { rejectedCount++; return '[unverified page reference]'; }
    cited.add(page);
    return '[' + sourceLabel(sources, page) + ']';
  });
  return { answer: output, citedPages: [...cited], rejectedCount, hasPageCitations };
}
/** Retained for existing call sites that need only the formatted answer. */
export function labelModelCitations(answer: string, sources: SourcePage[], consulted: number[]): string {
  return checkModelCitations(answer, sources, consulted).answer;
}
