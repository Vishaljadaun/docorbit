import test from 'node:test';
import assert from 'node:assert/strict';
import { makePassages, normalizeText, relevantPassages, samplePassages } from '../src/lib/ai/document.ts';

test('normalizes document whitespace', () => {
  assert.equal(normalizeText('  The   PDF\nsummary \t works '), 'The PDF summary works');
});

test('splits long text into bounded passages, retaining page numbers', () => {
  const pages = [{ page: 1, text: 'A'.repeat(490) }, { page: 2, text: 'Beta fact. '.repeat(80) }];
  const chunks = makePassages(pages, 100);
  assert.ok(chunks.length > 5);
  assert.ok(chunks.every(chunk => chunk.text.length <= 100));
  assert.ok(chunks.some(chunk => chunk.page === 2));
});

test('samples a document across its entire length', () => {
  const excerpts = Array.from({ length: 15 }, (_, i) => ({ page: i + 1, text: `Page ${i + 1}`, score: 0 }));
  const result = samplePassages(excerpts, 5);
  assert.equal(result.passages.length, 5);
  assert.deepEqual(result.passages.map(x => x.page), [1, 5, 8, 12, 15]);
  assert.equal(result.sampled, true);
});

test('ranks relevant passages and does not invent results for unmatched words', () => {
  const excerpts = makePassages([
    { page: 1, text: 'Revenue increased year over year by ten percent.' },
    { page: 2, text: 'The company added several cybersecurity controls this year.' },
  ]);
  assert.equal(relevantPassages(excerpts, 'What happened to revenue?', 1)[0].page, 1);
  assert.deepEqual(relevantPassages(excerpts, 'What is the cricket score?'), []);
});
