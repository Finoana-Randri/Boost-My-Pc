// Linux desktop integration: notify-send fallback, and a menu entry for the AppImage
// (the .deb installs its own).
const { app, nativeImage } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');
const ICON_SIZES = [48, 64, 128, 256, 512];

const dataHome = () => process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');

// External programs can't read the icon inside app.asar: copy it once to the data folder.
function iconFile() {
  const file = path.join(app.getPath('userData'), 'icon.png');
  try {
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, nativeImage.createFromPath(path.join(ASSETS, 'icon-256.png')).toPNG());
    }
    return file;
  } catch {
    return 'boost-my-pc';
  }
}

function notifySend(title, body) {
  const args = ['-a', 'Boost My Pc', '-i', iconFile(), '-h', 'string:desktop-entry:boost-my-pc', title, body];
  execFile('notify-send', args, { timeout: 10000 }, () => {});
  return true;
}

function installIcons(data) {
  const logo = nativeImage.createFromPath(path.join(ASSETS, 'icon.png'));
  for (const size of ICON_SIZES) {
    const dir = path.join(data, 'icons', 'hicolor', `${size}x${size}`, 'apps');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'boost-my-pc.png'), logo.resize({ width: size, height: size, quality: 'best' }).toPNG());
  }
}

// Quoting rules of the Exec key (Desktop Entry Specification).
const desktopExec = (file) => `"${file.replace(/(["\\$`])/g, '\\$1').replace(/%/g, '%%')}"`;

function writeMenuEntry(dir, appImage) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'boost-my-pc.desktop'), [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Boost My Pc',
    'Comment=Clean, protect and speed up your PC',
    `Exec=${desktopExec(appImage)} %U`,
    'Icon=boost-my-pc',
    'Terminal=false',
    'Categories=System;Monitor;',
    'Keywords=boost;cleaner;nettoyage;system;monitor;',
    'StartupWMClass=Boost My Pc',
    '',
  ].join('\n'));
}

// Runs at each start; does the work only when the AppImage is new or was moved.
function integrateAppImage() {
  const appImage = process.env.APPIMAGE;
  if (process.platform !== 'linux' || !appImage || !app.isPackaged) return;
  if (fs.existsSync('/usr/share/applications/boost-my-pc.desktop')) return;

  const marker = path.join(app.getPath('userData'), 'menu-entry');
  try {
    if (fs.readFileSync(marker, 'utf8') === appImage) return;
  } catch {}

  const data = dataHome();
  installIcons(data);
  writeMenuEntry(path.join(data, 'applications'), appImage);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, appImage);

  // Not installed everywhere; the menu picks the entry up later anyway.
  execFile('update-desktop-database', [path.join(data, 'applications')], () => {});
  execFile('gtk-update-icon-cache', ['-q', '-t', '-f', path.join(data, 'icons', 'hicolor')], () => {});
}

module.exports = { notifySend, integrateAppImage };
