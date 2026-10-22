// Find large files, downloads, and duplicates.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const isLinux = process.platform === 'linux';

// Skip system folders.
const EXCLUDE = isLinux ? [
  /^\/(proc|sys|dev|run|snap|boot|lost\+found|var\/lib\/(docker|containers|flatpak|snapd))\//,
  /\/\.local\/share\/Trash\//,
  /\/\.cache\//,
  /\/node_modules\//,
  /\/\.git\//,
] : [
  /^[a-z]:\\windows(\\|$)/i,
  /^[a-z]:\\program files( \(x86\))?\\windowsapps/i,
  /^[a-z]:\\\$recycle\.bin/i,
  /^[a-z]:\\system volume information/i,
  /\\appdata\\local\\packages\\/i,
  /\\node_modules\\/i,
  /\\\.git\\/i,
];

// The Downloads folder may have a localized name on Linux.
function downloadsDir() {
  if (isLinux) {
    const cfg = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'user-dirs.dirs');
    try {
      const m = fs.readFileSync(cfg, 'utf8').match(/^XDG_DOWNLOAD_DIR="(.+)"$/m);
      if (m) return m[1].replace('$HOME', os.homedir());
    } catch {}
  }
  return path.join(os.homedir(), 'Downloads');
}

const TYPES = {
  Documents: ['.rtf', '.csv', '.pdf', '.html', '.txt', '.xml', '.odt', '.odp', '.ods', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.vsd', '.vsdx'],
  Images: ['.jpeg', '.jpg', '.tif', '.png', '.gif', '.psd', '.eps', '.svg', '.bmp', '.raw', '.webp', '.heic'],
  Vidéos: ['.mp4', '.m4v', '.mov', '.avi', '.flv', '.wmv', '.asf', '.mpeg', '.mpg', '.vob', '.mkv', '.webm'],
  Audio: ['.mp3', '.wma', '.wav', '.aac', '.ape', '.flac', '.ogg', '.m4a'],
  Archives: ['.zip', '.bz2', '.tar', '.rar', '.7z', '.gz', '.iso'],
  Installateurs: ['.exe', '.msi', '.msix', '.appx', '.apk', '.jar', '.deb', '.rpm', '.appimage', '.flatpakref', '.run'],
};
function fileType(name) {
  const ext = path.extname(name).toLowerCase();
  for (const [t, list] of Object.entries(TYPES)) if (list.includes(ext)) return t;
  return 'Autres';
}

async function walk(root, onFile, state) {
  const stack = [root];
  while (stack.length) {
    if (state.cancelled) return;
    const dir = stack.pop();
    if (EXCLUDE.some((r) => r.test(dir + path.sep))) continue;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    state.dirs++;
    if (state.dirs % 200 === 0) state.onProgress?.({ dirs: state.dirs, current: dir });
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) {
        try { const st = await fsp.stat(full); onFile(full, st); } catch {}
      }
    }
  }
}

const toItem = (f, st) => ({ path: f, name: path.basename(f), size: st.size, mtime: st.mtimeMs, type: fileType(f) });

let current = null;
function cancel() { if (current) current.cancelled = true; }

// `olderThanDays` keeps files that have not changed for at least this many days.
async function findLargeFiles({ root = os.homedir(), minSize = 100 * 1024 * 1024, limit = 500, olderThanDays = 0 } = {}, onProgress) {
  const state = (current = { dirs: 0, cancelled: false, onProgress });
  const out = [];
  const before = olderThanDays > 0 ? Date.now() - olderThanDays * 24 * 3600 * 1000 : Infinity;
  await walk(root, (f, st) => { if (st.size >= minSize && st.mtimeMs < before) out.push(toItem(f, st)); }, state);
  out.sort((a, b) => b.size - a.size);
  return out.slice(0, limit);
}

async function listDownloads() {
  const dir = downloadsDir();
  const out = [];
  let entries = [];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch {}
  for (const e of entries) {
    const full = path.join(dir, e.name);
    try {
      const st = await fsp.stat(full);
      if (st.isFile()) out.push(toItem(full, st));
    } catch {}
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return { dir, items: out };
}

function hashFile(file, bytes) {
  return new Promise((resolve) => {
    const h = crypto.createHash('sha1');
    const s = fs.createReadStream(file, bytes ? { start: 0, end: bytes - 1 } : {});
    s.on('data', (d) => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', () => resolve(null));
  });
}

async function findDuplicates({ root = os.homedir(), minSize = 1024 * 1024 } = {}, onProgress) {
  const state = (current = { dirs: 0, cancelled: false, onProgress });
  const bySize = new Map();
  await walk(root, (f, st) => {
    if (st.size < minSize) return;
    if (!bySize.has(st.size)) bySize.set(st.size, []);
    bySize.get(st.size).push(toItem(f, st));
  }, state);

  const groups = [];
  for (const [size, files] of bySize) {
    if (files.length < 2 || state.cancelled) continue;
    // Hash a small sample first, then hash the full file to confirm.
    const quick = new Map();
    for (const f of files) {
      const h = await hashFile(f.path, 65536);
      if (!h) continue;
      if (!quick.has(h)) quick.set(h, []);
      quick.get(h).push(f);
    }
    for (const cands of quick.values()) {
      if (cands.length < 2) continue;
      const full = new Map();
      for (const f of cands) {
        const h = size <= 65536 ? 'same' : await hashFile(f.path);
        if (!h) continue;
        if (!full.has(h)) full.set(h, []);
        full.get(h).push(f);
      }
      for (const g of full.values()) if (g.length > 1) groups.push({ size, files: g.sort((a, b) => a.mtime - b.mtime) });
    }
  }
  groups.sort((a, b) => b.size * (b.files.length - 1) - a.size * (a.files.length - 1));
  return groups.slice(0, 300);
}

module.exports = { findLargeFiles, listDownloads, findDuplicates, cancel };
