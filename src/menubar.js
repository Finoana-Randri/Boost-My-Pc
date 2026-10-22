// Mini-panneau de la zone de notification, façon « Menu » de CleanMyMac X :
// un clic sur l'icône ouvre un panneau compact (état du PC, actions rapides), avec infobulle temps réel et alertes.
const { app, BrowserWindow, Tray, Menu, nativeImage, nativeTheme, screen, Notification, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const W = 380;
const H = 620;

function fmtBytes(b) {
  b = Number(b) || 0;
  if (b < 1024) return `${Math.round(b)} o`;
  const u = ['Ko', 'Mo', 'Go', 'To'];
  let i = -1;
  do { b /= 1024; i++; } while (b >= 1024 && i < u.length - 1);
  return `${b.toFixed(b >= 100 ? 0 : 1).replace('.', ',')} ${u[i]}`;
}

function createMenubar({ iconPath, showMain, sendToMain, services, getPrefs, onQuit }) {
  const { system, cleaner, protection, platform } = services;
  let tray = null;
  let mini = null;
  let shownAt = 0;
  let hiddenAt = 0;
  let quitting = false;

  // ---------- Fenêtre du mini-panneau ----------
  function createMini() {
    mini = new BrowserWindow({
      width: W,
      height: H,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: 'FastBoost — mini-panneau',
      icon: fs.existsSync(iconPath) ? iconPath : undefined,
      backgroundColor: bg(),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    mini.loadFile(path.join(__dirname, 'renderer', 'mini.html'));
    // Se ferme quand on clique ailleurs (comme un menu)
    mini.on('blur', () => {
      if (Date.now() - shownAt > 400 && !mini.webContents.isDevToolsOpened()) { mini.hide(); hiddenAt = Date.now(); }
    });
    // Fermer la fenêtre (Alt+F4) la masque seulement
    mini.on('close', (e) => { if (!quitting) { e.preventDefault(); mini.hide(); } });
    mini.on('closed', () => { mini = null; });
  }
  function bg() { return nativeTheme.shouldUseDarkColors ? '#1d1b26' : '#f6f5fa'; }

  // Place le panneau juste sous l'icône de la barre supérieure (comme un menu de la barre des menus macOS).
  // Sous Linux, l'emplacement de l'icône n'est pas connu (getBounds renvoie 0) : on utilise le pointeur
  // s'il se trouve dans la barre du haut (ou du bas pour KDE/Xfce), sinon le coin supérieur droit,
  // où GNOME/Ubuntu affichent les icônes d'état.
  const BAR = 64;
  function position(anchor) {
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const b = tray && typeof tray.getBounds === 'function' ? tray.getBounds() : null;
    let pt = b && b.width ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
    if (!pt && anchor === 'cursor') {
      const c = screen.getCursorScreenPoint();
      const d = screen.getDisplayNearestPoint(c);
      const inTopBar = c.y <= d.bounds.y + BAR;
      const inBottomBar = c.y >= d.bounds.y + d.bounds.height - BAR;
      if (inTopBar || inBottomBar) pt = c;
    }
    const display = pt ? screen.getDisplayNearestPoint(pt) : screen.getPrimaryDisplay();
    const wa = display.workArea;
    if (!pt) return { x: wa.x + wa.width - W - 8, y: wa.y + 6 };
    const x = clamp(Math.round(pt.x - W / 2), wa.x + 8, wa.x + wa.width - W - 8);
    const nearTop = pt.y < display.bounds.y + display.bounds.height / 2;
    const y = nearTop ? wa.y + 6 : wa.y + wa.height - H - 6;
    return { x, y };
  }

  function showMini(anchor = 'cursor') {
    if (!mini) createMini();
    const { x, y } = position(anchor);
    mini.setPosition(x, y, false);
    shownAt = Date.now();
    const reveal = () => { mini.show(); mini.focus(); mini.webContents.send('mini:shown'); };
    if (mini.webContents.isLoading()) mini.webContents.once('did-finish-load', reveal); else reveal();
  }
  function hideMini() { if (mini?.isVisible()) { mini.hide(); hiddenAt = Date.now(); } }
  function toggleMini(anchor) {
    // Un clic sur l'icône alors que le panneau est ouvert le fait d'abord perdre le focus (donc se masquer) :
    // on ne le rouvre pas dans la foulée.
    if (mini?.isVisible()) hideMini();
    else if (Date.now() - hiddenAt > 350) showMini(anchor);
  }

  // ---------- Icône et menu ----------
  function createTray() {
    if (!fs.existsSync(iconPath)) return null;
    try {
      tray = new Tray(nativeImage.createFromPath(path.join(path.dirname(iconPath), 'tray.png')).resize({ width: 22, height: 22, quality: 'best' }));
    } catch { tray = null; return null; } // bureau sans zone de notification
    tray.setToolTip('FastBoost');
    // Certains bureaux Linux n'envoient que le menu : la première entrée ouvre donc le mini-panneau
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Afficher le mini-panneau', click: () => showMini('cursor') },
      { label: 'Ouvrir FastBoost', click: () => showMain() },
      { type: 'separator' },
      { label: 'Boost', click: () => { showMini('cursor'); mini.webContents.send('mini:action', 'boost'); } },
      { label: 'Bilan de santé', click: () => { showMain(); sendToMain('go:health'); } },
      { label: 'Mises à jour', click: () => { showMain(); sendToMain('go:updates'); } },
      { type: 'separator' },
      { label: 'Quitter', click: onQuit },
    ]));
    tray.on('click', () => toggleMini('cursor'));
    return tray;
  }

  // ---------- Résumé mis en cache (analyses coûteuses) ----------
  let summary = { updates: null, security: 0, junk: null, trash: null, firewallOk: null, firewall: '', updatedAt: 0 };
  let summaryBusy = null;
  async function refreshSummary(force = false) {
    if (summaryBusy) return summaryBusy;
    if (!force && Date.now() - summary.updatedAt < 10 * 60 * 1000) return summary;
    summaryBusy = (async () => {
      const [scan, sec, upd] = await Promise.all([
        cleaner.scan('health').catch(() => null),
        protection.securityStatus().catch(() => null),
        summary.updates === null || force || Date.now() - summary.updatesAt > 60 * 60 * 1000
          ? protection.checkWindowsUpdates().catch(() => null) : Promise.resolve(undefined),
      ]);
      if (scan) {
        const userItems = scan.items.filter((i) => !i.needsAdmin && i.id !== 'trash' && i.id !== 'recycle' && i.id !== 'recent');
        summary.junk = userItems.reduce((a, i) => a + i.size, 0);
        summary.junkIds = userItems.filter((i) => i.size > 0).map((i) => i.id);
        const trash = scan.items.find((i) => i.id === 'trash' || i.id === 'recycle');
        summary.trash = trash ? trash.size : null;
      }
      if (sec) {
        const fw = sec.cards ? sec.cards.find((c) => c.id === 'firewall') : null;
        if (fw) { summary.firewallOk = fw.ok; summary.firewall = fw.status; }
        else if (sec.firewall) { summary.firewallOk = sec.firewall.every((f) => f.enabled); summary.firewall = summary.firewallOk ? 'Activé' : 'Désactivé'; }
      }
      if (upd) {
        summary.updates = upd.updates.length;
        summary.security = upd.updates.filter((u) => /sécurité|security/i.test(u.category || '')).length;
        summary.pendingReboot = upd.pendingReboot;
        summary.updatesAt = Date.now();
      }
      summary.updatedAt = Date.now();
      return summary;
    })().finally(() => { summaryBusy = null; });
    return summaryBusy;
  }

  // ---------- Infobulle temps réel + alertes ----------
  const lastAlert = {};
  let highMem = 0;
  function alert(key, cooldownMs, title, body) {
    if (!getPrefs().alerts || !Notification.isSupported()) return;
    if (lastAlert[key] && Date.now() - lastAlert[key] < cooldownMs) return;
    lastAlert[key] = Date.now();
    const n = new Notification({ title, body, icon: iconPath, silent: false });
    n.on('click', () => showMini());
    n.show();
  }

  async function tick() {
    const s = await system.getStats().catch(() => null);
    if (!s) return;
    if (tray) tray.setToolTip(`FastBoost\nProcesseur ${s.cpu} % · Mémoire ${s.memory.percent} %\n↓ ${fmtBytes(s.net.down)}/s  ↑ ${fmtBytes(s.net.up)}/s`);
    highMem = s.memory.percent >= 90 ? highMem + 1 : 0;
    if (highMem >= 3) alert('mem', 30 * 60 * 1000, 'Mémoire presque pleine', `${s.memory.percent} % de la mémoire est utilisée. Ouvrez le mini-panneau pour libérer de la mémoire.`);
  }

  async function slowTick() {
    const disks = await system.getDisks().catch(() => []);
    for (const d of disks) {
      if (d.size && d.free / d.size < 0.1) alert(`disk:${d.id}`, 6 * 3600 * 1000, 'Espace disque faible', `Il reste ${fmtBytes(d.free)} sur ${d.label} (${d.id}). Lancez un nettoyage pour libérer de l'espace.`);
    }
    const sum = await refreshSummary().catch(() => null);
    if (sum?.trash > 1024 ** 3) alert('trash', 24 * 3600 * 1000, 'Corbeille volumineuse', `La corbeille occupe ${fmtBytes(sum.trash)}. Videz-la depuis le mini-panneau.`);
    if (sum?.security > 0) alert('updates', 24 * 3600 * 1000, 'Mises à jour de sécurité', `${sum.security} mise(s) à jour de sécurité disponible(s).`);
  }

  // ---------- IPC du mini-panneau ----------
  ipcMain.handle('mini:summary', async (_e, force) => {
    try { return { ok: true, data: await refreshSummary(!!force) }; } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('ui:openMain', (_e, page) => { hideMini(); showMain(); if (page) sendToMain(`go:${page}`); return { ok: true }; });
  ipcMain.handle('ui:hideMini', () => { hideMini(); return { ok: true }; });

  app.on('before-quit', () => { quitting = true; });
  nativeTheme.on('updated', () => mini?.setBackgroundColor(bg()));
  createTray();
  createMini();
  setInterval(tick, 10 * 1000);
  setInterval(slowTick, 30 * 60 * 1000);
  setTimeout(slowTick, 60 * 1000);
  tick();

  return { tray, showMini, hideMini, toggleMini, platform };
}

module.exports = { createMenubar };
