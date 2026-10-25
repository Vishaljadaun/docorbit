import test from 'node:test';
import assert from 'node:assert/strict';
import {ocrToCsv,ocrToText} from '../src/lib/ocrExport.ts';
test('OCR exports text with original page labels',()=>{
 assert.equal(ocrToText([{page:3,text:' Hello '},{page:4,text:' World '}]),'Page 3\nHello\n\nPage 4\nWorld');
});
test('OCR CSV escapes quotes and prevents formula injection in Excel',()=>{
 const csv=ocrToCsv([{page:1,text:'=HYPERLINK("x")'},{page:2,text:'hello, world'}]);
 assert.ok(csv.startsWith('\uFEFFPage,Recognized text'));
 assert.match(csv,/'=HYPERLINK\(""x""\)/);
 assert.match(csv,/"hello, world"/);
});
