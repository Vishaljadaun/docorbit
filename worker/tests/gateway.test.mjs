import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { allowedOrigin, validateRequest, buildMessages } from '../src/index.js';

const valid={kind:'ask',question:'What was the revenue?',contexts:[{page:4,text:'Revenue for 2025 was ten million dollars.'}]};

test('only configured site origin can call gateway',()=>{
  assert.equal(allowedOrigin('https://vishaljadaun.github.io'),true);
  assert.equal(allowedOrigin('https://vishaljadaun.github.io.attacker.com'),false);
  assert.equal(allowedOrigin('https://evil.org'),false);
});
test('payload validation enforces excerpt and question limits',()=>{
  assert.equal(validateRequest(valid),null);
  assert.match(validateRequest({...valid,question:'Hi'}),/question/i);
  assert.match(validateRequest({...valid,contexts:[{page:1,text:'a'.repeat(1301)}]}),/Invalid passage/);
  assert.match(validateRequest({...valid,kind:'something'}),/Unknown/);
});
test('prompt includes source labels and rejects document commands as instructions',()=>{
  const messages=buildMessages(valid);
  assert.match(messages[0].content,/untrusted evidence/);
  assert.match(messages.at(-1).content,/\[Page 4\]/);
  assert.match(messages.at(-1).content,/revenue/i);
});
test('gateway fails closed without secret and rate limits', async()=>{
  const res=await worker.fetch(new Request('https://unit.test/chat',{method:'POST',
    headers:{Origin:'https://vishaljadaun.github.io','Content-Type':'application/json'},
    body:JSON.stringify(valid)}),{OPENROUTER_API_KEY:'dummy'});
  assert.equal(res.status,503);
});

import { visibleAnswer, emptyAnswerReason } from '../src/index.js';

test('handles normal and structured assistant text',()=>{
  assert.equal(visibleAnswer({choices:[{message:{content:'  Hello PDF  '}}]}),'Hello PDF');
  assert.equal(visibleAnswer({choices:[{message:{content:[{type:'text',text:'Answer'},{type:'reasoning',text:'private'}]}}]}),'Answer');
});
test('detects reasoning token exhaustion without leaking reasoning text',()=>{
  const result={choices:[{finish_reason:'length',message:{content:'',reasoning:'internal'}}],usage:{completion_tokens:650,completion_tokens_details:{reasoning_tokens:650}}};
  assert.equal(visibleAnswer(result),'');
  assert.equal(emptyAnswerReason(result),'reasoning_budget');
});
test('treats content filter separately from empty response',()=>{
  assert.equal(emptyAnswerReason({choices:[{finish_reason:'content_filter',message:{content:''}}]}),'filtered');
});
