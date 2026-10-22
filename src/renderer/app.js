/* global pcm, icon */
'use strict';

// ===================== Platform =====================
const IS_LINUX = pcm.platform === 'linux';
document.body.classList.add(IS_LINUX ? 'linux' : 'windows');
// Detail view mode: list by default, cards if the user chose them
try { if (localStorage.getItem('detailView') === 'cards') document.body.classList.add('view-cards'); } catch {}
let CAPS = { platform: pcm.platform, tools: [], isAdmin: false };
let PATHS = { home: '', pictures: '', downloads: '', root: '/' };
const UPDATES_NAME = IS_LINUX ? 'Mises à jour du système' : 'Windows Update';
const APP_TYPES = IS_LINUX
  ? { system: 'Paquets du système', flatpak: 'Flatpak', snap: 'Snap', user: 'Raccourcis personnels' }
  : { desktop: 'Bureau', store: 'Microsoft Store' };

// ===================== Utilities =====================
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const content = $('#content');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtBytes(b, d = 1) {
  b = Number(b) || 0;
  if (b < 1024) return `${Math.round(b)} o`;
  const u = ['Ko', 'Mo', 'Go', 'To'];
  let i = -1;
  do { b /= 1024; i++; } while (b >= 1024 && i < u.length - 1);
  return `${b.toFixed(b >= 100 ? 0 : d).replace('.', ',')} ${u[i]}`;
}
const fmtDate = (ms) => new Date(ms).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

let toastTimer;
function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast glass' + (error ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 4500);
}

function confirmBox(title, text, okLabel = 'Confirmer') {
  return new Promise((resolve) => {
    $('#modal-title').textContent = title;
    $('#modal-text').textContent = text;
    $('#modal-ok').textContent = okLabel;
    $('#modal').classList.remove('hidden');
    const done = (v) => { $('#modal').classList.add('hidden'); $('#modal-ok').onclick = $('#modal-cancel').onclick = null; resolve(v); };
    $('#modal-ok').onclick = () => done(true);
    $('#modal-cancel').onclick = () => done(false);
  });
}

async function safe(fn, errPrefix = 'Erreur') {
  try { return await fn(); } catch (e) { toast(`${errPrefix} : ${e.message}`, true); return undefined; }
}

const iconCache = new Map();
async function loadIcons(root = content) {
  for (const img of $$('img[data-file]', root)) {
    const p = img.dataset.file;
    if (!iconCache.has(p)) iconCache.set(p, pcm.file.icon(p).catch(() => null));
    const url = await iconCache.get(p);
    if (url && img.isConnected) { img.src = url; img.classList.remove('hidden'); img.nextElementSibling?.classList.add('hidden'); }
  }
}
const fileIcon = (p, fallback = 'file') => (p ? `<img data-file="${esc(p)}" class="hidden" alt="" />${icon(fallback)}` : icon(fallback));

function gauge(pct, size = 70, stroke = 7) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return `<div class="gauge" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="var(--track)" stroke-width="${stroke}" fill="none"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="url(#gg)" stroke-width="${stroke}" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}" style="transition:stroke-dashoffset .5s"/>
    <defs><linearGradient id="gg"><stop offset="0" stop-color="var(--a1)"/><stop offset="1" stop-color="var(--a2)"/></linearGradient></defs></svg><div class="g-val">${pct}%</div></div>`;
}

// ===================== Modules =====================
const MODULES = {
  smart: { title: 'Entretien intelligent', icon: 'sparkle' },
  cleanup: { title: 'Nettoyage', icon: 'broom' },
  protection: { title: 'Protection', icon: 'shield' },
  performance: { title: 'Performances', icon: 'gauge' },
  applications: { title: 'Applications', icon: 'apps' },
  clutter: { title: 'Encombrement', icon: 'layers' },
  lens: { title: 'Carte du disque', icon: 'lens' },
  cloud: { title: 'Nettoyage cloud', icon: 'cloud' },
  shredder: { title: 'Broyeur', icon: 'shredder' },
  tools: { title: 'Outils', icon: 'toolbox' },
  settings: { title: 'Paramètres', icon: 'settings' },
};
// Legacy routes for the mini panel and tray.
const LEGACY = {
  home: 'smart', health: 'cleanup', deepclean: 'cleanup', storage: 'lens', apps: 'applications', updates: 'applications/updates',
  processes: 'performance/processes', startup: 'performance/startup', uninstall: 'applications/uninstall', network: 'performance/network',
  downloads: 'clutter/downloads', large: 'clutter/large', duplicates: 'clutter/duplicates', toolbox: 'tools',
};

const PAGES = {};
let pageToken = 0;
let currentRoute = 'smart';
const progressHandlers = {};
pcm.onProgress((p) => progressHandlers[p.channel]?.(p));

function go(route) {
  route = LEGACY[route] || route;
  const [mod, tab] = route.split('/');
  const m = MODULES[mod] ? mod : 'smart';
  currentRoute = tab ? `${m}/${tab}` : m;
  document.body.dataset.mod = m;
  $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.page === m));
  for (const k of Object.keys(progressHandlers)) delete progressHandlers[k];
  const token = ++pageToken;
  content.scrollTop = 0;
  PAGES[m](token, tab);
}
const alive = (token) => token === pageToken;

document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-go]');
  if (g) { e.preventDefault(); go(g.dataset.go); return; }
  // Detail views: list by default, cards on request (remembered on this computer)
  const v = e.target.closest('[data-view]');
  if (v) {
    const cards = v.dataset.view === 'cards';
    document.body.classList.toggle('view-cards', cards);
    try { localStorage.setItem('detailView', cards ? 'cards' : 'list'); } catch {}
    $$('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === v.dataset.view));
    return;
  }
  const rs = e.target.closest('[data-restart]');
  if (rs) { delete overviewCache[rs.dataset.restart]; go(rs.dataset.restart); return; }
  const t = e.target.closest('[data-tool]');
  if (t) safe(() => pcm.tool.launch(t.dataset.tool), 'Outil');
  const r = e.target.closest('[data-reveal]');
  if (r) pcm.file.reveal(r.dataset.reveal);
});
$$('.nav-item').forEach((n) => {
  const ico = n.querySelector('[data-icon]');
  ico.innerHTML = micon(n.dataset.page);
  n.onclick = () => go(n.dataset.page);
});

// ===================== Shared components =====================
function page(html) { content.innerHTML = `<div class="page">${html}</div>`; return $('.page'); }

function header(mod, sub) {
  return `<h1>${esc(MODULES[mod].title)}</h1>${sub ? `<p class="lead">${sub}</p>` : ''}`;
}

function tabs(mod, list, active) {
  return `<div class="tabs glass">${list.map(([id, label]) => `<button class="tab ${id === active ? 'active' : ''}" data-go="${mod}/${id}">${esc(label)}</button>`).join('')}</div>`;
}

// Module home screen: icon, description, features, and action button.
function intro(mod, { title, lead, features = [], button = 'Analyser', extra = '' }) {
  return `<div class="intro">
    <div class="hero-icon">${micon(mod)}</div>
    <h1>${esc(title || MODULES[mod].title)}</h1>
    <p class="lead">${lead}</p>
    ${features.length ? `<div class="features">${features.map(([ic, t, s]) => `<div class="feature glass"><div class="f-ico">${ficon(ic)}</div><div><b>${esc(t)}</b><span>${esc(s)}</span></div></div>`).join('')}</div>` : ''}
    ${extra}
    <button class="scan-btn" id="scan">${esc(button)}</button>
  </div>`;
}

// Scan screen: animated ring and status text.
function scanning(mod, status, detail = '', { pct = null, stop = false } = {}) {
  const size = 190, stroke = 10, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const arc = pct == null
    ? `<circle cx="95" cy="95" r="${r}" stroke="url(#sg)" stroke-width="${stroke}" fill="none" stroke-linecap="round" stroke-dasharray="${c * 0.28} ${c}"/>`
    : `<circle cx="95" cy="95" r="${r}" stroke="url(#sg)" stroke-width="${stroke}" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}" style="transition:stroke-dashoffset .4s"/>`;
  return `<div class="scanning">
    <div class="ring-big ${pct == null ? 'spin' : ''}"><svg width="${size}" height="${size}"><defs><linearGradient id="sg"><stop offset="0" stop-color="var(--a1)"/><stop offset="1" stop-color="var(--a2)"/></linearGradient></defs>
      <circle cx="95" cy="95" r="${r}" stroke="var(--track)" stroke-width="${stroke}" fill="none"/>${arc}</svg>
      <div class="ring-center">${micon(mod)}</div></div>
    <div class="scan-status" id="scan-status">${esc(status)}</div>
    <div class="scan-detail" id="scan-detail">${esc(detail)}</div>
    ${stop ? '<button class="btn btn-stop" id="scan-stop">Arrêter</button>' : ''}
  </div>`;
}

function setScan(status, detail) {
  if (status != null && $('#scan-status')) $('#scan-status').textContent = status;
  if (detail != null && $('#scan-detail')) $('#scan-detail').textContent = detail;
}

function doneView(mod, title, sub, again) {
  return `<div class="intro">
    <div class="hero-icon">${icon('check')}</div>
    <h1>${esc(title)}</h1><p class="lead">${esc(sub)}</p>
    <button class="btn" data-go="${again}">${icon('refresh')} Nouvelle analyse</button>
  </div>`;
}

// ---------- Card overview (CleanMyMac style) ----------
// Each module with several sections opens, after its scan, on a grid of cards:
// a centered headline, an "examine all" button, then one large card and smaller ones.
const overviewCache = {};

function overview(mod, { title, sub, all, cards }) {
  return `<div class="ov-top"><button class="back-pill" data-restart="${mod}">${icon('back')} Recommencer</button><span class="ov-mod">${esc(MODULES[mod].title)}</span><span></span></div>
    <div class="ov-head"><h2 class="ov-title">${title}</h2><p class="ov-sub">${sub}</p>
      ${all ? `<button class="btn ov-all" data-go="${all[0]}">${esc(all[1])}</button>` : ''}</div>
    <div class="ov-grid">${cards.join('')}</div>`;
}

// size: '' (small), 'big' (two rows), 'wide' (two columns), 'full' (whole row)
function ovCard({ size = '', title, sub = '', art = '', actions = [] }) {
  const btn = (a) => (a.go
    ? `<button class="btn ${a.primary ? 'light' : ''}" data-go="${a.go}">${esc(a.label)}</button>`
    : `<button class="btn ${a.primary ? 'light' : ''}" id="${a.id}">${esc(a.label)}</button>`);
  return `<div class="ov-card glass ${size}">
    <div class="ov-text"><div class="ov-card-title">${title}</div>${sub ? `<div class="ov-card-sub">${sub}</div>` : ''}</div>
    ${art ? `<div class="ov-art">${art}</div>` : ''}
    <div class="ov-actions">${actions.map(btn).join('')}</div></div>`;
}

// Card artwork: icon tile, trio of icons, app icons, thumbnails
const artTile = (name, mod) => `<div class="ov-tile">${mod ? micon(mod) : ficon(name)}</div>`;
const artTrio = (names) => `<div class="ov-trio">${names.map((n, i) => `<span class="${i === 1 ? 'main' : ''}">${ficon(n)}</span>`).join('')}</div>`;
const artApps = (paths, fallback = 'apps') => `<div class="ov-apps">${paths.slice(0, 4).map((p) => `<span>${fileIcon(p, fallback)}</span>`).join('')}</div>`;
const artThumbs = (paths) => `<div class="ov-thumbs">${paths.slice(0, 3).map((p, i) => `<span class="${i === 1 ? 'main' : ''}"><img data-thumb="${esc(p)}" alt=""/></span>`).join('')}</div>`;

async function loadThumbs(token, root = content) {
  for (const img of $$('img[data-thumb]', root)) {
    if (!alive(token)) return;
    if (img.src) continue;
    const url = await pcm.v2.thumb(img.dataset.thumb).catch(() => null);
    if (url) img.src = url;
  }
}

// Header for a detail view: back to the overview, title, and quick navigation between sections
function detailHead(mod, list, active, sub) {
  const title = (list.find(([id]) => id === active) || [])[1] || MODULES[mod].title;
  const cards = document.body.classList.contains('view-cards');
  return `<div class="sub-head"><button class="back-pill" data-go="${mod}">${icon('back')} Vue d'ensemble</button><span class="ov-mod">${esc(MODULES[mod].title)}</span>
      <div class="view-toggle glass" role="group" aria-label="Affichage">
        <button class="${cards ? '' : 'active'}" data-view="list" title="Afficher en liste">${icon('viewList')}</button>
        <button class="${cards ? 'active' : ''}" data-view="cards" title="Afficher en cartes">${icon('viewCards')}</button></div></div>
    <h1>${esc(title)}</h1>${tabs(mod, list, active)}${sub ? `<p class="lead">${sub}</p>` : ''}`;
}

// Select files with checkboxes, then move them to the trash.
function fileRows(items, { showType = true, checked = false } = {}) {
  return items.map((f) => `<div class="row">
    <input type="checkbox" data-path="${esc(f.path)}" data-size="${f.size}" ${checked ? 'checked' : ''}/>
    <div class="r-ico">${fileIcon(f.path)}</div>
    <div class="r-main"><div class="r-title" title="${esc(f.path)}">${esc(f.name)}</div><div class="r-sub">${esc(f.path)}</div></div>
    ${showType && f.type ? `<div class="r-meta">${esc(f.type)}</div>` : ''}
    ${f.mtime ? `<div class="r-meta">${fmtDate(f.mtime)}</div>` : ''}
    <div class="r-meta"><b>${fmtBytes(f.size)}</b></div>
    <button class="btn ghost" data-reveal="${esc(f.path)}" title="Afficher dans le dossier">${icon('folder')}</button></div>`).join('');
}

function trashBar(label = 'Placer dans la corbeille') {
  return `<div class="action-bar" id="file-actions"><span class="summary sel"></span><button class="btn-main del" disabled>${esc(label)}</button></div>`;
}

// Connect the checkboxes to the action bar; `onAction(paths)` defaults to the trash.
function bindSelection(root, { onDone, onAction, confirmText } = {}) {
  const bar = $('#file-actions');
  const upd = () => {
    const sel = $$('input[data-path]:checked', root);
    const size = sel.reduce((a, c) => a + Number(c.dataset.size || 0), 0);
    bar.querySelector('.sel').textContent = sel.length ? `${plural(sel.length, 'élément sélectionné', 'éléments sélectionnés')}${size ? ` · ${fmtBytes(size)}` : ''}` : 'Sélectionnez des éléments';
    bar.querySelector('.del').disabled = !sel.length;
  };
  root.addEventListener('change', upd);
  bar.querySelector('.del').onclick = async () => {
    const paths = $$('input[data-path]:checked', root).map((c) => c.dataset.path);
    if (!paths.length) return;
    if (onAction) return onAction(paths);
    if (!(await confirmBox('Placer dans la corbeille ?', confirmText || `${plural(paths.length, 'élément sera déplacé', 'éléments seront déplacés')} vers la corbeille. Vous pourrez les restaurer.`, 'Placer dans la corbeille'))) return;
    const r = await safe(() => pcm.file.trash(paths));
    if (!r) return;
    toast(`${plural(r.done, 'élément déplacé', 'éléments déplacés')} vers la corbeille${r.failed ? ` · ${r.failed} échec(s)` : ''}`);
    onDone?.();
  };
  upd();
  return upd;
}

// ===================== Smart Care =====================
const SMART_STEPS = {
  cleanup: ['Nettoyage', 'broom', 'g-cleanup'],
  protection: ['Protection', 'shield', 'g-protection'],
  performance: ['Performances', 'gauge', 'g-performance'],
  applications: ['Applications', 'apps', 'g-applications'],
  clutter: ['Encombrement', 'layers', 'g-clutter'],
};
let smartResult = null;

PAGES.smart = async (token) => {
  if (smartResult) return renderSmartResult(token);
  page(intro('smart', {
    lead: 'Une seule analyse pour nettoyer, protéger et accélérer votre PC. Boost My Pc vérifie cinq points et vous propose les actions utiles.',
    features: [
      ['broom', 'Fichiers inutiles', 'Caches, temporaires et rapports de plantage'],
      ['shield', 'Menaces', IS_LINUX ? 'Démarrages et tâches suspects' : 'État de Microsoft Defender'],
      ['gauge', 'Maintenance', 'Tâches qui gardent le système rapide'],
      ['apps', 'Mises à jour', 'Système et applications'],
      ['layers', 'Encombrement', 'Gros fichiers oubliés dans les téléchargements'],
      ['lock', 'Sans risque', 'Rien n\'est supprimé sans votre accord'],
    ],
  }));
  $('#scan').onclick = async () => {
    page(scanning('smart', 'Analyse en cours…', 'Préparation', { pct: 0 }));
    progressHandlers.smart = (p) => {
      if (!alive(token) || !p.step || p.index == null) return;
      page(scanning('smart', `Analyse : ${SMART_STEPS[p.step][0]}`, `Étape ${p.index + 1} sur 5`, { pct: p.index / 5 }));
    };
    const r = await safe(() => pcm.v2.smartScan(), 'Analyse');
    if (!alive(token)) return;
    if (!r) return go('smart');
    smartResult = r;
    renderSmartResult(token);
  };
};

function renderSmartResult(token) {
  const s = Object.fromEntries(smartResult.steps.map((x) => [x.id, x]));
  const card = (id, val, sub, state, link) => {
    const [title, ic, g] = SMART_STEPS[id];
    return `<div class="result-card glass">
      <div class="rc-ico ${g}">${micon(id)}</div>
      <div class="muted small" style="font-weight:800">${title}</div>
      <div class="rc-val">${val}</div>
      <div class="rc-sub">${sub}</div>
      <div class="rc-state">${state}</div>
      <button class="btn" data-go="${link}">Examiner</button></div>`;
  };
  const ok = (t) => `<span class="pill ok">${icon('check')} ${t}</span>`;
  const warn = (t) => `<span class="pill warn">${t}</span>`;
  const c = s.cleanup || {}, p = s.protection || {}, pe = s.performance || {}, a = s.applications || {}, cl = s.clutter || {};
  const issues = smartResult.steps.reduce((n, x) => n + (x.issues || 0), 0);
  const willClean = c.size || 0;
  const willTasks = (pe.tasks || []).length;
  page(`${header('smart')}
    <p class="lead">${issues ? `Nous avons trouvé ${plural(issues, 'point à traiter', 'points à traiter')}.` : 'Votre PC est en pleine forme.'} Les actions sûres seront appliquées en un clic ; le reste est à examiner.</p>
    <div class="cards c5">
      ${card('cleanup', c.error ? '–' : fmtBytes(c.size), c.error ? esc(c.error) : 'de fichiers inutiles à supprimer', c.size > 0 ? warn('À nettoyer') : ok('Propre'), 'cleanup')}
      ${card('protection', p.error ? '–' : plural(p.threats?.length || 0, 'menace', 'menaces'), esc(p.note || (IS_LINUX ? 'Analyse heuristique des points d\'entrée' : '')), p.threats?.length ? `<span class="pill bad">À examiner</span>` : ok('Protégé'), 'protection')}
      ${card('performance', plural(willTasks, 'tâche', 'tâches'), `de maintenance recommandées · ${plural(pe.startup || 0, 'app', 'apps')} au démarrage`, willTasks ? warn('À exécuter') : ok('Optimisé'), 'performance')}
      ${card('applications', a.error ? '–' : plural(a.updates || 0, 'mise à jour', 'mises à jour'), a.security ? `dont ${a.security} de sécurité` : (a.pendingReboot ? 'Redémarrage nécessaire' : 'disponibles'), a.updates ? warn('À installer') : ok('À jour'), 'applications/updates')}
      ${card('clutter', plural(cl.count || 0, 'fichier', 'fichiers'), cl.count ? `${fmtBytes(cl.size)} de gros téléchargements anciens` : 'Aucun gros fichier oublié', cl.count ? warn('À trier') : ok('Rangé'), 'clutter/large')}
    </div>
    <div class="action-bar">
      <span class="summary">${willClean || willTasks ? `Nettoyer ${fmtBytes(willClean)} · ${plural(willTasks, 'tâche', 'tâches')}` : 'Rien à exécuter automatiquement'}</span>
      <button class="btn-main" id="smart-run" ${willClean || willTasks ? '' : 'disabled'}>Exécuter</button>
      <button class="btn" id="smart-new">${icon('refresh')} Relancer</button>
    </div>`);
  $('#smart-new').onclick = () => { smartResult = null; go('smart'); };
  $('#smart-run').onclick = async () => {
    page(scanning('smart', 'Exécution…', 'Nettoyage et maintenance'));
    const r = await safe(() => pcm.v2.smartRun(), 'Exécution');
    smartResult = null;
    if (!alive(token)) return;
    if (!r) return go('smart');
    page(doneView('smart', 'Entretien terminé', `${fmtBytes(r.freed)} libérés · ${plural(r.tasks, 'tâche effectuée', 'tâches effectuées')}`, 'smart'));
  };
}

// ===================== Cleanup =====================
PAGES.cleanup = async (token) => {
  page(intro('cleanup', {
    lead: 'Supprimez les fichiers système inutiles, les caches, les journaux et les autres fichiers qui encombrent votre disque.',
    features: [
      ['file', 'Fichiers système', IS_LINUX ? 'Journaux, cache des paquets, rapports de plantage' : 'Windows Update, rapports d\'erreurs, vidages mémoire'],
      ['globe', 'Navigateurs', 'Caches de Chrome, Firefox, Edge, Brave…'],
      ['wrench', 'Développement', 'Caches npm, pip, Yarn, Gradle, Cargo'],
    ],
  }));
  $('#scan').onclick = async () => {
    page(scanning('cleanup', 'Recherche des fichiers inutiles…', ''));
    progressHandlers.clean = (p) => alive(token) && setScan(null, `${p.current} (${p.index + 1}/${p.total})`);
    const r = await safe(() => pcm.clean.scan('deep'), 'Analyse');
    if (!r || !alive(token)) return go('cleanup');
    renderCleanResult(r, token);
  };
};

function renderCleanResult(r, token) {
  const total = r.items.reduce((a, i) => a + i.size, 0);
  const empty = (i) => i.size === 0 && !(i.countOnly && i.files);
  page(`${header('cleanup')}
    <div class="card glass" style="display:flex;align-items:center;gap:18px;margin-bottom:14px">
      <div class="hero-icon" style="width:70px;height:70px;border-radius:20px;margin:0;animation:none">${micon('cleanup')}</div>
      <div style="flex:1"><div class="big">${fmtBytes(total)}</div><div class="muted">peuvent être nettoyés</div></div>
      ${r.items.some((i) => i.needsAdmin) && !r.admin ? `<span class="pill warn">${icon('admin')} ${IS_LINUX ? 'Mot de passe demandé pour les éléments système' : 'Certains éléments nécessitent les droits admin'}</span>` : ''}
    </div>
    <div class="list glass" id="clean-list">${r.items.map((i) => `
      <label class="row" style="cursor:pointer"><input type="checkbox" data-id="${i.id}" data-size="${i.size}" ${i.recommended && !empty(i) ? 'checked' : ''} ${empty(i) ? 'disabled' : ''}/>
        <div class="r-ico tint">${ficon('broom')}</div>
        <div class="r-main"><div class="r-title">${esc(i.name)} ${i.recommended ? '<span class="pill info">Recommandé</span>' : ''}</div><div class="r-sub">${esc(i.desc)}</div></div>
        <div class="r-meta">${i.countOnly ? `${i.files} élément(s)` : `<b>${fmtBytes(i.size)}</b><div class="small">${i.files || 0} fichier(s)</div>`}</div></label>`).join('')}</div>
    <div class="action-bar"><span class="summary" id="sel-size"></span><button class="btn-main" id="do-clean">Nettoyer</button></div>`);
  const upd = () => {
    const sel = $$('#clean-list input:checked');
    $('#sel-size').textContent = sel.length ? `Sélection : ${fmtBytes(sel.reduce((a, c) => a + Number(c.dataset.size), 0))}` : 'Sélectionnez des éléments';
    $('#do-clean').disabled = !sel.length;
  };
  $('#clean-list').addEventListener('change', upd);
  upd();
  $('#do-clean').onclick = async () => {
    const ids = $$('#clean-list input:checked').map((c) => c.dataset.id);
    if ((ids.includes('recycle') || ids.includes('trash')) && !(await confirmBox('Vider la corbeille ?', 'Les fichiers de la corbeille seront supprimés définitivement.', 'Vider'))) return;
    page(scanning('cleanup', 'Nettoyage en cours…', ''));
    progressHandlers.clean = (p) => alive(token) && setScan(null, p.current);
    const res = await safe(() => pcm.clean.run(ids), 'Nettoyage');
    if (!alive(token)) return;
    if (!res) return go('cleanup');
    page(doneView('cleanup', `${fmtBytes(res.freed)} libérés`, `${plural(res.deleted, 'fichier supprimé', 'fichiers supprimés')}${res.failed ? ` · ${res.failed} ignoré(s) car en cours d'utilisation` : ''}${res.adminCancelled ? ' · éléments système non nettoyés (authentification annulée)' : ''}`, 'cleanup'));
  };
}

// ===================== Protection =====================
const PROTECTION_TABS = [['threats', 'Menaces'], ['privacy', 'Confidentialité'], ['permissions', 'Autorisations'], ['status', 'État']];
let malwareResult = null;

PAGES.protection = async (token, tab) => {
  if (tab === 'threats') return protectionThreats(token, detailHead('protection', PROTECTION_TABS, 'threats'));
  if (tab === 'privacy') return protectionPrivacy(token, detailHead('protection', PROTECTION_TABS, 'privacy', 'Effacez l\'historique et les traces de navigation. Les mots de passe, favoris et cartes bancaires ne sont jamais touchés.'));
  if (tab === 'permissions') return protectionPermissions(token, detailHead('protection', PROTECTION_TABS, 'permissions', IS_LINUX ? 'Vérifiez ce que vos applications Flatpak peuvent faire, et retirez les accès inutiles.' : 'Applications ayant accédé à votre caméra, votre micro ou votre position.'));
  if (tab === 'status') return protectionStatus(token, detailHead('protection', PROTECTION_TABS, 'status'));
  if (overviewCache.protection) return renderProtectionOverview(token);
  page(intro('protection', {
    lead: 'Recherchez les menaces, effacez vos traces de navigation et vérifiez quelles applications accèdent à votre caméra et à votre micro.',
    features: [
      ['virus', 'Menaces', IS_LINUX ? 'Démarrages, tâches planifiées et exécutables suspects' : 'Microsoft Defender'],
      ['eye', 'Confidentialité', 'Historique, cookies et éléments récents'],
      ['lock', 'Autorisations', 'Caméra, micro et accès aux fichiers'],
    ],
  }));
  $('#scan').onclick = async () => {
    page(scanning('protection', 'Analyse de la protection…', 'Menaces, confidentialité et autorisations'));
    const [quick, perms, privacy, status] = await Promise.all([
      pcm.v2.malwareQuick().catch(() => null),
      pcm.v2.permList().catch(() => null),
      pcm.v2.privacyScan().catch(() => []),
      pcm.protect.status().catch(() => null),
    ]);
    if (!alive(token)) return;
    overviewCache.protection = { quick, perms, privacy, status };
    if (quick) malwareResult = { kind: 'quick', engine: IS_LINUX ? 'Analyse heuristique' : 'Vérification de Microsoft Defender', threats: quick.threats, clamav: true, fromOverview: true };
    renderProtectionOverview(token);
  };
};

function renderProtectionOverview(token) {
  const { quick, perms, privacy, status } = overviewCache.protection;
  const threats = quick?.threats || [];
  const sensitive = (perms?.apps || []).filter((a) => a.perms.some((p) => ['webcam', 'microphone', 'devices-all', 'audio'].includes(p.id)));
  const browser = privacy.filter((i) => i.group !== 'Système');
  const browserSize = browser.reduce((a, i) => a + i.size, 0);
  const topBrowser = [...new Set(browser.map((i) => i.group))];
  const recent = privacy.filter((i) => i.group === 'Système');
  const recentCount = recent.reduce((a, i) => a + (i.count || 0), 0);
  const fw = status?.cards ? status.cards.find((c) => c.id === 'firewall') : null;
  const fwOk = fw ? fw.ok : (status?.firewall || []).every((f) => f.enabled);
  const issues = threats.length + (sensitive.length ? 1 : 0) + (browserSize ? 1 : 0);
  page(overview('protection', {
    title: threats.length ? `${plural(threats.length, 'menace détectée', 'menaces détectées')}.` : 'Aucune menace détectée.',
    sub: `${threats.length ? 'Supprimez les menaces et gérez vos éléments de confidentialité.' : issues ? 'Gérez vos éléments de confidentialité.' : 'Votre PC est protégé.'} Pare-feu ${fwOk ? 'activé' : 'désactivé'}.`,
    all: ['protection/threats', threats.length ? 'Voir les menaces détectées' : 'Lancer une analyse approfondie'],
    cards: [
      ovCard({
        size: 'big',
        title: threats.length ? plural(threats.length, 'menace détectée', 'menaces détectées') : 'Aucune menace',
        sub: threats.length ? 'Supprimez-les dès que vous pouvez pour profiter d\'une bonne protection.' : (quick?.note || 'Lancez une analyse normale ou approfondie pour vérifier tout le système.'),
        art: threats.length ? artTrio(['warn', 'bug', 'folder']) : artTrio(['lock', 'shieldCheck', 'eye']),
        actions: threats.length ? [{ label: 'Examiner', go: 'protection/threats' }, { label: 'Supprimer', go: 'protection/threats', primary: true }] : [{ label: 'Analyser', go: 'protection/threats' }],
      }),
      ovCard({
        size: 'wide',
        title: sensitive.length ? `${plural(sensitive.length, 'application a accès', 'applications ont accès')} à votre micro et à votre caméra` : 'Aucune application n\'accède à votre caméra ou à votre micro',
        sub: perms?.supported === false ? esc(perms.reason || '') : 'Il peut être judicieux d\'empêcher certaines applications d\'accéder à ces appareils. Passez en revue toute la liste.',
        art: sensitive.some((a) => a.icon) ? artApps(sensitive.filter((a) => a.icon).map((a) => a.icon)) : artTile('camera'),
        actions: [{ label: 'Examiner', go: 'protection/permissions' }],
      }),
      ovCard({
        title: browserSize ? `${fmtBytes(browserSize)} de données de navigation` : 'Aucune donnée de navigation',
        sub: topBrowser.length ? esc(topBrowser.slice(0, 2).join(', ')) : '',
        art: artTile('globe'),
        actions: browserSize ? [{ label: 'Examiner', go: 'protection/privacy' }, { label: 'Supprimer', go: 'protection/privacy', primary: true }] : [{ label: 'Examiner', go: 'protection/privacy' }],
      }),
      ovCard({
        title: recentCount ? `${plural(recentCount, 'élément récent détecté', 'éléments récents détectés')}` : 'Aucun élément récent',
        sub: 'Fichiers ouverts récemment et historique du système',
        art: artTile('clock'),
        actions: recentCount ? [{ label: 'Examiner', go: 'protection/privacy' }, { label: 'Supprimer', go: 'protection/privacy', primary: true }] : [{ label: 'Examiner', go: 'protection/privacy' }],
      }),
    ],
  }));
  loadIcons();
}

async function protectionThreats(token, top) {
  if (malwareResult) return renderThreats(token, top);
  let kind = 'quick';
  page(`${top}${intro('protection', {
    title: 'Analyse des menaces',
    lead: IS_LINUX
      ? 'Recherchez les programmes malveillants et les modifications suspectes du système. L\'analyse par signatures utilise ClamAV s\'il est installé.'
      : 'Lancez une analyse Microsoft Defender rapide, de votre dossier personnel ou complète, puis examinez les menaces détectées.',
    extra: `<div class="tabs glass" id="kinds" style="margin-bottom:24px">
      <button class="tab active" data-kind="quick">Rapide</button><button class="tab" data-kind="normal">Normale</button><button class="tab" data-kind="deep">Approfondie</button></div>`,
  })}`);
  $$('#kinds .tab').forEach((b) => (b.onclick = () => { kind = b.dataset.kind; $$('#kinds .tab').forEach((x) => x.classList.toggle('active', x === b)); }));
  $('#scan').onclick = async () => {
    page(`${top}${scanning('protection', 'Analyse des menaces…', 'Cela peut prendre plusieurs minutes')}`);
    progressHandlers.malware = (p) => alive(token) && setScan(null, p.current);
    const r = await safe(() => pcm.v2.malwareScan(kind), 'Analyse');
    if (!alive(token)) return;
    if (!r) return go('protection/threats');
    malwareResult = r;
    renderThreats(token, top);
  };
}

function renderThreats(token, top) {
  const r = malwareResult;
  const kinds = { quick: 'rapide', normal: 'normale', deep: 'approfondie' };
  page(`${top}
    <div class="card glass" style="display:flex;align-items:center;gap:16px;margin-bottom:14px">
      <div class="status-ico ${r.threats.length ? 'bad' : 'ok'}">${icon(r.threats.length ? 'warn' : 'check')}</div>
      <div style="flex:1"><div class="big">${r.threats.length ? plural(r.threats.length, 'menace détectée', 'menaces détectées') : 'Aucune menace détectée'}</div>
      <div class="muted small">${r.fromOverview ? esc(r.engine) : `Analyse ${kinds[r.kind]} · ${esc(r.engine)}`}</div></div>
      <button class="btn" id="new-scan">${icon('refresh')} ${r.fromOverview ? 'Analyse complète' : 'Nouvelle analyse'}</button>
    </div>
    ${IS_LINUX && r.clamav === false ? `<div class="card glass small muted" style="margin-bottom:14px">Pour ajouter l'analyse par signatures antivirus, installez ClamAV (par exemple <b>sudo apt install clamav</b>), puis relancez l'analyse.</div>` : ''}
    ${r.threats.length ? `<div class="cards c2" id="threats">${r.threats.map((t) => `<label class="pick-card glass ${t.removable && t.path ? '' : 'locked'}">
      ${t.removable && t.path ? `<input type="checkbox" data-path="${esc(t.path)}" data-size="0" checked/>` : ''}
      <div class="pc-ico g-protection">${ficon('virus')}</div>
      <div class="pc-title">${esc(t.threat)}</div>
      <div class="pc-sub" title="${esc(t.detail)}">${esc(t.path)}</div><div class="pc-sub">${esc(t.detail)}</div>
      ${t.path && t.path !== 'crontab' ? `<button class="btn ghost pc-corner" data-reveal="${esc(t.path)}" title="Afficher">${icon('folder')}</button>` : ''}</label>`).join('')}</div>${trashBar('Supprimer les menaces')}` : ''}`);
  $('#new-scan').onclick = () => { malwareResult = null; go('protection/threats'); };
  if (r.threats.length) {
    bindSelection($('#threats'), {
      confirmText: 'Les fichiers sélectionnés seront placés dans la corbeille. Les entrées non supprimables (crontab, scripts de session) doivent être corrigées à la main.',
      onDone: () => { malwareResult = null; delete overviewCache.protection; go('protection'); },
    });
  }
}

async function protectionPrivacy(token, top) {
  page(`${top}<div id="pv"><div class="loading"><span class="spinner"></span>Recherche des traces…</div></div>`);
  const items = await safe(() => pcm.v2.privacyScan(), 'Confidentialité');
  if (!items || !alive(token)) return;
  const groups = {};
  for (const it of items) (groups[it.group] ||= []).push(it);
  $('#pv').innerHTML = Object.entries(groups).map(([g, list]) => `<h2>${esc(g)}</h2><div class="cards c3">${list.map((it) => `
    <label class="pick-card glass ${it.blocked ? 'locked' : ''}"><input type="checkbox" data-id="${it.id}" data-size="${it.size}" ${it.blocked ? 'disabled' : it.recommended ? 'checked' : ''}/>
      <div class="pc-ico g-protection">${ficon(g === 'Système' ? 'clock' : 'globe')}</div>
      <div class="pc-title">${esc(it.name)}</div><div class="pc-sub">${esc(it.blocked || it.desc)}</div>
      <div class="pc-foot">${it.blocked ? '<span class="pill warn">Navigateur ouvert</span>' : `<b>${fmtBytes(it.size)}</b>`}</div></label>`).join('')}</div>`).join('') +
    '<div class="action-bar"><span class="summary" id="pv-sel"></span><button class="btn-main" id="pv-go">Effacer</button></div>';
  const upd = () => { const n = $$('#pv input:checked').length; $('#pv-go').disabled = !n; $('#pv-sel').textContent = n ? plural(n, 'élément sélectionné', 'éléments sélectionnés') : 'Sélectionnez des éléments'; };
  $('#pv').addEventListener('change', upd);
  upd();
  $('#pv-go').onclick = async () => {
    const ids = $$('#pv input:checked').map((c) => c.dataset.id);
    if (ids.some((i) => i.endsWith(':cookies')) && !(await confirmBox('Effacer les cookies ?', 'Vous serez déconnecté des sites web dans les navigateurs concernés.', 'Effacer'))) return;
    const r = await safe(() => pcm.v2.privacyClean(ids), 'Confidentialité');
    if (!r || !alive(token)) return;
    toast(`${plural(r.done, 'élément effacé', 'éléments effacés')} · ${fmtBytes(r.freed)}${r.skipped.length ? ` · ${r.skipped[0]}` : ''}`, r.skipped.length > 0 && !r.done);
    delete overviewCache.protection;
    go('protection/privacy');
  };
}

async function protectionPermissions(token, top) {
  page(`${top}<div id="perm"><div class="loading"><span class="spinner"></span>Lecture des autorisations…</div></div>`);
  const r = overviewCache.protection?.perms || await safe(() => pcm.v2.permList(), 'Autorisations');
  if (!r || !alive(token)) return;
  if (!r.supported || !r.apps.length) { $('#perm').innerHTML = `<div class="card glass empty">${icon('check')}<div>${esc(r.reason || 'Aucune autorisation à vérifier.')}</div></div>`; return; }
  const riskCls = { high: 'bad', medium: 'warn', low: 'info' };
  $('#perm').innerHTML = `${!IS_LINUX ? `<div class="list-head">${['privacyWebcam:Caméra', 'privacyMic:Micro', 'privacyLocation:Localisation'].map((x) => { const [id, l] = x.split(':'); return `<button class="btn" data-tool="${id}">${icon('external')} Gérer : ${l}</button>`; }).join('')}</div>` : ''}
    <div class="cards c3">${r.apps.map((a, i) => `<div class="pick-card glass static">
      <div class="pc-ico plain">${fileIcon(a.icon, 'apps')}</div>
      <div class="pc-title">${esc(a.name)}</div>
      <div class="pc-pills">${a.perms.length ? a.perms.map((p) => `<span class="pill ${riskCls[p.risk]}">${esc(p.label)}${p.last ? ` · ${new Date(p.last).toLocaleDateString('fr-FR')}` : ''}${IS_LINUX ? ` <button class="btn ghost" style="min-height:0;padding:0 4px" data-revoke="${i}:${p.id}" title="Retirer">${icon('x')}</button>` : ''}</span>`).join('') : '<span class="pill ok">Aucun accès sensible</span>'}</div>
      ${IS_LINUX ? `<div class="pc-foot"><button class="btn" data-reset="${i}">Réinitialiser</button></div>` : ''}</div>`).join('')}</div>`;
  loadIcons();
  $$('[data-revoke]').forEach((b) => (b.onclick = async (e) => {
    e.preventDefault();
    const [i, perm] = b.dataset.revoke.split(':');
    const a = r.apps[Number(i)];
    if (!(await confirmBox('Retirer cette autorisation ?', `« ${a.name} » ne pourra plus utiliser : ${a.perms.find((p) => p.id === perm).label}. L'application peut cesser de fonctionner correctement ; « Réinitialiser » annule ce changement.`, 'Retirer'))) return;
    if (await safe(() => pcm.v2.permRevoke(a.id, perm))) { toast('Autorisation retirée'); delete overviewCache.protection; go('protection/permissions'); }
  }));
  $$('[data-reset]').forEach((b) => (b.onclick = async () => {
    const a = r.apps[Number(b.dataset.reset)];
    if (await safe(() => pcm.v2.permReset(a.id))) { toast(`Autorisations de ${a.name} réinitialisées`); delete overviewCache.protection; go('protection/permissions'); }
  }));
}

async function protectionStatus(token, top) {
  page(`${top}<div class="cards c3" id="sec"><div class="loading"><span class="spinner"></span>Lecture de l'état de sécurité…</div></div>
    <h2>Raccourcis</h2><div class="cards c2">
      <button class="row glass" style="border-radius:18px;cursor:pointer" data-go="performance/network"><div class="r-ico tint">${ficon('wifi')}</div><div class="r-main"><div class="r-title">Diagnostic réseau</div><div class="r-sub">Analysez et réparez votre connexion</div></div></button>
      <button class="row glass" style="border-radius:18px;cursor:pointer" data-go="applications/updates"><div class="r-ico tint">${ficon('update')}</div><div class="r-main"><div class="r-title">${UPDATES_NAME}</div><div class="r-sub">Installez les mises à jour de sécurité</div></div></button>
    </div>`);
  const s = await safe(() => pcm.protect.status(), 'Protection');
  if (!s || !alive(token)) return;
  const cards = s.cards || windowsSecurityCards(s);
  $('#sec').innerHTML = cards.map((c) => `<div class="card glass">
    <div class="card-title"><div class="status-ico ${c.ok ? (c.warn ? 'warn' : 'ok') : 'bad'}">${icon(c.icon)}</div><div><div>${esc(c.title)}</div><div class="muted small">${esc(c.status)}</div></div></div>
    ${c.details?.length ? `<div class="kv" style="grid-template-columns:130px 1fr">${c.details.map(([k, v]) => `<div>${esc(k)}</div><div>${esc(v)}</div>`).join('')}</div>` : ''}
    ${c.actions?.length ? `<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">${c.actions.map((a) => `<button class="btn ${a.primary ? 'primary' : ''}" data-sec="${a.id}">${esc(a.label)}</button>`).join('')}</div>` : ''}</div>`).join('');
  $$('[data-sec]').forEach((b) => (b.onclick = async () => {
    const label = b.textContent;
    b.disabled = true; b.innerHTML = '<span class="spinner"></span>';
    const id = b.dataset.sec;
    const msg = await safe(() => (id === 'winQuick' ? pcm.protect.quickScan().then(() => 'Analyse rapide terminée.') : id === 'winSig' ? pcm.protect.updateSignatures().then(() => 'Signatures à jour.') : pcm.protect.action(id)), label);
    if (msg) { if (String(msg).includes('\n')) await confirmBox(label, msg, 'OK'); else toast(msg); }
    if (alive(token)) go('protection/status');
  }));
}

function windowsSecurityCards(s) {
  const d = s.defender;
  const fwAll = (s.firewall || []).length && s.firewall.every((f) => f.enabled);
  return [
    { icon: 'virus', title: 'Antivirus', ok: !!(d && d.enabled && d.realtime), status: d ? (d.realtime ? 'Microsoft Defender actif' : 'Protection en temps réel désactivée') : (s.antivirus || []).join(', ') || 'Inconnu',
      details: d ? [['Signatures', `${d.signatureVersion} (${d.signatureAge} j)`], ['Dernière analyse', d.lastQuickScan ? new Date(d.lastQuickScan).toLocaleString('fr-FR') : 'Jamais']] : [],
      actions: d ? [{ id: 'winSig', label: 'Mettre à jour les signatures' }] : [] },
    { icon: 'firewall', title: 'Pare-feu', ok: !!fwAll, warn: !fwAll, status: fwAll ? 'Activé sur tous les réseaux' : 'Désactivé sur certains profils', details: (s.firewall || []).map((f) => [f.name, f.enabled ? 'Activé' : 'Désactivé']) },
    { icon: 'shield', title: 'Protection contre la falsification', ok: !!d?.tamper, warn: !d?.tamper, status: d?.tamper ? 'Activée' : 'Désactivée ou inconnue', details: [['Rôle', 'Empêche la désactivation de la sécurité']] },
  ];
}

// ===================== Performance =====================
const PERF_TABS = [['maintenance', 'Maintenance'], ['startup', 'Démarrage'], ['processes', 'Gros consommateurs'], ['network', 'Réseau']];
const TASK_ICONS = { dns: 'globe', fontcache: 'file', appcache: 'apps', iconcache: 'image', ram: 'memory', trim: 'storage', journal: 'clock', orphans: 'box', storecache: 'download' };

PAGES.performance = async (token, tab) => {
  if (tab === 'maintenance') return perfMaintenance(token, detailHead('performance', PERF_TABS, 'maintenance', 'Des tâches de maintenance qui gardent votre système rapide et stable. Sélectionnez celles à exécuter.'));
  if (tab === 'startup') return perfStartup(token, detailHead('performance', PERF_TABS, 'startup', 'Désactivez les applications lancées à l\'ouverture de session pour démarrer plus vite.'));
  if (tab === 'processes') return perfProcesses(token, detailHead('performance', PERF_TABS, 'processes'));
  if (tab === 'network') return perfNetwork(token, detailHead('performance', PERF_TABS, 'network'));
  if (overviewCache.performance) return renderPerfOverview(token);
  page(intro('performance', {
    lead: 'Gardez un système rapide : tâches de maintenance, applications au démarrage, mémoire et applications gourmandes.',
    features: [
      ['wrench', 'Maintenance', 'Cache DNS, polices, SSD, journaux…'],
      ['power', 'Démarrage', 'Applications lancées avec la session'],
      ['memory', 'Mémoire', 'Applications les plus gourmandes'],
    ],
  }));
  $('#scan').onclick = async () => {
    page(scanning('performance', 'Analyse des performances…', 'Maintenance, démarrage et mémoire'));
    const [tasks, startup, procs, stats] = await Promise.all([
      pcm.v2.maintList().catch(() => []),
      pcm.apps.startup().catch(() => []),
      pcm.apps.processes().catch(() => []),
      pcm.system.stats().catch(() => null),
    ]);
    if (!alive(token)) return;
    overviewCache.performance = { tasks, startup, procs, stats };
    renderPerfOverview(token);
  };
};

function renderPerfOverview(token) {
  const { tasks, startup, procs, stats } = overviewCache.performance;
  const rec = tasks.filter((t) => t.recommended);
  const on = startup.filter((s) => s.enabled);
  const top = procs[0];
  const pct = stats?.memory?.percent ?? 0;
  const points = (rec.length ? 1 : 0) + (on.length > 3 ? 1 : 0) + (pct >= 80 ? 1 : 0);
  page(overview('performance', {
    title: points ? `${plural(points, 'amélioration possible', 'améliorations possibles')}.` : 'Votre système est rapide.',
    sub: 'Exécutez les tâches recommandées ou passez-les en revue une par une.',
    all: ['performance/maintenance', 'Voir toutes les tâches'],
    cards: [
      ovCard({
        size: 'big',
        title: rec.length ? `${plural(rec.length, 'tâche de maintenance recommandée', 'tâches de maintenance recommandées')}` : 'Aucune tâche recommandée',
        sub: rec.length ? esc(rec.map((t) => t.name).slice(0, 4).join(' · ')) : 'Toutes les tâches restent disponibles dans le détail.',
        art: artTrio(['wrench', 'gauge', 'refresh']),
        actions: [{ label: 'Examiner', go: 'performance/maintenance' }, ...(rec.length ? [{ label: 'Exécuter', id: 'ov-run', primary: true }] : [])],
      }),
      ovCard({
        size: 'wide',
        title: on.length ? `${plural(on.length, 'application se lance', 'applications se lancent')} au démarrage` : 'Aucune application au démarrage',
        sub: 'Désactivez celles dont vous n\'avez pas besoin pour démarrer plus vite.',
        art: on.some((s) => s.exe) ? artApps(on.map((s) => s.exe), 'power') : artTile('power'),
        actions: [{ label: 'Examiner', go: 'performance/startup' }],
      }),
      ovCard({
        title: top ? `${esc(top.desc)} utilise ${fmtBytes(top.memory)}` : 'Aucune application gourmande',
        sub: 'Application la plus gourmande en mémoire',
        art: top ? artApps([top.icon || top.path], 'process') : artTile('process'),
        actions: [{ label: 'Examiner', go: 'performance/processes' }],
      }),
      ovCard({
        title: `${pct} % de mémoire utilisée`,
        sub: stats ? `${fmtBytes(stats.memory.used)} sur ${fmtBytes(stats.memory.total)}` : '',
        art: `<div class="ov-gauge">${gauge(pct, 58, 6)}</div>`,
        actions: [{ label: 'Libérer', id: 'ov-boost', primary: true }],
      }),
      ovCard({
        size: 'full',
        title: 'Réseau',
        sub: 'Vérifiez la carte réseau, l\'adresse IP, le routeur, le DNS et l\'accès à Internet.',
        art: artTile('wifi'),
        actions: [{ label: 'Diagnostiquer', go: 'performance/network' }],
      }),
    ],
  }));
  loadIcons();
  $('#ov-run') && ($('#ov-run').onclick = () => runMaintenance(token, rec.map((t) => t.id), tasks, ''));
  $('#ov-boost').onclick = async (e) => {
    e.currentTarget.disabled = true;
    const r = await safe(() => pcm.system.boost(), 'Libérer');
    if (r) toast(`Mémoire libérée : ${fmtBytes(r.freed)}`);
    const s = await pcm.system.stats().catch(() => null);
    if (s && alive(token)) { overviewCache.performance.stats = s; renderPerfOverview(token); }
  };
}

async function runMaintenance(token, ids, tasks, top) {
  page(`${top}${scanning('performance', 'Maintenance en cours…', '')}`);
  const res = await safe(() => pcm.v2.maintRun(ids), 'Maintenance');
  if (!alive(token)) return;
  if (!res) return go('performance');
  delete overviewCache.performance;
  const okN = res.filter((x) => x.ok).length;
  const failed = res.filter((x) => !x.ok);
  page(`${top}${doneView('performance', `${plural(okN, 'tâche effectuée', 'tâches effectuées')}`, failed.length ? `Non effectuées : ${failed.map((f) => `${tasks.find((t) => t.id === f.id)?.name} (${f.error || 'échec'})`).join(' · ')}` : 'Votre système est optimisé.', 'performance')}`);
}

async function perfMaintenance(token, top) {
  page(`${top}<div id="mt"><div class="loading"><span class="spinner"></span></div></div>`);
  const tasks = overviewCache.performance?.tasks || await safe(() => pcm.v2.maintList(), 'Maintenance');
  if (!tasks || !alive(token)) return;
  $('#mt').innerHTML = `<div class="cards c3">${tasks.map((t) => `<label class="pick-card glass">
      <input type="checkbox" data-id="${t.id}" ${t.recommended ? 'checked' : ''}/>
      <div class="pc-ico g-performance">${ficon(TASK_ICONS[t.id] || 'wrench')}</div>
      <div class="pc-title">${esc(t.name)}</div>
      <div class="pc-sub">${esc(t.desc)}</div>
      <div class="pc-foot">${t.recommended ? '<span class="pill info">Recommandée</span>' : ''}${t.admin ? `<span class="pill warn">${icon('admin')} ${IS_LINUX ? 'Mot de passe' : 'Admin'}</span>` : ''}</div>
    </label>`).join('')}</div>
    <div class="action-bar"><span class="summary" id="mt-sel"></span><button class="btn-main" id="mt-run">Exécuter</button></div>`;
  const upd = () => { const n = $$('#mt input:checked').length; $('#mt-run').disabled = !n; $('#mt-sel').textContent = n ? plural(n, 'tâche sélectionnée', 'tâches sélectionnées') : 'Sélectionnez des tâches'; };
  $('#mt').addEventListener('change', upd);
  upd();
  $('#mt-run').onclick = () => runMaintenance(token, $$('#mt input:checked').map((c) => c.dataset.id), tasks, top);
}

async function perfStartup(token, top) {
  page(`${top}<div id="su"><div class="loading"><span class="spinner"></span></div></div>`);
  const items = await safe(() => pcm.apps.startup());
  if (!items || !alive(token)) return;
  const on = items.filter((i) => i.enabled).length;
  $('#su').innerHTML = items.length ? `<p class="small muted"><b>${on}</b> sur ${items.length} activée(s)</p><div class="cards c3">${items.map((it, i) => `<div class="pick-card glass static ${it.enabled ? '' : 'off'}">
    <div class="pc-ico plain">${fileIcon(it.exe, 'power')}</div>
    <label class="switch pc-corner"><input type="checkbox" data-i="${i}" ${it.enabled ? 'checked' : ''}/><span></span></label>
    <div class="pc-title">${esc(it.name.replace(/\.lnk$/i, ''))}</div>
    <div class="pc-sub" title="${esc(it.command)}">${esc(it.command)}</div>
    <div class="pc-foot"><span class="pill ${it.hive === 'HKLM' ? 'info' : 'ok'}">${IS_LINUX ? (it.hive === 'HKLM' ? 'Système' : 'Personnel') : (it.hive === 'HKLM' ? 'Tous les utilisateurs' : 'Utilisateur actuel')}</span></div></div>`).join('')}</div>`
    : `<div class="card glass empty">${icon('check')}<div>Aucune application au démarrage.</div></div>`;
  $$('#su input[data-i]').forEach((c) => (c.onchange = async () => {
    const it = items[Number(c.dataset.i)];
    const ok = await safe(() => pcm.apps.setStartup(it, c.checked), it.hive === 'HKLM' && !IS_LINUX ? 'Droits administrateur requis' : 'Erreur');
    if (ok) { toast(`${it.name} ${c.checked ? 'activée' : 'désactivée'} au démarrage`); c.closest('.pick-card').classList.toggle('off', !c.checked); delete overviewCache.performance; }
    else c.checked = !c.checked;
  }));
  loadIcons();
}

async function perfProcesses(token, top) {
  page(`${top}<div class="list-head"><input type="search" id="pr-q" placeholder="Rechercher" style="width:260px"/><div class="grow"></div><span class="muted small" id="pr-count"></span><button class="btn" id="pr-refresh">${icon('refresh')} Actualiser</button></div><div id="pr"><div class="loading"><span class="spinner"></span></div></div>`);
  let all = [];
  const render = () => {
    const q = $('#pr-q').value.toLowerCase();
    const list = all.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.desc || '').toLowerCase().includes(q)).slice(0, 60);
    const max = Math.max(...list.map((p) => p.memory), 1);
    $('#pr-count').textContent = `${list.length} processus · ${fmtBytes(list.reduce((a, p) => a + p.memory, 0))}`;
    $('#pr').innerHTML = `<div class="cards c3">${list.map((p, i) => `<div class="pick-card glass static">
      <div class="pc-ico plain">${fileIcon(p.icon || p.path, 'process')}</div>
      <div class="pc-title">${esc(p.desc)}</div>
      <div class="pc-sub">${esc(p.name)}${IS_LINUX ? '' : '.exe'}${p.ids.length > 1 ? ` · ${p.ids.length} instances` : ''}</div>
      <div class="bar" style="margin-top:4px"><div style="width:${Math.max(3, Math.round((p.memory / max) * 100))}%"></div></div>
      <div class="pc-foot"><b>${fmtBytes(p.memory)}</b><button class="btn" data-kill="${i}">Quitter</button></div></div>`).join('')}</div>`;
    $$('[data-kill]').forEach((b) => (b.onclick = async () => {
      const p = list[Number(b.dataset.kill)];
      if (!(await confirmBox('Quitter l\'application ?', `« ${p.desc} » sera fermée. Les données non enregistrées seront perdues.`, 'Quitter'))) return;
      if (await safe(() => pcm.apps.kill(p.ids, p.name, { force: true }))) { toast(`${p.desc} fermée`); delete overviewCache.performance; load(); }
    }));
    loadIcons();
  };
  const load = async () => { const r = await safe(() => pcm.apps.processes()); if (r && alive(token)) { all = r; render(); } };
  $('#pr-q').oninput = render;
  $('#pr-refresh').onclick = load;
  load();
}

async function perfNetwork(token, top) {
  page(`${top}${scanning('performance', 'Diagnostic du réseau…', 'Carte réseau, adresse IP, routeur, DNS et accès Internet')}`);
  const r = await safe(() => pcm.net.diagnose(), 'Diagnostic');
  if (!r || !alive(token)) return;
  const problems = r.checks.filter((c) => !c.ok);
  page(`${top}<div class="card glass" style="display:flex;align-items:center;gap:16px;margin-bottom:14px">
      <div class="status-ico ${problems.length ? 'warn' : 'ok'}">${icon(problems.length ? 'warn' : 'check')}</div>
      <div style="flex:1"><div class="big">${problems.length ? plural(problems.length, 'point à vérifier', 'points à vérifier') : 'Votre réseau fonctionne correctement'}</div>
      <div class="muted small">${r.latency !== null ? `Latence moyenne : ${r.latency} ms` : 'Internet injoignable'}</div></div>
      <button class="btn" data-go="performance/network">${icon('refresh')} Relancer</button></div>
    <div class="cards c3">${r.checks.map((c) => `<div class="pick-card glass static">
      <div class="status-ico ${c.ok ? 'ok' : c.warn ? 'warn' : 'bad'}">${icon(c.ok ? 'check' : c.warn ? 'warn' : 'x')}</div>
      <div class="pc-title">${esc(c.name)}</div><div class="pc-sub" style="white-space:normal">${esc(c.detail)}</div>
      ${c.fix ? `<div class="pc-foot"><button class="btn ${c.ok ? 'ghost' : 'primary'}" data-fix="${c.fix}">${c.ok ? 'Réinitialiser' : 'Réparer'}</button></div>` : ''}</div>`).join('')}</div>`);
  $$('[data-fix]').forEach((b) => (b.onclick = async () => {
    const id = b.dataset.fix;
    if (id === 'resetwinsock' && !(await confirmBox('Réinitialiser Winsock ?', 'Nécessite les droits administrateur et un redémarrage.', 'Réinitialiser'))) return;
    if (id === 'restartnm' && !(await confirmBox('Redémarrer NetworkManager ?', 'La connexion sera coupée quelques secondes. Votre mot de passe sera demandé.', 'Redémarrer'))) return;
    const msg = await safe(() => pcm.net.fix(id), 'Réparation');
    if (msg) { toast(msg); go('performance/network'); }
  }));
}

// ===================== Applications =====================
const APP_TABS = [['uninstall', 'Désinstallation'], ['leftovers', 'Restes'], ['updates', 'Mises à jour']];
let uninstallSort = 'name';

PAGES.applications = async (token, tab) => {
  if (tab === 'uninstall') return appsUninstall(token, detailHead('applications', APP_TABS, 'uninstall'));
  if (tab === 'leftovers') return appsLeftovers(token, detailHead('applications', APP_TABS, 'leftovers', 'Dossiers laissés par des applications qui ne sont plus installées et inutilisés depuis plus de 90 jours. Vérifiez la liste : ils iront dans la corbeille.'));
  if (tab === 'updates') return appsUpdates(token, detailHead('applications', APP_TABS, 'updates'));
  if (overviewCache.applications) return renderAppsOverview(token);
  page(intro('applications', {
    lead: 'Désinstallez les applications inutiles, supprimez leurs restes et ne manquez aucune mise à jour.',
    features: [
      ['apps', 'Désinstallation', IS_LINUX ? 'Paquets, Flatpak et Snap' : 'Programmes et Microsoft Store'],
      ['box', 'Restes', 'Dossiers d\'applications supprimées'],
      ['update', 'Mises à jour', 'Système et applications'],
    ],
  }));
  $('#scan').onclick = async () => {
    page(scanning('applications', 'Analyse des applications…', 'Applications installées, restes et mises à jour'));
    progressHandlers.leftovers = (p) => alive(token) && setScan(null, p.current);
    const [installed, leftovers, updates] = await Promise.all([
      pcm.apps.installed().catch(() => []),
      pcm.v2.leftovers().catch(() => []),
      pcm.protect.updates().catch(() => null),
    ]);
    if (!alive(token)) return;
    overviewCache.applications = { installed, leftovers, updates };
    renderAppsOverview(token);
  };
};

const appIconRef = (a) => {
  const ico = a.icon ? a.icon.split(',')[0].replace(/"/g, '') : null;
  return IS_LINUX ? ico : (ico && /\.(exe|ico|dll)$/i.test(ico) ? ico : null);
};

function renderAppsOverview(token) {
  const { installed, leftovers, updates } = overviewCache.applications;
  const total = installed.reduce((a, x) => a + (x.size || 0), 0);
  const heavy = [...installed].filter((a) => a.size).sort((a, b) => b.size - a.size);
  const loSize = leftovers.reduce((a, x) => a + x.size, 0);
  const upd = updates?.updates || [];
  const sec = upd.filter((u) => /sécurité|security/i.test(u.category || '')).length;
  const points = (leftovers.length ? 1 : 0) + (upd.length ? 1 : 0);
  page(overview('applications', {
    title: `${plural(installed.length, 'application installée', 'applications installées')}.`,
    sub: points ? 'Supprimez les restes d\'applications et installez les mises à jour.' : 'Vos applications sont à jour et sans restes.',
    all: ['applications/uninstall', 'Examiner toutes les applications'],
    cards: [
      ovCard({
        size: 'big',
        title: `${plural(installed.length, 'application', 'applications')}${total ? ` · ${fmtBytes(total)}` : ''}`,
        sub: 'Désinstallez celles que vous n\'utilisez plus.',
        art: artApps(heavy.map(appIconRef).filter(Boolean).length ? heavy.map(appIconRef).filter(Boolean) : [null, null, null]),
        actions: [{ label: 'Examiner', go: 'applications/uninstall' }],
      }),
      ovCard({
        size: 'wide',
        title: upd.length ? plural(upd.length, 'mise à jour disponible', 'mises à jour disponibles') : 'Tout est à jour',
        sub: upd.length ? `${sec ? `Dont ${sec} de sécurité. ` : ''}Installez-les pour corriger les failles et les bogues.` : (updates?.pendingReboot ? 'Un redémarrage est nécessaire pour terminer une mise à jour.' : 'Aucune mise à jour en attente.'),
        art: artTile('update'),
        actions: [{ label: 'Examiner', go: 'applications/updates' }],
      }),
      ovCard({
        title: leftovers.length ? `${plural(leftovers.length, 'reste', 'restes')} d'applications · ${fmtBytes(loSize)}` : 'Aucun reste d\'application',
        sub: 'Dossiers d\'applications désinstallées',
        art: artTile('box'),
        actions: leftovers.length ? [{ label: 'Examiner', go: 'applications/leftovers' }, { label: 'Supprimer', go: 'applications/leftovers', primary: true }] : [{ label: 'Examiner', go: 'applications/leftovers' }],
      }),
      ovCard({
        title: heavy[0] ? `${esc(heavy[0].name)} occupe ${fmtBytes(heavy[0].size)}` : 'Taille des applications inconnue',
        sub: 'Application la plus volumineuse',
        art: heavy[0] && appIconRef(heavy[0]) ? artApps([appIconRef(heavy[0])]) : artTile('apps'),
        actions: [{ label: 'Examiner', id: 'ov-heavy' }],
      }),
    ],
  }));
  loadIcons();
  $('#ov-heavy').onclick = () => { uninstallSort = 'size'; go('applications/uninstall'); };
}

async function appsUninstall(token, top) {
  page(`${top}<div class="list-head"><input type="search" id="un-q" placeholder="Rechercher une application" style="width:260px"/>
      <select id="un-sort"><option value="name">Nom</option><option value="size">Taille</option><option value="date">Date d'installation</option></select>
      <select id="un-type"><option value="">Toutes</option>${Object.entries(APP_TYPES).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>
      <div class="grow"></div><span class="muted small" id="un-count"></span></div>
    <div id="un"><div class="loading"><span class="spinner"></span>Lecture des applications…</div></div>`);
  $('#un-sort').value = uninstallSort;
  const all = overviewCache.applications?.installed || await safe(() => pcm.apps.installed());
  if (!all || !alive(token)) return;
  const render = () => {
    const q = $('#un-q').value.toLowerCase();
    const t = $('#un-type').value;
    const list = all.filter((a) => (!q || a.name.toLowerCase().includes(q) || (a.publisher || '').toLowerCase().includes(q)) && (!t || a.type === t));
    const s = (uninstallSort = $('#un-sort').value);
    if (s === 'size') list.sort((a, b) => (b.size || 0) - (a.size || 0));
    if (s === 'date') list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    $('#un-count').textContent = plural(list.length, 'application', 'applications');
    $('#un').innerHTML = `<div class="cards c3">${list.map((a, i) => `<div class="pick-card glass static">
        <div class="pc-ico plain">${fileIcon(appIconRef(a), 'apps')}</div>
        <div class="pc-title">${esc(a.name)}</div>
        <div class="pc-sub">${[a.publisher, a.version, a.type !== 'desktop' ? APP_TYPES[a.type] : ''].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</div>
        <div class="pc-foot"><span class="muted small">${[a.size ? fmtBytes(a.size) : '', a.date || ''].filter(Boolean).join(' · ')}</span><button class="btn" data-un="${i}">Désinstaller</button></div></div>`).join('')}</div>`;
    $$('[data-un]').forEach((b) => (b.onclick = async () => {
      const a = list[Number(b.dataset.un)];
      const how = { desktop: '\nLe programme de désinstallation va s\'ouvrir.', system: `\nLe paquet « ${a.pkg} » sera supprimé (mot de passe requis).`, snap: '\nMot de passe requis.', flatpak: '', user: '\nSeul le raccourci du menu sera supprimé.' }[a.type] || '';
      if (!(await confirmBox('Désinstaller ?', `« ${a.name} » va être désinstallée.${how}\nPensez ensuite à vérifier les restes d'applications.`, 'Désinstaller'))) return;
      b.disabled = true; b.innerHTML = '<span class="spinner"></span>';
      const r = await safe(() => pcm.apps.uninstall(a), 'Désinstallation');
      if (r) toast(r.finished ? `${a.name} a été désinstallée` : `Désinstallation de ${a.name} lancée`);
      if (r?.finished) { all.splice(all.indexOf(a), 1); render(); } else { b.disabled = false; b.textContent = 'Désinstaller'; }
    }));
    loadIcons();
  };
  $('#un-q').oninput = $('#un-sort').onchange = $('#un-type').onchange = render;
  render();
}

async function appsLeftovers(token, top) {
  let items = overviewCache.applications?.leftovers;
  if (!items) {
    page(`${top}${scanning('applications', 'Recherche des restes d\'applications…', 'Dossiers de configuration et de données sans application installée')}`);
    progressHandlers.leftovers = (p) => alive(token) && setScan(null, p.current);
    items = await safe(() => pcm.v2.leftovers(), 'Restes');
    if (!items || !alive(token)) return;
  }
  page(`${top}${items.length ? `<div class="cards c3" id="lo">${items.map((f) => `<label class="pick-card glass"><input type="checkbox" data-path="${esc(f.path)}" data-size="${f.size}"/>
      <div class="pc-ico g-applications">${ficon('box')}</div><div class="pc-title">${esc(f.name)}</div><div class="pc-sub" title="${esc(f.path)}">${esc(f.path)}</div>
      <div class="pc-foot"><b>${fmtBytes(f.size)}</b><span class="muted small">${fmtDate(f.mtime)}</span></div>
      <button class="btn ghost pc-corner" data-reveal="${esc(f.path)}" title="Afficher">${icon('folder')}</button></label>`).join('')}</div>${trashBar()}`
    : `<div class="card glass empty">${icon('check')}<div>Aucun reste d'application trouvé.</div></div>`}`);
  if (items.length) bindSelection($('#lo'), { onDone: () => { delete overviewCache.applications; go('applications/leftovers'); } });
}

async function appsUpdates(token, top) {
  let r = overviewCache.applications?.updates;
  if (!r) {
    page(`${top}${scanning('applications', 'Recherche des mises à jour…', 'Cela peut prendre une minute')}`);
    r = await safe(() => pcm.protect.updates(), UPDATES_NAME);
    if (!alive(token)) return;
    if (!r) return page(`${top}<div class="card glass empty">Impossible de vérifier les mises à jour.</div>`);
  }
  const groups = {};
  for (const u of r.updates) (groups[u.category || 'Système'] ||= []).push(u);
  page(`${top}<div class="card glass" style="display:flex;align-items:center;gap:16px;margin-bottom:6px">
      <div class="status-ico ${r.updates.length ? 'warn' : 'ok'}">${icon(r.updates.length ? 'update' : 'check')}</div>
      <div style="flex:1"><div class="big">${r.updates.length ? plural(r.updates.length, 'mise à jour disponible', 'mises à jour disponibles') : 'Tout est à jour'}</div>
      <div class="muted small">${r.pendingReboot ? 'Un redémarrage est nécessaire pour terminer une mise à jour.' : esc(IS_LINUX ? `Gestionnaire : ${r.manager || '–'}` : 'Windows Update')}</div></div></div>
    ${Object.entries(groups).map(([cat, list]) => `<h2>${esc(cat)} <span class="muted small">(${list.length})</span></h2><div class="cards c3">${list.slice(0, 120).map((u) => `<div class="pick-card glass static">
      <div class="pc-ico g-applications">${ficon(/sécurité/i.test(cat) ? 'shield' : 'update')}</div>
      <div class="pc-title">${esc(u.title)}</div><div class="pc-sub">${u.from ? `${esc(u.from)} → ` : ''}${esc(u.version || u.kb || '')}</div>
      ${u.size ? `<div class="pc-foot"><b>${fmtBytes(u.size)}</b></div>` : ''}</div>`).join('')}</div>`).join('')}
    ${r.updates.length ? `<div class="action-bar">${IS_LINUX ? '<button class="btn-main" id="upd-go">Tout mettre à jour</button>' : '<button class="btn-main" data-tool="windowsUpdate">Ouvrir Windows Update</button>'}</div>` : ''}`);
  $('#upd-go') && ($('#upd-go').onclick = async () => {
    if (!(await confirmBox('Installer les mises à jour ?', 'Les paquets du système, Snap et Flatpak vont être mis à jour. Votre mot de passe sera demandé.', 'Mettre à jour'))) return;
    page(`${top}${scanning('applications', 'Installation des mises à jour…', 'Ne fermez pas l\'application')}`);
    if (await safe(() => pcm.protect.installUpdates(), 'Mise à jour')) toast('Mises à jour installées');
    delete overviewCache.applications;
    if (alive(token)) go('applications/updates');
  });
}

// ===================== Clutter =====================
const CLUTTER_TABS = [['duplicates', 'Doublons'], ['similar', 'Images similaires'], ['large', 'Gros & anciens fichiers'], ['downloads', 'Téléchargements']];
const clutterRoots = {};
let downloadsFilter = '';

function rootPicker(key, def) {
  const root = clutterRoots[key] || def;
  return `<span class="muted small">Dossier :</span><b class="small">${esc(root)}</b><button class="btn" data-pick="${key}">${icon('folder')} Changer</button>`;
}
function bindRootPicker(key, route) {
  $$(`[data-pick="${key}"]`).forEach((b) => (b.onclick = async () => {
    const p = await pcm.storage.pickFolder();
    if (p) { clutterRoots[key] = p; delete (overviewCache.clutter || {})[key]; go(route); }
  }));
}

PAGES.clutter = async (token, tab) => {
  if (tab === 'duplicates') return clutterDuplicates(token, detailHead('clutter', CLUTTER_TABS, 'duplicates'));
  if (tab === 'similar') return clutterSimilar(token, detailHead('clutter', CLUTTER_TABS, 'similar'));
  if (tab === 'large') return clutterLarge(token, detailHead('clutter', CLUTTER_TABS, 'large'));
  if (tab === 'downloads') return clutterDownloads(token, detailHead('clutter', CLUTTER_TABS, 'downloads'));
  if (overviewCache.clutter?.done) return renderClutterOverview(token);
  page(intro('clutter', {
    lead: 'Retrouvez les doublons, les images similaires, les gros fichiers oubliés et les téléchargements qui encombrent votre disque.',
    features: [
      ['copy', 'Doublons', 'Fichiers identiques dans vos téléchargements'],
      ['image', 'Images similaires', 'Rafales et copies dans vos images'],
      ['file', 'Gros & anciens fichiers', 'Plus de 100 Mo, inutilisés depuis 6 mois'],
    ],
  }));
  $('#scan').onclick = async () => {
    page(scanning('clutter', 'Recherche des fichiers à trier…', '', { stop: true }));
    $('#scan-stop').onclick = () => { pcm.storage.cancel(); pcm.v2.similarCancel(); };
    progressHandlers.storage = (p) => alive(token) && setScan(`${p.dirs} dossiers analysés`, p.current);
    progressHandlers.similar = (p) => alive(token) && setScan(`${p.done} / ${p.total} images comparées`, p.current);
    // Duplicate and large-file scans share one cancellable walker: run them one after the other
    const downloads = await pcm.storage.downloads().catch(() => ({ dir: PATHS.downloads, items: [] }));
    const dups = await pcm.storage.duplicates({ root: clutterRoots.dup || downloads.dir }).catch(() => []);
    const similar = await pcm.v2.similarFind(clutterRoots.sim || PATHS.pictures).catch(() => ({ groups: [], scanned: 0 }));
    const large = await pcm.storage.large({ root: clutterRoots.large || PATHS.home, minSize: 100 * 1024 * 1024, olderThanDays: 180 }).catch(() => []);
    if (!alive(token)) return;
    overviewCache.clutter = { done: true, downloads, dups, similar, large, largeKey: `${clutterRoots.large || PATHS.home}|100|180` };
    renderClutterOverview(token);
  };
};

function renderClutterOverview(token) {
  const { downloads, dups, similar, large } = overviewCache.clutter;
  const dupCount = dups.reduce((a, g) => a + g.files.length - 1, 0);
  const dupWaste = dups.reduce((a, g) => a + g.size * (g.files.length - 1), 0);
  const simWaste = similar.groups.reduce((a, g) => a + g.waste, 0);
  const largeSize = large.reduce((a, f) => a + f.size, 0);
  const installers = downloads.items.filter((f) => f.type === 'Installateurs');
  const instSize = installers.reduce((a, f) => a + f.size, 0);
  const dlSize = downloads.items.reduce((a, f) => a + f.size, 0);
  const total = dupCount + similar.groups.reduce((a, g) => a + g.files.length - 1, 0) + large.length + downloads.items.length;
  const dupPreview = dups.flatMap((g) => g.files).filter((f) => /\.(jpe?g|png)$/i.test(f.name)).map((f) => f.path);
  page(overview('clutter', {
    title: total ? `Vous avez ${plural(total, 'fichier', 'fichiers')} à trier.` : 'Aucun fichier à trier.',
    sub: 'Suivez nos conseils rapides ou passez-les en revue manuellement.',
    all: ['clutter/large', 'Examiner tous les fichiers'],
    cards: [
      ovCard({
        size: 'big',
        title: dupCount ? `${plural(dupCount, 'doublon détecté', 'doublons détectés')}` : 'Aucun doublon',
        sub: dupCount ? `Supprimez ${fmtBytes(dupWaste)} de doublons dans vos téléchargements.` : 'Aucun fichier identique dans vos téléchargements.',
        art: dupPreview.length ? artThumbs(dupPreview) : artTrio(['file', 'copy', 'file']),
        actions: [{ label: 'Examiner', go: 'clutter/duplicates' }],
      }),
      ovCard({
        title: similar.groups.length ? `${plural(similar.groups.length, 'groupe', 'groupes')} d'images similaires` : 'Aucune image similaire',
        sub: similar.groups.length ? `${fmtBytes(simWaste)} récupérables` : `${similar.scanned || 0} images vérifiées`,
        art: similar.groups.length ? `<div class="ov-photo"><img data-thumb="${esc(similar.groups[0].files[0].path)}" alt=""/></div>` : artTile('image'),
        actions: [{ label: 'Examiner', go: 'clutter/similar' }],
      }),
      ovCard({
        title: large.length ? `${fmtBytes(largeSize)} de fichiers volumineux ou anciens détecté(s)` : 'Aucun gros fichier oublié',
        sub: large.length ? plural(large.length, 'fichier', 'fichiers') : 'Plus de 100 Mo, inutilisés depuis 6 mois',
        art: large[0] ? artApps([large[0].path], 'file') : artTile('file'),
        actions: [{ label: 'Examiner', go: 'clutter/large' }],
      }),
      ovCard({
        title: installers.length ? `${fmtBytes(instSize)} d'installateurs téléchargés` : 'Aucun installateur à supprimer',
        sub: installers.length ? 'Programmes déjà installés que vous pouvez supprimer' : '',
        art: installers[0] ? artApps([installers[0].path], 'download') : artTile('download'),
        actions: [{ label: 'Examiner', id: 'ov-installers' }],
      }),
      ovCard({
        title: `${fmtBytes(dlSize)} de téléchargements détecté(s)`,
        sub: `${plural(downloads.items.length, 'fichier', 'fichiers')} dans ${esc(downloads.dir)}`,
        art: artTile('folder'),
        actions: [{ label: 'Examiner', id: 'ov-downloads' }],
      }),
    ],
  }));
  loadIcons();
  loadThumbs(token);
  $('#ov-installers').onclick = () => { downloadsFilter = 'Installateurs'; go('clutter/downloads'); };
  $('#ov-downloads').onclick = () => { downloadsFilter = ''; go('clutter/downloads'); };
}

function renderDuplicates(token, top, groups) {
  const waste = groups.reduce((a, g) => a + g.size * (g.files.length - 1), 0);
  page(`${top}${groups.length ? `<div class="list-head"><span class="big" style="font-size:20px">${fmtBytes(waste)}</span><span class="muted">récupérables dans ${plural(groups.length, 'groupe', 'groupes')}</span><div class="grow"></div><button class="btn" id="dp-auto">Sélectionner les copies</button></div>
    <div id="dp">${groups.map((g) => `<div class="list glass dup-group" style="margin-bottom:10px"><div class="row" style="min-height:0"><b>${g.files.length} fichiers identiques · ${fmtBytes(g.size)} chacun</b></div>${fileRows(g.files, { showType: false })}</div>`).join('')}</div>${trashBar()}`
    : `<div class="card glass empty">${icon('check')}<div>Aucun doublon trouvé.</div></div>`}`);
  if (!groups.length) return;
  const upd = bindSelection($('#dp'), { onDone: () => { delete overviewCache.clutter; go('clutter/duplicates'); } });
  $('#dp-auto').onclick = () => { $$('.dup-group').forEach((g) => $$('input[data-path]', g).forEach((c, i) => (c.checked = i > 0))); upd(); };
  loadIcons();
}

async function clutterDuplicates(token, top) {
  if (overviewCache.clutter?.dups) return renderDuplicates(token, top, overviewCache.clutter.dups);
  const root = clutterRoots.dup || PATHS.downloads || PATHS.home;
  page(`${top}${intro('clutter', { title: 'Doublons', lead: `Trouvez les fichiers identiques (comparaison du contenu) dans <b>${esc(root)}</b>.`, extra: `<div class="list-head" style="justify-content:center;margin-bottom:22px">${rootPicker('dup', root)}</div>`, button: 'Rechercher' })}`);
  bindRootPicker('dup', 'clutter/duplicates');
  $('#scan').onclick = async () => {
    page(`${top}${scanning('clutter', 'Recherche des doublons…', '', { stop: true })}`);
    $('#scan-stop').onclick = () => pcm.storage.cancel();
    progressHandlers.storage = (p) => alive(token) && setScan(`${p.dirs} dossiers analysés`, p.current);
    const groups = await safe(() => pcm.storage.duplicates({ root }));
    if (!groups || !alive(token)) return;
    renderDuplicates(token, top, groups);
  };
}

function renderSimilar(token, top, r) {
  const waste = r.groups.reduce((a, g) => a + g.waste, 0);
  page(`${top}${r.groups.length ? `<div class="list-head"><span class="big" style="font-size:20px">${fmtBytes(waste)}</span><span class="muted">récupérables · ${plural(r.groups.length, 'groupe', 'groupes')} parmi ${r.scanned} images${r.truncated ? ' (limite atteinte)' : ''}</span></div>
    <div id="sim">${r.groups.map((g) => `<div class="sim-group glass"><div class="sim-grid">${g.files.map((f, i) => `<div class="sim-item">
      <input type="checkbox" data-path="${esc(f.path)}" data-size="${f.size}" ${i > 0 ? 'checked' : ''}/>${i === 0 ? '<span class="pill ok keep">Meilleure</span>' : ''}
      <img data-thumb="${esc(f.path)}" alt=""/><div class="sim-meta"><b title="${esc(f.path)}">${esc(f.name)}</b>${f.width}×${f.height} · ${fmtBytes(f.size)}</div></div>`).join('')}</div></div>`).join('')}</div>${trashBar()}`
    : `<div class="card glass empty">${icon('check')}<div>Aucune image similaire parmi ${r.scanned} images.</div></div>`}`);
  if (!r.groups.length) return;
  bindSelection($('#sim'), { onDone: () => { delete overviewCache.clutter; go('clutter/similar'); } });
  loadThumbs(token);
}

async function clutterSimilar(token, top) {
  if (overviewCache.clutter?.similar) return renderSimilar(token, top, overviewCache.clutter.similar);
  const root = clutterRoots.sim || PATHS.pictures;
  page(`${top}${intro('clutter', { title: 'Images similaires', lead: `Repérez les photos presque identiques (rafales, recadrages, copies compressées) dans <b>${esc(root)}</b>. La meilleure version est conservée.`, extra: `<div class="list-head" style="justify-content:center;margin-bottom:22px">${rootPicker('sim', PATHS.pictures)}</div>`, button: 'Rechercher' })}`);
  bindRootPicker('sim', 'clutter/similar');
  $('#scan').onclick = async () => {
    page(`${top}${scanning('clutter', 'Comparaison des images…', '', { pct: 0, stop: true })}`);
    $('#scan-stop').onclick = () => pcm.v2.similarCancel();
    progressHandlers.similar = (p) => {
      if (!alive(token)) return;
      const c = $('.ring-big circle:nth-of-type(2)');
      if (c && p.total) c.style.strokeDashoffset = c.getTotalLength() * (1 - p.done / p.total);
      setScan(`${p.done} / ${p.total} images`, p.current);
    };
    const r = await safe(() => pcm.v2.similarFind(root), 'Images similaires');
    if (!r || !alive(token)) return;
    renderSimilar(token, top, r);
  };
}

async function clutterLarge(token, top) {
  const root = clutterRoots.large || PATHS.home;
  const minMb = clutterRoots.largeMin || 100;
  const age = clutterRoots.largeAge ?? 180;
  page(`${top}<div class="list-head">${rootPicker('large', PATHS.home)}
      <select id="lg-min">${[50, 100, 500, 1024].map((m) => `<option value="${m}" ${m === minMb ? 'selected' : ''}>&gt; ${m >= 1024 ? '1 Go' : m + ' Mo'}</option>`).join('')}</select>
      <select id="lg-age">${[[0, 'Toutes dates'], [90, 'Non modifiés depuis 3 mois'], [180, 'depuis 6 mois'], [365, 'depuis 1 an']].map(([v, l]) => `<option value="${v}" ${v === age ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div id="lg">${scanning('clutter', 'Recherche des gros fichiers…', '', { stop: true })}</div>`);
  bindRootPicker('large', 'clutter/large');
  $('#lg-min').onchange = (e) => { clutterRoots.largeMin = Number(e.target.value); pcm.storage.cancel(); go('clutter/large'); };
  $('#lg-age').onchange = (e) => { clutterRoots.largeAge = Number(e.target.value); pcm.storage.cancel(); go('clutter/large'); };
  $('#scan-stop').onclick = () => pcm.storage.cancel();
  progressHandlers.storage = (p) => alive(token) && setScan(`${p.dirs} dossiers analysés`, p.current);
  const cached = overviewCache.clutter?.largeKey === `${root}|${minMb}|${age}` ? overviewCache.clutter.large : null;
  const items = cached || await safe(() => pcm.storage.large({ root, minSize: minMb * 1024 * 1024, olderThanDays: age }));
  if (!items || !alive(token)) return;
  $('#lg').innerHTML = items.length ? `<div class="list glass" id="lg-list">${fileRows(items)}</div>${trashBar()}` : `<div class="card glass empty">${icon('check')}<div>Aucun fichier correspondant.</div></div>`;
  if (items.length) { bindSelection($('#lg-list'), { onDone: () => { delete overviewCache.clutter; go('clutter/large'); } }); loadIcons(); }
}

async function clutterDownloads(token, top) {
  page(`${top}<div class="list-head"><select id="dl-sort"><option value="date">Plus récents</option><option value="size">Plus gros</option></select><select id="dl-type"><option value="">Tous les types</option></select></div><div id="dl"><div class="loading"><span class="spinner"></span></div></div>`);
  const r = await safe(() => pcm.storage.downloads());
  if (!r || !alive(token)) return;
  [...new Set(r.items.map((i) => i.type))].forEach((t) => $('#dl-type').insertAdjacentHTML('beforeend', `<option>${esc(t)}</option>`));
  if (downloadsFilter && [...$('#dl-type').options].some((o) => o.value === downloadsFilter)) { $('#dl-type').value = downloadsFilter; $('#dl-sort').value = 'size'; }
  const render = () => {
    let items = [...r.items];
    const t = (downloadsFilter = $('#dl-type').value);
    if (t) items = items.filter((i) => i.type === t);
    if ($('#dl-sort').value === 'size') items.sort((a, b) => b.size - a.size);
    $('#dl').innerHTML = items.length ? `<p class="small muted">${plural(items.length, 'fichier', 'fichiers')} · ${fmtBytes(items.reduce((a, i) => a + i.size, 0))} dans ${esc(r.dir)}</p><div class="list glass" id="dl-list">${fileRows(items)}</div>${trashBar()}`
      : `<div class="card glass empty">${icon('check')}<div>Aucun fichier téléchargé.</div></div>`;
    if (items.length) { bindSelection($('#dl-list'), { onDone: () => { delete overviewCache.clutter; go('clutter/downloads'); } }); loadIcons(); }
  };
  $('#dl-sort').onchange = $('#dl-type').onchange = render;
  render();
}

// ===================== Disk Map =====================
let lensData = null;
let lensPath = [];

PAGES.lens = async (token) => {
  if (lensData) return renderLens(token);
  page(intro('lens', {
    lead: 'Visualisez ce qui occupe votre disque sous forme de carte interactive. Cliquez sur un dossier pour l\'explorer, supprimez ce qui ne sert plus.',
    extra: `<div class="list-head" style="justify-content:center;margin-bottom:22px"><button class="btn" data-root="${esc(PATHS.home)}">${icon('home')} Dossier personnel</button>
      <button class="btn" data-root="${esc(PATHS.root)}">${icon('storage')} Disque entier</button><button class="btn" id="lens-pick">${icon('folder')} Autre dossier…</button></div>`,
    button: 'Analyser',
  }));
  let root = PATHS.home;
  const start = async (r) => {
    root = r;
    page(scanning('lens', 'Cartographie du disque…', root, { stop: true }));
    $('#scan-stop').onclick = () => pcm.v2.lensCancel();
    progressHandlers.lens = (p) => alive(token) && setScan(`${p.dirs} dossiers · ${p.files} fichiers`, p.current);
    const res = await safe(() => pcm.v2.lensScan(root), 'Carte du disque');
    if (!res || !alive(token)) return go('lens');
    lensData = res;
    lensPath = [res.tree];
    renderLens(token);
  };
  $$('[data-root]').forEach((b) => (b.onclick = () => start(b.dataset.root)));
  $('#lens-pick').onclick = async () => { const p = await pcm.storage.pickFolder(); if (p) start(p); };
  $('#scan').onclick = () => start(root);
};

// Squarified treemap: split the area into tiles with similar proportions.
function squarify(items, x, y, w, h) {
  const total = items.reduce((a, i) => a + i.size, 0);
  if (!total || w <= 0 || h <= 0) return [];
  const area = w * h;
  const nodes = items.map((i) => ({ item: i, a: (i.size / total) * area }));
  const out = [];
  let rect = { x, y, w, h };
  let row = [];
  const worst = (r, side) => {
    const s = r.reduce((a, n) => a + n.a, 0);
    const mx = Math.max(...r.map((n) => n.a)), mn = Math.min(...r.map((n) => n.a));
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  const layoutRow = (r) => {
    const s = r.reduce((a, n) => a + n.a, 0);
    if (rect.w >= rect.h) {
      const cw = s / rect.h; let cy = rect.y;
      for (const n of r) { const ch = n.a / cw; out.push({ ...n, x: rect.x, y: cy, w: cw, h: ch }); cy += ch; }
      rect = { x: rect.x + cw, y: rect.y, w: rect.w - cw, h: rect.h };
    } else {
      const ch = s / rect.w; let cx = rect.x;
      for (const n of r) { const cw = n.a / ch; out.push({ ...n, x: cx, y: rect.y, w: cw, h: ch }); cx += cw; }
      rect = { x: rect.x, y: rect.y + ch, w: rect.w, h: rect.h - ch };
    }
  };
  for (const n of nodes) {
    const side = Math.min(rect.w, rect.h);
    if (!row.length || worst([...row, n], side) <= worst(row, side)) row.push(n);
    else { layoutRow(row); row = [n]; }
  }
  if (row.length) layoutRow(row);
  return out;
}

// Disk Map colors: hand-picked gradients that work on the purple background.
const LENS_PALETTE = [
  ['#7C5CFF', '#B59BFF'], // lavender
  ['#FF4F9A', '#FF9CC9'], // pink
  ['#18B9C4', '#7EECDD'], // aqua
  ['#FF9F2E', '#FFD27A'], // amber
  ['#3D7DFF', '#8FC1FF'], // sky blue
  ['#B44CE0', '#E79BFF'], // orchid
  ['#1FBF74', '#93F2BF'], // mint
  ['#FF6A4D', '#FFB29E'], // coral
  ['#5865F2', '#A3ACFF'], // periwinkle
  ['#E83E8C', '#F7A1C4'], // raspberry
];
// Color files by type.
const LENS_TYPES = [
  ['Vidéos', /\.(mp4|mkv|mov|avi|webm|wmv|m4v|flv|mpe?g)$/i, LENS_PALETTE[1]],
  ['Images', /\.(jpe?g|png|gif|webp|heic|raw|psd|tiff?|bmp|svg)$/i, LENS_PALETTE[3]],
  ['Audio', /\.(mp3|flac|wav|ogg|m4a|aac|wma)$/i, LENS_PALETTE[5]],
  ['Archives', /\.(zip|rar|7z|tar|gz|xz|bz2|zst|iso|img|dmg)$/i, LENS_PALETTE[2]],
  ['Programmes', /\.(exe|msi|deb|rpm|appimage|apk|bin|run|dll|so|jar)$/i, LENS_PALETTE[4]],
  ['Documents', /\.(pdf|docx?|xlsx?|pptx?|odt|ods|txt|md|csv|epub)$/i, LENS_PALETTE[6]],
];
function lensColor(item, rank) {
  if (item.other) return null;
  if (item.dir) return LENS_PALETTE[rank % LENS_PALETTE.length];
  const t = LENS_TYPES.find(([, re]) => re.test(item.name));
  return t ? t[2] : LENS_PALETTE[8];
}
const grad = (c) => `linear-gradient(140deg, ${c[0]}, ${c[1]})`;

function renderLens(token) {
  const node = lensPath[lensPath.length - 1];
  const kids = (node.children || []).filter((c) => c.size > 0);
  let dirRank = 0;
  const colors = kids.map((c) => lensColor(c, c.dir ? dirRank++ : 0));
  const usedTypes = new Set(kids.filter((c) => !c.dir && !c.other).map((c) => (LENS_TYPES.find(([, re]) => re.test(c.name)) || ['Autres fichiers'])[0]));
  page(`${header('lens')}
    <div class="crumbs">${lensPath.map((n, i) => `<button class="crumb ${i === lensPath.length - 1 ? 'current' : ''}" data-crumb="${i}">${esc(i === 0 ? n.path : n.name)}</button>`).join('')}
      <div class="grow"></div><span class="muted small">${fmtBytes(node.size)} · ${node.files.toLocaleString('fr-FR')} fichiers</span><button class="btn" id="lens-new">${icon('refresh')} Nouvelle analyse</button></div>
    <div class="lens-wrap"><div><div class="treemap" id="tm"></div>
      <div class="tm-legend">${kids.some((c) => c.dir) ? `<span><i style="background:${grad(LENS_PALETTE[0])}"></i>Dossiers (cliquez pour explorer)</span>` : ''}
        ${LENS_TYPES.filter(([n]) => usedTypes.has(n)).map(([n, , c]) => `<span><i style="background:${grad(c)}"></i>${n}</span>`).join('')}
        ${usedTypes.has('Autres fichiers') ? `<span><i style="background:${grad(LENS_PALETTE[8])}"></i>Autres fichiers</span>` : ''}
        ${kids.some((c) => c.other) ? '<span><i class="tm-other-chip"></i>Petits éléments regroupés</span>' : ''}</div></div>
      <div class="list glass lens-list" id="lens-list">${kids.map((c, i) => `<div class="row">
        ${c.path && !c.other ? `<input type="checkbox" data-path="${esc(c.path)}" data-size="${c.size}"/>` : '<span style="width:19px"></span>'}
        <span class="lens-dot" style="background:${colors[i] ? grad(colors[i]) : 'var(--track)'}"></span>
        <div class="r-main"><div class="r-title" ${c.dir ? `data-open="${i}" style="cursor:pointer"` : ''}>${esc(c.name)}</div>
        <div class="bar lens-bar"><div style="width:${Math.max(2, Math.round((c.size / node.size) * 100))}%;${colors[i] ? `background:${grad(colors[i])}` : ''}"></div></div></div>
        <div class="r-meta"><b>${fmtBytes(c.size)}</b><div class="small">${Math.round((c.size / node.size) * 100)} %</div></div></div>`).join('')}</div></div>
    ${trashBar()}`);
  const tm = $('#tm');
  const W = tm.clientWidth, H = Math.max(440, tm.clientHeight);
  const GAP = 4;
  const tiles = squarify(kids, 0, 0, W, H);
  tm.innerHTML = tiles.map((t) => {
    const idx = kids.indexOf(t.item);
    const c = colors[idx];
    const x = t.x + GAP / 2, y = t.y + GAP / 2, w = Math.max(0, t.w - GAP), h = Math.max(0, t.h - GAP);
    const big = w > 150 && h > 90;
    const label = w > 64 && h > 40;
    // Show subfolders inside larger tiles (second level).
    let inner = '';
    if (t.item.dir && w > 170 && h > 140 && t.item.children?.length > 1) {
      const pad = 10, top = 46;
      inner = squarify(t.item.children.filter((s) => s.size > 0 && !s.other).slice(0, 16), pad, top, w - pad * 2, h - top - 30)
        .map((s) => `<span class="tm-sub" style="left:${s.x + 1.5}px;top:${s.y + 1.5}px;width:${Math.max(0, s.w - 3)}px;height:${Math.max(0, s.h - 3)}px">${s.w > 70 && s.h > 26 ? esc(s.item.name) : ''}</span>`).join('');
    }
    return `<div class="tm-cell ${t.item.dir ? 'dir' : 'file'} ${t.item.other ? 'other' : ''} ${big ? 'big' : ''}" data-tile="${idx}" title="${esc(t.item.name)} — ${fmtBytes(t.item.size)}"
      style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;${c ? `background:${grad(c)};--glow:${c[0]}` : ''}">
      ${label ? `<div class="tm-label">${t.item.dir ? icon('folder') : t.item.other ? '' : icon('file')}<span class="tm-name">${esc(t.item.name)}</span></div><span class="tm-size">${fmtBytes(t.item.size)}</span>` : ''}${inner}</div>`;
  }).join('');
  const open = (c) => { if (c?.dir && c.children?.length) { lensPath.push(c); renderLens(token); } };
  $$('[data-tile]').forEach((el) => (el.onclick = () => open(kids[Number(el.dataset.tile)])));
  $$('[data-open]').forEach((el) => (el.onclick = () => open(kids[Number(el.dataset.open)])));
  $$('[data-crumb]').forEach((b) => (b.onclick = () => { lensPath = lensPath.slice(0, Number(b.dataset.crumb) + 1); renderLens(token); }));
  $('#lens-new').onclick = () => { lensData = null; go('lens'); };
  bindSelection($('#lens-list'), {
    onDone: () => {
      // Remove deleted items from the map and recalculate parent folder sizes.
      const removed = new Set($$('#lens-list input[data-path]:checked').map((c) => c.dataset.path));
      const freed = node.children.filter((c) => removed.has(c.path)).reduce((a, c) => a + c.size, 0);
      node.children = node.children.filter((c) => !removed.has(c.path));
      for (const n of lensPath) n.size -= freed;
      renderLens(token);
    },
  });
}

// ===================== Cloud Cleanup =====================
PAGES.cloud = async (token) => {
  page(`${header('cloud', 'Faites le tri dans vos dossiers OneDrive, Dropbox, Google Drive ou Nextcloud synchronisés sur ce PC.')}<div id="cl"><div class="loading"><span class="spinner"></span>Recherche des dossiers cloud…</div></div>`);
  const folders = await safe(() => pcm.v2.cloudDetect(), 'Cloud');
  if (!folders || !alive(token)) return;
  if (!folders.length) {
    $('#cl').innerHTML = `<div class="intro"><div class="hero-icon">${micon('cloud')}</div><h1>Aucun dossier cloud détecté</h1>
      <p class="lead">Boost My Pc recherche les dossiers synchronisés de OneDrive, Dropbox, Google Drive, Nextcloud, ownCloud, pCloud, MEGA, iCloud Drive et Proton Drive dans votre dossier personnel.</p>
      <button class="btn" id="cl-pick">${icon('folder')} Choisir un dossier synchronisé</button></div>`;
    $('#cl-pick').onclick = async () => { const p = await pcm.storage.pickFolder(); if (p) analyzeCloud(token, { service: 'Dossier choisi', path: p }); };
    return;
  }
  $('#cl').innerHTML = `<div class="cards c3">${folders.map((f, i) => `<button class="result-card glass" style="border:1px solid var(--glass-border);cursor:pointer;text-align:left" data-cloud="${i}">
    <div class="rc-ico g-cloud">${micon('cloud')}</div><div class="rc-val">${esc(f.service)}</div><div class="rc-sub">${esc(f.path)}</div><span class="btn primary" style="align-self:flex-start">Analyser</span></button>`).join('')}</div>`;
  $$('[data-cloud]').forEach((b) => (b.onclick = () => analyzeCloud(token, folders[Number(b.dataset.cloud)])));
};

async function analyzeCloud(token, f) {
  page(scanning('cloud', `Analyse de ${f.service}…`, f.path, { stop: true }));
  $('#scan-stop').onclick = () => pcm.v2.cloudCancel();
  progressHandlers.cloud = (p) => alive(token) && setScan(`${p.count} fichiers analysés`, p.current);
  const r = await safe(() => pcm.v2.cloudAnalyze(f.path), 'Cloud');
  if (!r || !alive(token)) return;
  const section = (title, items) => (items.length ? `<h2>${title} <span class="muted small">(${items.length})</span></h2><div class="list glass">${fileRows(items, { showType: false })}</div>` : '');
  page(`${header('cloud')}
    <div class="card glass" style="display:flex;align-items:center;gap:16px;margin-bottom:6px">
      <div class="rc-ico g-cloud" style="width:52px;height:52px;border-radius:15px;display:flex;align-items:center;justify-content:center;color:#fff">${micon('cloud')}</div>
      <div style="flex:1"><div class="big">${fmtBytes(r.total)}</div><div class="muted small">${esc(f.service)} · ${plural(r.count, 'fichier', 'fichiers')} · ${esc(r.folder)}</div></div>
      <button class="btn" data-go="cloud">${icon('back')} Dossiers</button></div>
    <p class="small muted">Supprimer un fichier ici le supprime aussi du cloud lors de la prochaine synchronisation.${!IS_LINUX && /OneDrive/.test(f.service) ? ' « Libérer l\'espace local » garde le fichier en ligne et retire seulement la copie sur ce PC.' : ''}</p>
    <div id="cl-lists">${section('Gros fichiers (25 Mo et plus)', r.large)}${section('Fichiers anciens (non modifiés depuis 1 an)', r.old)}</div>
    ${r.large.length || r.old.length ? `<div class="action-bar" id="file-actions"><span class="summary sel"></span>
      ${!IS_LINUX && /OneDrive/.test(f.service) ? '<button class="btn" id="cl-free">Libérer l\'espace local</button>' : ''}<button class="btn-main del" disabled>Placer dans la corbeille</button></div>`
    : `<div class="card glass empty">${icon('check')}<div>Rien à trier dans ce dossier.</div></div>`}`);
  if (!r.large.length && !r.old.length) return;
  bindSelection($('#cl-lists'), { onDone: () => analyzeCloud(token, f), confirmText: 'Les fichiers iront dans la corbeille et seront aussi supprimés du cloud à la prochaine synchronisation.' });
  $('#cl-free') && ($('#cl-free').onclick = async () => {
    const paths = $$('#cl-lists input[data-path]:checked').map((c) => c.dataset.path);
    if (!paths.length) return toast('Sélectionnez des fichiers');
    const res = await safe(() => pcm.v2.cloudFreeUp(paths), 'OneDrive');
    if (res) toast(`${plural(res.done, 'fichier libéré', 'fichiers libérés')} localement (toujours disponibles en ligne)`);
  });
  loadIcons();
}

// ===================== Shredder =====================
let shredList = [];
PAGES.shredder = async (token) => {
  const render = () => {
    page(`${header('shredder', 'Supprimez définitivement des fichiers sensibles : ils sont écrasés par des données aléatoires avant d\'être effacés, sans passer par la corbeille.')}
      <div class="dropzone glass" id="dz">${icon('upload')}<h2 style="margin:10px 0 4px">Déposez des fichiers ou des dossiers ici</h2>
        <p class="muted small" style="margin:0 0 14px">ou</p><button class="btn" id="pick-files">${icon('file')} Choisir des fichiers</button> <button class="btn" id="pick-dir">${icon('folder')} Choisir un dossier</button></div>
      ${shredList.length ? `<h2>À broyer (${shredList.length})</h2><div class="list glass">${shredList.map((p, i) => `<div class="row"><div class="r-ico">${fileIcon(p)}</div>
        <div class="r-main"><div class="r-title">${esc(p.split(/[\\/]/).pop())}</div><div class="r-sub">${esc(p)}</div></div>
        <button class="btn ghost" data-rm="${i}">${icon('x')}</button></div>`).join('')}</div>` : ''}
      <p class="small muted" style="margin-top:14px">Sur un SSD, le contrôleur peut conserver d'anciennes copies des blocs : pour une sécurité maximale, utilisez aussi le chiffrement du disque.</p>
      <div class="action-bar"><select id="passes"><option value="1">1 passe (rapide)</option><option value="3">3 passes</option><option value="7">7 passes (lent)</option></select>
        <button class="btn-main" id="shred" ${shredList.length ? '' : 'disabled'}>Broyer</button></div>`);
    const dz = $('#dz');
    dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
    dz.ondragleave = () => dz.classList.remove('over');
    dz.ondrop = (e) => {
      e.preventDefault();
      dz.classList.remove('over');
      for (const f of e.dataTransfer.files) { const p = pcm.v2.filePath(f); if (p && !shredList.includes(p)) shredList.push(p); }
      render();
    };
    $('#pick-files').onclick = async () => { (await pcm.v2.pick({ files: true, title: 'Fichiers à broyer' })).forEach((p) => !shredList.includes(p) && shredList.push(p)); render(); };
    $('#pick-dir').onclick = async () => { (await pcm.v2.pick({ title: 'Dossier à broyer' })).forEach((p) => !shredList.includes(p) && shredList.push(p)); render(); };
    $$('[data-rm]').forEach((b) => (b.onclick = () => { shredList.splice(Number(b.dataset.rm), 1); render(); }));
    loadIcons();
    $('#shred').onclick = async () => {
      if (!(await confirmBox('Broyer définitivement ?', `${plural(shredList.length, 'élément sera détruit', 'éléments seront détruits')}. Cette action est irréversible : aucune récupération ne sera possible.`, 'Broyer'))) return;
      const passes = Number($('#passes').value);
      page(scanning('shredder', 'Broyage en cours…', ''));
      progressHandlers.shred = (p) => alive(token) && setScan(null, p.current);
      const r = await safe(() => pcm.v2.shred(shredList, { passes }), 'Broyeur');
      if (!alive(token)) return;
      shredList = [];
      if (!r) return render();
      page(doneView('shredder', `${plural(r.files, 'fichier broyé', 'fichiers broyés')}`, `${fmtBytes(r.bytes)} détruits${r.failed.length ? ` · non traités : ${r.failed.join(' ; ')}` : ''}`, 'shredder'));
    };
  };
  render();
};

// ===================== Tools =====================
const TOOLS = [
  ['screenshot', 'screenshot', 'Capture d\'écran', 'Capturer une zone de l\'écran'],
  ['screenshotFolder', 'folder', 'Dossier des captures', 'Ouvrir vos captures d\'écran'],
  ['snipping', 'image', 'Outil Capture', 'Captures, OCR et enregistrements'],
  ['calculator', 'calculator', 'Calculatrice', 'Calculs rapides'],
  ['notepad', 'notepad', 'Bloc-notes', 'Prendre des notes'],
  ['recorder', 'mic', 'Enregistreur vocal', 'Enregistrer de l\'audio'],
  ['captions', 'captions', 'Sous-titres en direct', 'Transcrire l\'audio en temps réel'],
  ['calendar', 'calendar', 'Calendrier', 'Vos rendez-vous'],
  ['terminal', 'task', 'Terminal', 'Ligne de commande'],
  ['files', 'folder', 'Fichiers', 'Gestionnaire de fichiers'],
  ['taskmgr', 'task', IS_LINUX ? 'Moniteur système' : 'Gestionnaire des tâches', 'Processus et ressources'],
  ['devmgmt', 'chip', 'Gestionnaire de périphériques', 'Pilotes et matériel'],
  ['hardware', 'chip', 'Informations matériel', 'Détails du matériel'],
  ['diskUsage', 'storage', 'Utilisation des disques', 'Analyseur du système'],
  ['disks', 'chip', 'Disques', 'Santé SMART et partitions'],
  ['software', 'download', 'Logithèque', 'Installer des applications'],
  ['translator', 'translate', 'Traducteur', 'Bing Traduction'],
  ['weather', 'weather', 'Météo', 'Prévisions locales'],
  ['display', 'screenshot', 'Affichage', 'Paramètres d\'écran'],
  ['power', 'power', 'Alimentation', 'Mise en veille et batterie'],
];

PAGES.tools = async (token) => {
  page(`${header('tools', 'Vos outils système, rassemblés au même endroit.')}
    <div class="cards c3" id="live"></div>
    <h2>Raccourcis</h2>
    <div class="cards c3">${TOOLS.filter(([id]) => CAPS.tools.includes(id)).map(([id, ic, t, s]) => `<button class="row glass" style="border-radius:18px;cursor:pointer;text-align:left" data-tool="${id}">
      <div class="r-ico tint">${ficon(ic)}</div><div class="r-main"><div class="r-title">${esc(t)}</div><div class="r-sub">${esc(s)}</div></div></button>`).join('')}</div>`);
  const refresh = async () => {
    const s = await pcm.system.stats().catch(() => null);
    if (!s || !alive(token) || !$('#live')) return;
    $('#live').innerHTML = `
      <div class="card glass" style="display:flex;align-items:center;gap:16px">${gauge(s.cpu)}<div><b>Processeur</b><div class="muted small">${s.load != null ? `Charge ${s.load.toFixed(2)}` : 'Utilisation'}</div></div></div>
      <div class="card glass" style="display:flex;align-items:center;gap:16px">${gauge(s.memory.percent)}<div><b>Mémoire</b><div class="muted small">${fmtBytes(s.memory.used)} / ${fmtBytes(s.memory.total)}</div></div></div>
      <div class="card glass"><b>Réseau</b><div class="muted small" style="margin-top:8px">↓ ${fmtBytes(s.net.down)}/s · ↑ ${fmtBytes(s.net.up)}/s</div>
        <button class="btn primary" style="margin-top:10px" id="boost">${icon('rocket')} Boost</button></div>`;
    $('#boost').onclick = async (e) => {
      e.currentTarget.disabled = true;
      const r = await safe(() => pcm.system.boost(), 'Boost');
      if (r) toast(`Boost terminé : ${fmtBytes(r.freed)} de mémoire libérée`);
    };
  };
  refresh();
  const timer = setInterval(() => (alive(token) ? refresh() : clearInterval(timer)), 3000);
};

// ===================== Settings =====================
PAGES.settings = async (token) => {
  const [p, info, admin] = await Promise.all([pcm.prefs.get(), pcm.system.info().catch(() => ({})), pcm.system.isAdmin().catch(() => false)]);
  if (!alive(token)) return;
  const row = (ic, title, sub, ctrl) => `<div class="row"><div class="r-ico tint">${ficon(ic)}</div><div class="r-main"><div class="r-title">${title}</div><div class="r-sub" style="white-space:normal">${sub}</div></div>${ctrl}</div>`;
  const sw = (id, on) => `<label class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}/><span></span></label>`;
  page(`${header('settings')}
    <div class="list glass">
      ${row('image', 'Thème', 'Apparence de l\'application', '<select id="s-theme"><option value="system">Système</option><option value="dark">Sombre</option><option value="light">Clair</option></select>')}
      ${row('sparkle', 'Effets visuels', 'Verre dépoli et animations. « Automatique » les désactive si la carte graphique n\'est pas accélérée.', '<select id="s-fx"><option value="auto">Automatique</option><option value="on">Activés</option><option value="off">Désactivés</option></select>')}
      ${row('power', 'Lancer à l\'ouverture de session', 'Boost My Pc démarre réduit dans la zone de notification', sw('s-startup', p.startup))}
      ${row('apps', 'Réduire dans la zone de notification', 'La fermeture de la fenêtre laisse l\'application active', sw('s-tray', p.minimizeToTray))}
      ${IS_LINUX ? `
      ${row('warn', 'Alertes', 'Mémoire saturée, disque plein, corbeille volumineuse, mises à jour de sécurité', sw('s-alerts', p.alerts !== false))}
      ${row('apps', 'Mini-panneau', 'Cliquez sur l\'icône de la barre supérieure, ou associez un raccourci clavier à <b>fastboost --mini</b>', '')}
      ${row('memory', 'Boost avancé', 'Vide aussi le cache de pages du noyau (mot de passe à chaque Boost)', sw('s-drop', p.boostDropCaches))}
      ${row('admin', 'Droits administrateur', 'Les actions système demandent votre mot de passe via polkit', `<span class="pill ${admin ? 'ok' : 'info'}">${admin ? 'root' : 'À la demande'}</span>`)}`
      : row('admin', 'Mode administrateur', admin ? 'Boost My Pc s\'exécute avec les droits administrateur' : 'Nécessaire pour certaines tâches système', admin ? '<span class="pill ok">Actif</span>' : '<button class="btn" id="s-admin">Redémarrer en administrateur</button>')}
    </div>
    <h2>Informations système</h2>
    <div class="card glass"><div class="kv">
      <div>Appareil</div><div>${esc(info.hostname)} · ${esc([info.maker, info.model].filter(Boolean).join(' '))}</div>
      <div>Système</div><div>${esc(info.os)} (${IS_LINUX ? 'noyau' : 'build'} ${esc(info.build)})</div>
      ${IS_LINUX ? `<div>Bureau</div><div>${esc([info.desktop, info.session].filter(Boolean).join(' · ') || '–')}</div>` : ''}
      <div>Processeur</div><div>${esc(info.cpu)} · ${info.cores} cœurs</div>
      <div>Mémoire</div><div>${fmtBytes(info.totalMem)}</div>
      <div>Carte graphique</div><div>${esc(info.gpu)}</div>
    </div></div>
    <h2>À propos</h2>
    <div class="card glass small muted">Boost My Pc 2.0.0 — interface inspirée de la palette de CleanMyMac et fonctions reconstruites à partir de l'analyse REA de Microsoft PC Manager. Projet indépendant, non affilié à Microsoft ni à MacPaw.</div>`);
  $('#s-theme').value = p.theme;
  $('#s-fx').value = p.effects || 'auto';
  $('#s-fx').onchange = async (e) => {
    await pcm.prefs.set({ effects: e.target.value });
    CAPS = await pcm.caps();
    document.body.classList.toggle('lite', !!CAPS.lite);
  };
  $('#s-theme').onchange = (e) => pcm.prefs.set({ theme: e.target.value });
  $('#s-startup').onchange = (e) => pcm.prefs.set({ startup: e.target.checked });
  $('#s-tray').onchange = (e) => pcm.prefs.set({ minimizeToTray: e.target.checked });
  $('#s-alerts') && ($('#s-alerts').onchange = (e) => pcm.prefs.set({ alerts: e.target.checked }));
  $('#s-drop') && ($('#s-drop').onchange = (e) => pcm.prefs.set({ boostDropCaches: e.target.checked }));
  $('#s-admin') && ($('#s-admin').onclick = () => safe(() => pcm.system.relaunchAdmin()));
};

// ===================== External actions (tray and mini panel) =====================
pcm.onAction((a) => {
  if (a === 'boost') { safe(() => pcm.system.boost()).then((r) => r && toast(`Boost terminé : ${fmtBytes(r.freed)} libérés`)); }
  else if (typeof a === 'string' && a.startsWith('go:')) go(a.slice(3));
});

// ===================== Startup =====================
(async () => {
  try { CAPS = await pcm.caps(); } catch {}
  try { PATHS = await pcm.v2.paths(); } catch {}
  document.body.classList.toggle('lite', !!CAPS.lite);
  $('#admin-badge').textContent = IS_LINUX ? 'root' : 'Administrateur';
  $('#admin-badge').classList.toggle('hidden', !CAPS.isAdmin);
  go('smart');
})();
