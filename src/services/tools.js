// Boîte à outils multiplateforme (liste blanche, cf. Plugin.ToolBoxTools). Chaque outil a une implémentation par OS.
const { shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const isLinux = process.platform === 'linux';
const appsFolder = (aumid) => ({ cmd: 'explorer.exe', args: [`shell:AppsFolder\\${aumid}`] });
const url = (u) => ({ url: u });
const screenshots = path.join(os.homedir(), 'Pictures', 'Screenshots');

const WINDOWS = {
  screenshot: url('ms-screenclip:'),
  screenshotFolder: { folder: screenshots },
  snipping: appsFolder('Microsoft.ScreenSketch_8wekyb3d8bbwe!App'),
  calculator: appsFolder('Microsoft.WindowsCalculator_8wekyb3d8bbwe!App'),
  notepad: { cmd: 'notepad.exe' },
  recorder: appsFolder('Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe!App'),
  captions: { cmd: path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'LiveCaptions.exe'), mustExist: true },
  calendar: url('outlookcal:'),
  edge: url('microsoft-edge:'),
  taskmgr: { cmd: 'taskmgr.exe' },
  devmgmt: { cmd: 'mmc.exe', args: ['devmgmt.msc'] },
  cleanmgr: { cmd: 'cleanmgr.exe' },
  storageSense: url('ms-settings:storagesense'),
  windowsUpdate: url('ms-settings:windowsupdate'),
  windowsSecurity: url('windowsdefender:'),
  defaultApps: url('ms-settings:defaultapps'),
  networkSettings: url('ms-settings:network-status'),
  privacyWebcam: url('ms-settings:privacy-webcam'),
  privacyMic: url('ms-settings:privacy-microphone'),
  privacyLocation: url('ms-settings:privacy-location'),
  display: url('ms-settings:display'),
  power: url('ms-settings:powersleep'),
};

// Linux : le premier programme installé de chaque liste est utilisé (GNOME, KDE, Xfce, Cinnamon…)
const desktopSettings = (gnome, kde, other = []) => [
  ['gnome-control-center', [gnome]], ['systemsettings', [kde]], ['systemsettings5', [kde]], ...other,
];
const LINUX = {
  screenshot: [['gnome-screenshot', ['-i']], ['spectacle', ['-r']], ['flameshot', ['gui']], ['xfce4-screenshooter', ['-r']], ['ksnip', []]],
  screenshotFolder: { folder: fs.existsSync(screenshots) ? screenshots : path.join(os.homedir(), 'Pictures') },
  calculator: [['gnome-calculator', []], ['kcalc', []], ['qalculate-gtk', []], ['galculator', []], ['mate-calc', []]],
  notepad: [['gnome-text-editor', []], ['gedit', []], ['kate', []], ['kwrite', []], ['mousepad', []], ['xed', []], ['pluma', []]],
  recorder: [['gnome-sound-recorder', []], ['audacity', []]],
  calendar: [['gnome-calendar', []], ['korganizer', []], ['merkuro-calendar', []]],
  terminal: [['gnome-terminal', []], ['kgx', []], ['ptyxis', []], ['konsole', []], ['xfce4-terminal', []], ['tilix', []], ['xterm', []]],
  files: [['nautilus', []], ['dolphin', []], ['thunar', []], ['nemo', []], ['pcmanfm', []]],
  taskmgr: [['gnome-system-monitor', []], ['plasma-systemmonitor', []], ['ksysguard', []], ['xfce4-taskmanager', []], ['mate-system-monitor', []]],
  diskUsage: [['baobab', []], ['filelight', []], ['qdirstat', []]],
  disks: [['gnome-disks', []], ['partitionmanager', []], ['gparted', []]],
  software: [['gnome-software', []], ['plasma-discover', []], ['mintinstall', []], ['pamac-manager', []], ['bazaar', []]],
  softwareUpdates: [['gnome-software', ['--mode=updates']], ['plasma-discover', ['--mode', 'update']], ['mintupdate', []], ['update-manager', []]],
  hardware: [['hardinfo2', []], ['hardinfo', []], ['kinfocenter', []], ['gnome-control-center', ['system']]],
  networkSettings: desktopSettings('network', 'kcm_networkmanagement', [['nm-connection-editor', []]]),
  display: desktopSettings('display', 'kcm_kscreen', [['xfce4-display-settings', []]]),
  power: desktopSettings('power', 'kcm_powerdevilprofilesconfig', [['xfce4-power-manager-settings', []]]),
  defaultApps: desktopSettings('default-apps', 'kcm_componentchooser'),
  privacy: desktopSettings('privacy', 'kcm_activities'),
  firewallSettings: [['gufw', []], ['firewall-config', []]],
  translator: url('https://www.bing.com/translator'),
  currency: url('https://www.bing.com/search?q=convertisseur+de+devises'),
  dictionary: url('https://www.bing.com/search?q=dictionnaire'),
  imageSearch: url('https://www.bing.com/visualsearch'),
  weather: url('https://www.msn.com/fr-fr/meteo'),
};
for (const k of ['translator', 'currency', 'dictionary', 'imageSearch', 'weather']) WINDOWS[k] = LINUX[k];

function which(bin) {
  for (const d of (process.env.PATH || '/usr/bin:/bin').split(path.delimiter)) {
    const p = path.join(d, bin);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {}
  }
  return null;
}

// Résout l'outil en action concrète, ou null s'il n'est pas disponible sur ce PC
function resolve(id) {
  const t = (isLinux ? LINUX : WINDOWS)[id];
  if (!t) return null;
  if (Array.isArray(t)) {
    for (const [cmd, args] of t) if (which(cmd)) return { cmd, args };
    return null;
  }
  if (t.mustExist && !fs.existsSync(t.cmd)) return null;
  return t;
}

const available = () => Object.keys(isLinux ? LINUX : WINDOWS).filter((id) => resolve(id));

async function launch(id) {
  const t = resolve(id);
  if (!t) throw new Error('Cet outil n\'est pas disponible sur ce PC.');
  if (t.url) return shell.openExternal(t.url);
  if (t.folder) { fs.mkdirSync(t.folder, { recursive: true }); return shell.openPath(t.folder); }
  spawn(t.cmd, t.args || [], { detached: true, stdio: 'ignore' }).unref();
}

module.exports = { launch, available };
