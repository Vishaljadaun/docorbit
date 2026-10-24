import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizedRect, screenToPdf, uprightAngle } from '../src/lib/editorGeometry.ts';

test('page screen coordinates correctly invert default PDF viewport', () => {
  const map = [1, 0, 0, -1, 0, 842];
  assert.deepEqual(screenToPdf({ x: 100, y: 200 }, map), { x: 100, y: 642 });
  assert.equal(uprightAngle(map), 0);
});

test('editor coordinates remain upright on a rotated PDF page', () => {
  const rotated90 = [0, 1, 1, 0, 0, 0];
  assert.deepEqual(screenToPdf({ x: 40, y: 80 }, rotated90), { x: 80, y: 40 });
  assert.equal(uprightAngle(rotated90), 90);
});

test('highlight rectangles normalize drags in any direction', () => {
  assert.deepEqual(normalizedRect({ x: 120, y: 50 }, { x: 20, y: 90 }), { x: 20, y: 50, width: 100, height: 40 });
});

test('invalid singular transforms are rejected', () => {
  assert.throws(() => screenToPdf({ x: 1, y: 1 }, [0, 0, 0, 0, 0, 0]));
});
