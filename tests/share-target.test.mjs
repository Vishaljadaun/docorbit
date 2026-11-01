import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

function loadShareHandler() {
  // Use the project's TypeScript compiler so these tests exercise the real helper.
  function transpile(path) {
    return ts.transpileModule(read(path), {
      compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
    }).outputText;
  }
  const links = {};
  runInNewContext(transpile('src/lib/mediaLinks.ts'), {exports: links, URL});
  const handler = {};
  runInNewContext(transpile('src/lib/sharedMedia.ts'), {
    exports: handler, URL, URLSearchParams,
    require: specifier => {
      if (specifier === './mediaLinks') return links;
      throw new Error('Unexpected import: ' + specifier);
    },
  });
  return handler;
}

test('installable manifest registers a GET share target within app scope', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.share_target.method, 'GET');
  assert.equal(manifest.share_target.action, './?source=share');
  assert.deepEqual(manifest.share_target.params, {
    title: 'shared_title', text: 'shared_text', url: 'shared_url',
  });
});

test('Instagram shared text is parsed and accepted for automatic preview', () => {
  const {sharedMediaLink, isSharedMediaLaunch} = loadShareHandler();
  const link = 'https://www.instagram.com/reel/C4ReeL98765/?igsh=abc';
  const query = '?source=share&shared_text=' + encodeURIComponent('Watch this reel! ' + link);
  assert.equal(sharedMediaLink(query), link);
  assert.equal(isSharedMediaLaunch(query), true);
});

test('share receiver handles Instagram captions, YouTube URLs, and other posts', () => {
  const {sharedMediaLink} = loadShareHandler();
  const instagram = 'https://www.instagram.com/p/ABCxyz12345/';
  const youtube = 'https://youtu.be/abcdefghijk';
  const x = 'https://x.com/example/status/1234567890123456789';
  const threads = 'https://www.threads.net/@example/post/ABCdef12345';
  for (const link of [instagram, youtube, x, threads]) {
    assert.equal(sharedMediaLink('?shared_text=' + encodeURIComponent('See ' + link)), link);
  }
  assert.equal(sharedMediaLink('?shared_url=' + encodeURIComponent(instagram)), instagram);
});

test('unrelated, deceptive, or private URLs are ignored', () => {
  const {sharedMediaLink, isSharedMediaLaunch} = loadShareHandler();
  assert.equal(sharedMediaLink('?shared_text=' + encodeURIComponent('https://evil.example/hi')), '');
  assert.equal(sharedMediaLink('?shared_text=' + encodeURIComponent('https://instagram.com.evil.example/reel/ABCxyz12345/')), '');
  assert.equal(sharedMediaLink('?shared_text=' + encodeURIComponent('https://www.instagram.com/accounts/login/')), '');
  assert.equal(isSharedMediaLaunch('?foo=bar'), false);
});
