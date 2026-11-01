/** Generate installable DocOrbit PNG icons without paid services or extra npm deps.
 * The artwork matches DocOrbit's existing planet/orbit favicon.
 * Build-time output lives in public/icons and is copied by Vite.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const output = resolve('public/icons');
mkdirSync(output, { recursive: true });

const rgba = (r, g, b, a = 255) => [r, g, b, a];
const dark = rgba(20, 24, 49);
const orbit = rgba(139, 135, 255);
const planet = rgba(89, 94, 235);
const mint = rgba(116, 238, 210);
const empty = rgba(0, 0, 0, 0);

function insideRounded(x, y, left, top, w, h, radius) {
  const nearX = Math.max(left + radius, Math.min(x, left + w - radius));
  const nearY = Math.max(top + radius, Math.min(y, top + h - radius));
  return Math.hypot(x - nearX, y - nearY) <= radius;
}

function sample(px, py, maskable) {
  // The solid maskable background gives Android freedom to crop the outer 20%.
  const x = maskable ? 32 + (px - 32) / .76 : px;
  const y = maskable ? 32 + (py - 32) / .76 : py;
  let fill = maskable || insideRounded(x, y, 0, 0, 64, 64, 16) ? dark : empty;
  const dx = x - 32, dy = y - 33;
  const theta = -29 * Math.PI / 180;
  const u = Math.cos(theta) * dx + Math.sin(theta) * dy;
  const v = -Math.sin(theta) * dx + Math.cos(theta) * dy;
  const radius = Math.hypot(u / 23, v / 11);
  if (Math.abs(radius - 1) < .16) fill = orbit;
  if ((x - 32) ** 2 + (y - 32) ** 2 < 11 ** 2) fill = planet;
  if ((x - 53) ** 2 + (y - 20) ** 2 < 5.2 ** 2) fill = mint;
  return fill;
}

// PNG with an RGBA8 scanline, deflated by Node's standard library.
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let crc = n;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xEDB88320 : crc >>> 1;
  crcTable[n] = crc >>> 0;
}
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const byte of buf) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, checksum]);
}
function createIcon(size, maskable = false) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const offset = y * (size * 4 + 1);
    raw[offset] = 0;
    for (let x = 0; x < size; x++) {
      const channels = [0, 0, 0, 0];
      for (const ax of [.25, .75]) {
        for (const ay of [.25, .75]) {
          const pixel = sample((x + ax) / size * 64, (y + ay) / size * 64, maskable);
          for (let c = 0; c < 4; c++) channels[c] += pixel[c];
        }
      }
      const dst = offset + 1 + x * 4;
      for (let c = 0; c < 4; c++) raw[dst + c] = Math.round(channels[c] / 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return png;
}

for (const [name, size, maskable] of [
  ['docorbit-192.png', 192, false],
  ['docorbit-512.png', 512, false],
  ['docorbit-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true],
]) {
  const png = createIcon(size, maskable);
  writeFileSync(resolve(output, name), png);
  console.log('Generated', name, png.byteLength, 'bytes');
}
