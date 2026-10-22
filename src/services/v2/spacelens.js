// Disk Map: an interactive tree of folder sizes.
// Keep the largest children in each folder and group the rest to limit work.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const isLinux = process.platform === 'linux';
const SKIP = isLinux
  ? /^\/(proc|sys|dev|run|snap|lost\+found)(\/|$)|^\/var\/lib\/(docker|containers)(\/|$)/
  : /^[a-z]:\\(\$recycle\.bin|system volume information|windows\\winsxs)(\\|$)/i;
const KEEP_CHILDREN = 40;
const MIN_KEEP = 1024 * 1024; // Group items smaller than 1 MB.

let state = null;
function cancel() { if (state) state.cancelled = true; }

async function scanDir(dir, st, depth) {
  const node = { name: path.basename(dir) || dir, path: dir, size: 0, files: 0, dir: true, children: [] };
  if (st.cancelled || SKIP.test(dir)) return node;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { node.denied = true; return node; }
  st.dirs++;
  if (st.dirs % 300 === 0) st.onProgress?.({ dirs: st.dirs, files: st.files, current: dir });
  const kids = [];
  let small = 0, smallCount = 0;
  // Stat files in batches.
  const files = entries.filter((e) => e.isFile());
  for (let i = 0; i < files.length; i += 64) {
    const sizes = await Promise.all(files.slice(i, i + 64).map((e) => fsp.lstat(path.join(dir, e.name)).then((s) => s.size).catch(() => 0)));
    sizes.forEach((sz, j) => {
      st.files++;
      node.files++;
      node.size += sz;
      if (sz >= MIN_KEEP) kids.push({ name: files[i + j].name, path: path.join(dir, files[i + j].name), size: sz, files: 1, dir: false });
      else { small += sz; smallCount++; }
    });
  }
  // Recurse into subfolders with limited parallelism.
  const dirs = entries.filter((e) => e.isDirectory() && !e.isSymbolicLink());
  for (let i = 0; i < dirs.length; i += 6) {
    const subs = await Promise.all(dirs.slice(i, i + 6).map((e) => scanDir(path.join(dir, e.name), st, depth + 1)));
    for (const s of subs) {
      node.size += s.size;
      node.files += s.files;
      if (s.size >= MIN_KEEP) kids.push(s); else { small += s.size; smallCount += s.files || 1; }
    }
  }
  kids.sort((a, b) => b.size - a.size);
  const kept = kids.slice(0, KEEP_CHILDREN);
  const rest = kids.slice(KEEP_CHILDREN);
  const other = small + rest.reduce((a, k) => a + k.size, 0);
  if (other > 0) kept.push({ name: `Autres éléments (${smallCount + rest.length})`, path: null, size: other, files: smallCount, dir: false, other: true });
  node.children = kept;
  return node;
}

async function scan(root, onProgress) {
  state = { cancelled: false, dirs: 0, files: 0, onProgress };
  const tree = await scanDir(path.resolve(root), state, 0);
  return { tree, cancelled: state.cancelled, dirs: state.dirs, files: state.files };
}

module.exports = { scan, cancel };
