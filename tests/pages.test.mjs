import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePageRange, parseSplitRanges, safeFileStem, prettyBytes, pageNumberLabel, validateWatermarkText, compressionSettings, compressionSavings } from '../src/lib/pages.ts';

test('parses pages as zero-based indexes in input order', () => {
  assert.deepEqual(parsePageRange('3,1-2,2', 5), [2, 0, 1]);
});
test('rejects bad page ranges', () => {
  for (const range of ['0', '4-2', '6', '1,,2', 'abc', '1-99', '']) {
    assert.throws(() => parsePageRange(range, 5));
  }
});
test('splits each comma-separated range into a separate group', () => {
  assert.deepEqual(parseSplitRanges('1-2,4-5', 5), [[0, 1], [3, 4]]);
});
test('safely names outputs and displays file sizes', () => {
  assert.equal(safeFileStem('my<report>.pdf'), 'my_report_');
  assert.equal(prettyBytes(2048), '2.0 KB');
});

test('page numbering respects the first number and rejects invalid settings', () => {
  assert.equal(pageNumberLabel(0,7), '7');
  assert.equal(pageNumberLabel(2,7,4,true), '9 / 10');
  assert.throws(()=>pageNumberLabel(-1,1));
  assert.throws(()=>pageNumberLabel(0,0));
});
test('watermark text requires a single line with a maximum of 80 characters', () => {
  assert.equal(validateWatermarkText('  DRAFT  '), 'DRAFT');
  assert.throws(()=>validateWatermarkText('  '));
  assert.throws(()=>validateWatermarkText('x'.repeat(81)));
  assert.throws(()=>validateWatermarkText('hello\nworld'));
});

test('compression presets are bounded, ordered and reject unexpected levels', () => {
  const small = compressionSettings('small');
  const balanced = compressionSettings('balanced');
  const clear = compressionSettings('clear');
  assert.ok(small.scale < balanced.scale && balanced.scale < clear.scale);
  assert.ok(small.jpegQuality < balanced.jpegQuality && balanced.jpegQuality < clear.jpegQuality);
  assert.throws(() => compressionSettings('unknown'));
});
test('compression savings never claims progress when file becomes bigger', () => {
  assert.equal(compressionSavings(1000, 450), 55);
  assert.equal(compressionSavings(1000, 1200), 0);
  assert.throws(() => compressionSavings(0, 10));
});

import { combineDocuments,sourceLabel,balancedPassages,labelModelCitations,makePassages,checkModelCitations,retrieveQuestionPassages } from '../src/lib/ai/document.ts';

test('multi-PDF sources maintain distinct page references',()=>{
  const data=combineDocuments([{name:'a.pdf',pages:[{page:1,text:'Alpha findings are detailed and useful.'}]},{name:'b.pdf',pages:[{page:1,text:'Beta outcomes discuss separate results.'}]}]);
  assert.deepEqual(data.pages.map(p=>p.page),[1,2]);
  assert.equal(sourceLabel(data.sources,2),'b.pdf · p. 1');
  assert.equal(labelModelCitations('See [Page 2] and [Page 999]',data.sources,[2]),'See [b.pdf · p. 1] and [unverified page reference]');
});
test('balanced passages cover distinct documents when capacity allows',()=>{
  const data=combineDocuments([{name:'first.pdf',pages:[{page:1,text:'First document reports annual results.'}]},{name:'second.pdf',pages:[{page:1,text:'Second document reports quarterly outcomes.'}]}]);
  const result=balancedPassages(makePassages(data.pages),data.sources,2);
  assert.deepEqual(new Set(result.passages.map(p=>p.page)),new Set([1,2]));
});

test('citation checker identifies supported and invented source references',()=>{
  const sources=[{page:1,document:'alpha.pdf',originalPage:4},{page:2,document:'beta.pdf',originalPage:2}];
  const result=checkModelCitations('Finding [Page 1]; other [Page 3].',sources,[1]);
  assert.equal(result.rejectedCount,1);
  assert.deepEqual(result.citedPages,[1]);
  assert.match(result.answer,/unverified page reference/);
});
test('comparison questions retrieve evidence from multiple PDFs',()=>{
  const combined=combineDocuments([
    {name:'first.pdf',pages:[{page:1,text:'Revenue increased to 20 million after new subscriptions launched.'}]},
    {name:'second.pdf',pages:[{page:1,text:'Revenue decreased to 12 million following cancellations.'}]}
  ]);
  const matched=retrieveQuestionPassages(makePassages(combined.pages),combined.sources,'Compare revenue between both documents',7);
  assert.deepEqual(new Set(matched.map(p=>p.page)),new Set([1,2]));
});

import {segmentInkRows,expandedLineBounds} from '../src/lib/handwritingSegmentation.ts';
test('handwriting segmentation separates text lines despite sparse descenders',()=>{
  const counts=Array(160).fill(0);
  for(let y=20;y<=43;y++) counts[y]=52;
  for(let y=79;y<=106;y++) counts[y]=60;
  for(let y=44;y<=78;y++) counts[y]=3;
  const lines=segmentInkRows(counts,1200);
  assert.equal(lines.length,2);
  const first=expandedLineBounds(lines,0,160),second=expandedLineBounds(lines,1,160);
  assert.ok(first.bottom<=second.top);
});
