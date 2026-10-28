// In-app update from the latest GitHub release. The installer that matches this installation is
// downloaded (size and SHA-256 checked), installed, and the app restarts:
//   Windows   silent setup, which reopens the app;
//   AppImage  the new file replaces the old one;
//   .deb      installed with apt, the password is asked through polkit.
const { app, net } = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

const REPO = 'Finoana-Randri/Boost-My-Pc';
// Tests point this to a local feed in the GitHub format.
const FEED = process.env.BMP_UPDATE_FEED || `https://api.github.com/repos/${REPO}/releases/latest`;
const isLinux = process.platform === 'linux';

const ASSET_PATTERNS = {
  exe: /Setup-[\d.]+\.exe$/i,
  appimage: /\.AppImage$/i,
  deb: /_amd64\.deb$|[\d.]+\.deb$/i,
};

const isNewer = (version, current) => String(version).localeCompare(String(current), undefined, { numeric: true }) > 0;

// Null when this copy can't update itself (started from the sources, unknown package format).
function installKind() {
  if (!app.isPackaged) return null;
  if (!isLinux) return 'exe';
  if (process.env.APPIMAGE) return 'appimage';
  return fs.existsSync('/usr/bin/dpkg') ? 'deb' : null;
}

async function latest() {
  const res = await net.fetch(FEED, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const release = await res.json();
  const version = String(release.tag_name || '').replace(/^v/, '');
  const kind = installKind();
  const asset = kind && (release.assets || []).find((a) => ASSET_PATTERNS[kind].test(a.name));
  return {
    version,
    url: release.html_url,
    current: app.getVersion(),
    newer: isNewer(version, app.getVersion()),
    asset: asset && {
      name: asset.name,
      url: asset.browser_download_url,
      size: asset.size,
      sha256: String(asset.digest || '').replace(/^sha256:/, '') || null,
    },
  };
}

const downloadDir = () => path.join(app.getPath('temp'), 'boost-my-pc-update');

// Removes the installer of the previous update, once the new version runs.
function cleanup() {
  try {
    fs.rmSync(downloadDir(), { recursive: true, force: true });
  } catch {
    // Still locked by the installer: removed at the next start.
  }
}

async function download(asset, onProgress) {
  fs.mkdirSync(downloadDir(), { recursive: true });
  const file = path.join(downloadDir(), path.basename(asset.name));
  const res = await net.fetch(asset.url, { signal: AbortSignal.timeout(30 * 60000) });
  if (!res.ok || !res.body) throw new Error(`Téléchargement impossible (${res.status})`);

  const total = asset.size || Number(res.headers.get('content-length')) || 0;
  const hash = crypto.createHash('sha256');
  let received = 0;
  let reportedAt = 0;
  const meter = new Transform({
    transform(chunk, _encoding, next) {
      hash.update(chunk);
      received += chunk.length;
      if (Date.now() - reportedAt > 200) {
        reportedAt = Date.now();
        onProgress({ phase: 'download', done: received, total });
      }
      next(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body), meter, fs.createWriteStream(file));

  if (total && received !== total) throw new Error('Téléchargement incomplet.');
  if (asset.sha256 && hash.digest('hex') !== asset.sha256) {
    fs.rmSync(file, { force: true });
    throw new Error('Fichier téléchargé corrompu (somme de contrôle différente).');
  }
  onProgress({ phase: 'download', done: received, total: total || received });
  return file;
}

// Restarts through the Linux launcher (see build/afterPack.js), which picks the sandbox mode again.
function relaunch(execPath) {
  const args = process.argv.slice(1).filter((a) => !a.startsWith('--bmp') && a !== '--no-sandbox' && a !== '--disable-setuid-sandbox');
  app.relaunch({ execPath, args });
  app.exit(0);
}

function runWindowsSetup(file) {
  // Installed for all users (Program Files): administrator rights, which Windows asks for unless the
  // app already has them. --force-run reopens the app after the silent install.
  const programFiles = [process.env.ProgramFiles, process.env.ProgramW6432].filter(Boolean).map((p) => p.toLowerCase());
  const allUsers = programFiles.some((p) => app.getPath('exe').toLowerCase().startsWith(p));
  const command = `Start-Process -FilePath '${file.replace(/'/g, "''")}' -ArgumentList '/S','--force-run'${allUsers ? ' -Verb RunAs' : ''}`;
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true });
    let stderr = '';
    ps.stderr.on('data', (d) => { stderr += d; });
    ps.on('error', reject);
    ps.on('close', (code) => {
      if (!code) return resolve();
      reject(new Error(/annul|cancel/i.test(stderr) ? 'Autorisation administrateur refusée.' : 'L\'installation n\'a pas pu démarrer.'));
    });
  });
}

async function install(file, kind) {
  if (kind === 'exe') {
    await runWindowsSetup(file);
    setTimeout(() => app.quit(), 800);
  } else if (kind === 'appimage') {
    // A running AppImage can be replaced: the new file takes the old one's place atomically.
    const target = process.env.APPIMAGE;
    const temp = `${target}.new`;
    fs.copyFileSync(file, temp);
    fs.chmodSync(temp, 0o755);
    fs.renameSync(temp, target);
    relaunch(target);
  } else if (kind === 'deb') {
    const { privileged, which } = require('./services/linux/sh');
    const quoted = `'${file.replace(/'/g, `'\\''`)}'`;
    const command = which('apt-get') ? `DEBIAN_FRONTEND=noninteractive apt-get install -y ${quoted}` : `dpkg -i ${quoted}`;
    await privileged(command, { timeout: 10 * 60000 });
    const launcher = path.join(path.dirname(process.execPath), 'boost-my-pc');
    relaunch(fs.existsSync(launcher) ? launcher : process.execPath);
  }
}

async function update(onProgress) {
  const release = await latest();
  if (!release.newer) throw new Error('Boost My Pc est déjà à jour.');
  if (!release.asset) throw new Error('Mise à jour automatique indisponible pour cette installation.');
  const file = await download(release.asset, onProgress);
  onProgress({ phase: 'install' });
  await install(file, installKind());
  return { version: release.version };
}

module.exports = { latest, update, installKind, cleanup };
