// Nettoyage : scènes "HealthCheck" et "DeepClean" reconstruites d'après CleanTrash.Options (REA ev_d8b0de32…).
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { runPS, runPSJson } = require('./ps');

const env = process.env;
const LOCAL = env.LOCALAPPDATA || path.join(env.USERPROFILE, 'AppData', 'Local');
const ROAMING = env.APPDATA || path.join(env.USERPROFILE, 'AppData', 'Roaming');
const WIN = env.WINDIR || 'C:\\Windows';
const PDATA = env.ProgramData || 'C:\\ProgramData';

// Chaque cible : { dir, match?: RegExp sur le nom de fichier, depth?: 0 = fichiers du dossier seulement }
const CATEGORIES = [
  {
    id: 'temp', name: 'Fichiers temporaires', scenes: ['health', 'deep'], recommended: true,
    desc: 'Fichiers temporaires créés par les applications et Windows.',
    targets: [{ dir: env.TEMP || path.join(LOCAL, 'Temp') }, { dir: path.join(WIN, 'Temp'), admin: true }],
  },
  {
    id: 'webcache', name: 'Cache des navigateurs', scenes: ['health', 'deep'], recommended: true,
    desc: 'Cache d\'Edge, Chrome, Firefox et fichiers Internet temporaires.',
    targets: [
      { dir: path.join(LOCAL, 'Microsoft', 'Windows', 'INetCache') },
      { dir: path.join(LOCAL, 'Microsoft', 'Edge', 'User Data', 'Default', 'Cache') },
      { dir: path.join(LOCAL, 'Microsoft', 'Edge', 'User Data', 'Default', 'Code Cache') },
      { dir: path.join(LOCAL, 'Google', 'Chrome', 'User Data', 'Default', 'Cache') },
      { dir: path.join(LOCAL, 'Google', 'Chrome', 'User Data', 'Default', 'Code Cache') },
      { dir: path.join(LOCAL, 'Mozilla', 'Firefox', 'Profiles', '*', 'cache2') },
    ],
  },
  {
    id: 'wer', name: 'Rapports d\'erreurs Windows', scenes: ['health', 'deep'], recommended: true,
    desc: 'Rapports Windows Error Reporting (WER) archivés.',
    targets: [
      { dir: path.join(LOCAL, 'Microsoft', 'Windows', 'WER') },
      { dir: path.join(PDATA, 'Microsoft', 'Windows', 'WER'), admin: true },
    ],
  },
  {
    id: 'dumps', name: 'Fichiers de vidage mémoire', scenes: ['health', 'deep'], recommended: true,
    desc: 'Mini-dumps et vidages créés lors des plantages.',
    targets: [
      { dir: path.join(LOCAL, 'CrashDumps') },
      { dir: path.join(WIN, 'Minidump'), admin: true },
      { dir: WIN, match: /^MEMORY\.DMP$/i, depth: 0, admin: true },
    ],
  },
  {
    id: 'recent', name: 'Fichiers récents', scenes: ['health'], recommended: false,
    desc: 'Raccourcis de la liste des éléments récents de l\'Explorateur.',
    targets: [{ dir: path.join(ROAMING, 'Microsoft', 'Windows', 'Recent'), match: /\.lnk$/i, depth: 0 }],
  },
  {
    id: 'thumbs', name: 'Miniatures', scenes: ['deep'], recommended: true,
    desc: 'Cache des miniatures de l\'Explorateur (recréé automatiquement).',
    targets: [{ dir: path.join(LOCAL, 'Microsoft', 'Windows', 'Explorer'), match: /^(thumbcache|iconcache)_.*\.db$/i, depth: 0 }],
  },
  {
    id: 'dxcache', name: 'Cache des nuanceurs DirectX', scenes: ['deep'], recommended: true,
    desc: 'Fichiers créés par le système graphique, recréés si besoin.',
    targets: [
      { dir: path.join(LOCAL, 'D3DSCache') },
      { dir: path.join(LOCAL, 'NVIDIA', 'DXCache') },
      { dir: path.join(LOCAL, 'NVIDIA', 'GLCache') },
      { dir: path.join(LOCAL, 'AMD', 'DxCache') },
    ],
  },
  {
    id: 'devjunk', name: 'Fichiers de développement', scenes: ['deep'], recommended: false,
    desc: 'Caches de npm, pip, Yarn, Gradle et Cargo (retéléchargés si besoin).',
    targets: [
      { dir: path.join(LOCAL, 'npm-cache', '_cacache') },
      { dir: path.join(LOCAL, 'pip', 'Cache') },
      { dir: path.join(LOCAL, 'Yarn', 'Cache') },
      { dir: path.join(env.USERPROFILE || '', '.gradle', 'caches') },
      { dir: path.join(env.USERPROFILE || '', '.cargo', 'registry', 'cache') },
    ],
  },
  {
    id: 'wucache', name: 'Cache de Windows Update', scenes: ['deep'], recommended: false,
    desc: 'Fichiers de mise à jour déjà installés.',
    targets: [{ dir: path.join(WIN, 'SoftwareDistribution', 'Download'), admin: true }],
  },
  {
    id: 'delivery', name: 'Fichiers d\'optimisation de distribution', scenes: ['deep'], recommended: false,
    desc: 'Fichiers partagés de Windows Update entre PC.',
    targets: [{ dir: path.join(WIN, 'ServiceProfiles', 'NetworkService', 'AppData', 'Local', 'Microsoft', 'Windows', 'DeliveryOptimization', 'Cache'), admin: true }],
  },
  {
    id: 'logs', name: 'Journaux système', scenes: ['health', 'deep'], recommended: false,
    desc: 'Journaux CBS / DISM / installation.',
    targets: [{ dir: path.join(WIN, 'Logs', 'CBS'), match: /\.(log|cab)$/i, admin: true }, { dir: path.join(WIN, 'Logs', 'DISM'), admin: true }],
  },
  {
    id: 'recycle', name: 'Corbeille', scenes: ['deep'], recommended: false, special: 'recycle',
    desc: 'Fichiers supprimés présents dans la Corbeille.',
    targets: [],
  },
];

let adminCache = null;
async function isAdmin() {
  if (adminCache !== null) return adminCache;
  try {
    const r = await runPS(`([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)`);
    adminCache = /true/i.test(r);
  } catch { adminCache = false; }
  return adminCache;
}

// Développe un éventuel segment "*" (ex. profils Firefox)
async function expandDir(dir) {
  const parts = dir.split(path.sep);
  const star = parts.indexOf('*');
  if (star < 0) return [dir];
  const base = parts.slice(0, star).join(path.sep);
  const rest = parts.slice(star + 1).join(path.sep);
  try {
    const entries = await fsp.readdir(base, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => path.join(base, e.name, rest));
  } catch { return []; }
}

// Parcourt une cible et appelle onFile(fullPath, size)
// Les stat() d'un même dossier sont faits en parallèle pour accélérer l'analyse.
async function walk(dir, { match, depth = Infinity }, onFile, level = 0, budget = { n: 0 }) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  if ((budget.n += entries.length) > 300000) return;
  const files = entries.filter((e) => e.isFile() && (!match || match.test(e.name)));
  for (let i = 0; i < files.length; i += 64) {
    await Promise.all(files.slice(i, i + 64).map(async (e) => {
      const full = path.join(dir, e.name);
      try { const st = await fsp.stat(full); await onFile(full, st.size); } catch {}
    }));
  }
  if (level < depth) {
    const dirs = entries.filter((e) => e.isDirectory() && !e.isSymbolicLink());
    for (let i = 0; i < dirs.length; i += 8) {
      await Promise.all(dirs.slice(i, i + 8).map((e) => walk(path.join(dir, e.name), { match, depth }, onFile, level + 1, budget)));
    }
  }
}

async function recycleBinSize() {
  try {
    const r = await runPSJson(`
      $sh = New-Object -ComObject Shell.Application
      $rb = $sh.Namespace(10)
      $size = 0; $count = 0
      foreach ($i in $rb.Items()) { $size += [int64]$i.ExtendedProperty('Size'); $count++ }
      [pscustomobject]@{ size = $size; count = $count } | ConvertTo-Json -Compress
    `);
    return { size: Number(r.size) || 0, files: Number(r.count) || 0 };
  } catch { return { size: 0, files: 0 }; }
}

async function scanCategory(cat, admin) {
  if (cat.special === 'recycle') return { ...publicCat(cat), ...(await recycleBinSize()), needsAdmin: false };
  let size = 0, files = 0, skippedAdmin = false;
  for (const t of cat.targets) {
    if (t.admin && !admin) { skippedAdmin = true; continue; }
    for (const dir of await expandDir(t.dir)) {
      await walk(dir, t, (_f, s) => { size += s; files++; });
    }
  }
  return { ...publicCat(cat), size, files, needsAdmin: skippedAdmin };
}

const publicCat = (c) => ({ id: c.id, name: c.name, desc: c.desc, recommended: c.recommended });

async function scan(scene, onProgress) {
  const admin = await isAdmin();
  const cats = CATEGORIES.filter((c) => c.scenes.includes(scene));
  const results = [];
  for (let i = 0; i < cats.length; i++) {
    onProgress?.({ current: cats[i].name, index: i, total: cats.length });
    results.push(await scanCategory(cats[i], admin));
  }
  return { admin, items: results };
}

async function removeEmptyDirs(dir, isRoot = true) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) if (e.isDirectory() && !e.isSymbolicLink()) await removeEmptyDirs(path.join(dir, e.name), false);
  if (!isRoot) { try { await fsp.rmdir(dir); } catch {} }
}

async function clean(ids, onProgress) {
  const admin = await isAdmin();
  let freed = 0, deleted = 0, failed = 0;
  const cats = CATEGORIES.filter((c) => ids.includes(c.id));
  for (let i = 0; i < cats.length; i++) {
    const cat = cats[i];
    onProgress?.({ current: cat.name, index: i, total: cats.length });
    if (cat.special === 'recycle') {
      const { size, files } = await recycleBinSize();
      try { await runPS('Clear-RecycleBin -Force -ErrorAction Stop'); freed += size; deleted += files; } catch { failed++; }
      continue;
    }
    for (const t of cat.targets) {
      if (t.admin && !admin) continue;
      for (const dir of await expandDir(t.dir)) {
        await walk(dir, t, async (f, s) => {
          try { await fsp.unlink(f); freed += s; deleted++; } catch { failed++; } // fichiers verrouillés ignorés
        });
        if (t.depth !== 0) await removeEmptyDirs(dir);
      }
    }
  }
  return { freed, deleted, failed };
}

module.exports = { scan, clean, isAdmin };
