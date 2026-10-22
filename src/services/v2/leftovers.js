// Find configuration and data folders left behind by uninstalled apps.
// List a folder only when it does not match a known app or package
// and has not changed for 90 days. Removal goes through the trash.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const isLinux = process.platform === 'linux';
const HOME = os.homedir();
const STALE_MS = 90 * 24 * 3600 * 1000;

// Never suggest standard folders.
const KEEP = new Set([
  // Linux, XDG, and desktop environments
  'autostart', 'systemd', 'dconf', 'gtk-2.0', 'gtk-3.0', 'gtk-4.0', 'fontconfig', 'fonts', 'pulse', 'pipewire', 'menus', 'applications',
  'icons', 'themes', 'trash', 'keyrings', 'mime', 'user-dirs.dirs', 'user-dirs.locale', 'mimeapps.list', 'ibus', 'fcitx', 'environment.d',
  'gnome-session', 'gnome-shell', 'gnome-control-center', 'nautilus', 'evolution', 'tracker', 'tracker3', 'gvfs-metadata', 'xdg-desktop-portal',
  'kde', 'kdeconnect', 'plasma', 'kwin', 'xfce4', 'cinnamon', 'mate', 'lxsession', 'openbox', 'sway', 'hypr', 'nvim', 'vim', 'git', 'ssh', 'gnupg',
  'flatpak', 'snap', 'containers', 'docker', 'npm', 'node', 'pip', 'mesa_shader_cache', 'mesa_shader_cache_db', 'thumbnails', 'fastboost', 'boost-my-pc', 'boost my pc',
  'recently-used.xbel', 'sounds', 'backgrounds', 'nano', 'session', 'sessions', 'desktop-directories', 'org.gnome', 'goa-1.0', 'gnome-online-accounts',
  // Windows
  'microsoft', 'packages', 'temp', 'connecteddevicesplatform', 'comms', 'publishers', 'virtualstore', 'd3dscache', 'crashdumps', 'programs',
  'microsoft_corporation', 'windows', 'intel', 'nvidia', 'nvidia corporation', 'amd', 'realtek', 'adobe', 'google', 'mozilla', 'apple', 'apple computer',
  'peerdistrepub', 'placeholdertilelogofolder', 'history', 'onedrive', 'squirreltemp', 'electron', 'pip', 'npm-cache', 'fastboost', 'boost my pc', 'boost-my-pc-updater', 'pc manager',
]);

const norm = (s) => String(s || '').toLowerCase().replace(/\.(desktop|exe)$/, '').replace(/[^a-z0-9]/g, '');

async function knownTokens() {
  const tokens = new Set();
  const add = (s) => {
    const n = norm(s);
    if (n.length >= 3) tokens.add(n);
    for (const part of String(s || '').toLowerCase().split(/[^a-z0-9]+/)) if (part.length >= 4) tokens.add(part);
  };
  if (isLinux) {
    const { run, packageManager, which } = require('../linux/sh');
    const pm = packageManager();
    const pkgs = await ({
      apt: () => run('dpkg-query', ['-W', '-f=${Package}\n']),
      dnf: () => run('rpm', ['-qa', '--qf', '%{NAME}\n']),
      zypper: () => run('rpm', ['-qa', '--qf', '%{NAME}\n']),
      pacman: () => run('pacman', ['-Qq']),
    }[pm] || (async () => ''))().catch(() => '');
    pkgs.split('\n').forEach(add);
    if (which('flatpak')) (await run('flatpak', ['list', '--columns=application']).catch(() => '')).split('\n').forEach(add);
    if (which('snap')) (await run('snap', ['list']).catch(() => '')).split('\n').slice(1).forEach((l) => add(l.split(/\s+/)[0]));
    for (const d of (process.env.PATH || '').split(':')) for (const f of await fsp.readdir(d).catch(() => [])) add(f);
    for (const d of ['/usr/share/applications', path.join(HOME, '.local/share/applications')]) {
      for (const f of await fsp.readdir(d).catch(() => [])) add(f);
    }
    for (const f of await fsp.readdir('/opt').catch(() => [])) add(f);
  } else {
    const apps = await require('../apps').listInstalledApps().catch(() => []);
    for (const a of apps) { add(a.name); add(a.publisher); if (a.location) add(path.basename(a.location)); }
    for (const d of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], path.join(process.env.LOCALAPPDATA || '', 'Programs')]) {
      for (const f of await fsp.readdir(d || '').catch(() => [])) add(f);
    }
  }
  return tokens;
}

function isKnown(name, tokens) {
  const n = norm(name);
  if (!n || KEEP.has(name.toLowerCase()) || KEEP.has(n)) return true;
  if (tokens.has(n)) return true;
  for (const part of name.toLowerCase().split(/[^a-z0-9]+/)) if (part.length >= 4 && tokens.has(part)) return true;
  // Match partial names, such as "code" to "code-oss" or "jetbrains" to "jetbrains-toolbox".
  for (const t of tokens) if (t.length >= 5 && (n.startsWith(t) || t.startsWith(n))) return true;
  return false;
}

// Stop counting when a file newer than `cutoff` appears; the folder is still in use.
async function dirInfo(p, cutoff) {
  let size = 0, n = 0;
  const stack = [p];
  while (stack.length && n < 50000) {
    const d = stack.pop();
    let entries = [];
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { continue; }
    const stats = await Promise.all(entries.filter((e) => !e.isSymbolicLink()).map((e) =>
      fsp.stat(path.join(d, e.name)).then((st) => ({ e, st })).catch(() => null)));
    for (const x of stats) {
      if (!x) continue;
      n++;
      if (x.st.mtimeMs > cutoff) return { recent: true };
      if (x.e.isDirectory()) stack.push(path.join(d, x.e.name)); else size += x.st.size;
    }
  }
  return { recent: false, size };
}

async function scan(onProgress) {
  const roots = isLinux
    ? [path.join(HOME, '.config'), path.join(HOME, '.local', 'share'), path.join(HOME, '.cache')]
    : [process.env.APPDATA, process.env.LOCALAPPDATA].filter(Boolean);
  const tokens = await knownTokens();
  const cutoff = Date.now() - STALE_MS;
  const candidatesList = [];
  for (const root of roots) {
    let entries = [];
    try { entries = await fsp.readdir(root, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || isKnown(e.name, tokens)) continue;
      candidatesList.push({ full: path.join(root, e.name), name: e.name, root: path.basename(root) });
    }
  }
  const out = [];
  for (let i = 0; i < candidatesList.length; i += 4) {
    await Promise.all(candidatesList.slice(i, i + 4).map(async (c) => {
      onProgress?.({ current: c.full, done: i, total: candidatesList.length });
      const st = await fsp.stat(c.full).catch(() => null);
      if (!st || st.mtimeMs > cutoff) return; // Still in use.
      const info = await dirInfo(c.full, cutoff);
      if (info.recent || info.size < 50 * 1024) return;
      out.push({ path: c.full, name: c.name, size: info.size, mtime: st.mtimeMs, root: c.root });
    }));
  }
  return out.sort((a, b) => b.size - a.size);
}

module.exports = { scan };
