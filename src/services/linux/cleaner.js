// Linux cleanup: user caches, trash, thumbnails, systemd logs, and package caches.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { run, which, isRoot, privileged, packageManager } = require('./sh');

const HOME = os.homedir();
const CACHE = process.env.XDG_CACHE_HOME || path.join(HOME, '.cache');
const DATA = process.env.XDG_DATA_HOME || path.join(HOME, '.local', 'share');
const UID = typeof process.getuid === 'function' ? process.getuid() : -1;
const DAY = 24 * 3600 * 1000;

// `targets` are user-cleanable; `root` lists directories to size and the admin cleanup command.
const pm = packageManager();
const PKG_CACHE = {
  apt: { dirs: [{ dir: '/var/cache/apt/archives', match: /\.deb$/ }], cmd: 'apt-get clean' },
  dnf: { dirs: [{ dir: '/var/cache/dnf' }, { dir: '/var/cache/libdnf5' }], cmd: 'dnf clean packages' },
  pacman: { dirs: [{ dir: '/var/cache/pacman/pkg', match: /\.pkg\.tar/ }], cmd: which('paccache') ? 'paccache -rk1' : 'pacman -Sc --noconfirm' },
  zypper: { dirs: [{ dir: '/var/cache/zypp/packages' }], cmd: 'zypper clean --all' },
}[pm];

const CATEGORIES = [
  {
    id: 'tmp', name: 'Fichiers temporaires', scenes: ['health', 'deep'], recommended: true,
    desc: 'Vos fichiers de /tmp et /var/tmp non modifiés depuis plus de 24 h.',
    targets: [{ dir: '/tmp', ownOnly: true, olderThan: DAY }, { dir: '/var/tmp', ownOnly: true, olderThan: DAY }],
  },
  {
    id: 'webcache', name: 'Cache des navigateurs', scenes: ['health', 'deep'], recommended: true,
    desc: 'Cache de Firefox, Chrome, Chromium, Brave, Edge, Vivaldi et Opera.',
    targets: [
      { dir: path.join(CACHE, 'mozilla', 'firefox', '*', 'cache2') },
      { dir: path.join(HOME, '.var', 'app', 'org.mozilla.firefox', 'cache', 'mozilla', 'firefox', '*', 'cache2') },
      { dir: path.join(HOME, 'snap', 'firefox', 'common', '.cache', 'mozilla', 'firefox', '*', 'cache2') },
      ...['google-chrome', 'chromium', 'BraveSoftware/Brave-Browser', 'microsoft-edge', 'vivaldi', 'opera'].flatMap((b) => [
        { dir: path.join(CACHE, b, '*', 'Cache') },
        { dir: path.join(CACHE, b, '*', 'Code Cache') },
      ]),
    ],
  },
  {
    id: 'thumbs', name: 'Miniatures', scenes: ['health', 'deep'], recommended: true,
    desc: 'Aperçus d\'images et de vidéos générés par le gestionnaire de fichiers (recréés si besoin).',
    targets: [{ dir: path.join(CACHE, 'thumbnails') }],
  },
  {
    id: 'trash', name: 'Corbeille', scenes: ['health', 'deep'], recommended: false,
    desc: 'Fichiers placés dans la Corbeille.',
    targets: [{ dir: path.join(DATA, 'Trash', 'files') }, { dir: path.join(DATA, 'Trash', 'info') }, { dir: path.join(DATA, 'Trash', 'expunged') }],
  },
  {
    id: 'recent', name: 'Fichiers récents', scenes: ['health'], recommended: false,
    desc: 'Historique des documents récemment ouverts.',
    targets: [{ dir: DATA, match: /^recently-used\.xbel$/, depth: 0 }],
  },
  {
    id: 'appcache', name: 'Cache des applications', scenes: ['deep'], recommended: false,
    desc: 'Autres caches dans ~/.cache et caches des applications Flatpak (recréés automatiquement).',
    targets: [{ dir: CACHE, skip: /^(thumbnails|mozilla|google-chrome|chromium|BraveSoftware|microsoft-edge|vivaldi|opera|pip|yarn|go-build)$/ }, { dir: path.join(HOME, '.var', 'app', '*', 'cache') }],
  },
  {
    id: 'devjunk', name: 'Fichiers de développement', scenes: ['deep'], recommended: false,
    desc: 'Caches de npm, pip, Yarn, Gradle, Cargo et Go (retéléchargés si besoin).',
    targets: [
      { dir: path.join(HOME, '.npm', '_cacache') },
      { dir: path.join(CACHE, 'pip') },
      { dir: path.join(CACHE, 'yarn') },
      { dir: path.join(CACHE, 'go-build') },
      { dir: path.join(HOME, '.gradle', 'caches') },
      { dir: path.join(HOME, '.cargo', 'registry', 'cache') },
    ],
  },
  {
    id: 'crash', name: 'Rapports de plantage', scenes: ['health', 'deep'], recommended: true,
    desc: 'Rapports Apport et vidages mémoire systemd-coredump.',
    root: { dirs: [{ dir: '/var/crash' }, { dir: '/var/lib/systemd/coredump' }], cmd: 'rm -rf /var/crash/* /var/lib/systemd/coredump/*' },
  },
  {
    id: 'journal', name: 'Journaux système', scenes: ['health', 'deep'], recommended: false,
    desc: 'Journaux systemd de plus de 7 jours et anciens journaux compressés de /var/log.',
    root: { dirs: [{ dir: '/var/log/journal' }, { dir: '/var/log', match: /\.(gz|xz|\d+)$/ }], cmd: 'journalctl --vacuum-time=7d; find /var/log -type f \\( -name "*.gz" -o -name "*.xz" -o -regex ".*\\.[0-9]+" \\) -delete' },
  },
  ...(PKG_CACHE ? [{
    id: 'pkgcache', name: 'Cache des paquets', scenes: ['deep'], recommended: true,
    desc: `Paquets téléchargés et déjà installés (${pm}).`,
    root: PKG_CACHE,
  }] : []),
  ...(which('flatpak') ? [{
    id: 'flatpakunused', name: 'Runtimes Flatpak inutilisés', scenes: ['deep'], recommended: false,
    desc: 'Runtimes et extensions Flatpak qui ne sont plus utilisés par aucune application.',
    special: 'flatpak',
  }] : []),
];

const isAdmin = async () => isRoot();

async function expandDir(dir) {
  const parts = dir.split(path.sep);
  const star = parts.indexOf('*');
  if (star < 0) return [dir];
  const base = parts.slice(0, star).join(path.sep) || '/';
  const rest = parts.slice(star + 1).join(path.sep);
  let entries = [];
  try { entries = await fsp.readdir(base, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries.filter((x) => x.isDirectory())) out.push(...(await expandDir(path.join(base, e.name, rest))));
  return out;
}

async function walk(dir, t, onFile, level = 0, budget = { n: 0, denied: false }) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
  catch (e) { if (e.code === 'EACCES') budget.denied = true; return budget; }
  if ((budget.n += entries.length) > 300000) return budget;
  const files = entries.filter((e) => e.isFile() && (!t.match || t.match.test(e.name)) && !(level === 0 && t.skip?.test(e.name)));
  for (let i = 0; i < files.length; i += 64) {
    await Promise.all(files.slice(i, i + 64).map(async (e) => {
      const full = path.join(dir, e.name);
      try {
        const st = await fsp.lstat(full);
        if (t.ownOnly && st.uid !== UID) return;
        if (t.olderThan && Date.now() - st.mtimeMs < t.olderThan) return;
        await onFile(full, st.size);
      } catch {}
    }));
  }
  if (level < (t.depth ?? Infinity)) {
    const dirs = entries.filter((e) => e.isDirectory() && !(level === 0 && t.skip?.test(e.name)));
    for (let i = 0; i < dirs.length; i += 8) {
      await Promise.all(dirs.slice(i, i + 8).map((e) => walk(path.join(dir, e.name), t, onFile, level + 1, budget)));
    }
  }
  return budget;
}

async function sizeOf(targets) {
  let size = 0, files = 0, denied = false;
  for (const t of targets) {
    for (const dir of await expandDir(t.dir)) {
      const b = await walk(dir, t, (_f, s) => { size += s; files++; });
      if (b.denied) denied = true;
    }
  }
  return { size, files, denied };
}

async function journalSize() {
  if (!which('journalctl')) return 0;
  const out = await run('journalctl', ['--disk-usage']).catch(() => '');
  const m = out.match(/([\d.]+)\s*([KMGT])/);
  if (!m) return 0;
  return Number(m[1]) * { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }[m[2]];
}

const publicCat = (c) => ({ id: c.id, name: c.name, desc: c.desc, recommended: c.recommended });

async function scanCategory(cat) {
  if (cat.special === 'flatpak') {
    const out = await run('flatpak', ['uninstall', '--unused', '--assumeno'], { okCodes: [0, 1] }).catch(() => '');
    const n = out.split('\n').filter((l) => /^\s*\d+\.\s/.test(l)).length;
    return { ...publicCat(cat), size: 0, files: n, countOnly: true, needsAdmin: false };
  }
  let size = 0, files = 0, needsAdmin = false;
  if (cat.targets) { const r = await sizeOf(cat.targets); size += r.size; files += r.files; }
  if (cat.root) {
    const r = await sizeOf(cat.root.dirs);
    size += r.size; files += r.files;
    if (cat.id === 'journal') { const j = await journalSize(); if (j) size = Math.max(size, j); }
    needsAdmin = !isRoot();
  }
  return { ...publicCat(cat), size, files, needsAdmin };
}

async function scan(scene, onProgress) {
  const cats = CATEGORIES.filter((c) => c.scenes.includes(scene));
  const items = [];
  for (let i = 0; i < cats.length; i++) {
    onProgress?.({ current: cats[i].name, index: i, total: cats.length });
    items.push(await scanCategory(cats[i]));
  }
  return { admin: isRoot(), adminViaPrompt: true, items };
}

async function removeEmptyDirs(dir, isRootDir = true) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) if (e.isDirectory()) await removeEmptyDirs(path.join(dir, e.name), false);
  if (!isRootDir) { try { await fsp.rmdir(dir); } catch {} }
}

async function clean(ids, onProgress) {
  let freed = 0, deleted = 0, failed = 0;
  const cats = CATEGORIES.filter((c) => ids.includes(c.id));
  const rootCmds = [];
  for (let i = 0; i < cats.length; i++) {
    const cat = cats[i];
    onProgress?.({ current: cat.name, index: i, total: cats.length });
    if (cat.special === 'flatpak') {
      try { await run('flatpak', ['uninstall', '--unused', '-y', '--noninteractive'], { timeout: 10 * 60000 }); deleted++; } catch { failed++; }
      continue;
    }
    for (const t of cat.targets || []) {
      for (const dir of await expandDir(t.dir)) {
        await walk(dir, t, async (f, s) => {
          try { await fsp.unlink(f); freed += s; deleted++; } catch { failed++; }
        });
        // Keep empty directories in /tmp in case a running program is using them.
        if (t.depth !== 0 && !t.ownOnly) await removeEmptyDirs(dir);
      }
    }
    if (cat.root) rootCmds.push({ cat, cmd: cat.root.cmd });
  }
  let adminCancelled = false;
  // Run admin operations together so polkit asks for the password only once.
  if (rootCmds.length) {
    onProgress?.({ current: 'Éléments système (authentification requise)', index: cats.length - 1, total: cats.length });
    const before = await Promise.all(rootCmds.map(({ cat }) => sizeOf(cat.root.dirs)));
    try {
      await privileged(rootCmds.map((r) => `(${r.cmd}) >/dev/null 2>&1`).join('; ') + '; true');
      const after = await Promise.all(rootCmds.map(({ cat }) => sizeOf(cat.root.dirs)));
      before.forEach((b, i) => { freed += Math.max(0, b.size - after[i].size); deleted += Math.max(0, b.files - after[i].files); });
    } catch (e) {
      if (!e.cancelled) throw e;
      adminCancelled = true;
    }
  }
  return { freed, deleted, failed, adminCancelled };
}

module.exports = { scan, clean, isAdmin };
