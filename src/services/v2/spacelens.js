// Disk Map: an interactive tree of folder sizes.
// Keep the largest children in each folder and group the rest to limit work.
// In the app, the scan runs in its own process (spacelens-worker.js): a file call that
// hangs (cloud placeholders, WSL links, locked files) can then neither block the app's
// file threads nor keep the scan from finishing.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const isLinux = process.platform === 'linux';
const SKIP = isLinux
  ? /^\/(proc|sys|dev|run|snap|lost\+found)(\/|$)|^\/var\/lib\/(docker|containers)(\/|$)/
  : /^[a-z]:\\(\$recycle\.bin|system volume information|windows\\winsxs)(\\|$)/i;
const KEEP_CHILDREN = 40;
const MIN_KEEP = 1024 * 1024; // Group items smaller than 1 MB.
const MAX_PARALLEL = 64; // File calls in flight at once.
const CALL_TIMEOUT = 8000; // A call that takes longer counts as unreadable.

// Run at most MAX_PARALLEL file calls at once, each with a timeout.
function limiter() {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= MAX_PARALLEL || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    let timer;
    Promise.race([fn(), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), CALL_TIMEOUT); })])
      .then(resolve, reject)
      .finally(() => { clearTimeout(timer); active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

async function scanDir(dir, st) {
  const node = { name: path.basename(dir) || dir, path: dir, size: 0, files: 0, dir: true, children: [] };
  if (st.cancelled || SKIP.test(dir)) return node;
  let entries;
  try { entries = await st.run(() => fsp.readdir(dir, { withFileTypes: true })); } catch { node.denied = true; return node; }
  st.dirs++;
  if (st.dirs % 300 === 0) st.onProgress?.({ dirs: st.dirs, files: st.files, current: dir });
  const kids = [];
  let small = 0, smallCount = 0;
  const files = entries.filter((e) => e.isFile());
  const sizes = await Promise.all(files.map((e) => st.run(() => fsp.lstat(path.join(dir, e.name))).then((s) => s.size, () => 0)));
  sizes.forEach((sz, j) => {
    st.files++;
    node.files++;
    node.size += sz;
    if (sz >= MIN_KEEP) kids.push({ name: files[j].name, path: path.join(dir, files[j].name), size: sz, files: 1, dir: false });
    else { small += sz; smallCount++; }
  });
  const dirs = entries.filter((e) => e.isDirectory() && !e.isSymbolicLink());
  const subs = await Promise.all(dirs.map((e) => scanDir(path.join(dir, e.name), st)));
  for (const s of subs) {
    node.size += s.size;
    node.files += s.files;
    if (s.size >= MIN_KEEP) kids.push(s); else { small += s.size; smallCount += s.files || 1; }
  }
  kids.sort((a, b) => b.size - a.size);
  const kept = kids.slice(0, KEEP_CHILDREN);
  const rest = kids.slice(KEEP_CHILDREN);
  const other = small + rest.reduce((a, k) => a + k.size, 0);
  if (other > 0) kept.push({ name: `Autres éléments (${smallCount + rest.length})`, path: null, size: other, files: smallCount, dir: false, other: true });
  node.children = kept;
  return node;
}

// Scan in the current process (worker, tests, or outside Electron).
let state = null;
async function scanHere(root, onProgress) {
  const st = { cancelled: false, dirs: 0, files: 0, onProgress, run: limiter() };
  state = st;
  const tree = await scanDir(path.resolve(root), st);
  return { tree, cancelled: st.cancelled, dirs: st.dirs, files: st.files };
}

// In the Electron main process, scan in a separate utility process.
let child = null;
function scanInWorker(root, onProgress) {
  const { utilityProcess } = require('electron');
  cancel();
  return new Promise((resolve, reject) => {
    const proc = utilityProcess.fork(path.join(__dirname, 'spacelens-worker.js'), [], {
      serviceName: 'Boost My Pc Disk Map',
      env: { ...process.env, UV_THREADPOOL_SIZE: '24' },
    });
    child = proc;
    let done = false;
    const finish = (fn, v) => { if (done) return; done = true; if (child === proc) child = null; proc.kill(); fn(v); };
    proc.on('message', (m) => {
      if (m.type === 'progress') onProgress?.(m.data);
      else if (m.type === 'done') finish(resolve, m.data);
      else if (m.type === 'error') finish(reject, new Error(m.error));
    });
    proc.on('exit', () => finish(reject, new Error('Analyse interrompue.')));
    proc.postMessage({ type: 'scan', root });
    proc.stopScan = () => {
      proc.postMessage({ type: 'cancel' });
      // A call that still hangs must not keep the scan open.
      setTimeout(() => finish(reject, new Error('Analyse arrêtée.')), 4000);
    };
  });
}

const inElectronMain = !!process.versions.electron && process.type === 'browser';
const scan = (root, onProgress) => (inElectronMain ? scanInWorker(root, onProgress) : scanHere(root, onProgress));
function cancel() {
  if (child) child.stopScan();
  if (state) state.cancelled = true;
}

module.exports = { scan, cancel, scanHere };
