import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

test('build-time PNG icons are valid and sized for Android/iOS installation', ()=>{
  execFileSync(process.execPath,['scripts/generate-pwa-icons.mjs'],{stdio:'pipe'});
  const sizes=new Map([
    ['docorbit-192.png',192],
    ['docorbit-512.png',512],
    ['docorbit-maskable-512.png',512],
    ['apple-touch-icon.png',180],
  ]);
  for(const [name,size] of sizes){
    const data=readFileSync('public/icons/'+name);
    assert.equal(data.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(data.readUInt32BE(16),size,name+' width');
    assert.equal(data.readUInt32BE(20),size,name+' height');
    assert.ok(data.byteLength>1000,name+' should contain actual image data');
  }
});

test('manifest is an installable standalone PWA with both maskable and plain icons', ()=>{
  const manifest=JSON.parse(readFileSync('public/manifest.webmanifest','utf8'));
  assert.equal(manifest.display,'standalone');
  assert.equal(manifest.start_url,'./');
  assert.equal(manifest.scope,'./');
  assert.ok(manifest.name.includes('DocOrbit'));
  assert.ok(manifest.icons.some(icon=>icon.purpose==='maskable'&&icon.sizes==='512x512'));
  assert.ok(manifest.icons.some(icon=>icon.purpose==='any'&&icon.sizes==='192x192'));
});

test('service worker is scoped and never caches user PDFs, social videos or provider data', ()=>{
  const worker=readFileSync('public/sw.js','utf8');
  assert.match(worker,/url\.origin !== self\.location\.origin/);
  assert.match(worker,/req\.destination === "script"/);
  assert.match(worker,/req\.destination === "style"/);
  assert.match(worker,/req\.mode === "navigate"/);
  assert.doesNotMatch(worker,/cache\.put\(req/);
  // Files are not added to cache unless they are recognized hashed JS/CSS.
  assert.match(worker,/url\.pathname\.startsWith\(BASE \+ "assets\/"/);
});
