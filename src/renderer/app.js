/* global pcm, icon */
'use strict';

// ===================== Plateforme =====================
const IS_LINUX = pcm.platform === 'linux';
document.body.classList.add(IS_LINUX ? 'linux' : 'windows');
let CAPS = { platform: pcm.platform, tools: [], isAdmin: false };
const OS_NAME = IS_LINUX ? 'votre session' : 'Windows';
const UPDATES_NAME = IS_LINUX ? 'Mises à jour du système' : 'Windows Update';
const APP_TYPES = IS_LINUX
  ? { system: 'Paquets du système', flatpak: 'Flatpak', snap: 'Snap', user: 'Raccourcis personnels' }
  : { desktop: 'Bureau', store: 'Microsoft Store' };

// ===================== Utilitaires =====================
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
const fmtSpeed = (b) => `${fmtBytes(b)}/s`;
const fmtDate = (ms) => new Date(ms).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });

let toastTimer;
function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (error ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 4000);
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
    if (url) { img.src = url; img.classList.remove('hidden'); img.nextElementSibling?.classList.add('hidden'); }
  }
}
const fileIcon = (p, fallback = 'file') => p
  ? `<img data-file="${esc(p)}" class="hidden" alt="" />${icon(fallback)}`
  : icon(fallback);

function gauge(pct, size = 74, stroke = 7) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = pct >= 85 ? 'var(--bad)' : pct >= 70 ? '#e8a200' : 'var(--accent)';
  return `<div class="gauge" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="var(--track)" stroke-width="${stroke}" fill="none"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="${color}" stroke-width="${stroke}" fill="none" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}" style="transition:stroke-dashoffset .5s"/></svg>
    <div class="g-val">${pct}%</div></div>`;
}

function tile(ic, title, sub, onclick, id = '') {
  return `<button class="tile" ${id ? `id="${id}"` : ''} data-go="${esc(onclick)}"><div class="t-ico">${icon(ic)}</div>
    <div><div class="t-title">${esc(title)}</div><div class="t-sub">${sub}</div></div><div class="t-end">${icon('chevron')}</div></button>`;
}
// Tuile d'un outil externe : affichée seulement s'il existe sur ce système
function toolTile(id, ic, title, sub) {
  if (!CAPS.tools.includes(id)) return '';
  return `<button class="tile" data-tool="${id}"><div class="t-ico">${icon(ic)}</div><div><div class="t-title">${esc(title)}</div><div class="t-sub">${esc(sub)}</div></div><div class="t-end">${icon('external')}</div></button>`;
}
const toolSection = (title, tiles) => (tiles.join('') ? `<h2>${esc(title)}</h2><div class="grid g2">${tiles.join('')}</div>` : '');
const header = (title, back) => `<h1>${back ? `<button class="back" data-go="${back}">${icon('back')}</button>` : ''}${esc(title)}</h1>`;
const loading = (txt = 'Chargement…') => `<div class="loading"><span class="spinner"></span>${esc(txt)}</div>`;

// ===================== Navigation =====================
const PAGES = {};
let currentPage = 'home';
let pageToken = 0;
let liveTimer = null;

function go(page) {
  const top = page.split('/')[0];
  const mapTop = { health: 'home', deepclean: 'storage', large: 'storage', downloads: 'storage', duplicates: 'storage', processes: 'apps', startup: 'apps', uninstall: 'apps', updates: 'protection', network: 'protection' };
  const navKey = mapTop[top] || top;
  $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.page === navKey));
  currentPage = page;
  clearInterval(liveTimer);
  const token = ++pageToken;
  content.scrollTop = 0;
  (PAGES[top] || PAGES.home)(token);
}
const alive = (token) => token === pageToken;

document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-go]');
  if (g) { e.preventDefault(); go(g.dataset.go); }
});
$$('.nav-item').forEach((n) => { n.innerHTML = n.innerHTML.replace(/<span class="ico" data-icon="(\w+)"><\/span>/, (_m, k) => icon(k)); n.onclick = () => go(n.dataset.page); });

// ===================== Accueil =====================
const perfHist = { net: [] };
let lastHealth = null;

PAGES.home = async (token) => {
  content.innerHTML = `<div class="page">
    ${header('Accueil')}
    <div class="card hero">
      <div class="hero-stats">
        <div class="stat"><div class="val" id="h-mem">–<small>%</small></div><div class="lbl">Utilisation de la mémoire</div></div>
        <div class="stat"><div class="val" id="h-temp">–</div><div class="lbl">Fichiers temporaires</div></div>
      </div>
      <button class="boost-btn" id="boost">${icon('rocket')}<span>Boost</span></button>
    </div>
    <div id="boost-result"></div>

    <h2>Bilan de santé</h2>
    ${tile('heart', 'Bilan de santé', 'Recherchez les problèmes et optimisez votre PC en un clic', 'health')}

    <h2>Performances en temps réel</h2>
    <div class="grid g3">
      <div class="card meter-row"><div id="g-cpu">${gauge(0)}</div><div><div class="t-title">Processeur</div><div class="muted small" id="cpu-name">…</div></div></div>
      <div class="card meter-row"><div id="g-mem">${gauge(0)}</div><div><div class="t-title">Mémoire</div><div class="muted small" id="mem-detail">…</div></div></div>
      <div class="card"><div class="t-title" style="margin-bottom:8px">Réseau</div>
        <div class="small">↓ <b id="net-down">0 o/s</b> &nbsp; ↑ <b id="net-up">0 o/s</b></div>
        <svg class="chart" id="net-chart" viewBox="0 0 120 30" preserveAspectRatio="none"></svg></div>
    </div>

    <h2>Raccourcis</h2>
    <div class="grid g2">
      ${tile('process', 'Gestion des processus', 'Fermez les processus qui consomment trop de mémoire', 'processes')}
      ${tile('power', 'Applications au démarrage', `Accélérez le démarrage de ${IS_LINUX ? 'votre session' : 'Windows'}`, 'startup')}
      ${tile('broom', 'Nettoyage approfondi', 'Libérez de l\'espace disque', 'deepclean')}
      ${tile('wifi', 'Diagnostic réseau', 'Détectez et réparez les problèmes de connexion', 'network')}
    </div>
    <h2>Stockage</h2>
    <div class="grid g2" id="home-disks">${loading()}</div>
  </div>`;

  $('#boost').onclick = doBoost;
  pcm.system.info().then((i) => { if (alive(token)) $('#cpu-name').textContent = `${i.cpu} · ${i.cores} cœurs`; }).catch(() => {});

  const refresh = async () => {
    const s = await pcm.system.stats().catch(() => null);
    if (!s || !alive(token)) return;
    perfHist.net.push(s.net.down); if (perfHist.net.length > 60) perfHist.net.shift();
    $('#h-mem').innerHTML = `${s.memory.percent}<small>%</small>`;
    $('#g-cpu').innerHTML = gauge(s.cpu);
    $('#g-mem').innerHTML = gauge(s.memory.percent);
    $('#mem-detail').textContent = `${fmtBytes(s.memory.used)} / ${fmtBytes(s.memory.total)}`;
    $('#net-down').textContent = fmtSpeed(s.net.down);
    $('#net-up').textContent = fmtSpeed(s.net.up);
    const max = Math.max(...perfHist.net, 1024);
    const pts = perfHist.net.map((v, i) => `${(i / 59) * 120},${30 - (v / max) * 28}`).join(' ');
    $('#net-chart').innerHTML = `<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`;
  };
  refresh();
  liveTimer = setInterval(refresh, 2000);

  renderDisks('#home-disks', token);

  if (lastHealth) $('#h-temp').textContent = fmtBytes(lastHealth);
  else pcm.clean.scan('health').then((r) => {
    lastHealth = r.items.filter((i) => i.recommended).reduce((a, i) => a + i.size, 0);
    if (alive(token)) $('#h-temp').textContent = fmtBytes(lastHealth);
  }).catch(() => { if (alive(token)) $('#h-temp').textContent = '–'; });
};

async function renderDisks(sel, token) {
  const disks = await pcm.system.disks().catch(() => []);
  if (!alive(token)) return;
  $(sel).innerHTML = disks.map((d) => {
    const pct = Math.round(((d.size - d.free) / d.size) * 100);
    return `<div class="card disk"><div class="disk-head">${icon('storage')}<div><div class="t-title">${esc(d.label)} (${esc(d.id)})</div>
      <div class="muted small">${fmtBytes(d.free)} libres sur ${fmtBytes(d.size)} · ${esc(d.fs)}</div></div></div>
      <div class="bar ${pct > 90 ? 'bad' : pct > 75 ? 'warn' : ''}"><div style="width:${pct}%"></div></div></div>`;
  }).join('') || '<div class="muted">Aucun disque détecté</div>';
}

let boosting = false;
async function doBoost() {
  if (boosting) return;
  boosting = true;
  const btn = $('#boost');
  btn?.classList.add('busy');
  try {
    const [mem, scan] = await Promise.all([pcm.system.boost(), pcm.clean.scan('health')]);
    const tempId = IS_LINUX ? 'tmp' : 'temp';
    const temp = scan.items.find((i) => i.id === tempId);
    let cleaned = { freed: 0 };
    if (temp && temp.size > 0) cleaned = await pcm.clean.run([tempId]);
    lastHealth = null;
    const res = $('#boost-result');
    if (res) {
      const memTxt = IS_LINUX
        ? `Disques synchronisés · mémoire disponible : +${fmtBytes(mem.freed)}`
        : `Mémoire libérée : ${fmtBytes(mem.freed)} (${mem.processes} processus optimisés)`;
      res.innerHTML = `<div class="card result-banner" style="margin-top:12px"><div class="status-ico ok">${icon('check')}</div>
        <div><div class="t-title">Boost terminé</div><div class="muted small">${memTxt} · Fichiers temporaires supprimés : ${fmtBytes(cleaned.freed)}</div></div></div>`;
    }
    toast(`Boost terminé : ${fmtBytes(mem.freed + cleaned.freed)} libérés`);
    pcm.clean.scan('health').then((r) => { lastHealth = r.items.filter((i) => i.recommended).reduce((a, i) => a + i.size, 0); const el = $('#h-temp'); if (el) el.textContent = fmtBytes(lastHealth); });
  } catch (e) {
    toast('Boost : ' + e.message, true);
  } finally {
    boosting = false;
    $('#boost')?.classList.remove('busy');
  }
}
pcm.onAction((a) => {
  if (a === 'boost') { go('home'); setTimeout(doBoost, 300); }
  else if (typeof a === 'string' && a.startsWith('go:')) go(a.slice(3));
});

// ===================== Nettoyage (Bilan de santé / approfondi) =====================
let cleanProgress = null;
pcm.onProgress((p) => {
  if (p.channel === 'clean' && cleanProgress) cleanProgress(p);
  if (p.channel === 'storage' && storageProgress) storageProgress(p);
});

function cleanPage(scene, title, back) {
  return async (token) => {
    content.innerHTML = `<div class="page">${header(title, back)}
      <div class="card" id="scan-box"><div class="loading"><span class="spinner"></span><span id="scan-cur">Analyse en cours…</span></div><div class="progress-line"></div></div>
      <div id="scan-res"></div></div>`;
    cleanProgress = (p) => { const el = $('#scan-cur'); if (el && alive(token)) el.textContent = `Analyse : ${p.current} (${p.index + 1}/${p.total})`; };
    const r = await safe(() => pcm.clean.scan(scene), 'Analyse');
    cleanProgress = null;
    if (!r || !alive(token)) return;
    renderCleanResult(r, scene, title, back, token);
  };
}

function renderCleanResult(r, scene, title, back, token) {
  const total = r.items.reduce((a, i) => a + i.size, 0);
  const needAdmin = r.items.some((i) => i.needsAdmin);
  $('#scan-box').outerHTML = `<div class="card result-banner" id="scan-box">
    <div class="status-ico ${total > 0 ? 'warn' : 'ok'}">${icon(total > 0 ? 'broom' : 'check')}</div>
    <div style="flex:1"><div class="big">${fmtBytes(total)}</div><div class="muted small">peuvent être nettoyés</div></div>
    <div class="t-title" id="sel-size"></div>
    <button class="btn primary lg" id="do-clean">Nettoyer</button></div>
    ${needAdmin && !r.admin ? (IS_LINUX
      ? `<div class="card" style="margin-top:12px;display:flex;align-items:center;gap:12px"><div class="status-ico warn">${icon('admin')}</div>
      <div style="flex:1" class="small">Les éléments système (journaux, cache des paquets, rapports de plantage) demanderont votre mot de passe au moment du nettoyage.</div></div>`
      : `<div class="card" style="margin-top:12px;display:flex;align-items:center;gap:12px"><div class="status-ico warn">${icon('admin')}</div>
      <div style="flex:1" class="small">Certains éléments système nécessitent les droits administrateur pour être analysés et nettoyés.</div>
      <button class="btn" id="relaunch">Redémarrer en administrateur</button></div>`) : ''}`;
  const empty = (i) => i.size === 0 && !(i.countOnly && i.files);
  $('#scan-res').innerHTML = `<h2>Éléments</h2><div class="list">${r.items.map((i) => `
    <label class="row" style="cursor:pointer"><input type="checkbox" data-id="${i.id}" data-size="${i.size}" ${i.recommended && !empty(i) ? 'checked' : ''} ${empty(i) ? 'disabled' : ''}/>
      <div class="r-main"><div class="r-title">${esc(i.name)} ${i.recommended ? '<span class="pill info">Recommandé</span>' : ''}${i.needsAdmin && IS_LINUX ? ` <span class="pill warn">${icon('admin')} Mot de passe</span>` : ''}</div>
      <div class="r-sub">${esc(i.desc)}${i.needsAdmin && !IS_LINUX ? ' · certains emplacements nécessitent les droits admin' : ''}</div></div>
      <div class="r-meta">${i.countOnly ? `${i.files} élément(s)` : `${fmtBytes(i.size)}<div class="small muted">${i.files || 0} fichier(s)</div>`}</div></label>`).join('')}</div>`;

  const updateSel = () => {
    const sel = $$('#scan-res input:checked');
    const size = sel.reduce((a, c) => a + Number(c.dataset.size), 0);
    $('#sel-size').textContent = sel.length ? `Sélection : ${fmtBytes(size)}` : '';
    $('#do-clean').disabled = sel.length === 0;
  };
  $$('#scan-res input').forEach((c) => (c.onchange = updateSel));
  updateSel();
  $('#relaunch') && ($('#relaunch').onclick = () => safe(() => pcm.system.relaunchAdmin()));

  $('#do-clean').onclick = async () => {
    const ids = $$('#scan-res input:checked').map((c) => c.dataset.id);
    if ((ids.includes('recycle') || ids.includes('trash')) && !(await confirmBox('Vider la Corbeille ?', 'Les fichiers de la Corbeille seront supprimés définitivement.', 'Vider'))) return;
    $('#do-clean').disabled = true;
    $('#do-clean').innerHTML = '<span class="spinner"></span> Nettoyage…';
    cleanProgress = (p) => { const b = $('#do-clean'); if (b && alive(token)) b.innerHTML = `<span class="spinner"></span> ${esc(p.current)}`; };
    const res = await safe(() => pcm.clean.run(ids), 'Nettoyage');
    cleanProgress = null;
    if (!res || !alive(token)) return;
    lastHealth = null;
    $('#scan-box').outerHTML = `<div class="card result-banner" id="scan-box"><div class="status-ico ok">${icon('check')}</div>
      <div style="flex:1"><div class="big">${fmtBytes(res.freed)} libérés</div>
      <div class="muted small">${res.deleted} fichier(s) supprimé(s)${res.failed ? ` · ${res.failed} ignoré(s) car en cours d'utilisation` : ''}${res.adminCancelled ? ' · éléments système non nettoyés (authentification annulée)' : ''}</div></div>
      <button class="btn" data-go="${scene === 'health' ? 'health' : 'deepclean'}">${icon('refresh')} Analyser à nouveau</button></div>`;
    $('#scan-res').innerHTML = '';
  };
}

PAGES.health = cleanPage('health', 'Bilan de santé', 'home');
PAGES.deepclean = cleanPage('deep', 'Nettoyage approfondi', 'storage');

// ===================== Stockage =====================
let storageProgress = null;

PAGES.storage = async (token) => {
  content.innerHTML = `<div class="page">${header('Stockage')}
    <div class="grid g2" id="st-disks">${loading()}</div>
    <h2>Gestion du stockage</h2>
    <div class="grid g2">
      ${tile('broom', 'Nettoyage approfondi', 'Cache système, fichiers temporaires, mises à jour…', 'deepclean')}
      ${tile('file', 'Gérer les fichiers volumineux', 'Trouvez les fichiers qui occupent le plus d\'espace', 'large')}
      ${tile('download', 'Fichiers téléchargés', 'Triez et supprimez vos anciens téléchargements', 'downloads')}
      ${tile('copy', 'Fichiers en double', 'Repérez les fichiers identiques', 'duplicates')}
    </div>
    ${toolSection(IS_LINUX ? 'Outils du système' : 'Outils Windows', [
      toolTile('storageSense', 'storage', 'Assistant Stockage', 'Libérez de l\'espace automatiquement'),
      toolTile('cleanmgr', 'trash', 'Nettoyage de disque', 'Outil classique de Windows'),
      toolTile('diskUsage', 'storage', 'Analyseur d\'utilisation des disques', 'Visualisez ce qui occupe votre espace'),
      toolTile('disks', 'chip', 'Disques', 'Santé SMART, partitions et formatage'),
    ])}</div>`;
  renderDisks('#st-disks', token);
};

function fileRows(items, { showType = true } = {}) {
  return items.map((f) => `<div class="row">
    <input type="checkbox" data-path="${esc(f.path)}" data-size="${f.size}"/>
    <div class="r-ico">${fileIcon(f.path)}</div>
    <div class="r-main"><div class="r-title" title="${esc(f.path)}">${esc(f.name)}</div><div class="r-sub">${esc(f.path)}</div></div>
    ${showType ? `<div class="r-meta">${esc(f.type)}</div>` : ''}
    <div class="r-meta">${fmtDate(f.mtime)}</div>
    <div class="r-meta"><b>${fmtBytes(f.size)}</b></div>
    <div class="r-actions"><button class="btn subtle" data-reveal="${esc(f.path)}" title="Ouvrir l'emplacement">${icon('folder')}</button></div></div>`).join('');
}

function bindFileActions(root, onDeleted) {
  root.addEventListener('click', (e) => {
    const r = e.target.closest('[data-reveal]');
    if (r) pcm.file.reveal(r.dataset.reveal);
  });
  const bar = $('#file-actions');
  const upd = () => {
    const sel = $$('input[data-path]:checked', root);
    bar.querySelector('.sel').textContent = sel.length ? `${sel.length} sélectionné(s) · ${fmtBytes(sel.reduce((a, c) => a + Number(c.dataset.size), 0))}` : '';
    bar.querySelector('.del').disabled = !sel.length;
  };
  root.addEventListener('change', upd);
  bar.querySelector('.del').onclick = async () => {
    const paths = $$('input[data-path]:checked', root).map((c) => c.dataset.path);
    if (!(await confirmBox('Déplacer vers la Corbeille ?', `${paths.length} fichier(s) seront déplacés vers la Corbeille. Vous pourrez les restaurer.`, 'Supprimer'))) return;
    const r = await safe(() => pcm.file.trash(paths));
    if (!r) return;
    toast(`${r.done} fichier(s) déplacé(s) vers la Corbeille${r.failed ? `, ${r.failed} échec(s)` : ''}`);
    onDeleted();
  };
  upd();
  return upd;
}

const actionBar = (extra = '') => `<div class="list-head" id="file-actions">${extra}<div class="grow"></div><span class="sel muted small"></span><button class="btn danger del">${icon('trash')} Supprimer</button></div>`;

PAGES.large = async (token, opts = {}) => {
  const root = opts.root || (PAGES.large.root ??= null);
  const minMb = PAGES.large.min || 100;
  content.innerHTML = `<div class="page">${header('Fichiers volumineux', 'storage')}
    ${actionBar(`<span class="muted small">Dossier :</span><b class="small" id="lf-root">${esc(root || 'Dossier personnel')}</b>
      <button class="btn" id="lf-pick">${icon('folder')} Changer</button>
      <select id="lf-min">${[50, 100, 500, 1024].map((m) => `<option value="${m}" ${m === minMb ? 'selected' : ''}>&gt; ${m >= 1024 ? '1 Go' : m + ' Mo'}</option>`).join('')}</select>`)}
    <div id="lf-list"><div class="card"><div class="loading"><span class="spinner"></span><span id="lf-prog">Recherche des fichiers volumineux…</span><button class="btn" id="lf-cancel">Arrêter</button></div><div class="progress-line"></div></div></div></div>`;
  $('#lf-pick').onclick = async () => { const p = await pcm.storage.pickFolder(); if (p) { PAGES.large.root = p; go('large'); } };
  $('#lf-min').onchange = (e) => { PAGES.large.min = Number(e.target.value); pcm.storage.cancel(); go('large'); };
  $('#lf-cancel').onclick = () => pcm.storage.cancel();
  storageProgress = (p) => { const el = $('#lf-prog'); if (el && alive(token)) el.textContent = `${p.dirs} dossiers analysés · ${p.current}`; };
  const items = await safe(() => pcm.storage.large({ root: root || undefined, minSize: minMb * 1024 * 1024 }));
  storageProgress = null;
  if (!items || !alive(token)) return;
  $('#lf-list').innerHTML = items.length ? `<div class="list">${fileRows(items)}</div>` : `<div class="card empty">Aucun fichier de plus de ${minMb} Mo trouvé.</div>`;
  bindFileActions($('#lf-list'), () => go('large'));
  loadIcons();
};

PAGES.downloads = async (token) => {
  content.innerHTML = `<div class="page">${header('Fichiers téléchargés', 'storage')}
    ${actionBar('<select id="dl-sort"><option value="date">Trier par date</option><option value="size">Trier par taille</option></select><select id="dl-type"><option value="">Tous les types</option></select>')}
    <div id="dl-list">${loading()}</div></div>`;
  const r = await safe(() => pcm.storage.downloads());
  if (!r || !alive(token)) return;
  const types = [...new Set(r.items.map((i) => i.type))];
  $('#dl-type').innerHTML += types.map((t) => `<option>${esc(t)}</option>`).join('');
  const render = () => {
    let items = [...r.items];
    const t = $('#dl-type').value;
    if (t) items = items.filter((i) => i.type === t);
    if ($('#dl-sort').value === 'size') items.sort((a, b) => b.size - a.size);
    const total = items.reduce((a, i) => a + i.size, 0);
    $('#dl-list').innerHTML = items.length
      ? `<p class="muted small">${items.length} fichier(s) · ${fmtBytes(total)} dans ${esc(r.dir)}</p><div class="list">${fileRows(items)}</div>`
      : '<div class="card empty">Aucun fichier téléchargé.</div>';
    loadIcons();
    updSel?.();
  };
  let updSel = null;
  $('#dl-sort').onchange = $('#dl-type').onchange = render;
  render();
  updSel = bindFileActions($('#dl-list'), () => go('downloads'));
};

PAGES.duplicates = async (token) => {
  const root = PAGES.duplicates.root || null;
  content.innerHTML = `<div class="page">${header('Fichiers en double', 'storage')}
    ${actionBar(`<span class="muted small">Dossier :</span><b class="small">${esc(root || 'Dossier personnel')}</b><button class="btn" id="dp-pick">${icon('folder')} Changer</button>
      <button class="btn" id="dp-auto">Sélectionner les copies</button>`)}
    <div id="dp-list"><div class="card"><div class="loading"><span class="spinner"></span><span id="dp-prog">Recherche des doublons (fichiers &gt; 1 Mo)…</span><button class="btn" id="dp-cancel">Arrêter</button></div><div class="progress-line"></div></div></div></div>`;
  $('#dp-pick').onclick = async () => { const p = await pcm.storage.pickFolder(); if (p) { PAGES.duplicates.root = p; go('duplicates'); } };
  $('#dp-cancel').onclick = () => pcm.storage.cancel();
  storageProgress = (p) => { const el = $('#dp-prog'); if (el && alive(token)) el.textContent = `${p.dirs} dossiers analysés · ${p.current}`; };
  const groups = await safe(() => pcm.storage.duplicates({ root: root || undefined }));
  storageProgress = null;
  if (!groups || !alive(token)) return;
  const waste = groups.reduce((a, g) => a + g.size * (g.files.length - 1), 0);
  $('#dp-list').innerHTML = groups.length
    ? `<p class="muted small">${groups.length} groupe(s) de doublons · ${fmtBytes(waste)} récupérables</p>` +
      groups.map((g) => `<div class="list dup-group"><div class="dup-head">${g.files.length} fichiers identiques · ${fmtBytes(g.size)} chacun</div>${fileRows(g.files, { showType: false })}</div>`).join('')
    : '<div class="card empty">Aucun doublon trouvé.</div>';
  // Garde le plus ancien, sélectionne les copies
  $('#dp-auto').onclick = () => {
    $$('.dup-group').forEach((g) => $$('input[data-path]', g).forEach((c, i) => (c.checked = i > 0)));
    updSel();
  };
  const updSel = bindFileActions($('#dp-list'), () => go('duplicates'));
  loadIcons();
};

// ===================== Applications =====================
PAGES.apps = async () => {
  content.innerHTML = `<div class="page">${header('Applications')}
    <div class="grid g2">
      ${tile('process', 'Gestion des processus', 'Affichez et fermez les processus en cours', 'processes')}
      ${tile('power', 'Applications au démarrage', `Gérez les applications lancées avec ${OS_NAME}`, 'startup')}
      ${tile('apps', 'Gestion des applications', 'Désinstallez les applications inutilisées', 'uninstall')}
      ${toolTile('defaultApps', 'settings', 'Applications par défaut', 'Choisissez vos applications par défaut')}
    </div>
    ${toolSection('Outils', [
      toolTile('software', 'download', 'Logithèque', 'Installez de nouvelles applications'),
      toolTile('taskmgr', 'task', IS_LINUX ? 'Moniteur système' : 'Gestionnaire des tâches', 'Ressources et processus détaillés'),
    ])}</div>`;
};

PAGES.processes = async (token) => {
  content.innerHTML = `<div class="page">${header('Gestion des processus', 'apps')}
    <div class="list-head"><input type="search" id="pr-q" placeholder="Rechercher un processus" style="width:260px"/><div class="grow"></div>
      <span class="muted small" id="pr-count"></span><button class="btn" id="pr-refresh">${icon('refresh')} Actualiser</button></div>
    <div id="pr-list">${loading()}</div></div>`;
  let all = [];
  const render = () => {
    const q = $('#pr-q').value.toLowerCase();
    const list = all.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.desc || '').toLowerCase().includes(q));
    $('#pr-count').textContent = `${list.length} processus · ${fmtBytes(list.reduce((a, p) => a + p.memory, 0))}`;
    $('#pr-list').innerHTML = `<div class="list">${list.map((p, i) => `<div class="row">
      <div class="r-ico">${fileIcon(p.icon || p.path, 'process')}</div>
      <div class="r-main"><div class="r-title">${esc(p.desc)}</div><div class="r-sub">${esc(p.name)}${IS_LINUX ? '' : '.exe'}${p.ids.length > 1 ? ` · ${p.ids.length} instances` : ''}${p.hasWindow ? (IS_LINUX ? ' · application' : ' · fenêtre ouverte') : ''}${IS_LINUX && p.mine === false ? ' · système' : ''}</div></div>
      <div class="r-meta"><b>${fmtBytes(p.memory)}</b></div>
      <button class="btn" data-kill="${i}">Terminer</button></div>`).join('')}</div>`;
    $$('[data-kill]').forEach((b) => (b.onclick = async () => {
      const p = list[Number(b.dataset.kill)];
      if (!(await confirmBox('Terminer le processus ?', `« ${p.desc} » sera fermé. Les données non enregistrées seront perdues.`, 'Terminer'))) return;
      const ok = await safe(() => pcm.apps.kill(p.ids, p.name, { force: true }));
      if (ok) { toast(`${p.desc} terminé`); load(); }
    }));
    loadIcons();
  };
  const load = async () => {
    const r = await safe(() => pcm.apps.processes());
    if (!r || !alive(token)) return;
    all = r;
    render();
  };
  $('#pr-q').oninput = render;
  $('#pr-refresh').onclick = load;
  load();
};

PAGES.startup = async (token) => {
  content.innerHTML = `<div class="page">${header('Applications au démarrage', 'apps')}
    <p class="muted">Désactiver une application l'empêche de se lancer à l'ouverture de session, ce qui accélère le démarrage de ${OS_NAME}.</p>
    <div id="su-list">${loading()}</div></div>`;
  const load = async () => {
    const items = await safe(() => pcm.apps.startup());
    if (!items || !alive(token)) return;
    const on = items.filter((i) => i.enabled).length;
    $('#su-list').innerHTML = items.length ? `<p class="small"><b>${on}</b> application(s) activée(s) sur ${items.length}</p><div class="list">${items.map((it, i) => `<div class="row">
      <div class="r-ico">${fileIcon(it.exe, 'power')}</div>
      <div class="r-main"><div class="r-title">${esc(it.name.replace(/\.lnk$/i, ''))}</div><div class="r-sub" title="${esc(it.command)}">${esc(it.command)}</div></div>
      <span class="pill ${it.hive === 'HKLM' ? 'info' : 'ok'}">${IS_LINUX ? (it.hive === 'HKLM' ? 'Système' : 'Personnel') : (it.hive === 'HKLM' ? 'Tous les utilisateurs' : 'Utilisateur actuel')}</span>
      <label class="switch" title="${it.enabled ? 'Activée' : 'Désactivée'}"><input type="checkbox" data-i="${i}" ${it.enabled ? 'checked' : ''}/><span></span></label></div>`).join('')}</div>`
      : '<div class="card empty">Aucune application au démarrage.</div>';
    $$('#su-list input[data-i]').forEach((c) => (c.onchange = async () => {
      const it = items[Number(c.dataset.i)];
      const ok = await safe(() => pcm.apps.setStartup(it, c.checked), it.hive === 'HKLM' && !IS_LINUX ? 'Droits administrateur requis' : 'Erreur');
      if (ok) toast(`${it.name} ${c.checked ? 'activée' : 'désactivée'} au démarrage`);
      else c.checked = !c.checked;
    }));
    loadIcons();
  };
  load();
};

PAGES.uninstall = async (token) => {
  content.innerHTML = `<div class="page">${header('Gestion des applications', 'apps')}
    <div class="list-head"><input type="search" id="un-q" placeholder="Rechercher une application" style="width:260px"/>
      <select id="un-sort"><option value="name">Trier par nom</option><option value="size">Trier par taille</option><option value="date">Trier par date d'installation</option></select>
      <select id="un-type"><option value="">Toutes</option>${Object.entries(APP_TYPES).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>
      <div class="grow"></div><span class="muted small" id="un-count"></span></div>
    <div id="un-list">${loading('Lecture des applications installées…')}</div></div>`;
  const all = await safe(() => pcm.apps.installed());
  if (!all || !alive(token)) return;
  const render = () => {
    const q = $('#un-q').value.toLowerCase();
    const t = $('#un-type').value;
    let list = all.filter((a) => (!q || a.name.toLowerCase().includes(q) || (a.publisher || '').toLowerCase().includes(q)) && (!t || a.type === t));
    const s = $('#un-sort').value;
    if (s === 'size') list.sort((a, b) => (b.size || 0) - (a.size || 0));
    if (s === 'date') list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    $('#un-count').textContent = `${list.length} application(s)`;
    $('#un-list').innerHTML = `<div class="list">${list.map((a, i) => {
      const ico = a.icon ? a.icon.split(',')[0].replace(/"/g, '') : null;
      const iconRef = IS_LINUX ? ico : (ico && /\.(exe|ico|dll)$/i.test(ico) ? ico : null);
      const typeLbl = a.type === 'desktop' ? '' : APP_TYPES[a.type] || '';
      return `<div class="row"><div class="r-ico">${fileIcon(iconRef, 'apps')}</div>
      <div class="r-main"><div class="r-title">${esc(a.name)}</div><div class="r-sub">${[a.publisher, a.version, IS_LINUX && a.pkg && a.type === 'system' ? a.pkg : '', typeLbl].filter(Boolean).map(esc).join(' · ')}</div></div>
      <div class="r-meta">${a.size ? fmtBytes(a.size) : ''}</div><div class="r-meta">${a.date ? esc(a.date) : ''}</div>
      <button class="btn" data-un="${i}">Désinstaller</button></div>`;
    }).join('')}</div>`;
    $$('[data-un]').forEach((b) => (b.onclick = async () => {
      const a = list[Number(b.dataset.un)];
      const how = {
        desktop: '\nLe programme de désinstallation de l\'application va s\'ouvrir.',
        system: `\nLe paquet « ${a.pkg} » sera supprimé (mot de passe requis).`,
        snap: '\nLe snap sera supprimé (mot de passe requis).',
        flatpak: '\nL\'application Flatpak et ses données d\'exécution seront supprimées.',
        user: '\nSeul le raccourci du menu sera supprimé.',
      }[a.type] || '';
      if (!(await confirmBox('Désinstaller ?', `« ${a.name} » va être désinstallée.${how}`, 'Désinstaller'))) return;
      b.disabled = true; b.innerHTML = '<span class="spinner"></span>';
      const r = await safe(() => pcm.apps.uninstall(a), 'Désinstallation');
      if (r) toast(r.finished ? `${a.name} a été désinstallée` : `Désinstallation de ${a.name} lancée`);
      if (r?.finished) { all.splice(all.indexOf(a), 1); render(); } else { b.disabled = false; b.textContent = 'Désinstaller'; }
    }));
    loadIcons();
  };
  $('#un-q').oninput = $('#un-sort').onchange = $('#un-type').onchange = render;
  render();
};

// ===================== Protection =====================
PAGES.protection = async (token) => {
  content.innerHTML = `<div class="page">${header('Protection')}
    <div class="grid g3" id="sec-cards">${loading('Lecture de l\'état de sécurité…')}</div>
    <h2>Sécurité et mises à jour</h2>
    <div class="grid g2">
      ${tile('update', UPDATES_NAME, 'Recherchez les mises à jour disponibles', 'updates')}
      ${tile('wifi', 'Diagnostic réseau', 'Analysez et réparez votre connexion', 'network')}
      ${toolTile('windowsSecurity', 'shield', 'Sécurité Windows', 'Ouvrir le centre de sécurité')}
      ${toolTile('firewallSettings', 'firewall', 'Configuration du pare-feu', 'Règles et profils réseau')}
      ${toolTile('privacy', 'shield', 'Confidentialité', 'Paramètres de confidentialité du bureau')}
      ${toolTile('defaultApps', 'globe', 'Navigateur par défaut', 'Protégez votre navigateur par défaut')}
    </div></div>`;
  const s = await safe(() => pcm.protect.status());
  if (!s || !alive(token)) return;
  if (s.cards) return renderSecurityCards(s.cards, token);
  const d = s.defender;
  const fwAll = (s.firewall || []).length && s.firewall.every((f) => f.enabled);
  const defOk = d && d.enabled && d.realtime;
  $('#sec-cards').innerHTML = `
    <div class="card"><div class="meter-row"><div class="status-ico ${defOk ? 'ok' : 'bad'}">${icon('virus')}</div><div><div class="t-title">Protection antivirus</div>
      <div class="muted small">${d ? (defOk ? 'Microsoft Defender actif' : 'Protection en temps réel désactivée') : esc((s.antivirus || []).join(', ') || 'Inconnu')}</div></div></div>
      ${d ? `<div class="kv" style="margin-top:14px"><div>Signatures</div><div>${esc(d.signatureVersion)} (${d.signatureAge} j)</div><div>Dernière analyse</div><div>${d.lastQuickScan ? new Date(d.lastQuickScan).toLocaleString('fr-FR') : 'Jamais'}</div></div>
      <div style="display:flex;gap:8px;margin-top:14px"><button class="btn primary" id="qscan">Analyse rapide</button><button class="btn" id="sigup">Mettre à jour</button></div>` : ''}</div>
    <div class="card"><div class="meter-row"><div class="status-ico ${fwAll ? 'ok' : 'warn'}">${icon('firewall')}</div><div><div class="t-title">Pare-feu</div>
      <div class="muted small">${fwAll ? 'Activé sur tous les réseaux' : 'Désactivé sur certains profils'}</div></div></div>
      <div class="kv" style="margin-top:14px">${(s.firewall || []).map((f) => `<div>${esc(f.name)}</div><div><span class="pill ${f.enabled ? 'ok' : 'bad'}">${f.enabled ? 'Activé' : 'Désactivé'}</span></div>`).join('')}</div></div>
    <div class="card"><div class="meter-row"><div class="status-ico ${d?.tamper ? 'ok' : 'warn'}">${icon('shield')}</div><div><div class="t-title">Protection contre la falsification</div>
      <div class="muted small">${d?.tamper ? 'Activée' : 'Désactivée ou inconnue'}</div></div></div>
      <p class="small muted" style="margin-top:14px">Empêche les applications malveillantes de modifier les paramètres de sécurité.</p></div>`;
  $('#qscan') && ($('#qscan').onclick = async (e) => {
    e.target.disabled = true; e.target.innerHTML = '<span class="spinner"></span> Analyse…';
    const ok = await safe(() => pcm.protect.quickScan(), 'Analyse');
    if (ok) toast('Analyse rapide terminée, aucune menace active signalée par Defender.');
    if (alive(token)) go('protection');
  });
  $('#sigup') && ($('#sigup').onclick = async (e) => {
    e.target.disabled = true; e.target.innerHTML = '<span class="spinner"></span>';
    const ok = await safe(() => pcm.protect.updateSignatures(), 'Mise à jour');
    if (ok) toast('Signatures à jour');
    if (alive(token)) go('protection');
  });
};

// Cartes de sécurité génériques (Linux) : { icon, title, ok, warn, status, details, actions }
function renderSecurityCards(cards, token) {
  $('#sec-cards').innerHTML = cards.map((c) => `<div class="card">
    <div class="meter-row"><div class="status-ico ${c.ok ? (c.warn ? 'warn' : 'ok') : 'bad'}">${icon(c.icon)}</div>
      <div><div class="t-title">${esc(c.title)}</div><div class="muted small">${esc(c.status)}</div></div></div>
    ${c.details?.length ? `<div class="kv" style="margin-top:14px;grid-template-columns:130px 1fr">${c.details.map(([k, v]) => `<div>${esc(k)}</div><div>${esc(v)}</div>`).join('')}</div>` : ''}
    ${c.actions?.length ? `<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">${c.actions.map((a) => `<button class="btn ${a.primary ? 'primary' : ''}" data-sec="${a.id}">${esc(a.label)}</button>`).join('')}</div>` : ''}
  </div>`).join('');
  $$('[data-sec]').forEach((b) => (b.onclick = async () => {
    const label = b.textContent;
    b.disabled = true; b.innerHTML = '<span class="spinner"></span> En cours…';
    const msg = await safe(() => pcm.protect.action(b.dataset.sec), label);
    if (msg) {
      if (msg.includes('\n')) await confirmBox(label, msg, 'OK'); else toast(msg);
    }
    if (alive(token)) go('protection');
  }));
}

PAGES.updates = async (token) => {
  content.innerHTML = `<div class="page">${header(UPDATES_NAME, 'protection')}
    <div class="card"><div class="loading"><span class="spinner"></span>Recherche des mises à jour (cela peut prendre une minute)…</div><div class="progress-line"></div></div></div>`;
  const r = await safe(() => pcm.protect.updates(), UPDATES_NAME);
  if (!alive(token)) return;
  if (IS_LINUX && r) return renderLinuxUpdates(r, token);
  const page = $('.page');
  if (!r) {
    page.innerHTML = header(UPDATES_NAME, 'protection') + (IS_LINUX
      ? `<div class="card empty">Impossible de vérifier les mises à jour.<br><br>${toolTile('softwareUpdates', 'download', '', '') ? '<button class="btn primary" data-tool="softwareUpdates">Ouvrir la logithèque</button>' : ''}</div>`
      : `<div class="card empty">Impossible de contacter Windows Update.<br><br><button class="btn primary" data-tool="windowsUpdate">Ouvrir Windows Update</button></div>`);
    return;
  }
  page.innerHTML = header('Windows Update', 'protection') + `
    <div class="card result-banner"><div class="status-ico ${r.updates.length ? 'warn' : 'ok'}">${icon(r.updates.length ? 'update' : 'check')}</div>
      <div style="flex:1"><div class="big">${r.updates.length ? `${r.updates.length} mise(s) à jour disponible(s)` : 'Votre PC est à jour'}</div>
      <div class="muted small">${r.pendingReboot ? 'Un redémarrage est nécessaire pour terminer l\'installation.' : 'Dernière vérification : à l\'instant'}</div></div>
      <button class="btn primary" data-tool="windowsUpdate">${icon('external')} Installer via Windows Update</button></div>
    ${r.updates.length ? `<h2>Mises à jour</h2><div class="list">${r.updates.map((u) => `<div class="row"><div class="r-ico">${icon('update')}</div>
      <div class="r-main"><div class="r-title">${esc(u.title)}</div><div class="r-sub">${esc(u.category || '')}${u.kb ? ' · KB' + esc(u.kb) : ''}${u.reboot ? ' · redémarrage requis' : ''}</div></div>
      <div class="r-meta">${u.size ? fmtBytes(u.size) : ''}</div></div>`).join('')}</div>` : ''}`;
};

function renderLinuxUpdates(r, token) {
  const groups = {};
  for (const u of r.updates) (groups[u.category] ||= []).push(u);
  const security = (groups['Sécurité'] || []).length;
  $('.page').innerHTML = header(UPDATES_NAME, 'protection') + `
    <div class="card result-banner"><div class="status-ico ${r.updates.length ? 'warn' : 'ok'}">${icon(r.updates.length ? 'update' : 'check')}</div>
      <div style="flex:1"><div class="big">${r.updates.length ? `${r.updates.length} mise(s) à jour disponible(s)` : 'Votre système est à jour'}</div>
      <div class="muted small">${r.pendingReboot ? 'Un redémarrage est nécessaire pour terminer une mise à jour.' : `Gestionnaire : ${esc(r.manager || '–')}${security ? ` · ${security} mise(s) à jour de sécurité` : ''}`}</div></div>
      ${r.updates.length ? `<button class="btn primary lg" id="upd-install">Tout mettre à jour</button>` : ''}
      ${toolTile('softwareUpdates', 'download', '', '') ? `<button class="btn" data-tool="softwareUpdates">${icon('external')} Logithèque</button>` : ''}</div>
    ${Object.entries(groups).map(([cat, list]) => `<h2>${esc(cat)} <span class="muted small">(${list.length})</span></h2><div class="list">${list.slice(0, 200).map((u) => `<div class="row">
      <div class="r-ico">${icon(cat === 'Sécurité' ? 'shield' : 'update')}</div>
      <div class="r-main"><div class="r-title">${esc(u.title)}</div><div class="r-sub">${u.from ? `${esc(u.from)} → ` : ''}${esc(u.version || '')}</div></div></div>`).join('')}${list.length > 200 ? `<div class="row muted small">… et ${list.length - 200} autres</div>` : ''}</div>`).join('')}`;
  $('#upd-install') && ($('#upd-install').onclick = async (e) => {
    if (!(await confirmBox('Installer les mises à jour ?', 'Les paquets du système, Snap et Flatpak vont être mis à jour. Votre mot de passe sera demandé ; l\'opération peut durer plusieurs minutes.', 'Mettre à jour'))) return;
    e.target.disabled = true; e.target.innerHTML = '<span class="spinner"></span> Installation…';
    const ok = await safe(() => pcm.protect.installUpdates(), 'Mise à jour');
    if (ok) toast('Mises à jour installées');
    if (alive(token)) go('updates');
  });
}

PAGES.network = async (token) => {
  content.innerHTML = `<div class="page">${header('Diagnostic réseau', 'protection')}
    <div class="card"><div class="loading"><span class="spinner"></span>Analyse de la connexion réseau…</div><div class="progress-line"></div></div></div>`;
  const r = await safe(() => pcm.net.diagnose(), 'Diagnostic');
  if (!r || !alive(token)) return;
  const problems = r.checks.filter((c) => !c.ok);
  $('.page').innerHTML = header('Diagnostic réseau', 'protection') + `
    <div class="card result-banner"><div class="status-ico ${problems.length ? 'warn' : 'ok'}">${icon(problems.length ? 'warn' : 'check')}</div>
      <div style="flex:1"><div class="big">${problems.length ? `${problems.length} point(s) à vérifier` : 'Votre réseau fonctionne correctement'}</div>
      <div class="muted small">${r.latency !== null ? `Latence moyenne : ${r.latency} ms` : 'Internet injoignable'}</div></div>
      <button class="btn" data-go="network">${icon('refresh')} Relancer</button></div>
    <h2>Résultats</h2>
    <div class="list">${r.checks.map((c) => `<div class="row"><div class="status-ico ${c.ok ? 'ok' : c.warn ? 'warn' : 'bad'}">${icon(c.ok ? 'check' : c.warn ? 'warn' : 'x')}</div>
      <div class="r-main"><div class="r-title">${esc(c.name)}</div><div class="r-sub">${esc(c.detail)}</div></div>
      ${c.fix ? `<button class="btn ${c.ok ? 'subtle' : 'primary'}" data-fix="${c.fix}">${c.ok ? 'Réinitialiser' : 'Réparer'}</button>` : ''}</div>`).join('')}</div>
    <h2>Outils</h2><div class="grid g2">
      <button class="tile" data-fixtile="flushdns"><div class="t-ico">${icon('refresh')}</div><div><div class="t-title">Vider le cache DNS</div><div class="t-sub">Résout certains sites inaccessibles</div></div></button>
      ${toolTile('networkSettings', 'wifi', 'Paramètres réseau', 'Ouvrir les paramètres du système')}</div>`;
  $$('[data-fix],[data-fixtile]').forEach((b) => (b.onclick = async () => {
    const id = b.dataset.fix || b.dataset.fixtile;
    if (id === 'resetwinsock' && !(await confirmBox('Réinitialiser Winsock ?', 'Cette opération nécessite les droits administrateur et un redémarrage.', 'Réinitialiser'))) return;
    if (id === 'restartnm' && !(await confirmBox('Redémarrer NetworkManager ?', 'La connexion sera coupée quelques secondes. Votre mot de passe sera demandé.', 'Redémarrer'))) return;
    const msg = await safe(() => pcm.net.fix(id), 'Réparation');
    if (msg) { toast(msg); if (b.dataset.fix) go('network'); }
  }));
};

// ===================== Boîte à outils =====================
const TOOLS = [
  ['screenshot', 'screenshot', 'Capture d\'écran', 'Capturer une zone de l\'écran'],
  ['screenshotFolder', 'folder', 'Dossier des captures', 'Ouvrir vos captures d\'écran'],
  ['snipping', 'image', 'Outil Capture', 'Captures, OCR et enregistrements'],
  ['calculator', 'calculator', 'Calculatrice', 'Calculs rapides'],
  ['notepad', 'notepad', 'Bloc-notes', 'Prendre des notes'],
  ['recorder', 'mic', 'Enregistreur vocal', 'Enregistrer de l\'audio'],
  ['captions', 'captions', 'Sous-titres en direct', 'Transcrire l\'audio en temps réel'],
  ['calendar', 'calendar', 'Calendrier', 'Vos rendez-vous'],
  ['translator', 'translate', 'Traducteur', 'Bing Traduction'],
  ['currency', 'currency', 'Convertisseur de devises', 'Taux de change'],
  ['dictionary', 'book', 'Dictionnaire', 'Définitions'],
  ['imageSearch', 'search', 'Recherche d\'image', 'Recherche visuelle Bing'],
  ['weather', 'weather', 'Météo', 'Prévisions locales'],
  ['edge', 'edge', 'Microsoft Edge', 'Ouvrir le navigateur'],
  ['terminal', 'task', 'Terminal', 'Ligne de commande'],
  ['files', 'folder', 'Fichiers', 'Gestionnaire de fichiers'],
  ['taskmgr', 'task', 'Gestionnaire des tâches', 'Outil Windows', 'Moniteur système', 'Processus et ressources'],
  ['devmgmt', 'chip', 'Gestionnaire de périphériques', 'Pilotes et matériel'],
  ['hardware', 'chip', 'Informations matériel', 'Détails du matériel'],
  ['diskUsage', 'storage', 'Utilisation des disques', 'Ce qui occupe votre espace'],
  ['software', 'download', 'Logithèque', 'Installer des applications'],
  ['display', 'screenshot', 'Affichage', 'Paramètres d\'écran'],
  ['power', 'power', 'Alimentation', 'Mise en veille et batterie'],
];
PAGES.toolbox = async () => {
  const list = TOOLS.filter(([id]) => CAPS.tools.includes(id));
  content.innerHTML = `<div class="page">${header('Boîte à outils')}
    <div class="grid g3">${list.map(([id, ic, t, s, lt, ls]) => `<button class="tile" data-tool="${id}"><div class="t-ico">${icon(ic)}</div><div><div class="t-title">${esc(IS_LINUX && lt ? lt : t)}</div><div class="t-sub">${esc(IS_LINUX && ls ? ls : s)}</div></div></button>`).join('')}</div>
    ${IS_LINUX ? `<p class="muted small" style="margin-top:18px">Les outils affichés dépendent des applications installées sur votre bureau (${esc(CAPS.desktop || 'Linux')}).</p>` : ''}</div>`;
};
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tool]');
  if (t) safe(() => pcm.tool.launch(t.dataset.tool), 'Outil');
});

// ===================== Paramètres =====================
PAGES.settings = async (token) => {
  const [p, info, admin] = await Promise.all([pcm.prefs.get(), pcm.system.info().catch(() => ({})), pcm.system.isAdmin().catch(() => false)]);
  if (!alive(token)) return;
  content.innerHTML = `<div class="page">${header('Paramètres')}
    <div class="list">
      <div class="row"><div class="r-ico">${icon('image')}</div><div class="r-main"><div class="r-title">Thème</div><div class="r-sub">Apparence de l'application</div></div>
        <select id="s-theme"><option value="system">Système</option><option value="light">Clair</option><option value="dark">Sombre</option></select></div>
      <div class="row"><div class="r-ico">${icon('power')}</div><div class="r-main"><div class="r-title">Lancer à l'ouverture de session</div><div class="r-sub">FastBoost démarre réduit dans la zone de notification</div></div>
        <label class="switch"><input type="checkbox" id="s-startup" ${p.startup ? 'checked' : ''}/><span></span></label></div>
      <div class="row"><div class="r-ico">${icon('apps')}</div><div class="r-main"><div class="r-title">Réduire dans la zone de notification</div><div class="r-sub">La fermeture de la fenêtre laisse l'application active</div></div>
        <label class="switch"><input type="checkbox" id="s-tray" ${p.minimizeToTray ? 'checked' : ''}/><span></span></label></div>
      ${IS_LINUX ? `
      <div class="row"><div class="r-ico">${icon('warn')}</div><div class="r-main"><div class="r-title">Alertes</div><div class="r-sub">Notifications quand la mémoire sature, le disque se remplit, la corbeille grossit ou une mise à jour de sécurité arrive</div></div>
        <label class="switch"><input type="checkbox" id="s-alerts" ${p.alerts !== false ? 'checked' : ''}/><span></span></label></div>
      <div class="row"><div class="r-ico">${icon('apps')}</div><div class="r-main"><div class="r-title">Mini-panneau</div><div class="r-sub">Cliquez sur l'icône de la barre supérieure. Sans zone de notification (GNOME sans extension AppIndicator), associez un raccourci clavier à la commande <b>fastboost --mini</b></div></div></div>
      <div class="row"><div class="r-ico">${icon('memory')}</div><div class="r-main"><div class="r-title">Boost avancé</div><div class="r-sub">Vide aussi le cache de pages du noyau (mot de passe demandé à chaque Boost)</div></div>
        <label class="switch"><input type="checkbox" id="s-drop" ${p.boostDropCaches ? 'checked' : ''}/><span></span></label></div>
      <div class="row"><div class="r-ico">${icon('admin')}</div><div class="r-main"><div class="r-title">Droits administrateur</div><div class="r-sub">Les actions système (paquets, journaux, pare-feu) demandent votre mot de passe via polkit</div></div>
        <span class="pill ${admin ? 'ok' : 'info'}">${admin ? 'root' : 'À la demande'}</span></div>` : `
      <div class="row"><div class="r-ico">${icon('admin')}</div><div class="r-main"><div class="r-title">Mode administrateur</div><div class="r-sub">${admin ? 'L\'application s\'exécute avec les droits administrateur' : 'Nécessaire pour nettoyer les fichiers système'}</div></div>
        ${admin ? '<span class="pill ok">Actif</span>' : '<button class="btn" id="s-admin">Redémarrer en administrateur</button>'}</div>`}
    </div>
    <h2>Informations système</h2>
    <div class="card"><div class="kv">
      <div>Appareil</div><div>${esc(info.hostname)} · ${esc([info.maker, info.model].filter(Boolean).join(' '))}</div>
      <div>Système</div><div>${esc(info.os)} (${IS_LINUX ? 'noyau' : 'build'} ${esc(info.build)})</div>
      ${IS_LINUX ? `<div>Bureau</div><div>${esc([info.desktop, info.session].filter(Boolean).join(' · ') || '–')}</div>` : ''}
      <div>Processeur</div><div>${esc(info.cpu)} · ${info.cores} cœurs</div>
      <div>Mémoire</div><div>${fmtBytes(info.totalMem)}</div>
      <div>Carte graphique</div><div>${esc(info.gpu)}</div>
      <div>Utilisateur</div><div>${esc(info.user)}</div>
    </div></div>
    <h2>À propos</h2>
    <div class="card small muted">FastBoost 1.2.0 — reconstruit à partir de l'analyse REA de Microsoft PC Manager 3.23. Projet indépendant, non affilié à Microsoft.</div></div>`;
  $('#s-theme').value = p.theme;
  $('#s-theme').onchange = (e) => pcm.prefs.set({ theme: e.target.value });
  $('#s-startup').onchange = (e) => pcm.prefs.set({ startup: e.target.checked });
  $('#s-tray').onchange = (e) => pcm.prefs.set({ minimizeToTray: e.target.checked });
  $('#s-drop') && ($('#s-drop').onchange = (e) => pcm.prefs.set({ boostDropCaches: e.target.checked }));
  $('#s-alerts') && ($('#s-alerts').onchange = (e) => pcm.prefs.set({ alerts: e.target.checked }));
  $('#s-admin') && ($('#s-admin').onclick = () => safe(() => pcm.system.relaunchAdmin()));
};

// ===================== Démarrage =====================
(async () => {
  try { CAPS = await pcm.caps(); } catch {}
  $('#admin-badge').textContent = IS_LINUX ? 'root' : 'Administrateur';
  $('#admin-badge').classList.toggle('hidden', !CAPS.isAdmin);
  go('home');
})();
