import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyMediaLink,configuredMediaApi,availableDownloadQualities} from '../src/lib/mediaLinks.ts';

test('recognizes supported public video-post URL shapes',()=>{
  assert.equal(classifyMediaLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),'YouTube');
  assert.equal(classifyMediaLink('https://youtu.be/dQw4w9WgXcQ'),'YouTube');
  assert.equal(classifyMediaLink('https://youtube.com/shorts/dQw4w9WgXcQ'),'YouTube');
  assert.equal(classifyMediaLink('https://www.instagram.com/reel/CrDk7r99/'),'Instagram');
  assert.equal(classifyMediaLink('https://x.com/creator/status/1234567890123456789'),'X');
  assert.equal(classifyMediaLink('https://twitter.com/creator/status/1234567890123456789'),'X');
  assert.equal(classifyMediaLink('https://www.threads.net/@creator/post/CrDk7r99'),'Threads');
});
test('rejects private, spoofed, unrecognized and insecure URLs',()=>{
  for(const url of ['http://youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://evil.example/reel/CrDk7r99/',
    'https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/playlist?list=PL123456',
    'https://127.0.0.1/video.mp4',
    'https://example.com/a.mp4',
    'https://www.instagram.com/accounts/login/','not a link']) {
    assert.equal(classifyMediaLink(url),null,url);
  }
});
test('media backend configuration allows TLS origins, not credentials',()=>{
  assert.equal(configuredMediaApi('https://media.example.net/'),'https://media.example.net');
  assert.equal(configuredMediaApi(''),null);
  assert.equal(configuredMediaApi('https://user:pass@media.example.net'),null);
  assert.equal(configuredMediaApi('http://127.0.0.1:10000'),'http://127.0.0.1:10000');
  assert.equal(configuredMediaApi('javascript:alert(1)'),null);
});

test('quality choices never advertise unsupported Full HD',()=>{
  assert.deepEqual(availableDownloadQualities([360,480]),['best','480']);
  assert.deepEqual(availableDownloadQualities([720,480]),['best','720','480']);
  assert.deepEqual(availableDownloadQualities([1080,720,480]),['best','1080','720','480']);
  assert.deepEqual(availableDownloadQualities([]),['best']);
  assert.deepEqual(availableDownloadQualities([NaN,-42]),['best']);
});
