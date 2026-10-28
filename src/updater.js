// Updates from the latest GitHub release, like most desktop apps: checked in the background,
// downloaded silently (size and SHA-256 checked), installed when the user restarts the app.
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
const FIRST_CHECK_DELAY = 20 * 1000;
const CHECK_INTERVAL = 4 * 3600 * 1000;
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

async function fetchLatest() {
  const res = await net.fetch(FEED, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const release = await res.json();
  const kind = installKind();
  const asset = kind && (release.assets || []).find((a) => ASSET_PATTERNS[kind].test(a.name));
  return {
    version: String(release.tag_name || '').replace(/^v/, ''),
    asset: asset && {
      name: asset.name,
      url: asset.browser_download_url,
      size: asset.size,
      sha256: String(asset.digest || '').replace(/^sha256:/, '') || null,
    },
  };
}

const downloadDir = () => path.join(app.getPath('temp'), 'boost-my-pc-update');

function sha256Of(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('error', reject).on('data', (d) => hash.update(d)).on('end', () => resolve(hash.digest('hex')));
  });
}

async function isComplete(file, asset) {
  if (!fs.existsSync(file) || fs.statSync(file).size !== asset.size) return false;
  return !asset.sha256 || (await sha256Of(file)) === asset.sha256;
}

// Keeps only the installer of the release in progress (or nothing when up to date).
function removeOldDownloads(keep) {
  try {
    for (const name of fs.readdirSync(downloadDir())) {
      if (name !== keep) fs.rmSync(path.join(downloadDir(), name), { recursive: true, force: true });
    }
  } catch {
    // No folder yet, or a file still locked by the installer: retried at the next check.
  }
}

async function download(asset, onProgress) {
  fs.mkdirSync(downloadDir(), { recursive: true });
  const file = path.join(downloadDir(), path.basename(asset.name));
  if (await isComplete(file, asset)) return file;

  const res = await net.fetch(asset.url, { signal: AbortSignal.timeout(60 * 60000) });
  if (!res.ok || !res.body) throw new Error(`Téléchargement impossible (${res.status})`);
  const total = asset.size || Number(res.headers.get('content-length')) || 0;
  const hash = crypto.createHash('sha256');
  let received = 0;
  let reportedAt = 0;
  const meter = new Transform({
    transform(chunk, _encoding, next) {
      hash.update(chunk);
      received += chunk.length;
      if (Date.now() - reportedAt > 500) {
        reportedAt = Date.now();
        onProgress(received, total);
      }
      next(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body), meter, fs.createWriteStream(file));

  if ((total && received !== total) || (asset.sha256 && hash.digest('hex') !== asset.sha256)) {
    fs.rmSync(file, { force: true });
    throw new Error('Fichier téléchargé incomplet ou corrompu.');
  }
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

// States sent to the interface:
//   idle, checking, current, unsupported (newer version, but this copy can't install it),
//   available (waiting for the user, automatic download off), downloading, ready, installing, error.
function createUpdateService({ autoDownload, onChange, onReady }) {
  let state = { status: 'idle', current: app.getVersion() };
  let release = null;
  let file = null;
  let queue = Promise.resolve();

  const setState = (next) => {
    state = { ...next, current: app.getVersion() };
    onChange(state);
  };

  async function downloadRelease() {
    const { version, asset } = release;
    setState({ status: 'downloading', version, done: 0, total: asset.size });
    try {
      file = await download(asset, (done, total) => setState({ status: 'downloading', version, done, total }));
      setState({ status: 'ready', version });
      onReady(version);
    } catch (err) {
      setState({ status: 'error', version, message: err.message });
    }
  }

  async function check({ forceDownload = false } = {}) {
    if (['downloading', 'installing'].includes(state.status)) return state;
    // With an update ready, check quietly: the restart button stays unless a newer release came out.
    const ready = state.status === 'ready' ? state : null;
    if (!ready) setState({ status: 'checking' });
    try {
      release = await fetchLatest();
    } catch (err) {
      if (!ready) setState({ status: 'error', message: err.message });
      return state;
    }
    const { version, asset } = release;
    if (ready && version === ready.version) return state;
    if (!isNewer(version, app.getVersion())) {
      removeOldDownloads(null);
      setState({ status: 'current', version });
    } else if (!asset) {
      setState({ status: 'unsupported', version });
    } else {
      removeOldDownloads(path.basename(asset.name));
      if (autoDownload() || forceDownload) await downloadRelease();
      else setState({ status: 'available', version, size: asset.size });
    }
    return state;
  }

  // One run at a time: a click during the scheduled check waits for it.
  const exclusive = (task) => (...args) => {
    queue = queue.catch(() => {}).then(() => task(...args));
    return queue;
  };

  async function installReady() {
    if (state.status !== 'ready' || !file) throw new Error('Aucune mise à jour prête.');
    const { version } = state;
    setState({ status: 'installing', version });
    try {
      await install(file, installKind());
    } catch (err) {
      setState({ status: 'ready', version });
      throw err;
    }
    return state;
  }

  function start() {
    setTimeout(() => runCheck(), FIRST_CHECK_DELAY);
    setInterval(() => runCheck(), CHECK_INTERVAL);
  }

  const runCheck = exclusive(check);
  return {
    start,
    state: () => state,
    check: () => runCheck(),
    download: () => runCheck({ forceDownload: true }),
    install: exclusive(installReady),
  };
}

module.exports = { createUpdateService, installKind };
