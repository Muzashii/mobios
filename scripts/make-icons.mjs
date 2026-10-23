// Renders the app icon (graphite tile + laser-orange bolt) to PNG without dependencies.
// Usage: node scripts/make-icons.mjs  → public/icons/*.png
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const BG = [0x17, 0x18, 0x1c];
const ACCENT = [0xff, 0x6b, 0x2c];
// Bolt from public/favicon.svg (32-unit box).
const BOLT = [[9, 7], [18, 7], [15, 15], [22, 15], [12, 26], [15, 18], [9, 18]];

function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** size px; `safe` shrinks the artwork (maskable icons need a 10% safe zone); `rounded` tile corners. */
function render(size, { safe = 1, rounded = true } = {}) {
  const ss = 4; // supersampling for anti-aliasing
  const px = new Uint8Array(size * size * 4);
  const r = rounded ? size * 0.22 : 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let a = 0, bolt = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const fx = x + (sx + 0.5) / ss, fy = y + (sy + 0.5) / ss;
        // Rounded square mask.
        const dx = Math.max(r - fx, fx - (size - r), 0), dy = Math.max(r - fy, fy - (size - r), 0);
        if (r > 0 && dx * dx + dy * dy > r * r) continue;
        a++;
        // Bolt in a 32-unit box centred and scaled by `safe`.
        const u = ((fx / size - 0.5) / safe + 0.5) * 32, v = ((fy / size - 0.5) / safe + 0.5) * 32;
        if (inside(BOLT, u, v)) bolt++;
      }
      const o = (y * size + x) * 4;
      const t = a ? bolt / a : 0;
      for (let k = 0; k < 3; k++) px[o + k] = Math.round(BG[k] * (1 - t) + ACCENT[k] * t);
      px[o + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  return encodePNG(size, size, px);
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = path.resolve('public/icons');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon-192.png'), render(192));
fs.writeFileSync(path.join(out, 'icon-512.png'), render(512));
fs.writeFileSync(path.join(out, 'maskable-512.png'), render(512, { safe: 0.78, rounded: false }));
fs.writeFileSync(path.join(out, 'apple-touch-icon.png'), render(180, { rounded: false }));
console.log('ícones gerados em', out);
