// Clean browser and system history, cookies, and other traces.
// Only clear browser data after the browser closes, to avoid corrupting its files.
// Passwords, bookmarks, and payment card data are never touched.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const isLinux = process.platform === 'linux';
const HOME = os.homedir();
const LOCAL = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
const ROAMING = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
const CONFIG = process.env.XDG_CONFIG_HOME || path.join(HOME, '.config');

// Chromium browsers: profile root and process name.
const CHROMIUMS = isLinux ? [
  { id: 'chrome', name: 'Google Chrome', dir: path.join(CONFIG, 'google-chrome'), proc: /^chrome$/ },
  { id: 'chromium', name: 'Chromium', dir: path.join(CONFIG, 'chromium'), proc: /^chromium(-browser)?$/ },
  { id: 'brave', name: 'Brave', dir: path.join(CONFIG, 'BraveSoftware', 'Brave-Browser'), proc: /^brave(-browser)?$/ },
  { id: 'edge', name: 'Microsoft Edge', dir: path.join(CONFIG, 'microsoft-edge'), proc: /^msedge$/ },
  { id: 'vivaldi', name: 'Vivaldi', dir: path.join(CONFIG, 'vivaldi'), proc: /^vivaldi-bin$/ },
] : [
  { id: 'chrome', name: 'Google Chrome', dir: path.join(LOCAL, 'Google', 'Chrome', 'User Data'), proc: /^chrome$/i },
  { id: 'edge', name: 'Microsoft Edge', dir: path.join(LOCAL, 'Microsoft', 'Edge', 'User Data'), proc: /^msedge$/i },
  { id: 'brave', name: 'Brave', dir: path.join(LOCAL, 'BraveSoftware', 'Brave-Browser', 'User Data'), proc: /^brave$/i },
  { id: 'vivaldi', name: 'Vivaldi', dir: path.join(LOCAL, 'Vivaldi', 'User Data'), proc: /^vivaldi$/i },
];
const FIREFOX = {
  id: 'firefox', name: 'Firefox',
  dirs: isLinux
    ? [path.join(HOME, '.mozilla', 'firefox'), path.join(HOME, 'snap', 'firefox', 'common', '.mozilla', 'firefox'), path.join(HOME, '.var', 'app', 'org.mozilla.firefox', '.mozilla', 'firefox')]
    : [path.join(ROAMING, 'Mozilla', 'Firefox', 'Profiles')],
  proc: isLinux ? /^(firefox|firefox-bin|GeckoMain)$/ : /^firefox$/i,
};

// Files for each category, relative to the profile.
const CHROMIUM_FILES = {
  history: ['History', 'History-journal', 'Visited Links', 'Top Sites', 'Top Sites-journal'],
  cookies: ['Cookies', 'Cookies-journal', path.join('Network', 'Cookies'), path.join('Network', 'Cookies-journal')],
  sessions: ['Current Session', 'Current Tabs', 'Last Session', 'Last Tabs', 'Sessions'],
};
const FIREFOX_FILES = {
  cookies: ['cookies.sqlite', 'cookies.sqlite-wal', 'cookies.sqlite-shm'],
  forms: ['formhistory.sqlite', 'formhistory.sqlite-wal', 'formhistory.sqlite-shm'],
  sessions: ['sessionstore.jsonlz4', 'sessionstore-backups'],
};
const LABELS = {
  history: ['Historique de navigation', 'Sites visités et téléchargements listés'],
  cookies: ['Cookies', 'Vous serez déconnecté des sites web'],
  forms: ['Historique des formulaires', 'Saisies proposées automatiquement'],
  sessions: ['Onglets de la dernière session', 'Les onglets ne seront plus restaurés'],
};

async function exists(p) { try { await fsp.access(p); return true; } catch { return false; } }
async function sizeOf(p) {
  try {
    const st = await fsp.stat(p);
    if (!st.isDirectory()) return st.size;
    let total = 0;
    for (const e of await fsp.readdir(p)) total += await sizeOf(path.join(p, e));
    return total;
  } catch { return 0; }
}

async function chromiumProfiles(root) {
  let entries = [];
  try { entries = await fsp.readdir(root, { withFileTypes: true }); } catch { return []; }
  return entries.filter((e) => e.isDirectory() && (e.name === 'Default' || /^Profile \d+$/.test(e.name))).map((e) => path.join(root, e.name));
}
async function firefoxProfiles() {
  const out = [];
  for (const d of FIREFOX.dirs) {
    let entries = [];
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) if (e.isDirectory() && /\./.test(e.name) && await exists(path.join(d, e.name, 'prefs.js'))) out.push(path.join(d, e.name));
  }
  return out;
}

async function runningProcessNames() {
  const names = new Set();
  if (isLinux) {
    for (const pid of await fsp.readdir('/proc').catch(() => [])) {
      if (!/^\d+$/.test(pid)) continue;
      const comm = await fsp.readFile(`/proc/${pid}/comm`, 'utf8').catch(() => '');
      if (comm) names.add(comm.trim());
    }
  } else {
    const { runPS } = require('../ps');
    const out = await runPS('Get-Process | Select-Object -ExpandProperty ProcessName').catch(() => '');
    out.split(/\r?\n/).forEach((n) => n.trim() && names.add(n.trim()));
  }
  return [...names];
}

// Build the item list: { id, group, name, desc, files[], size, blocked }.
async function collect() {
  const running = await runningProcessNames();
  const isRunning = (re) => running.some((n) => re.test(n));
  const items = [];
  for (const b of CHROMIUMS) {
    const profiles = await chromiumProfiles(b.dir);
    if (!profiles.length) continue;
    for (const [cat, rel] of Object.entries(CHROMIUM_FILES)) {
      const files = [];
      for (const p of profiles) for (const r of rel) { const f = path.join(p, r); if (await exists(f)) files.push(f); }
      if (!files.length) continue;
      items.push({ id: `${b.id}:${cat}`, group: b.name, cat, files, blocked: isRunning(b.proc) ? `Fermez ${b.name} pour effacer ces données` : null });
    }
  }
  const ff = await firefoxProfiles();
  if (ff.length) {
    for (const [cat, rel] of Object.entries(FIREFOX_FILES)) {
      const files = [];
      for (const p of ff) for (const r of rel) { const f = path.join(p, r); if (await exists(f)) files.push(f); }
      if (files.length) items.push({ id: `firefox:${cat}`, group: 'Firefox', cat, files, blocked: isRunning(FIREFOX.proc) ? 'Fermez Firefox pour effacer ces données' : null });
    }
  }
  // System traces
  const sys = isLinux
    ? [
      { id: 'sys:recent', name: 'Documents récents', desc: 'Liste des fichiers ouverts récemment', files: [path.join(HOME, '.local', 'share', 'recently-used.xbel')] },
      { id: 'sys:shell', name: 'Historique du terminal', desc: 'Commandes tapées dans bash et zsh', files: [path.join(HOME, '.bash_history'), path.join(HOME, '.zsh_history')] },
      { id: 'sys:thumbs', name: 'Miniatures en cache', desc: 'Aperçus des images et vidéos consultées', files: [path.join(HOME, '.cache', 'thumbnails')] },
    ]
    : [
      { id: 'sys:recent', name: 'Éléments récents', desc: 'Raccourcis des fichiers ouverts récemment', files: [path.join(ROAMING, 'Microsoft', 'Windows', 'Recent')] },
      { id: 'sys:jumplists', name: 'Listes de raccourcis', desc: 'Fichiers récents affichés dans la barre des tâches', files: [path.join(ROAMING, 'Microsoft', 'Windows', 'Recent', 'AutomaticDestinations'), path.join(ROAMING, 'Microsoft', 'Windows', 'Recent', 'CustomDestinations')] },
      { id: 'sys:runmru', name: 'Historique de la commande Exécuter', desc: 'Commandes tapées dans Win + R', registry: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\RunMRU', files: [] },
    ];
  for (const s of sys) {
    const files = [];
    for (const f of s.files) if (await exists(f)) files.push(f);
    if (files.length || s.registry) items.push({ ...s, group: 'Système', files, blocked: null });
  }
  for (const it of items) {
    if (it.cat) { it.name = LABELS[it.cat][0]; it.desc = LABELS[it.cat][1]; }
    it.size = 0;
    for (const f of it.files) it.size += await sizeOf(f);
  }
  return items;
}

async function scan() {
  const items = await collect();
  return items.map(({ files, registry, ...rest }) => ({ ...rest, count: files.length + (registry ? 1 : 0), recommended: rest.cat === 'history' || rest.id === 'sys:recent' }));
}

async function removePath(p, keepDir) {
  const st = await fsp.lstat(p);
  if (st.isDirectory()) {
    for (const e of await fsp.readdir(p)) await removePath(path.join(p, e), false);
    if (!keepDir) await fsp.rmdir(p);
  } else {
    await fsp.unlink(p);
  }
}

async function clean(ids) {
  const items = (await collect()).filter((i) => ids.includes(i.id));
  let freed = 0, done = 0;
  const skipped = [];
  for (const it of items) {
    if (it.blocked) { skipped.push(it.blocked); continue; }
    try {
      // Clear container folders such as Recent and thumbnails, but keep the folders.
      for (const f of it.files) await removePath(f, it.group === 'Système');
      if (it.registry) {
        const { runPS, psq } = require('../ps');
        await runPS(`Remove-ItemProperty -Path ${psq(it.registry)} -Name * -ErrorAction SilentlyContinue`);
      }
      freed += it.size; done++;
    } catch (e) { skipped.push(`${it.name} (${it.group}) : ${e.message}`); }
  }
  return { freed, done, skipped: [...new Set(skipped)] };
}

module.exports = { scan, clean };
