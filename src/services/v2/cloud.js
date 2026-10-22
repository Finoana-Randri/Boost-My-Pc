// Scan locally synced folders from OneDrive, Dropbox, Google Drive, Nextcloud, and other providers.
// Deleting a file here also deletes it from the cloud after sync; the UI warns about this.
// OneDrive's "Free up space" keeps the online file and removes only the local copy.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const isLinux = process.platform === 'linux';
const HOME = os.homedir();

function candidates() {
  const c = [
    { service: 'OneDrive', paths: [process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial, path.join(HOME, 'OneDrive')] },
    { service: 'Dropbox', paths: [path.join(HOME, 'Dropbox')] },
    { service: 'Google Drive', paths: [path.join(HOME, 'Google Drive'), path.join(HOME, 'GoogleDrive'), path.join(HOME, 'Insync'), 'G:\\My Drive', 'G:\\Mon Drive'] },
    { service: 'Nextcloud', paths: [path.join(HOME, 'Nextcloud')] },
    { service: 'ownCloud', paths: [path.join(HOME, 'ownCloud')] },
    { service: 'pCloud', paths: [path.join(HOME, 'pCloudDrive'), 'P:\\'] },
    { service: 'MEGA', paths: [path.join(HOME, 'MEGA'), path.join(HOME, 'MEGAsync')] },
    { service: 'iCloud Drive', paths: [path.join(HOME, 'iCloudDrive')] },
    { service: 'Proton Drive', paths: [path.join(HOME, 'Proton Drive')] },
  ];
  // Business OneDrive folders use the "OneDrive - Company Name" format.
  try { for (const d of fs.readdirSync(HOME)) if (/^OneDrive - /.test(d)) c[0].paths.push(path.join(HOME, d)); } catch {}
  return c;
}

async function detect() {
  const out = [];
  const seen = new Set();
  for (const { service, paths } of candidates()) {
    for (const p of paths) {
      if (!p || seen.has(p.toLowerCase())) continue;
      try { if ((await fsp.stat(p)).isDirectory()) { seen.add(p.toLowerCase()); out.push({ service, path: p }); } } catch {}
    }
  }
  return out;
}

let state = null;
function cancel() { if (state) state.cancelled = true; }

// Scan a folder for its total size, large files (25 MB or more), and files unchanged for a year.
async function analyze(folder, onProgress) {
  state = { cancelled: false };
  const st = state;
  let total = 0, count = 0;
  const large = [];
  const old = [];
  const yearAgo = Date.now() - 365 * 24 * 3600 * 1000;
  const stack = [folder];
  while (stack.length && !st.cancelled) {
    const d = stack.pop();
    let entries = [];
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.') || /^~\$/.test(e.name)) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory() && !e.isSymbolicLink()) { stack.push(full); continue; }
      if (!e.isFile()) continue;
      try {
        const s = await fsp.stat(full);
        count++;
        total += s.size;
        const item = { path: full, name: e.name, size: s.size, mtime: s.mtimeMs };
        if (s.size >= 25 * 1024 * 1024) large.push(item);
        else if (s.mtimeMs < yearAgo && s.size >= 1024 * 1024) old.push(item);
      } catch {}
      if (count % 500 === 0) onProgress?.({ count, current: d });
    }
  }
  large.sort((a, b) => b.size - a.size);
  old.sort((a, b) => b.size - a.size);
  return { folder, total, count, large: large.slice(0, 300), old: old.slice(0, 300), cancelled: st.cancelled };
}

// Remove the local OneDrive copy while keeping the file in the cloud.
async function freeUp(paths) {
  if (isLinux) throw new Error('Non disponible sous Linux');
  const { runPS, psq } = require('../ps');
  let done = 0;
  for (const p of paths) {
    try { await runPS(`attrib +U -P ${psq(p)}`); done++; } catch {}
  }
  return { done };
}

module.exports = { detect, analyze, freeUp, cancel };
