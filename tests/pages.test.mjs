import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePageRange, parseSplitRanges, safeFileStem, prettyBytes } from '../src/lib/pages.ts';

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
