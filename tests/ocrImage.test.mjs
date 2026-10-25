import test from 'node:test';
import assert from 'node:assert/strict';
import {isInkPixel} from '../src/lib/ocrImage.ts';

test('colored decorative pixels are excluded from neutral handwriting mode',()=>{
  assert.equal(isInkPixel(0,0,0,true),true);
  assert.equal(isInkPixel(70,70,70,true),true);
  assert.equal(isInkPixel(20,85,25,true),false); // holly green
  assert.equal(isInkPixel(205,28,15,true),false); // red signature
  assert.equal(isInkPixel(20,85,25,false),true); // user wants colored writing
  assert.equal(isInkPixel(255,255,255,true),false);
  assert.equal(isInkPixel(120,247,248,true),false); // cyan paper
});
