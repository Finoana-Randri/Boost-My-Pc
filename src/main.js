// Electron main process: windows, tray icon, and IPC for the Windows and Linux services.
const { app, BrowserWindow, ipcMain, shell, nativeTheme, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { platform, system, cleaner, storage, apps, protection, tools } = require('./services');
const isLinux = platform === 'linux';
const { createMenubar } = require('./menubar');

// Native Wayland does not let apps place their windows, so use XWayland
// to keep the mini panel below the top bar.
if (isLinux && process.env.DISPLAY && !app.commandLine.hasSwitch('ozone-platform')) {
  app.commandLine.appendSwitch('ozone-platform', 'x11');
}

let win = null;
let tray = null;
let menubar = null;
let quitting = false;

// ---------- Preferences ----------
const prefsFile = () => path.join(app.getPath('userData'), 'preferences.json');
const defaultPrefs = { theme: 'system', minimizeToTray: true, startup: false, boostDropCaches: false, alerts: true, effects: 'auto' };
function loadPrefs() {
  try { return { ...defaultPrefs, ...JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) }; } catch { return { ...defaultPrefs }; }
}
function savePrefs(p) {
  fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
  fs.writeFileSync(prefsFile(), JSON.stringify(p, null, 2));
}
let prefs = defaultPrefs;

const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');

function createWindow() {
  win = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 900,
    minHeight: 600,
    title: 'Boost My Pc',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: backgroundColor(),
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarColors(),
    ...(isLinux ? {} : { backgroundMaterial: 'mica' }),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    const quiet = process.argv.includes('--hidden') || (menubar && process.argv.includes('--mini'));
    if (!quiet || !tray) win.show();
  });
  win.on('close', (e) => {
    if (!quitting && prefs.minimizeToTray && tray) { e.preventDefault(); win.hide(); }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });
}

function backgroundColor() {
  const dark = nativeTheme.shouldUseDarkColors;
  if (isLinux) return dark ? '#222226' : '#fafafb';
  return dark ? '#202020' : '#f3f3f3';
}

function titleBarColors() {
  const dark = nativeTheme.shouldUseDarkColors;
  return { color: '#00000000', symbolColor: dark ? '#ffffff' : '#1a1a1a', height: isLinux ? 46 : 40 };
}

function createTray() {
  if (!fs.existsSync(iconPath)) return;
  try {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png')).resize({ width: isLinux ? 22 : 16, height: isLinux ? 22 : 16, quality: 'best' }));
  } catch { tray = null; return; } // Some Linux desktops have no tray.
  tray.setToolTip('Boost My Pc');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ouvrir Boost My Pc', click: showWindow },
    { label: 'Boost', click: () => { showWindow(); win.webContents.send('action', 'boost'); } },
    { type: 'separator' },
    { label: 'Quitter', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow);
}
function showWindow() { if (!win) createWindow(); win.show(); win.focus(); }

function applyTheme() {
  nativeTheme.themeSource = prefs.theme;
  if (win) { win.setTitleBarOverlay?.(titleBarColors()); win.setBackgroundColor(backgroundColor()); }
}

// ---------- Launch at startup ----------
const linuxAutostartFile = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart', 'fastboost.desktop');
function getStartup() {
  if (isLinux) return fs.existsSync(linuxAutostartFile);
  return app.getLoginItemSettings().openAtLogin;
}
function setStartup(on) {
  if (!isLinux) return app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
  if (!on) { try { fs.unlinkSync(linuxAutostartFile); } catch {} return; }
  // For an AppImage, launch the AppImage itself; otherwise use Electron and the app directory.
  const exec = process.env.APPIMAGE
    ? `"${process.env.APPIMAGE}" --hidden`
    : `"${process.execPath}"${process.defaultApp ? ` "${path.resolve(process.argv[1] || '.')}"` : ''} --hidden`;
  fs.mkdirSync(path.dirname(linuxAutostartFile), { recursive: true });
  fs.writeFileSync(linuxAutostartFile, `[Desktop Entry]\nType=Application\nName=Boost My Pc\nExec=${exec}\nIcon=${iconPath}\nX-GNOME-Autostart-enabled=true\n`);
}

function liteMode() {
  if (prefs.effects === 'off') return true;
  if (prefs.effects === 'on') return false;
  const gpu = app.getGPUFeatureStatus?.() || {};
  return !String(gpu.gpu_compositing || '').startsWith('enabled');
}

// ---------- Capabilities (the UI adapts to the system) ----------
async function capabilities() {
  const info = await system.getSystemInfo().catch(() => ({}));
  return {
    platform,
    os: info.os,
    distroId: info.distroId,
    desktop: info.desktop,
    isAdmin: await cleaner.isAdmin().catch(() => false),
    lite: liteMode(),
    tools: tools.available(),
    packageManager: isLinux ? require('./services/linux/sh').packageManager() : null,
    hasFlatpak: isLinux && !!require('./services/linux/sh').which('flatpak'),
    hasSnap: isLinux && !!require('./services/linux/sh').which('snap'),
  };
}

// The app itself (.deb, AppImage, or Windows installation)
const appDir = path.dirname(process.execPath).toLowerCase();
function isSelf(a) {
  if (!a) return false;
  if (a.pkg === 'boost-my-pc' || a.pkg === 'fastboost') return true;
  if (/fastboost\.desktop$/.test(a.desktopFile || '')) return true;
  if (app.isPackaged && [a.uninstall, a.location].some((s) => s && String(s).toLowerCase().includes(appDir))) return true;
  return false;
}

// ---------- IPC ----------
const progress = (channel) => (data) => win?.webContents.send('progress', { channel, ...data });

function handle(name, fn) {
  ipcMain.handle(name, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; }
    catch (err) { return { ok: false, error: err.message || String(err) }; }
  });
}

function registerIpc() {
  handle('app:caps', capabilities);
  handle('system:stats', () => system.getStats());
  handle('system:disks', () => system.getDisks());
  handle('system:info', () => system.getSystemInfo());
  handle('system:boost', () => system.boostMemory({ dropCaches: prefs.boostDropCaches }));
  handle('system:isAdmin', () => cleaner.isAdmin());
  handle('system:relaunchAdmin', async () => {
    if (isLinux) throw new Error('Sous Linux, chaque action système demande votre mot de passe.');
    const { runPS } = require('./services/ps');
    const args = process.defaultApp ? [path.resolve(process.argv[1] || '.')] : [];
    const argList = args.map((a) => `'"${a.replace(/'/g, "''")}"'`).join(',');
    await runPS(`Start-Process -FilePath '${process.execPath.replace(/'/g, "''")}' ${argList ? '-ArgumentList ' + argList : ''} -Verb RunAs`);
    quitting = true;
    app.quit();
  });

  handle('clean:scan', (scene) => cleaner.scan(scene, progress('clean')));
  handle('clean:run', (ids) => cleaner.clean(ids, progress('clean')));

  handle('storage:large', (opts) => storage.findLargeFiles(opts, progress('storage')));
  handle('storage:downloads', () => storage.listDownloads());
  handle('storage:duplicates', (opts) => storage.findDuplicates(opts, progress('storage')));
  handle('storage:cancel', () => storage.cancel());
  handle('storage:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  // Keep Boost My Pc out of its own process list so it cannot stop itself.
  // Linux Chromium zygote processes are missing from getAppMetrics, so filter by executable too.
  const ownPids = () => new Set([process.pid, ...app.getAppMetrics().map((m) => m.pid)]);
  const ownExe = (() => { try { return fs.realpathSync(process.execPath).toLowerCase(); } catch { return process.execPath.toLowerCase(); } })();
  const isOwnExe = (p) => !!p && p.toLowerCase().replace(/ \(deleted\)$/, '') === ownExe;
  handle('apps:processes', async () => {
    const mine = ownPids();
    return (await apps.listProcesses())
      .filter((p) => !isOwnExe(p.path))
      .map((p) => ({ ...p, ids: p.ids.filter((id) => !mine.has(id)) }))
      .filter((p) => p.ids.length);
  });
  handle('apps:kill', (ids, name, opts) => {
    const mine = ownPids();
    if ((ids || []).some((id) => mine.has(Number(id)))) throw new Error('Boost My Pc ne peut pas se terminer lui-même.');
    return apps.killProcesses(ids, name, opts || {});
  });
  handle('apps:startup', () => apps.listStartup());
  handle('apps:setStartup', (item, enabled) => apps.setStartup(item, enabled));
  handle('apps:installed', async () => (await apps.listInstalledApps()).filter((a) => !isSelf(a)));
  handle('apps:uninstall', (a) => {
    if (isSelf(a)) throw new Error('Désinstallez Boost My Pc depuis le gestionnaire de paquets du système.');
    return apps.uninstallApp(a);
  });

  handle('protect:status', () => protection.securityStatus());
  handle('protect:quickScan', () => protection.quickScan());
  handle('protect:updateSignatures', () => protection.updateSignatures());
  handle('protect:action', (id) => protection.securityAction(id));
  handle('protect:updates', () => protection.checkWindowsUpdates());
  handle('protect:installUpdates', () => protection.installUpdates());
  handle('net:diagnose', () => protection.networkDiagnose());
  handle('net:fix', (id) => protection.networkFix(id));

  handle('file:trash', async (paths) => {
    let done = 0, failed = 0;
    for (const p of paths) { try { await shell.trashItem(p); done++; } catch { failed++; } }
    return { done, failed };
  });
  handle('file:reveal', (p) => shell.showItemInFolder(p));
  handle('file:open', (p) => shell.openPath(p));
  handle('file:icon', async (p) => {
    if (!p) return null;
    // Linux: icon name from the theme (.desktop) or a PNG/SVG file.
    if (isLinux) {
      const url = await apps.iconDataUrl(p).catch(() => null);
      if (url) return url;
    }
    if (!fs.existsSync(p)) return null;
    const img = await app.getFileIcon(p, { size: 'normal' });
    return img.isEmpty() ? null : img.toDataURL();
  });

  registerV2();
  handle('tool:launch', (id) => tools.launch(id));
  handle('prefs:get', () => ({ ...prefs, startup: getStartup() }));
  handle('prefs:set', (p) => {
    prefs = { ...prefs, ...p };
    savePrefs(prefs);
    if ('theme' in p) applyTheme();
    if ('startup' in p) setStartup(!!p.startup);
    return prefs;
  });
}

// ---------- v2 modules ----------
function registerV2() {
  const maintenance = require('./services/v2/maintenance');
  const privacy = require('./services/v2/privacy');
  const permissions = require('./services/v2/permissions');
  const leftovers = require('./services/v2/leftovers');
  const malware = require('./services/v2/malware');
  const shredder = require('./services/v2/shredder');
  const lens = require('./services/v2/spacelens');
  const similar = require('./services/v2/similar');
  const cloud = require('./services/v2/cloud');
  const { createSmartCare } = require('./services/v2/smartcare');
  const boost = () => system.boostMemory({ dropCaches: false });
  const smart = createSmartCare({ cleaner, protection, apps, storage, maintenance, malware, boost });

  handle('v2:smart:scan', () => smart.scan(progress('smart')));
  handle('v2:smart:run', () => smart.run(progress('smart')));
  handle('v2:maint:list', () => maintenance.list());
  handle('v2:maint:run', (ids) => maintenance.run(ids || [], { boost }));
  handle('v2:privacy:scan', () => privacy.scan());
  handle('v2:privacy:clean', (ids) => privacy.clean(ids || []));
  handle('v2:perm:list', () => permissions.list());
  handle('v2:perm:revoke', (appId, permId) => permissions.revoke(appId, permId));
  handle('v2:perm:reset', (appId) => permissions.reset(appId));
  handle('v2:leftovers:scan', () => leftovers.scan(progress('leftovers')));
  // Quick check for the Protection overview (heuristics on Linux, Defender status on Windows).
  handle('v2:malware:quick', () => malware.quickCheck(protection));
  handle('v2:malware:scan', (kind) => {
    if (!['quick', 'normal', 'deep'].includes(kind)) throw new Error('Type d\'analyse inconnu');
    return malware.scan(kind, progress('malware'));
  });
  handle('v2:shred', (paths, opts) => shredder.shred(paths || [], opts || {}, progress('shred')));
  handle('v2:lens:scan', (root) => lens.scan(root || os.homedir(), progress('lens')));
  handle('v2:lens:cancel', () => lens.cancel());
  handle('v2:similar:find', (root) => similar.find(root || app.getPath('pictures'), progress('similar')));
  handle('v2:similar:cancel', () => similar.cancel());
  handle('v2:cloud:detect', () => cloud.detect());
  handle('v2:cloud:analyze', (folder) => cloud.analyze(folder, progress('cloud')));
  handle('v2:cloud:freeUp', (paths) => cloud.freeUp(paths || []));
  handle('v2:cloud:cancel', () => cloud.cancel());
  handle('file:pick', async (opts = {}) => {
    const props = opts.files ? ['openFile', 'multiSelections'] : ['openDirectory'];
    if (opts.files && opts.dirs) props.push('openDirectory');
    const r = await dialog.showOpenDialog(win, { properties: props, title: opts.title });
    return r.canceled ? [] : r.filePaths;
  });
  // Thumbnail for a similar image.
  handle('file:thumb', async (p) => {
    const img = nativeImage.createFromPath(p);
    if (img.isEmpty()) return null;
    return img.resize({ width: 220, quality: 'good' }).toDataURL();
  });
  handle('app:paths', () => ({ home: os.homedir(), pictures: app.getPath('pictures'), downloads: app.getPath('downloads'), root: path.parse(os.homedir()).root }));
}

// ---------- Lifecycle ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // `boost-my-pc --mini` toggles the mini panel, for example from a keyboard shortcut.
  app.on('second-instance', (_e, argv) => {
    if (menubar && argv.includes('--mini')) menubar.toggleMini('corner');
    else showWindow();
  });
  app.whenReady().then(() => {
    if (!isLinux) app.setAppUserModelId('com.fastboost.app');
    prefs = loadPrefs();
    applyTheme();
    registerIpc();
    if (isLinux) {
      // Linux: show the mini panel from the tray icon.
      menubar = createMenubar({
        iconPath,
        showMain: showWindow,
        sendToMain: (msg) => {
          if (!win) return;
          if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => win.webContents.send('action', msg));
          else win.webContents.send('action', msg);
        },
        services: { system, cleaner, protection, platform },
        getPrefs: () => prefs,
        onQuit: () => { quitting = true; app.quit(); },
      });
      tray = menubar.tray;
    } else {
      createTray();
    }
    createWindow();
    if (menubar && process.argv.includes('--mini')) menubar.showMini('corner');
    nativeTheme.on('updated', () => { win?.setTitleBarOverlay?.(titleBarColors()); });
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { if (!tray) app.quit(); });
}
