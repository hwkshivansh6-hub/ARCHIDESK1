const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ (-1)) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type);
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function createPng(width, height, drawFn) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // 8 bits
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rawRows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0; // Filter None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = drawFn(x, y, width, height);
      const idx = 1 + x * 4;
      row[idx] = r;
      row[idx + 1] = g;
      row[idx + 2] = b;
      row[idx + 3] = a;
    }
    rawRows.push(row);
  }

  const compressed = zlib.deflateSync(Buffer.concat(rawRows), { level: 6 });
  const idat = makeChunk('IDAT', compressed);
  const iend = makeChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, makeChunk('IHDR', ihdr), idat, iend]);
}

// Draw architectural set-square triangle logo
function drawArchitectIcon(x, y, w, h) {
  const nx = x / w;
  const ny = y / h;

  // Background: Dark Slate #181c20
  let r = 24, g = 28, b = 32, a = 255;

  // Subtle border highlight
  const pad = 0.04;
  if (nx < pad || nx > (1 - pad) || ny < pad || ny > (1 - pad)) {
    return [24, 28, 32, 255];
  }

  // Set-square triangle coordinates (Right triangle)
  // Outer triangle vertices: (0.2, 0.8), (0.8, 0.8), (0.2, 0.2)
  // Inner cutout vertices: (0.32, 0.72), (0.68, 0.72), (0.32, 0.36)
  
  const inOuter = (nx >= 0.18 && ny <= 0.82 && (nx - 0.18) <= (0.82 - ny) * 1.02);
  const inInner = (nx >= 0.32 && ny <= 0.70 && (nx - 0.32) <= (0.70 - ny) * 1.05);

  if (inOuter && !inInner) {
    // Blueprint Gold/Amber Accent #b47d3c -> #f59e0b gradient
    const grad = ny;
    r = Math.round(180 + grad * 50);
    g = Math.round(125 + grad * 35);
    b = Math.round(60 + grad * 20);
    a = 255;
  } else if (inInner) {
    // Inner hollow dark background
    r = 15; g = 23; b = 42; a = 255;
  } else {
    // Check ruler scale ticks along the bottom and left
    if (ny >= 0.84 && ny <= 0.87 && nx >= 0.18 && nx <= 0.82) {
      // Scale tick marks
      const tick = Math.floor(nx * 40) % 2 === 0;
      if (tick) { r = 148; g = 163; b = 184; }
    }
  }

  return [r, g, b, a];
}

const assetsDir = path.join(__dirname, 'public', 'assets');
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

console.log('Generating 192x192 PNG...');
const png192 = createPng(192, 192, drawArchitectIcon);
fs.writeFileSync(path.join(assetsDir, 'icon-192.png'), png192);

console.log('Generating 512x512 PNG...');
const png512 = createPng(512, 512, drawArchitectIcon);
fs.writeFileSync(path.join(assetsDir, 'icon-512.png'), png512);

console.log('Generating apple-touch-icon.png (180x180)...');
const appleIcon = createPng(180, 180, drawArchitectIcon);
fs.writeFileSync(path.join(assetsDir, 'apple-touch-icon.png'), appleIcon);

console.log('Generating favicon.png (64x64)...');
const favicon = createPng(64, 64, drawArchitectIcon);
fs.writeFileSync(path.join(assetsDir, 'favicon.png'), favicon);

console.log('All PWA mobile icons generated successfully!');
