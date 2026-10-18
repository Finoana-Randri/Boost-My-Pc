// Linux : processus (/proc), démarrage automatique (XDG autostart), applications installées et désinstallation.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { run, which, privileged, q, packageManager } = require('./sh');

const HOME = os.homedir();
const CONFIG = process.env.XDG_CONFIG_HOME || path.join(HOME, '.config');
const DATA = process.env.XDG_DATA_HOME || path.join(HOME, '.local', 'share');
const PAGE = 4096;

// ---------- Fichiers .desktop ----------
function parseDesktop(txt) {
  const out = {};
  let inMain = false;
  for (const raw of txt.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) { inMain = line === '[Desktop Entry]'; continue; }
    if (!inMain || !line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    if (!(key in out)) out[key] = line.slice(i + 1).trim();
  }
  return out;
}
// Nom localisé (Name[fr_FR], Name[fr], Name)
function localized(d, key) {
  const lang = (process.env.LANG || 'fr_FR').split('.')[0];
  return d[`${key}[${lang}]`] || d[`${key}[${lang.split('_')[0]}]`] || d[key] || '';
}
function setDesktopKey(txt, key, value) {
  const lines = txt.split('\n');
  let start = lines.findIndex((l) => l.trim() === '[Desktop Entry]');
  if (start < 0) { lines.unshift('[Desktop Entry]'); start = 0; }
  let end = lines.findIndex((l, i) => i > start && l.trim().startsWith('['));
  if (end < 0) end = lines.length;
  const idx = lines.findIndex((l, i) => i > start && i < end && l.startsWith(key + '='));
  if (idx >= 0) lines[idx] = `${key}=${value}`; else lines.splice(start + 1, 0, `${key}=${value}`);
  return lines.join('\n');
}
const cleanExec = (e = '') => e.replace(/\s%[fFuUdDnNickvm]/g, '').trim();
function execBinary(exec) {
  const first = cleanExec(exec).match(/^"([^"]+)"|^(\S+)/);
  let bin = first ? first[1] || first[2] : '';
  if (bin === 'env') bin = cleanExec(exec).split(/\s+/).find((p, i) => i > 0 && !p.includes('=')) || bin;
  return bin.startsWith('/') ? bin : which(bin) || bin;
}

// ---------- Processus ----------
const CLK = 100;
async function listProcesses() {
  const uid = process.getuid?.();
  const groups = new Map();
  const pids = (await fsp.readdir('/proc')).filter((p) => /^\d+$/.test(p));
  await Promise.all(pids.map(async (pid) => {
    try {
      const status = await fsp.readFile(`/proc/${pid}/status`, 'utf8');
      const name = status.match(/^Name:\s+(.*)$/m)?.[1];
      const rss = Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] || 0) * 1024;
      const owner = Number(status.match(/^Uid:\s+(\d+)/m)?.[1]);
      if (!name || !rss) return; // threads noyau
      let exe = null;
      try { exe = await fsp.readlink(`/proc/${pid}/exe`); } catch {}
      const cmd = (await fsp.readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '')).split('\0').filter(Boolean).join(' ');
      const key = name.toLowerCase();
      if (!groups.has(key)) groups.set(key, { name, desc: name, path: exe, cmd, ids: [], memory: 0, hasWindow: false, mine: owner === uid, user: owner });
      const g = groups.get(key);
      g.ids.push(Number(pid));
      g.memory += rss;
      if (!g.path && exe) g.path = exe;
    } catch {}
  }));
  await attachAppNames(groups);
  return [...groups.values()].sort((a, b) => b.memory - a.memory);
}

// Associe les processus aux applications (.desktop) pour un nom lisible et une icône
let desktopIndex = null;
async function getDesktopIndex() {
  if (desktopIndex) return desktopIndex;
  desktopIndex = new Map();
  for (const app of await readDesktopApps()) {
    const bin = path.basename(app.bin || '');
    if (bin && !desktopIndex.has(bin)) desktopIndex.set(bin, app);
    if (app.wmClass && !desktopIndex.has(app.wmClass.toLowerCase())) desktopIndex.set(app.wmClass.toLowerCase(), app);
  }
  return desktopIndex;
}
async function attachAppNames(groups) {
  const idx = await getDesktopIndex();
  for (const g of groups.values()) {
    const app = idx.get(path.basename(g.path || '')) || idx.get(g.name.toLowerCase());
    if (app) { g.desc = app.name; g.icon = app.icon; g.hasWindow = true; }
  }
}

const PROTECTED = /^(systemd|init|kthreadd|Xorg|Xwayland|gnome-shell|plasmashell|kwin_x11|kwin_wayland|sddm|gdm|gdm3|lightdm|pipewire|wireplumber|pulseaudio|dbus-daemon|dbus-broker|NetworkManager|polkitd|udisksd|systemd-.*|login|agetty|cinnamon|xfwm4|mutter|sway|Hyprland)$/i;

// Par défaut, fermeture propre (SIGTERM : l'application peut enregistrer) ; `force` termine ensuite les récalcitrants.
async function killProcesses(ids, name, { force = false } = {}) {
  if (name && PROTECTED.test(name)) throw new Error(`« ${name} » est un processus système protégé.`);
  // PID ≤ 1 interdit : kill(-1) viserait tous les processus de l'utilisateur, kill(1) le système
  const pids = (ids || []).map(Number).filter((id) => Number.isInteger(id) && id > 1);
  if (!pids.length) throw new Error('Aucun processus valide.');
  const denied = [];
  for (const id of pids) {
    try { process.kill(id, 'SIGTERM'); } catch (e) { if (e.code === 'EPERM') denied.push(id); }
  }
  if (force) {
    await new Promise((r) => setTimeout(r, 3000));
    for (const id of pids) { if (!denied.includes(id)) { try { process.kill(id, 0); process.kill(id, 'SIGKILL'); } catch {} } }
  }
  if (denied.length) {
    await privileged(`kill -TERM ${denied.join(' ')}`);
  }
  return true;
}

// ---------- Démarrage automatique (XDG autostart) ----------
const USER_AUTOSTART = path.join(CONFIG, 'autostart');
const SYS_AUTOSTART = ['/etc/xdg/autostart'];

async function readDir(dir) { try { return await fsp.readdir(dir); } catch { return []; } }

async function listStartup() {
  const items = new Map();
  for (const dir of [...SYS_AUTOSTART, USER_AUTOSTART]) {
    for (const f of (await readDir(dir)).filter((x) => x.endsWith('.desktop'))) {
      const full = path.join(dir, f);
      const txt = await fsp.readFile(full, 'utf8').catch(() => null);
      if (!txt) continue;
      const d = parseDesktop(txt);
      const isUser = dir === USER_AUTOSTART;
      const prev = items.get(f);
      // Ignore les entrées réservées à un autre bureau
      const desk = (process.env.XDG_CURRENT_DESKTOP || '').split(':');
      if (d.OnlyShowIn && !d.OnlyShowIn.split(';').some((x) => desk.includes(x))) { if (!prev) continue; }
      if (d.NotShowIn && d.NotShowIn.split(';').some((x) => x && desk.includes(x))) continue;
      const enabled = d.Hidden !== 'true' && d['X-GNOME-Autostart-enabled'] !== 'false';
      items.set(f, {
        file: f,
        name: localized(d, 'Name') || prev?.name || f.replace(/\.desktop$/, ''),
        command: cleanExec(d.Exec || prev?.command || ''),
        exe: d.Icon || prev?.exe || execBinary(d.Exec || ''),
        hive: isUser && !prev ? 'HKCU' : 'HKLM', // HKCU = propre à l'utilisateur, HKLM = fourni par le système
        source: isUser ? 'user' : 'system',
        hasSystem: !!prev || !isUser,
        enabled,
      });
    }
  }
  return [...items.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

// Active/désactive en écrivant une copie dans ~/.config/autostart (méthode standard, sans droits admin)
async function setStartup(item, enabled) {
  await fsp.mkdir(USER_AUTOSTART, { recursive: true });
  const userFile = path.join(USER_AUTOSTART, item.file);
  let txt = await fsp.readFile(userFile, 'utf8').catch(() => null);
  if (!txt) {
    const sys = SYS_AUTOSTART.map((d) => path.join(d, item.file)).find((p) => fs.existsSync(p));
    txt = sys ? await fsp.readFile(sys, 'utf8') : `[Desktop Entry]\nType=Application\nName=${item.name}\nExec=${item.command}\n`;
  }
  txt = setDesktopKey(txt, 'Hidden', enabled ? 'false' : 'true');
  txt = setDesktopKey(txt, 'X-GNOME-Autostart-enabled', enabled ? 'true' : 'false');
  await fsp.writeFile(userFile, txt);
  return true;
}

// ---------- Applications installées ----------
const APP_DIRS = [
  '/usr/share/applications',
  '/usr/local/share/applications',
  path.join(DATA, 'applications'),
  '/var/lib/flatpak/exports/share/applications',
  path.join(DATA, 'flatpak', 'exports', 'share', 'applications'),
  '/var/lib/snapd/desktop/applications',
];

async function readDesktopApps() {
  const seen = new Map();
  for (const dir of APP_DIRS) {
    for (const f of (await readDir(dir)).filter((x) => x.endsWith('.desktop'))) {
      const full = path.join(dir, f);
      const txt = await fsp.readFile(full, 'utf8').catch(() => null);
      if (!txt) continue;
      const d = parseDesktop(txt);
      if (d.Type && d.Type !== 'Application') continue;
      if (d.NoDisplay === 'true' || d.Hidden === 'true') continue;
      let type = 'system', pkgId = null;
      if (d['X-Flatpak'] || full.includes('/flatpak/')) { type = 'flatpak'; pkgId = d['X-Flatpak'] || f.replace(/\.desktop$/, ''); }
      else if (d['X-SnapInstanceName'] || full.includes('/snapd/')) { type = 'snap'; pkgId = d['X-SnapInstanceName'] || f.split('_')[0]; }
      else if (full.startsWith(path.join(DATA, 'applications'))) type = 'user';
      seen.set(f, {
        id: f, file: full, name: localized(d, 'Name') || f, comment: localized(d, 'Comment'),
        icon: d.Icon || null, bin: execBinary(d.Exec || ''), wmClass: d.StartupWMClass || null, type, pkgId,
      });
    }
  }
  return [...seen.values()];
}

// Trouve le paquet propriétaire de chaque fichier .desktop, en un seul appel
async function ownerPackages(files) {
  const pm = packageManager();
  const map = new Map();
  if (!files.length || !pm) return map;
  try {
    if (pm === 'apt') {
      const out = await run('dpkg-query', ['-S', ...files], { okCodes: [0, 1] });
      for (const l of out.split('\n')) { const m = l.match(/^(.+?): (\/.+)$/); if (m) map.set(m[2], m[1].split(',')[0].split(':')[0].trim()); }
    } else if (pm === 'dnf' || pm === 'zypper') {
      const out = await run('rpm', ['-qf', '--qf', '%{NAME}\\n', ...files], { okCodes: [0, 1] });
      out.split('\n').forEach((l, i) => { if (files[i] && l && !/not owned/.test(l)) map.set(files[i], l.trim()); });
    } else if (pm === 'pacman') {
      const out = await run('pacman', ['-Qqo', ...files], { okCodes: [0, 1] });
      out.split('\n').forEach((l, i) => { if (files[i] && l) map.set(files[i], l.trim()); });
    }
  } catch {}
  return map;
}

async function packageSizes() {
  const pm = packageManager();
  const map = new Map();
  try {
    if (pm === 'apt') {
      const out = await run('dpkg-query', ['-W', '-f=${Package}\t${Installed-Size}\t${Version}\t${Maintainer}\n']);
      for (const l of out.split('\n')) { const [n, s, v, m] = l.split('\t'); if (n) map.set(n, { size: Number(s) * 1024, version: v, publisher: (m || '').replace(/\s*<.*>/, '') }); }
    } else if (pm === 'dnf' || pm === 'zypper') {
      const out = await run('rpm', ['-qa', '--qf', '%{NAME}\t%{SIZE}\t%{VERSION}-%{RELEASE}\t%{VENDOR}\t%{INSTALLTIME}\n']);
      for (const l of out.split('\n')) { const [n, s, v, m, t] = l.split('\t'); if (n) map.set(n, { size: Number(s), version: v, publisher: m === '(none)' ? '' : m, date: t ? new Date(Number(t) * 1000).toISOString().slice(0, 10) : null }); }
    } else if (pm === 'pacman') {
      const out = await run('pacman', ['-Qi'], { timeout: 60000 });
      for (const block of out.split('\n\n')) {
        const g = (k) => block.match(new RegExp(`^${k}\\s*:\\s*(.*)$`, 'm'))?.[1];
        const n = g('Name'); if (!n) continue;
        const sz = (g('Installed Size') || '').match(/([\d.]+)\s*(\w+)/);
        const mult = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 }[sz?.[2]] || 1;
        map.set(n, { size: sz ? Number(sz[1]) * mult : 0, version: g('Version'), publisher: (g('Packager') || '').replace(/\s*<.*>/, '') });
      }
    }
  } catch {}
  return map;
}

async function flatpakInfo() {
  const map = new Map();
  if (!which('flatpak')) return map;
  const out = await run('flatpak', ['list', '--app', '--columns=application,version,size,origin,installation']).catch(() => '');
  for (const l of out.split('\n')) {
    const [id, version, size, origin, inst] = l.split('\t');
    if (id) map.set(id, { version, size: parseHumanSize(size), publisher: origin, installation: inst });
  }
  return map;
}
async function snapInfo() {
  const map = new Map();
  if (!which('snap')) return map;
  const out = await run('snap', ['list']).catch(() => '');
  for (const l of out.split('\n').slice(1)) {
    const f = l.trim().split(/\s+/);
    if (f[0]) map.set(f[0], { version: f[1], publisher: (f[4] || '').replace(/\*|✓/g, '') });
  }
  return map;
}
function parseHumanSize(s = '') {
  const m = s.replace(',', '.').match(/([\d.]+)\s*([kMGT]?)B?/i);
  if (!m) return 0;
  return Number(m[1]) * ({ '': 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12 }[m[2]] || 1);
}

async function listInstalledApps() {
  const apps = await readDesktopApps();
  const sysFiles = apps.filter((a) => a.type === 'system').map((a) => a.file);
  const [owners, sizes, flat, snaps] = await Promise.all([ownerPackages(sysFiles), packageSizes(), flatpakInfo(), snapInfo()]);
  // Un paquet = une ligne : on garde le .desktop qui ressemble le plus à l'application principale
  const score = (a, pkg) => {
    const base = a.id.replace(/\.desktop$/, '').toLowerCase();
    let s = 0;
    if (pkg && (base === pkg.toLowerCase() || base.endsWith('.' + pkg.toLowerCase()))) s += 3;
    if (pkg && base.includes(pkg.toLowerCase())) s += 1;
    if (/settings|preferences|paramètres|préférences|config/i.test(a.name + base)) s -= 2;
    return s;
  };
  const best = new Map();
  for (const a of apps) {
    let info = {};
    let pkg = a.pkgId;
    if (a.type === 'system') { pkg = owners.get(a.file); info = sizes.get(pkg) || {}; }
    else if (a.type === 'flatpak') info = flat.get(pkg) || {};
    else if (a.type === 'snap') info = snaps.get(pkg) || {};
    if (a.type === 'system' && !pkg) continue; // non désinstallable par le gestionnaire de paquets
    const key = `${a.type}:${pkg || a.id}`;
    const s = score(a, pkg);
    if (best.has(key) && best.get(key).score >= s) continue;
    best.set(key, {
      score: s,
      app: {
        id: a.id, name: a.name, publisher: info.publisher || '', version: info.version || '', size: info.size || 0,
        date: info.date || null, icon: a.icon, type: a.type, pkg, desktopFile: a.file, installation: info.installation,
      },
    });
  }
  return [...best.values()].map((b) => b.app).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

async function uninstallApp(app) {
  const pm = packageManager();
  if (app.type === 'flatpak') {
    const args = ['uninstall', '-y', '--noninteractive', app.pkg];
    if (app.installation === 'user') args.splice(1, 0, '--user');
    await run('flatpak', args, { timeout: 10 * 60000 });
  } else if (app.type === 'snap') {
    await privileged(`snap remove ${q(app.pkg)}`);
  } else if (app.type === 'user') {
    await fsp.unlink(app.desktopFile);
  } else {
    if (!/^[\w.+:@-]+$/.test(app.pkg || '')) throw new Error('Nom de paquet invalide');
    const cmd = {
      apt: `DEBIAN_FRONTEND=noninteractive apt-get remove -y ${q(app.pkg)}`,
      dnf: `dnf remove -y ${q(app.pkg)}`,
      pacman: `pacman -R --noconfirm ${q(app.pkg)}`,
      zypper: `zypper --non-interactive remove ${q(app.pkg)}`,
    }[pm];
    if (!cmd) throw new Error('Gestionnaire de paquets non pris en charge');
    await privileged(cmd);
  }
  desktopIndex = null;
  return { started: true, finished: true };
}

// ---------- Icônes ----------
const ICON_DIRS = [
  path.join(DATA, 'icons'), path.join(HOME, '.icons'), '/usr/share/icons', '/usr/local/share/icons',
  '/var/lib/flatpak/exports/share/icons', path.join(DATA, 'flatpak', 'exports', 'share', 'icons'),
];
const THEMES = ['hicolor', 'Adwaita', 'breeze', 'Papirus', 'Yaru', 'elementary', 'gnome'];
const SIZES = ['scalable', '256x256', '128x128', '96x96', '64x64', '48x48', '32x32'];
const iconMemo = new Map();
function resolveIcon(name) {
  if (!name) return null;
  if (iconMemo.has(name)) return iconMemo.get(name);
  let found = null;
  if (name.startsWith('/')) found = fs.existsSync(name) ? name : null;
  else {
    outer: for (const base of ICON_DIRS) for (const theme of THEMES) for (const size of SIZES) for (const cat of ['apps', 'applications']) for (const ext of ['svg', 'png']) {
      const p = path.join(base, theme, size, cat, `${name}.${ext}`);
      if (fs.existsSync(p)) { found = p; break outer; }
    }
    if (!found) for (const ext of ['svg', 'png', 'xpm']) { const p = `/usr/share/pixmaps/${name}.${ext}`; if (fs.existsSync(p)) { found = p; break; } }
  }
  iconMemo.set(name, found);
  return found;
}
async function iconDataUrl(nameOrPath) {
  const p = resolveIcon(nameOrPath);
  if (!p || !/\.(svg|png)$/i.test(p)) return null;
  const buf = await fsp.readFile(p);
  return `data:image/${p.endsWith('.svg') ? 'svg+xml' : 'png'};base64,${buf.toString('base64')}`;
}

module.exports = { listProcesses, killProcesses, listStartup, setStartup, listInstalledApps, uninstallApp, iconDataUrl, resolveIcon };
