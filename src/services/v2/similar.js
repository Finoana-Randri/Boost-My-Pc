// Find similar images with Electron's 64-bit dHash.
// Images are considered similar when their hashes differ by six bits or fewer.
const { nativeImage } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const EXT = /\.(jpe?g|png)$/i;
const MAX_IMAGES = 6000;
const THRESHOLD = 6;

let state = null;
function cancel() { if (state) state.cancelled = true; }

async function listImages(root, st) {
  const out = [];
  const stack = [root];
  while (stack.length && out.length < MAX_IMAGES && !st.cancelled) {
    const d = stack.pop();
    let entries = [];
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory() && !e.isSymbolicLink()) stack.push(full);
      else if (e.isFile() && EXT.test(e.name)) out.push(full);
    }
  }
  return out;
}

// dHash: convert to 9×8 grayscale, then compare neighboring pixels.
function dhash(img) {
  const bmp = img.resize({ width: 9, height: 8, quality: 'good' }).toBitmap(); // Pixels are stored as BGRA.
  let hi = 0, lo = 0, bit = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const a = (y * 9 + x) * 4, b = (y * 9 + x + 1) * 4;
      const ga = bmp[a + 2] * 0.299 + bmp[a + 1] * 0.587 + bmp[a] * 0.114;
      const gb = bmp[b + 2] * 0.299 + bmp[b + 1] * 0.587 + bmp[b] * 0.114;
      const v = ga > gb ? 1 : 0;
      if (bit < 32) hi = (hi << 1) | v; else lo = (lo << 1) | v;
      bit++;
    }
  }
  return [hi >>> 0, lo >>> 0];
}
function popcount(n) { n -= (n >>> 1) & 0x55555555; n = (n & 0x33333333) + ((n >>> 2) & 0x33333333); return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; }
const distance = (a, b) => popcount(a[0] ^ b[0]) + popcount(a[1] ^ b[1]);

async function find(root, onProgress) {
  state = { cancelled: false };
  const st = state;
  const files = await listImages(root, st);
  const items = [];
  for (let i = 0; i < files.length && !st.cancelled; i++) {
    try {
      const buf = await fsp.readFile(files[i]);
      const img = nativeImage.createFromBuffer(buf);
      if (img.isEmpty()) continue;
      const { width, height } = img.getSize();
      const s = await fsp.stat(files[i]);
      items.push({ path: files[i], name: path.basename(files[i]), size: s.size, mtime: s.mtimeMs, width, height, hash: dhash(img) });
    } catch {}
    if (i % 20 === 0) {
      onProgress?.({ done: i, total: files.length, current: files[i] });
      await new Promise((r) => setImmediate(r)); // Let the main process handle other work.
    }
  }
  // Group matches with union-find.
  const parent = items.map((_, i) => i);
  const findRoot = (i) => (parent[i] === i ? i : (parent[i] = findRoot(parent[i])));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (distance(items[i].hash, items[j].hash) <= THRESHOLD) parent[findRoot(j)] = findRoot(i);
    }
  }
  const groups = new Map();
  items.forEach((it, i) => { const r = findRoot(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(it); });
  const result = [...groups.values()].filter((g) => g.length > 1).map((g) => {
    // Keep the largest image by resolution, using file size to break ties.
    g.sort((a, b) => b.width * b.height - a.width * a.height || b.size - a.size);
    return { files: g.map(({ hash, ...f }) => f), waste: g.slice(1).reduce((a, f) => a + f.size, 0) };
  }).sort((a, b) => b.waste - a.waste);
  return { groups: result, scanned: items.length, truncated: files.length >= MAX_IMAGES, cancelled: st.cancelled };
}

module.exports = { find, cancel };
