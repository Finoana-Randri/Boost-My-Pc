// Shredder: overwrite a file with random data before deleting it.
// SSD wear leveling can prevent overwrites from reaching the physical data; the UI warns about this.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const CHUNK = 1024 * 1024;

// Paths that must never be shredded.
function isForbidden(p) {
  const r = path.resolve(p);
  const home = os.homedir();
  if (r === path.parse(r).root || r === home) return true;
  const sys = process.platform === 'linux'
    ? ['/bin', '/boot', '/dev', '/etc', '/lib', '/lib64', '/proc', '/run', '/sbin', '/sys', '/usr', '/var', '/opt', '/snap']
    : [process.env.WINDIR, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData].filter(Boolean);
  return sys.some((s) => r.toLowerCase() === s.toLowerCase() || r.toLowerCase().startsWith(s.toLowerCase() + path.sep));
}

async function shredFile(file, passes) {
  const st = await fsp.lstat(file);
  if (st.isSymbolicLink()) { await fsp.unlink(file); return st.size; }
  const fh = await fsp.open(file, 'r+');
  try {
    for (let pass = 0; pass < passes; pass++) {
      let pos = 0;
      while (pos < st.size) {
        const len = Math.min(CHUNK, st.size - pos);
        await fh.write(crypto.randomBytes(len), 0, len, pos);
        pos += len;
      }
      await fh.sync();
    }
    await fh.truncate(0);
  } finally { await fh.close(); }
  // Rename the file before deleting it so its original name is removed too.
  const tmp = path.join(path.dirname(file), crypto.randomBytes(8).toString('hex'));
  await fsp.rename(file, tmp);
  await fsp.unlink(tmp);
  return st.size;
}

async function shredPath(p, passes, acc, onProgress) {
  const st = await fsp.lstat(p);
  if (st.isDirectory()) {
    for (const e of await fsp.readdir(p)) await shredPath(path.join(p, e), passes, acc, onProgress);
    await fsp.rmdir(p);
  } else {
    onProgress?.({ current: p });
    acc.bytes += await shredFile(p, passes);
    acc.files++;
  }
}

async function shred(paths, { passes = 1 } = {}, onProgress) {
  passes = Math.max(1, Math.min(7, Number(passes) || 1));
  const acc = { files: 0, bytes: 0, failed: [] };
  for (const p of paths) {
    if (isForbidden(p)) { acc.failed.push(`${p} : emplacement protégé`); continue; }
    try { await shredPath(p, passes, acc, onProgress); }
    catch (e) { acc.failed.push(`${p} : ${e.code === 'EACCES' || e.code === 'EPERM' ? 'accès refusé' : e.message}`); }
  }
  return acc;
}

module.exports = { shred, isForbidden };
