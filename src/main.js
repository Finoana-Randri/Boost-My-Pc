const { app, BrowserWindow, ipcMain, shell, nativeTheme, Tray, Menu, nativeImage, dialog, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { platform, system, cleaner, storage, apps, protection, tools } = require('./services');
const Prefs = require('./prefs');
const admin = require('./admin');
const { createMenubar } = require('./menubar');
const { notifySend, integrateAppImage } = require('./linux-desktop');
const { attachRoundedShape, registerWindowControls } = require('./linux-window');
const { createUpdateService } = require('./updater');

const isLinux = platform === 'linux';
const ICON = path.join(__dirname, '..', 'assets', 'icon.png');

// An uncaught error would otherwise open a modal dialog that blocks the whole app.
process.on('uncaughtException', (err) => console.error('[Boost My Pc]', err));

if (isLinux) {
  // Native Wayland doesn't let apps place their windows: XWayland keeps the mini panel under the top bar.
  if (process.env.DISPLAY && !app.commandLine.hasSwitch('ozone-platform')) app.commandLine.appendSwitch('ozone-platform', 'x11');
  // Ties the window and the notifications to the menu entry (icon, name).
  app.setDesktopName('boost-my-pc.desktop');
}

let win = null;
let tray = null;
let menubar = null;
let quitting = false;
let prefs = Prefs.DEFAULTS;

const T = require('./i18n-main').makeT(() => uiLang());

const updates = createUpdateService({
  autoDownload: () => prefs.autoUpdate !== false,
  onChange: (state) => sendToWindow('update:state', state),
  onReady: (version) => {
    if (prefs.notifications === false) return;
    notify({ title: T('Mise à jour prête'), body: T(`Redémarrez Boost My Pc pour passer à la version ${version}.`) });
  },
});

const windowAlive = () => win && !win.isDestroyed();
const sendToWindow = (channel, data) => { if (windowAlive()) win.webContents.send(channel, data); };
const progress = (channel) => (data) => sendToWindow('progress', { channel, ...data });

function quit() {
  quitting = true;
  app.quit();
}

// ---------- Main window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 900,
    minHeight: 600,
    title: 'Boost My Pc',
    icon: fs.existsSync(ICON) ? ICON : undefined,
    backgroundColor: backgroundColor(),
    ...(isLinux
      ? { frame: false }
      : { titleBarStyle: 'hidden', titleBarOverlay: titleBarColors(), backgroundMaterial: 'mica' }),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // Read by the page before its first render.
      additionalArguments: [
        liteMode() ? '--bmp-lite' : '--bmp-full',
        ...(prefs.welcomed ? [] : ['--bmp-welcome']),
        ...(isLinux ? ['--bmp-frameless', '--bmp-round'] : []),
      ],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // A crashed or frozen interface is reloaded, at most once every 15 s.
  let lastReload = 0;
  const reload = (reason) => {
    console.error(`[Boost My Pc] interface ${reason}`);
    if (!windowAlive() || Date.now() - lastReload < 15000) return;
    lastReload = Date.now();
    win.webContents.reload();
  };
  win.webContents.on('render-process-gone', (_e, d) => reload(`gone: ${d.reason} (code ${d.exitCode})`));
  win.on('unresponsive', () => reload('unresponsive'));

  win.once('ready-to-show', () => {
    const startHidden = process.argv.includes('--hidden') || (menubar && process.argv.includes('--mini'));
    if (!startHidden || !tray) win.show();
  });
  win.on('close', (e) => {
    if (!quitting && prefs.minimizeToTray && tray) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isLinux) attachRoundedShape(win);
  else setupWindowsWindow(win);
  if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });
}

function setupWindowsWindow(w) {
  roundWindows11Corners(w);
  // Taskbar icon and relaunch name, even when Windows still groups the window with the shortcut of
  // an older installation.
  const ico = app.isPackaged ? process.execPath : path.join(__dirname, '..', 'build', 'icon.ico');
  try {
    w.setAppDetails({ appId: 'com.boostmypc.app', appIconPath: ico, appIconIndex: 0, relaunchDisplayName: 'Boost My Pc' });
  } catch {}
  // Window buttons drawn by Windows: their colour follows the theme.
  const recolor = () => { if (!w.isDestroyed()) w.setTitleBarOverlay(titleBarColors()); };
  nativeTheme.on('updated', recolor);
  w.on('closed', () => nativeTheme.off('updated', recolor));
}

// Windows 11 doesn't always round windows with a custom title bar: ask DWM to
// (DWMWA_WINDOW_CORNER_PREFERENCE = 33, DWMWCP_ROUND = 2). Older versions ignore it.
function roundWindows11Corners(w) {
  const handle = w.getNativeWindowHandle();
  const hwnd = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));
  const { runPS } = require('./services/ps');
  runPS(`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class BmpDwm { [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr h, int a, ref int v, int s); }'
$v = 2; [void][BmpDwm]::DwmSetWindowAttribute([IntPtr]${hwnd}, 33, [ref]$v, 4)`, { timeout: 20000 }).catch(() => {});
}

function showWindow() {
  if (!windowAlive()) createWindow();
  win.show();
  win.focus();
}

// ---------- Appearance ----------
function uiLang() {
  if (['fr', 'en', 'mg'].includes(prefs.lang)) return prefs.lang;
  const locale = (app.getLocale() || 'fr').toLowerCase();
  if (locale.startsWith('fr')) return 'fr';
  return locale.startsWith('mg') ? 'mg' : 'en';
}

function backgroundColor() {
  const dark = nativeTheme.shouldUseDarkColors;
  if (isLinux) return dark ? '#222226' : '#fafafb';
  return dark ? '#202020' : '#f3f3f3';
}

function titleBarColors() {
  return { color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#1a1a1a', height: 40 };
}

function applyTheme() {
  nativeTheme.themeSource = prefs.theme;
  if (windowAlive()) win.setBackgroundColor(backgroundColor());
}

// Without graphics acceleration (virtual machines...), decorative effects are turned off.
function liteMode() {
  if (prefs.effects === 'off') return true;
  if (prefs.effects === 'on') return false;
  const gpu = app.getGPUFeatureStatus?.() || {};
  return !String(gpu.gpu_compositing || '').startsWith('enabled');
}

// ---------- Tray icon ----------
// One image per display scale so the icon stays sharp at 125 %, 150 % and 200 %. Linux top bars
// use one-colour white icons; the colour logo stays on Windows.
function trayImage(size) {
  const src = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', isLinux ? 'tray-white.png' : 'tray.png'));
  const img = nativeImage.createEmpty();
  for (const scale of [1, 1.25, 1.5, 2]) {
    const px = Math.round(size * scale);
    img.addRepresentation({ scaleFactor: scale, width: px, height: px, buffer: src.resize({ width: px, height: px, quality: 'best' }).toPNG() });
  }
  return img;
}

function setTrayMenu() {
  menubar?.setMenu();
  menubar?.reloadMini();
}

// Notification-area icon and its widget (the mini panel).
function createMenubarTray() {
  menubar = createMenubar({
    iconPath: ICON,
    trayImage,
    traySize: isLinux ? 22 : 16,
    decorate: isLinux ? undefined : roundWindows11Corners,
    T,
    showMain: showWindow,
    sendToMain: (msg) => {
      if (!windowAlive()) return;
      if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => sendToWindow('action', msg));
      else sendToWindow('action', msg);
    },
    services: { system, cleaner, protection, platform },
    getPrefs: () => prefs,
    onQuit: quit,
  });
  tray = menubar.tray;
}

// ---------- Launch at login ----------
const linuxAutostartFile = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart', 'boost-my-pc.desktop');

function getStartup() {
  return isLinux ? fs.existsSync(linuxAutostartFile) : app.getLoginItemSettings().openAtLogin;
}

function setStartup(on) {
  if (!isLinux) return app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
  if (!on) {
    fs.rmSync(linuxAutostartFile, { force: true });
    return;
  }
  // An AppImage is started through its own file; otherwise Electron and, in development, the app folder.
  const exec = process.env.APPIMAGE
    ? `"${process.env.APPIMAGE}" --hidden`
    : `"${process.execPath}"${process.defaultApp ? ` "${path.resolve(process.argv[1] || '.')}"` : ''} --hidden`;
  fs.mkdirSync(path.dirname(linuxAutostartFile), { recursive: true });
  fs.writeFileSync(linuxAutostartFile, `[Desktop Entry]\nType=Application\nName=Boost My Pc\nExec=${exec}\nIcon=boost-my-pc\nX-GNOME-Autostart-enabled=true\n`);
}

// ---------- What the interface needs to know ----------
async function capabilities() {
  const info = await system.getSystemInfo().catch(() => ({}));
  const sh = isLinux ? require('./services/linux/sh') : null;
  return {
    platform,
    os: info.os,
    distroId: info.distroId,
    desktop: info.desktop,
    isAdmin: await cleaner.isAdmin().catch(() => false),
    lite: liteMode(),
    version: app.getVersion(),
    tools: tools.available(),
    packageManager: sh ? sh.packageManager() : null,
    hasFlatpak: !!sh?.which('flatpak'),
    hasSnap: !!sh?.which('snap'),
  };
}

// Boost My Pc itself (.deb, AppImage or Windows installation) is hidden from the uninstall list.
const appDir = path.dirname(process.execPath).toLowerCase();
function isSelf(entry) {
  if (!entry) return false;
  if (entry.pkg === 'boost-my-pc' || entry.pkg === 'fastboost') return true;
  if (/(fastboost|boost-my-pc)\.desktop$/.test(entry.desktopFile || '')) return true;
  return app.isPackaged && [entry.uninstall, entry.location].some((s) => s && String(s).toLowerCase().includes(appDir));
}

// ---------- IPC ----------
// Every handler answers { ok, data } or { ok: false, error }, so the interface never gets an exception.
function handle(name, fn) {
  ipcMain.handle(name, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });
}

function notify({ title, body, route } = {}) {
  const t = String(title || 'Boost My Pc');
  const b = String(body || '');
  if (!Notification.isSupported()) return isLinux ? notifySend(t, b) : false;
  const n = new Notification({ title: t, body: b, icon: ICON, silent: true });
  n.on('click', () => {
    showWindow();
    if (route) sendToWindow('action', `go:${route}`);
  });
  // No notification service on the session bus: notify-send may still reach one.
  n.on('failed', () => { if (isLinux) notifySend(t, b); });
  n.show();
  return true;
}

function updatePrefs(changes) {
  prefs = { ...prefs, ...changes };
  Prefs.save(prefs);
  if ('theme' in changes) applyTheme();
  if ('startup' in changes) setStartup(!!changes.startup);
  if ('lang' in changes) setTrayMenu();
  return prefs;
}

function registerAppIpc() {
  ipcMain.on('app:lang', (e) => { e.returnValue = uiLang(); });
  if (isLinux) registerWindowControls();
  handle('app:caps', capabilities);
  handle('app:notify', notify);
  handle('app:paths', () => ({ home: os.homedir(), pictures: app.getPath('pictures'), downloads: app.getPath('downloads'), root: path.parse(os.homedir()).root }));

  handle('update:state', () => updates.state());
  handle('update:check', () => updates.check());
  handle('update:download', () => updates.download());
  handle('update:install', () => updates.install());

  handle('app:adminMode', () => admin.status(prefs.adminMode));
  handle('app:setAdminMode', async (mode) => {
    updatePrefs({ adminMode: await admin.setMode(mode) });
    return { mode, elevated: admin.isElevated() };
  });
  handle('system:relaunchAdmin', async () => {
    await admin.relaunchElevated(prefs.adminMode);
    quit();
  });

  handle('prefs:get', () => ({ ...prefs, startup: getStartup() }));
  handle('prefs:set', updatePrefs);
  handle('prefs:reset', () => {
    prefs = { ...Prefs.DEFAULTS, adminMode: prefs.adminMode };
    Prefs.save(prefs);
    applyTheme();
    return prefs;
  });
}

function registerSystemIpc() {
  handle('system:stats', () => system.getStats());
  handle('system:disks', () => system.getDisks());
  handle('system:info', () => system.getSystemInfo());
  handle('system:boost', () => system.boostMemory({ dropCaches: prefs.boostDropCaches }));
  handle('system:isAdmin', () => cleaner.isAdmin());

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

  handle('tool:launch', (id) => tools.launch(id));
}

function registerAppsIpc() {
  // Boost My Pc doesn't list or stop its own processes. Linux Chromium zygote processes are missing
  // from getAppMetrics, so the executable is compared too.
  const ownPids = () => new Set([process.pid, ...app.getAppMetrics().map((m) => m.pid)]);
  const ownExe = (() => {
    try { return fs.realpathSync(process.execPath).toLowerCase(); } catch { return process.execPath.toLowerCase(); }
  })();
  const isOwnExe = (exe) => !!exe && exe.toLowerCase().replace(/ \(deleted\)$/, '') === ownExe;

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
  handle('apps:uninstall', (entry) => {
    if (isSelf(entry)) throw new Error('Désinstallez Boost My Pc depuis le gestionnaire de paquets du système.');
    return apps.uninstallApp(entry);
  });
}

function registerProtectionIpc() {
  handle('protect:status', () => protection.securityStatus());
  handle('protect:quickScan', () => protection.quickScan());
  handle('protect:updateSignatures', () => protection.updateSignatures());
  handle('protect:action', (id) => protection.securityAction(id, { runElevated: admin.runElevated, openExternal: (url) => shell.openExternal(url) }));
  handle('protect:updates', () => protection.checkWindowsUpdates());
  handle('protect:installUpdates', () => protection.installUpdates());
  handle('net:diagnose', () => protection.networkDiagnose());
  handle('net:fix', (id) => protection.networkFix(id));
}

function registerFileIpc() {
  handle('file:trash', async (paths) => {
    let done = 0;
    let failed = 0;
    for (const p of paths || []) {
      try {
        await shell.trashItem(p);
        done++;
      } catch {
        failed++;
      }
    }
    return { done, failed };
  });
  handle('file:reveal', (p) => shell.showItemInFolder(p));
  handle('file:open', (p) => shell.openPath(p));
  handle('file:icon', async (p) => {
    if (!p) return null;
    // Linux: an icon name from the theme (.desktop files) or an image file.
    if (isLinux) {
      const url = await apps.iconDataUrl(p).catch(() => null);
      if (url) return url;
    }
    if (!fs.existsSync(p)) return null;
    const img = await app.getFileIcon(p, { size: 'normal' });
    return img.isEmpty() ? null : img.toDataURL();
  });
  handle('file:pick', async (opts = {}) => {
    const properties = opts.files ? ['openFile', 'multiSelections'] : ['openDirectory'];
    if (opts.files && opts.dirs) properties.push('openDirectory');
    const r = await dialog.showOpenDialog(win, { properties, title: opts.title });
    return r.canceled ? [] : r.filePaths;
  });
  handle('file:thumb', async (p) => {
    const img = nativeImage.createFromPath(p);
    return img.isEmpty() ? null : img.resize({ width: 220, quality: 'good' }).toDataURL();
  });
}

function registerModulesIpc() {
  const maintenance = require('./services/v2/maintenance');
  const privacy = require('./services/v2/privacy');
  const permissions = require('./services/v2/permissions');
  const leftovers = require('./services/v2/leftovers');
  const malware = require('./services/v2/malware');
  const shredder = require('./services/v2/shredder');
  const lens = require('./services/v2/spacelens');
  const similar = require('./services/v2/similar');
  const cloud = require('./services/v2/cloud');
  const health = require('./services/v2/health');
  const drivers = require('./services/v2/drivers');
  const { createSmartCare } = require('./services/v2/smartcare');
  const { createDiagnose } = require('./services/v2/diagnose');

  const boost = () => system.boostMemory({ dropCaches: false });
  const smart = createSmartCare({ cleaner, protection, apps, storage, maintenance, malware, boost });
  const diagnose = createDiagnose({ runElevated: (script) => admin.runElevated(script, 60 * 60000) });

  handle('v2:smart:scan', () => smart.scan(progress('smart')));
  handle('v2:smart:run', () => smart.run(progress('smart')));
  handle('v2:smart:cancel', () => smart.cancel());
  handle('v2:diag:scan', () => diagnose.scan());
  handle('v2:diag:fix', (ids) => diagnose.fix(ids || []));
  handle('v2:health', () => health.check());
  handle('v2:drivers:list', () => drivers.list());
  handle('v2:drivers:install', async (ids) => drivers.install(ids || [], progress('drivers'), await cleaner.isAdmin().catch(() => false)));
  handle('v2:maint:list', () => maintenance.list());
  handle('v2:maint:run', (ids) => maintenance.run(ids || [], { boost }));
  handle('v2:privacy:scan', () => privacy.scan());
  handle('v2:privacy:clean', (ids) => privacy.clean(ids || []));
  handle('v2:perm:list', () => permissions.list());
  handle('v2:perm:revoke', (appId, permId) => permissions.revoke(appId, permId));
  handle('v2:perm:reset', (appId) => permissions.reset(appId));
  handle('v2:leftovers:scan', () => leftovers.scan(progress('leftovers')));
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
}

// ---------- Start ----------
function start() {
  // `boost-my-pc --mini` toggles the mini panel, for example from a keyboard shortcut.
  app.on('second-instance', (_e, argv) => {
    if (menubar && argv.includes('--mini')) menubar.toggleMini('corner');
    else showWindow();
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { if (!tray) app.quit(); });
  process.argv.push(...admin.inheritedFlags());

  app.whenReady().then(() => {
    if (!isLinux) app.setAppUserModelId('com.boostmypc.app');
    prefs = Prefs.load(admin.defaultMode());
    applyTheme();
    registerAppIpc();
    registerSystemIpc();
    registerAppsIpc();
    registerProtectionIpc();
    registerFileIpc();
    registerModulesIpc();
    // Elevated first launch after installation: create the task for silent elevated launches.
    if (process.argv.includes('--create-admin-task') && admin.isElevated()) {
      admin.setMode('task').then((mode) => updatePrefs({ adminMode: mode })).catch(() => {});
    }
    createMenubarTray();
    createWindow();
    // A few seconds later, so the window shows first.
    if (isLinux) setTimeout(() => { try { integrateAppImage(); } catch {} }, 4000);
    if (menubar && process.argv.includes('--mini')) menubar.showMini('corner');
    updates.start();
  });
}

if (admin.elevateAtLaunch(Prefs.load(admin.defaultMode()).adminMode)) app.exit(0);
else if (!app.requestSingleInstanceLock()) app.quit();
else start();
