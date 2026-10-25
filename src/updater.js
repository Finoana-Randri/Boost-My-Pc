// In-app update from the latest GitHub release: pick the installer that matches how Boost My Pc
// is installed, download it (size and SHA-256 checked), install it and restart the app.
//   Windows: silent NSIS install (it asks for administrator rights if needed), then the app reopens.
//   Linux AppImage: the new file replaces the old one, then the app restarts.
//   Linux .deb: installed with apt (password asked through polkit), then the app restarts.
const { app, net } = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPO = 'Finoana-Randri/Boost-My-Pc';
// A different release feed (JSON in the GitHub format), for tests only.
const FEED = process.env.BMP_UPDATE_FEED || `https://api.github.com/repos/${REPO}/releases/latest`;
const isLinux = process.platform === 'linux';

const newer = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }) > 0;

// How this copy is installed, which decides the file to download.
function installKind() {
  if (!app.isPackaged) return null;
  if (!isLinux) return 'exe';
  if (process.env.APPIMAGE) return 'appimage';
  return fs.existsSync('/usr/bin/dpkg') ? 'deb' : null;
}
const ASSET = { exe: /Setup-[\d.]+\.exe$/i, appimage: /\.AppImage$/i, deb: /_amd64\.deb$|[\d.]+\.deb$/i };

async function latest() {
  const res = await net.fetch(FEED, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const r = await res.json();
  const version = String(r.tag_name || '').replace(/^v/, '');
  const kind = installKind();
  const a = kind && (r.assets || []).find((x) => ASSET[kind].test(x.name));
  return {
    version, url: r.html_url, current: app.getVersion(), newer: newer(version, app.getVersion()),
    // Can this copy update itself? (Not when started from the sources or from an unknown package.)
    asset: a ? { name: a.name, url: a.browser_download_url, size: a.size, sha256: String(a.digest || '').replace(/^sha256:/, '') || null } : null,
  };
}

const updateDir = () => path.join(app.getPath('temp'), 'boost-my-pc-update');
// The installer of the previous update is no longer needed once the app has restarted.
function cleanup() { try { fs.rmSync(updateDir(), { recursive: true, force: true }); } catch {} }

async function download(asset, onProgress) {
  const dir = updateDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, path.basename(asset.name));
  const res = await net.fetch(asset.url, { signal: AbortSignal.timeout(30 * 60000) });
  if (!res.ok || !res.body) throw new Error(`Téléchargement impossible (${res.status})`);
  const total = asset.size || Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(file);
  const hash = crypto.createHash('sha256');
  let done = 0, last = 0;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      hash.update(value);
      done += value.length;
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      if (Date.now() - last > 200) { last = Date.now(); onProgress({ phase: 'download', done, total }); }
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  if (total && done !== total) throw new Error('Téléchargement incomplet.');
  if (asset.sha256 && hash.digest('hex') !== asset.sha256) { fs.rmSync(file, { force: true }); throw new Error('Fichier téléchargé corrompu (somme de contrôle différente).'); }
  onProgress({ phase: 'download', done, total: total || done });
  return file;
}

async function install(file, kind) {
  if (kind === 'exe') {
    // An all-users install (Program Files) needs administrator rights: Windows asks for them
    // unless the app already has them. --force-run reopens the app once the silent install is over.
    const pf = [process.env.ProgramFiles, process.env.ProgramW6432].filter(Boolean).map((p) => p.toLowerCase());
    const allUsers = pf.some((p) => app.getPath('exe').toLowerCase().startsWith(p));
    const ps = `Start-Process -FilePath '${file.replace(/'/g, "''")}' -ArgumentList '/S','--force-run'${allUsers ? ' -Verb RunAs' : ''}`;
    await new Promise((resolve, reject) => {
      const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true });
      let err = '';
      p.stderr.on('data', (d) => (err += d));
      p.on('error', reject);
      p.on('close', (code) => (code ? reject(new Error(/annul|cancel/i.test(err) ? 'Autorisation administrateur refusée.' : 'L\'installation n\'a pas pu démarrer.')) : resolve()));
    });
    setTimeout(() => app.quit(), 800);
    return;
  }
  if (kind === 'appimage') {
    // Replace the file in place (Linux allows it while it runs), then start the new one.
    const target = process.env.APPIMAGE;
    const tmp = `${target}.new`;
    fs.copyFileSync(file, tmp);
    fs.chmodSync(tmp, 0o755);
    fs.renameSync(tmp, target);
    app.relaunch({ execPath: target, args: process.argv.slice(1).filter((a) => !a.startsWith('--bmp')) });
    app.exit(0);
    return;
  }
  if (kind === 'deb') {
    const { privileged, which } = require('./services/linux/sh');
    const q = `'${file.replace(/'/g, `'\\''`)}'`;
    await privileged(which('apt-get') ? `DEBIAN_FRONTEND=noninteractive apt-get install -y ${q}` : `dpkg -i ${q}`, { timeout: 10 * 60000 });
    app.relaunch();
    app.exit(0);
  }
}

// The whole update; progress goes to `onProgress({ phase, done, total })`.
async function update(onProgress) {
  const l = await latest();
  if (!l.newer) throw new Error('Boost My Pc est déjà à jour.');
  if (!l.asset) throw new Error('Mise à jour automatique indisponible pour cette installation.');
  const file = await download(l.asset, onProgress);
  onProgress({ phase: 'install' });
  await install(file, installKind());
  return { version: l.version };
}

module.exports = { latest, update, installKind, cleanup };
