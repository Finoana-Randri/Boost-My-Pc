// Electron main process: windows, tray icon, and IPC for the Windows and Linux services.
const { app, BrowserWindow, ipcMain, shell, nativeTheme, Tray, Menu, nativeImage, dialog, net, Notification } = require('electron');
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
// Checked before Chromium creates its own files: data from an earlier session means the app was already used.
const usedBefore = fs.existsSync(path.join(app.getPath('userData'), 'Local Storage'));
const defaultPrefs = { sounds: true, notifications: true, theme: 'system', minimizeToTray: true, startup: false, boostDropCaches: false, alerts: true, effects: 'auto', welcomed: false };
function loadPrefs() {
  try {
    const saved = JSON.parse(fs.readFileSync(prefsFile(), 'utf8'));
    // Preferences saved by an earlier version: the app was already in use, so skip the welcome screen.
    if (!('welcomed' in saved)) saved.welcomed = true;
    return { ...defaultPrefs, adminMode: defaultAdminMode(), ...saved };
  } catch { return { ...defaultPrefs, adminMode: defaultAdminMode(), welcomed: usedBefore }; }
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
      // Lets the page start in lightweight mode before its first render.
      additionalArguments: [liteMode() ? '--bmp-lite' : '--bmp-full', ...(prefs.welcomed ? [] : ['--bmp-welcome'])],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // If the interface process crashes or stops responding, reload it instead of leaving a frozen window.
  let lastReload = 0;
  const recover = (why) => {
    console.error(`[Boost My Pc] interface ${why}`);
    if (Date.now() - lastReload < 15000 || win.isDestroyed()) return;
    lastReload = Date.now();
    win.webContents.reload();
  };
  win.webContents.on('render-process-gone', (_e, d) => recover(`gone: ${d.reason} (code ${d.exitCode})`));
  win.on('unresponsive', () => recover('unresponsive'));
  win.once('ready-to-show', () => {
    const quiet = process.argv.includes('--hidden') || (menubar && process.argv.includes('--mini'));
    if (!quiet || !tray) win.show();
  });
  if (process.platform === 'win32') roundCorners(win);
  // Taskbar icon and relaunch details from the current icon, even when Windows still
  // groups the window with the shortcut of an older installation.
  if (process.platform === 'win32') {
    const ico = app.isPackaged ? process.execPath : path.join(__dirname, '..', 'build', 'icon.ico');
    try { win.setAppDetails({ appId: 'com.boostmypc.app', appIconPath: ico, appIconIndex: 0, relaunchDisplayName: 'Boost My Pc' }); } catch {}
  }
  win.on('close', (e) => {
    if (!quitting && prefs.minimizeToTray && tray) { e.preventDefault(); win.hide(); }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });
}

// Windows 11 does not always round windows with a custom title bar:
// ask DWM for rounded corners (DWMWA_WINDOW_CORNER_PREFERENCE = 33, DWMWCP_ROUND = 2).
// Older Windows versions ignore the attribute.
function roundCorners(w) {
  const buf = w.getNativeWindowHandle();
  const hwnd = buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0));
  const { runPS } = require('./services/ps');
  runPS(`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class BmpDwm { [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr h, int a, ref int v, int s); }'
$v = 2; [void][BmpDwm]::DwmSetWindowAttribute([IntPtr]${hwnd}, 33, [ref]$v, 4)`, { timeout: 20000 }).catch(() => {});
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

// Tray icon from assets/tray.png (made from icon.png by scripts/make-icons.py), with one
// image per display scale so it stays sharp at 125 %, 150 % and 200 %.
function trayImage(size) {
  const src = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png'));
  const img = nativeImage.createEmpty();
  for (const scale of [1, 1.25, 1.5, 2]) {
    const px = Math.round(size * scale);
    img.addRepresentation({ scaleFactor: scale, width: px, height: px, buffer: src.resize({ width: px, height: px, quality: 'best' }).toPNG() });
  }
  return img;
}

function createTray() {
  if (!fs.existsSync(iconPath)) return;
  try {
    tray = new Tray(trayImage(isLinux ? 22 : 16));
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
const linuxAutostartFile = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart', 'boost-my-pc.desktop');
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
    version: app.getVersion(),
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
  if (/(fastboost|boost-my-pc)\.desktop$/.test(a.desktopFile || '')) return true;
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
  // System notification (Windows action center, Linux notification daemon); a click opens the result.
  handle('app:notify', ({ title, body, route } = {}) => {
    if (!Notification.isSupported()) return false;
    const n = new Notification({ title: String(title || 'Boost My Pc'), body: String(body || ''), icon: iconPath, silent: true });
    n.on('click', () => {
      showWindow();
      if (route) win?.webContents.send('action', `go:${route}`);
    });
    n.show();
    return true;
  });
  // Latest published version, shown in Settings > About.
  handle('app:latest', async () => {
    const res = await net.fetch('https://api.github.com/repos/Finoana-Randri/FastBoost/releases/latest', { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const r = await res.json();
    return { version: String(r.tag_name || '').replace(/^v/, ''), url: r.html_url };
  });
  handle('system:stats', () => system.getStats());
  handle('system:disks', () => system.getDisks());
  handle('system:info', () => system.getSystemInfo());
  handle('system:boost', () => system.boostMemory({ dropCaches: prefs.boostDropCaches }));
  handle('system:isAdmin', () => cleaner.isAdmin());
  handle('system:relaunchAdmin', async () => {
    if (isLinux) throw new Error('Sous Linux, chaque action système demande votre mot de passe.');
    const { runPS } = require('./services/ps');
    // Release the lock first so the elevated copy does not hand over to this one and exit.
    app.releaseSingleInstanceLock();
    try {
      if (prefs.adminMode === 'task' && protectedInstall() && adminTaskExists()) {
        execFileSync('schtasks', ['/run', '/tn', ADMIN_TASK], { stdio: 'ignore', windowsHide: true, timeout: 10000 });
      } else {
        const { exe, args } = launchCommand();
        const argList = [...args.map((a) => '"' + a + '"'), '--no-elevate'].map(psQuote).join(',');
        await runPS('Start-Process -FilePath ' + psQuote(exe) + ' -ArgumentList ' + argList + ' -Verb RunAs');
      }
    } catch (e) {
      app.requestSingleInstanceLock();
      throw new Error(/annul|cancel/i.test(e.message) ? 'Autorisation administrateur refusée.' : e.message);
    }
    quitting = true;
    app.quit();
  });
  handle('app:adminMode', () => ({ mode: prefs.adminMode, protectedInstall: protectedInstall(), elevated: isElevated(), task: !isLinux && adminTaskExists() }));
  handle('app:setAdminMode', (mode) => setAdminMode(mode));
  // Voluntary reset: default preferences, so the welcome screen shows again.
  handle('prefs:reset', () => {
    prefs = { ...defaultPrefs, adminMode: prefs.adminMode };
    savePrefs(prefs);
    applyTheme();
    return prefs;
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
  handle('v2:smart:cancel', () => smart.cancel());
  const diagnose = require('./services/v2/diagnose').createDiagnose({ runElevated: (script) => runElevated(script, 60 * 60000) });
  handle('v2:diag:scan', () => diagnose.scan());
  handle('v2:diag:fix', (ids) => diagnose.fix(ids || []));
  const health = require('./services/v2/health');
  handle('v2:health', () => health.check());
  const drivers = require('./services/v2/drivers');
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

// ---------- Administrator mode (Windows) ----------
// 'off': rights are requested only by the actions that need them.
// 'prompt': Windows asks for elevation (UAC) once at each launch.
// 'task': the app starts elevated through a scheduled task created once with the user's consent.
//   Offered only when the app is installed in Program Files, where only administrators can modify
//   its files; elsewhere such a task would let any program gain administrator rights.
const ADMIN_TASK = 'Boost My Pc (administrateur)';
const { execFileSync } = require('child_process');

function isElevated() {
  if (isLinux) return false;
  try { execFileSync('net', ['session'], { stdio: 'ignore', windowsHide: true, timeout: 5000 }); return true; } catch { return false; }
}

function protectedInstall() {
  if (isLinux || !app.isPackaged) return false;
  const exe = process.execPath.toLowerCase();
  return [process.env.ProgramFiles, process.env['ProgramW6432']].filter(Boolean).some((p) => exe.startsWith(p.toLowerCase() + '\\'));
}

// Command line that starts this app (the packaged exe, or Electron with the app folder in development).
function launchCommand() {
  return { exe: process.execPath, args: process.defaultApp ? [path.resolve(process.argv[1] || '.')] : [] };
}

const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Run a PowerShell script elevated: directly if already elevated, otherwise after one UAC prompt.
async function runElevated(script, timeout = 120000) {
  const { runPS } = require('./services/ps');
  if (isElevated()) return runPS(script, { timeout });
  const enc = Buffer.from(script, 'utf16le').toString('base64');
  await runPS(`$p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${enc}'; exit $p.ExitCode`, { timeout })
    .catch((e) => { throw new Error(/annul|cancel/i.test(e.message) ? 'Autorisation administrateur refusée.' : e.message); });
}

function adminTaskExists() {
  try { execFileSync('schtasks', ['/query', '/tn', ADMIN_TASK], { stdio: 'ignore', windowsHide: true, timeout: 8000 }); return true; } catch { return false; }
}

async function setAdminMode(mode) {
  if (isLinux) throw new Error('Sous Linux, chaque action système demande votre mot de passe via polkit.');
  if (!['off', 'prompt', 'task'].includes(mode)) throw new Error('Mode inconnu.');
  if (mode === 'task') {
    if (!protectedInstall()) throw new Error('Ce mode nécessite une installation « pour tous les utilisateurs » (dans Program Files). Réinstallez Boost My Pc en choisissant cette option.');
    const { exe, args } = launchCommand();
    const user = `${process.env.USERDOMAIN || os.hostname()}\\${os.userInfo().username}`;
    await runElevated(`
      $a = New-ScheduledTaskAction -Execute ${psQuote(exe)}${args.length ? ` -Argument ${psQuote(args.map((x) => `"${x}"`).join(' '))}` : ''}
      $p = New-ScheduledTaskPrincipal -UserId ${psQuote(user)} -LogonType Interactive -RunLevel Highest
      $s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances Parallel
      Register-ScheduledTask -TaskName ${psQuote(ADMIN_TASK)} -Action $a -Principal $p -Settings $s -Force | Out-Null`);
    if (!adminTaskExists()) throw new Error('La tâche planifiée n\'a pas pu être créée.');
  } else if (adminTaskExists()) {
    await runElevated(`Unregister-ScheduledTask -TaskName ${psQuote(ADMIN_TASK)} -Confirm:$false`);
  }
  prefs = { ...prefs, adminMode: mode };
  savePrefs(prefs);
  return { mode, elevated: isElevated() };
}

// Flags that must survive the relaunch through elevation (started at logon, mini panel).
const LAUNCH_FLAGS = ['--hidden', '--mini'];
const launchFlagsFile = () => path.join(app.getPath('userData'), 'launch-flags.json');

// At launch, start an elevated copy if the user chose so. Returns true when this process should exit.
function elevateAtLaunch() {
  if (isLinux || process.argv.includes('--no-elevate')) return false;
  const mode = loadPrefs().adminMode;
  if (mode === 'off') return false;
  // At logon the app starts hidden in the tray: no UAC prompt then, only with the silent task.
  if (mode === 'prompt' && process.argv.includes('--hidden')) return false;
  if (isElevated()) return false;
  // First launch after installation: create the silent elevation task, with one Windows prompt.
  const setupTask = mode === 'task' && protectedInstall() && !adminTaskExists();
  try { fs.writeFileSync(launchFlagsFile(), JSON.stringify({ flags: process.argv.filter((a) => LAUNCH_FLAGS.includes(a)), at: Date.now() })); } catch {}
  try {
    if (mode === 'task' && protectedInstall() && adminTaskExists()) {
      execFileSync('schtasks', ['/run', '/tn', ADMIN_TASK], { stdio: 'ignore', windowsHide: true, timeout: 10000 });
      return true;
    }
    if (mode === 'prompt' || mode === 'task') {
      const { exe, args } = launchCommand();
      const argList = [...args.map((a) => `"${a}"`), '--no-elevate', ...(setupTask ? ['--create-admin-task'] : [])].map(psQuote).join(',');
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath ${psQuote(exe)} -ArgumentList ${argList} -Verb RunAs`], { stdio: 'ignore', windowsHide: true, timeout: 120000 });
      return true;
    }
  } catch {
    // Elevation refused or failed: continue without administrator rights.
  }
  return false;
}

// Installed for all users (Program Files): start as administrator by default, through the
// scheduled task created at the first launch. Elsewhere (development, per-user copy): on demand.
function defaultAdminMode() {
  return protectedInstall() ? 'task' : 'off';
}

// Flags passed by the non-elevated launcher (see elevateAtLaunch).
function inheritedFlags() {
  try {
    const f = JSON.parse(fs.readFileSync(launchFlagsFile(), 'utf8'));
    fs.unlinkSync(launchFlagsFile());
    if (Date.now() - f.at < 30000) return f.flags.filter((x) => LAUNCH_FLAGS.includes(x));
  } catch {}
  return [];
}

// ---------- Lifecycle ----------
if (elevateAtLaunch()) {
  app.exit(0);
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // `boost-my-pc --mini` toggles the mini panel, for example from a keyboard shortcut.
  app.on('second-instance', (_e, argv) => {
    if (menubar && argv.includes('--mini')) menubar.toggleMini('corner');
    else showWindow();
  });
  process.argv.push(...inheritedFlags());
  app.whenReady().then(() => {
    if (!isLinux) app.setAppUserModelId('com.boostmypc.app');
    prefs = loadPrefs();
    applyTheme();
    registerIpc();
    // Elevated first launch: register the task so later launches start as administrator silently.
    if (process.argv.includes('--create-admin-task') && isElevated()) setAdminMode('task').catch(() => {});
    if (isLinux) {
      // Linux: show the mini panel from the tray icon.
      menubar = createMenubar({
        iconPath,
        trayImage,
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
