// Linux desktop integration:
//  - notify-send, when the app's own notifications can't reach the notification service;
//  - a menu entry and icons for an AppImage, so that it shows up in the application menu and the
//    dock on any distribution without a separate tool (the .deb installs its own).
const { app, nativeImage } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');
const dataHome = () => process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');

// A real file on disk for programs outside the app (the packaged one is inside app.asar).
function iconFile() {
  const file = path.join(app.getPath('userData'), 'icon.png');
  try {
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, nativeImage.createFromPath(path.join(ASSETS, 'icon-256.png')).toPNG());
    }
    return file;
  } catch { return 'boost-my-pc'; }
}

function notifySend(title, body) {
  execFile('notify-send', ['-a', 'Boost My Pc', '-i', iconFile(), '-h', 'string:desktop-entry:boost-my-pc', title, body], { timeout: 10000 }, () => {});
  return true;
}

function integrateAppImage() {
  const image = process.env.APPIMAGE;
  if (process.platform !== 'linux' || !image || !app.isPackaged) return;
  if (fs.existsSync('/usr/share/applications/boost-my-pc.desktop')) return; // installed from the .deb
  // Done once per location of the file (moving the AppImage updates the entry).
  const marker = path.join(app.getPath('userData'), 'menu-entry');
  try { if (fs.readFileSync(marker, 'utf8') === image) return; } catch {}

  const data = dataHome();
  const logo = nativeImage.createFromPath(path.join(ASSETS, 'icon.png'));
  for (const size of [48, 64, 128, 256, 512]) {
    const dir = path.join(data, 'icons', 'hicolor', `${size}x${size}`, 'apps');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'boost-my-pc.png'), logo.resize({ width: size, height: size, quality: 'best' }).toPNG());
  }
  const quoted = `"${image.replace(/(["\\$`])/g, '\\$1').replace(/%/g, '%%')}"`;
  const apps = path.join(data, 'applications');
  fs.mkdirSync(apps, { recursive: true });
  fs.writeFileSync(path.join(apps, 'boost-my-pc.desktop'), [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Boost My Pc',
    'Comment=Clean, protect and speed up your PC',
    `Exec=${quoted} %U`,
    'Icon=boost-my-pc',
    'Terminal=false',
    'Categories=System;Monitor;',
    'Keywords=boost;cleaner;nettoyage;system;monitor;',
    'StartupWMClass=Boost My Pc',
    '',
  ].join('\n'));
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, image);
  // Best effort: let the menu and icon caches know right away.
  execFile('update-desktop-database', [apps], () => {});
  execFile('gtk-update-icon-cache', ['-q', '-t', '-f', path.join(data, 'icons', 'hicolor')], () => {});
}

module.exports = { notifySend, integrateAppImage };
