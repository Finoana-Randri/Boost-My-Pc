/* global pcm, icon */
'use strict';

// ===================== Platform =====================
const IS_LINUX = pcm.platform === 'linux';
document.body.classList.add(IS_LINUX ? 'linux' : 'windows');
try { if (localStorage.getItem('detailView') === 'cards') document.body.classList.add('view-cards'); } catch {}
document.body.classList.toggle('lite', !!pcm.lite);
if (pcm.firstRun) document.body.classList.add('welcoming');
// Animations pause in the background so the GPU stays idle.
const setPaused = () => document.body.classList.toggle('paused', document.hidden || !document.hasFocus());
window.addEventListener('blur', setPaused);
window.addEventListener('focus', setPaused);
document.addEventListener('visibilitychange', setPaused);
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
pcm.onProgress((p) => { progressHandlers[p.channel]?.(p); jobProgress[p.channel]?.(p); });

function go(route, { scan = false } = {}) {
  route = LEGACY[route] || route;
  const [mod, tab] = route.split('/');
  const m = MODULES[mod] ? mod : 'smart';
  currentRoute = tab ? `${m}/${tab}` : m;
  document.body.dataset.mod = m;
  $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.page === m));
  moveGlider(!navGlider.style.opacity);
  for (const k of Object.keys(progressHandlers)) delete progressHandlers[k];
  const token = ++pageToken;
  content.scrollTop = 0;
  const shown = PAGES[m](token, tab);
  // Opened from a Smart Care result: start the module's own analysis instead of waiting for a click.
  if (scan) Promise.resolve(shown).then(() => { if (alive(token)) $('#scan')?.click(); });
}
const alive = (token) => token === pageToken;

document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-go]');
  if (g) { e.preventDefault(); go(g.dataset.go, { scan: g.hasAttribute('data-scan') }); return; }
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
  n.title = n.textContent.trim(); // Shown when the menu is reduced to icons
  n.onclick = () => go(n.dataset.page);
});

// ===================== Motion =====================
const motionOff = () => document.body.classList.contains('lite') || matchMedia('(prefers-reduced-motion: reduce)').matches;

const navGlider = document.createElement('div');
navGlider.className = 'nav-glider';
$('#nav').prepend(navGlider);
function moveGlider(instant = false) {
  const a = $('.nav-item.active');
  if (!a) return;
  navGlider.classList.toggle('instant', instant);
  navGlider.style.transform = `translateY(${a.offsetTop}px)`;
  navGlider.style.height = `${a.offsetHeight}px`;
  navGlider.style.opacity = 1;
}
window.addEventListener('resize', () => moveGlider(true));

const COUNT_SELECTOR = '.big, .ov-card-title, .hx-big b, .rc-val, .sc-val';
function countUp(el, ms = 750) {
  if (motionOff() || el.dataset.counted) return;
  const m = el.textContent.match(/^(\s*)(\d{1,3}(?:[\s ]\d{3})*(?:,\d+)?)(.*)$/s);
  if (!m || el.children.length > 1) return;
  const target = Number(m[2].replace(/[\s ]/g, '').replace(',', '.'));
  if (!(target > 1)) return;
  el.dataset.counted = '1';
  const decimals = (m[2].split(',')[1] || '').length;
  const node = [...el.childNodes].find((n) => n.nodeType === 3 && /\d/.test(n.nodeValue));
  if (!node) return;
  const suffix = node.nodeValue.slice(node.nodeValue.indexOf(m[2]) + m[2].length);
  const prefix = node.nodeValue.slice(0, node.nodeValue.indexOf(m[2]));
  const fmt = (v) => v.toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const t0 = performance.now();
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    node.nodeValue = prefix + fmt(target * (1 - Math.pow(1 - k, 3))) + suffix;
    if (k < 1 && el.isConnected) requestAnimationFrame(tick);
    else node.nodeValue = prefix + m[2] + suffix;
  };
  requestAnimationFrame(tick);
}
function countUpIn(root = content) { $$(COUNT_SELECTOR, root).forEach((el) => countUp(el)); }

let spotRaf = 0;
document.addEventListener('pointermove', (e) => {
  if (spotRaf || motionOff()) return;
  spotRaf = requestAnimationFrame(() => {
    spotRaf = 0;
    const c = e.target.closest?.('.ov-card, .sc-tile, .hx-card, .feature, .pick-card, .result-card, .wl-points li');
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty('--mx', `${e.clientX - r.left}px`);
    c.style.setProperty('--my', `${e.clientY - r.top}px`);
  });
});

// Scrollbars show while their area is scrolled, then fade back out.
const scrollIdle = new WeakMap();
document.addEventListener('scroll', (e) => {
  const el = e.target;
  if (!(el instanceof Element)) return;
  if (!scrollIdle.has(el)) el.classList.add('scrolling');
  clearTimeout(scrollIdle.get(el));
  scrollIdle.set(el, setTimeout(() => { el.classList.remove('scrolling'); scrollIdle.delete(el); }, 900));
}, { capture: true, passive: true });

function pageMotion(root) {
  Motion.slideTabs(root);
  Motion.startOrbit();
  countUpIn(root);
}

// ===================== Shared components =====================
function page(html) {
  content.innerHTML = `<div class="page">${html}</div>`;
  const el = $('.page');
  // Only what follows the header scrolls. Pages that start with a plain title get the same header.
  let head = el.querySelector(':scope > .dhead');
  const TITLE = 'h1, .lead, .tabs, .sc-head, .tools-head';
  if (!head && el.firstElementChild?.matches(TITLE)) {
    head = document.createElement('div');
    head.className = 'dhead';
    el.prepend(head);
    while (head.nextElementSibling?.matches(TITLE)) head.appendChild(head.nextElementSibling);
  }
  // A search or filter bar right under the title stays with it.
  if (head?.nextElementSibling?.matches('.list-head')) head.appendChild(head.nextElementSibling);
  content.classList.toggle('split', !!head);
  if (head) {
    const body = document.createElement('div');
    body.className = 'dbody';
    while (head.nextSibling) body.appendChild(head.nextSibling);
    el.appendChild(body);
    const foot = document.createElement('div');
    foot.className = 'dfoot';
    el.appendChild(foot);
    el.classList.add('split');
  }
  pageMotion(el);
  return el;
}

// The action bar is moved below the scroll area; a hidden marker removes it when its section is redrawn.
const barSlots = new WeakMap();
new MutationObserver(() => {
  const foot = content.querySelector(':scope > .page.split > .dfoot');
  if (!foot) return;
  for (const b of [...foot.children]) if (!barSlots.get(b)?.isConnected) b.remove();
  for (const b of foot.parentNode.querySelectorAll('.dbody .action-bar')) {
    const slot = document.createElement('i');
    slot.hidden = true;
    b.replaceWith(slot);
    barSlots.set(b, slot);
    foot.replaceChildren(b);
  }
}).observe(content, { childList: true, subtree: true });

function header(mod, sub) {
  return `<h1>${esc(MODULES[mod].title)}</h1>${sub ? `<p class="lead">${sub}</p>` : ''}`;
}

function tabs(mod, list, active) {
  return `<div class="tabs glass">${list.map(([id, label]) => `<button class="tab ${id === active ? 'active' : ''}" data-go="${mod}/${id}">${esc(label)}</button>`).join('')}</div>`;
}

const MODULE_GROUP = {
  smart: 'Analyse complète', cleanup: 'Nettoyage', protection: 'Protection', performance: 'Vitesse',
  applications: 'Applications', clutter: 'Fichiers', lens: 'Fichiers', cloud: 'Fichiers', shredder: 'Fichiers',
};

function lastScanText(mod) {
  let t = 0;
  try { t = Number(localStorage.getItem(`lastScan:${mod}`)) || 0; } catch {}
  if (!t) return 'Jamais analysé';
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return 'Analysé à l\'instant';
  if (min < 60) return `Analysé il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `Analysé il y a ${h} h`;
  return `Analysé il y a ${plural(Math.round(h / 24), 'jour', 'jours')}`;
}

function intro(mod, { title, lead, features = [], button = 'Analyser', extra = '' }) {
  const columns = features.length === 4 ? 2 : Math.min(3, features.length);
  return `<div class="intro ms">
    <div class="ms-hero" aria-hidden="true">
      <div class="ms-glow"></div>
      <div class="ms-lens lg"><div class="ms-aura"><i></i><i></i><i></i></div>${micon(mod)}</div>
    </div>
    <span class="ms-eyebrow">${esc(MODULE_GROUP[mod] || '')}</span>
    <h1>${esc(title || MODULES[mod].title)}</h1>
    <p class="lead">${lead}</p>
    ${features.length ? `<div class="ms-features" style="--cols:${columns}">${features.map(([ic, t, s, attrs], i) => {
      // A fourth item turns the card into a button (a choice, such as the folder to analyse).
      const tag = attrs ? 'button' : 'div';
      return `<${tag} class="ms-feature lg${attrs ? ' choice' : ''}" style="--d:${0.2 + i * 0.05}s" ${attrs || ''}><span class="ms-f-ico">${ficon(ic)}</span><div><b>${esc(t)}</b><span>${esc(s)}</span></div></${tag}>`;
    }).join('')}
    </div>` : ''}
    ${extra ? `<div class="ms-extra">${extra}</div>` : ''}
    <button class="scan-btn" id="scan"><span>${esc(button)}</span></button>
    <span class="ms-last">${icon('clock')} ${lastScanText(mod)}</span>
  </div>`;
}

function scanning(mod, status, detail = '', { pct = null, stop = false } = {}) {
  const size = 190, stroke = 10, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const arc = pct == null
    ? `<circle cx="95" cy="95" r="${r}" stroke="url(#sg)" stroke-width="${stroke}" fill="none" stroke-linecap="round" stroke-dasharray="${c * 0.28} ${c}"/>`
    : `<circle cx="95" cy="95" r="${r}" stroke="url(#sg)" stroke-width="${stroke}" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}" style="transition:stroke-dashoffset .4s"/>`;
  return `<div class="scanning">
    <div class="ring-big ${pct == null ? 'spin' : ''}"><div class="scan-halo"></div><div class="scan-orbit"><i></i><i></i><i></i></div><svg width="${size}" height="${size}"><defs><linearGradient id="sg"><stop offset="0" stop-color="var(--a1)"/><stop offset="1" stop-color="var(--a2)"/></linearGradient></defs>
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
    <div class="hero-icon done-hero"><svg class="done-check" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></div>
    <h1>${esc(title)}</h1><p class="lead">${esc(sub)}</p>
    <button class="btn" data-go="${again}">${icon('refresh')} Nouvelle analyse</button>
  </div>`;
}

// ---------- Background scans ----------
// A scan keeps running when the user leaves its page; coming back shows its progress or result.
const JOBS = {};
const jobProgress = {};

// Resolves with the chosen value, or null when dismissed.
function choiceBox(title, text, choices) {
  return new Promise((resolve) => {
    const [ok, alt, cancel] = choices;
    $('#modal-title').textContent = title;
    $('#modal-text').textContent = text;
    $('#modal-ok').textContent = ok[1];
    $('#modal-alt').textContent = alt ? alt[1] : '';
    $('#modal-alt').classList.toggle('hidden', !alt);
    $('#modal-cancel').textContent = cancel ? cancel[1] : 'Annuler';
    $('#modal').classList.remove('hidden');
    const done = (v) => {
      $('#modal').classList.add('hidden');
      $('#modal-alt').classList.add('hidden');
      $('#modal-cancel').textContent = 'Annuler';
      $('#modal-ok').onclick = $('#modal-alt').onclick = $('#modal-cancel').onclick = null;
      resolve(v);
    };
    $('#modal-ok').onclick = () => done(ok[0]);
    $('#modal-alt').onclick = () => done(alt?.[0] ?? null);
    $('#modal-cancel').onclick = () => done(cancel?.[0] ?? null);
  });
}

function markBusy() {
  const busy = new Set(Object.keys(JOBS).map((k) => k.split('/')[0]));
  $$('.nav-item').forEach((n) => n.classList.toggle('busy', busy.has(n.dataset.page)));
}

// Asks before stopping another running scan, except for `auto` scans started by opening a page.
async function startJob(key, { label, stop, auto = false, keepPartial = false }, work) {
  const others = Object.values(JOBS).filter((j) => j.key !== key);
  if (others.length && !auto) {
    const names = others.map((j) => `« ${j.label} »`).join(', ');
    const choice = await choiceBox('Une analyse est déjà en cours',
      `${names} ${others.length > 1 ? 'sont' : 'est'} en cours. Voulez-vous l'arrêter avant de lancer « ${label} » ?`,
      [['stop', 'Arrêter et lancer'], ['both', 'Ne pas arrêter'], ['cancel', 'Annuler']]);
    if (!choice || choice === 'cancel') return null;
    if (choice === 'stop') others.forEach(stopJob);
  }
  if (JOBS[key]) stopJob(JOBS[key]);
  const job = { key, label, stop, keepPartial, status: '', detail: '', pct: null, cancelled: false, listeners: new Set(), channels: [] };
  job.update = (status, detail, pct) => {
    if (status != null) job.status = status;
    if (detail != null) job.detail = detail;
    if (pct != null) job.pct = pct;
    job.listeners.forEach((f) => f(job));
  };
  job.on = (channel, fn) => { job.channels.push(channel); jobProgress[channel] = (p) => !job.cancelled && fn(p); };
  JOBS[key] = job;
  markBusy();
  job.promise = Promise.resolve()
    .then(() => work(job))
    .then((r) => (job.cancelled ? null : r), (e) => { if (!job.cancelled) toast(`${label} : ${e.message}`, true); return null; })
    .then((r) => {
      finishJob(job);
      if (r != null && currentRoute.split('/')[0] !== key.split('/')[0]) toast(`${label} : terminée. Le résultat vous attend dans « ${MODULES[key.split('/')[0]].title} ».`);
      if (r != null) jobFinished(job);
      return r;
    });
  return job;
}

// ---------- Sound and system notifications ----------
let soundPrefs = { sounds: true, notifications: true };
pcm.prefs.get().then((p) => { soundPrefs = { sounds: p.sounds !== false, notifications: p.notifications !== false }; }).catch(() => {});
let audioCtx = null;

function chime(kind = 'done') {
  if (!soundPrefs.sounds) return;
  try {
    audioCtx ||= new AudioContext();
    const t = audioCtx.currentTime + 0.02;
    const notes = kind === 'warn' ? [[659.3, 0], [523.3, 0.13]] : [[783.99, 0], [1174.66, 0.11]];
    for (const [freq, at] of notes) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, t + at);
      g.gain.linearRampToValueAtTime(0.12, t + at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.55);
      o.connect(g).connect(audioCtx.destination);
      o.start(t + at);
      o.stop(t + at + 0.6);
    }
  } catch {}
}

function jobFinished(job) {
  try { localStorage.setItem(`lastScan:${job.key.split('/')[0]}`, String(Date.now())); } catch {}
  chime();
  if (!soundPrefs.notifications || (document.hasFocus() && !document.hidden)) return;
  const mod = job.key.split('/')[0];
  pcm.notify({ title: `${job.label} : terminée`, body: `Le résultat vous attend dans « ${MODULES[mod].title} ».`, route: job.key }).catch(() => {});
}

function finishJob(job) {
  job.channels.forEach((c) => { if (jobProgress[c]) delete jobProgress[c]; });
  if (JOBS[job.key] === job) delete JOBS[job.key];
  markBusy();
}

function stopJob(job) {
  job.cancelled = true;
  try { job.stop?.(); } catch {}
  finishJob(job);
}

// `onDone(result)` runs only if the page is still open.
function showJob(token, key, { mod, top = '', into = null }, onDone) {
  const job = JOBS[key];
  const html = scanning(mod, job.status, job.detail, { pct: job.pct, stop: true });
  if (into) into.innerHTML = html; else page(`${top}${html}`);
  $('#scan-stop').onclick = () => {
    if (job.keepPartial) { job.stop?.(); setScan('Arrêt…', ''); return; }
    stopJob(job);
    go(currentRoute);
  };
  const view = (j) => {
    if (!alive(token)) return job.listeners.delete(view);
    setScan(j.status, j.detail);
    const c = $('.ring-big circle:nth-of-type(2)');
    if (c && j.pct != null) c.style.strokeDashoffset = c.getTotalLength() * (1 - j.pct);
  };
  job.listeners.add(view);
  job.promise.then((r) => {
    job.listeners.delete(view);
    if (!alive(token)) return;
    if (r == null) return go(currentRoute);
    onDone(r);
  });
}

// ---------- Card overview ----------
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

function detailHead(mod, list, active, sub) {
  const title = (list.find(([id]) => id === active) || [])[1] || MODULES[mod].title;
  const cards = document.body.classList.contains('view-cards');
  return `<div class="dhead"><div class="sub-head"><button class="back-pill" data-go="${mod}">${icon('back')} Vue d'ensemble</button><span class="ov-mod">${esc(MODULES[mod].title)}</span>
      <div class="view-toggle glass" role="group" aria-label="Affichage">
        <button class="${cards ? '' : 'active'}" data-view="list" title="Afficher en liste">${icon('viewList')}</button>
        <button class="${cards ? 'active' : ''}" data-view="cards" title="Afficher en cartes">${icon('viewCards')}</button></div></div>
    <h1>${esc(title)}</h1>${tabs(mod, list, active)}</div>${sub ? `<p class="lead">${sub}</p>` : ''}`;
}

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
    const t = pageToken;
    const r = await safe(() => pcm.file.trash(paths));
    if (!r) return;
    toast(`${plural(r.done, 'élément déplacé', 'éléments déplacés')} vers la corbeille${r.failed ? ` · ${r.failed} échec(s)` : ''}`);
    if (t === pageToken) onDone?.();
  };
  upd();
  return upd;
}

// ===================== Smart Care =====================
const SMART_STEPS = {
  cleanup: ['Nettoyage', 'g-cleanup', 'cleanup'],
  protection: ['Protection', 'g-protection', 'protection'],
  performance: ['Performances', 'g-performance', 'performance'],
  applications: ['Applications', 'g-applications', 'applications/updates'],
  clutter: ['Encombrement', 'g-clutter', 'clutter/large'],
};
const SMART_ORDER = Object.keys(SMART_STEPS);
let smartResult = null;
let smartDone = null;
// Kept to redraw the board when the user comes back.
let smartTiles = {};

PAGES.smart = async (token) => {
  if (JOBS.smart) return smartWatch(token);
  if (smartDone) return smartShowDone(token);
  if (smartResult) return smartShowResult(token);
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
  $('#scan').onclick = () => smartScan(token);
};

function smartTile(id, cls = '') {
  const [title, g, link] = SMART_STEPS[id];
  return `<div class="sc-tile glass ${cls}" data-id="${id}" data-state="wait">
    <div class="sc-art ${g}">${micon(id)}</div>
    <div class="sc-text"><div class="sc-name">${title}</div><div class="sc-val">En attente…</div><div class="sc-sub"></div></div>
    <button class="sc-link hidden" data-go="${link}" data-scan>Examiner ${icon('chevron')}</button>
  </div>`;
}

const SMART_RING = 2 * Math.PI * 58;

// Drawn once; smartSet() then updates the tiles in place.
function smartBoard() {
  page(`<div class="sc-head"><h1 id="sc-title">Entretien intelligent</h1><p class="lead" id="sc-lead"></p></div>
    <div class="sc-grid enter">
      ${smartTile('cleanup', 'tall')}
      <div class="sc-tile sc-hero glass" data-id="protection" data-state="wait">
        <div class="sc-art g-protection">${micon('protection')}</div>
        <div class="sc-text"><div class="sc-name">Protection</div><div class="sc-val">En attente…</div><div class="sc-sub"></div></div>
        <ul class="sc-log">${SMART_ORDER.map((id) => `<li data-log="${id}" data-state="wait"><span class="sc-dot"></span><b>${SMART_STEPS[id][0]}</b><span class="sc-log-val">En attente</span></li>`).join('')}</ul>
        <button class="sc-link hidden" data-go="protection" data-scan>Examiner ${icon('chevron')}</button>
      </div>
      ${smartTile('performance')}
      ${smartTile('applications', 'wide')}
      <div class="sc-center">
        <button class="sc-btn" id="sc-btn"><svg viewBox="0 0 132 132"><circle cx="66" cy="66" r="58" class="sc-track"/><circle cx="66" cy="66" r="58" class="sc-arc" id="sc-arc" stroke-dasharray="${SMART_RING}" stroke-dashoffset="${SMART_RING}"/></svg><span id="sc-btn-label">Arrêter</span></button>
        <div class="sc-hint" id="sc-hint"></div>
      </div>
      ${smartTile('clutter', 'wide')}
    </div>`);
  for (const [id, t] of Object.entries(smartTiles)) smartSet(id, ...t);
  setTimeout(() => $('.sc-grid')?.classList.remove('enter'), 1000);
}

function smartProgress(pct) {
  const a = $('#sc-arc');
  if (a) a.style.strokeDashoffset = SMART_RING * (1 - Math.max(0, Math.min(1, pct)));
}

function smartSet(id, state, val, sub = '') {
  smartTiles[id] = [state, val, sub];
  const t = $(`.sc-tile[data-id="${id}"]`);
  if (t) {
    t.dataset.state = state;
    const v = t.querySelector('.sc-val');
    v.innerHTML = val;
    delete v.dataset.counted;
    if (['ok', 'warn', 'bad', 'done'].includes(state)) countUp(v);
    t.querySelector('.sc-sub').innerHTML = sub;
    t.querySelector('.sc-link').classList.toggle('hidden', !['ok', 'warn', 'bad', 'done'].includes(state));
  }
  const l = $(`[data-log="${id}"]`);
  if (l) {
    l.dataset.state = state;
    l.querySelector('.sc-log-val').innerHTML = state === 'active' ? 'Analyse…' : state === 'wait' ? 'En attente' : val;
  }
}

async function smartScan(token) {
  const job = await startJob('smart', { label: 'Entretien intelligent', stop: () => pcm.v2.smartCancel() }, async (j) => {
    smartResult = null;
    smartDone = null;
    smartTiles = {};
    j.phase = 'scan';
    j.update('Analyse de votre PC en cours…', 'Préparation', 0);
    j.on('smart', (p) => {
      if (p.index == null) return;
      SMART_ORDER.forEach((id, i) => { if (i < p.index && smartTiles[id]?.[0] === 'active') smartSet(id, 'scanned', 'Analysé'); });
      if (p.index < 5) smartSet(p.step, 'active', 'Analyse…');
      j.update(null, p.index < 5 ? `${SMART_STEPS[p.step][0]} · étape ${p.index + 1} sur 5` : j.detail, p.index / 5);
    });
    const r = await pcm.v2.smartScan();
    if (!j.cancelled) smartResult = r;
    return r;
  });
  if (job && alive(token)) smartWatch(token);
}

function smartWatch(token) {
  const job = JOBS.smart;
  if (!$('.sc-grid')) smartBoard();
  const btn = $('#sc-btn');
  btn.classList.remove('ready', 'finished');
  btn.classList.add('busy');
  if (job.phase === 'scan') {
    btn.disabled = false;
    $('#sc-title').textContent = 'Entretien intelligent';
    $('#sc-btn-label').textContent = 'Arrêter';
    btn.onclick = () => { stopJob(job); go('smart'); };
  } else {
    btn.disabled = true;
    $('#sc-title').textContent = 'Entretien en cours…';
    $('#sc-btn-label').textContent = 'En cours';
  }
  const view = (j) => {
    if (!alive(token)) return job.listeners.delete(view);
    $('#sc-lead').textContent = j.status;
    $('#sc-hint').textContent = j.detail;
    if (job.phase === 'scan') smartProgress(j.pct || 0);
  };
  view(job);
  job.listeners.add(view);
  job.promise.then(async (r) => {
    job.listeners.delete(view);
    if (!alive(token)) return;
    if (r == null) return go('smart');
    if (job.phase === 'run') return smartShowDone(token);
    smartProgress(1);
    await new Promise((res) => setTimeout(res, 350));
    if (alive(token)) smartShowResult(token, true);
  });
}

function smartValues() {
  const s = Object.fromEntries(smartResult.steps.map((x) => [x.id, x]));
  const c = s.cleanup || {}, p = s.protection || {}, pe = s.performance || {}, a = s.applications || {}, cl = s.clutter || {};
  const tasks = (pe.tasks || []).length;
  const threats = p.threats?.length || 0;
  return {
    s, c, tasks,
    values: {
      cleanup: c.error ? ['bad', 'Indisponible', esc(c.error)] : c.size > 0 ? ['warn', fmtBytes(c.size), 'de fichiers inutiles à nettoyer'] : ['ok', 'Propre', 'Aucun fichier inutile'],
      protection: p.error ? ['bad', 'Indisponible', esc(p.error)] : threats ? ['bad', plural(threats, 'menace', 'menaces'), 'à examiner'] : ['ok', 'Aucune menace', esc(p.note || (IS_LINUX ? 'Points d\'entrée vérifiés' : ''))],
      performance: pe.error ? ['bad', 'Indisponible', esc(pe.error)] : tasks ? ['warn', plural(tasks, 'tâche', 'tâches'), `de maintenance · ${plural(pe.startup || 0, 'app', 'apps')} au démarrage`] : ['ok', 'Optimisé', `${plural(pe.startup || 0, 'app', 'apps')} au démarrage`],
      applications: a.error ? ['bad', 'Indisponible', esc(a.error)] : a.updates ? ['warn', plural(a.updates, 'mise à jour', 'mises à jour'), a.security ? `dont ${a.security} de sécurité` : 'disponibles'] : ['ok', 'À jour', a.pendingReboot ? 'Redémarrage nécessaire' : 'Aucune mise à jour en attente'],
      clutter: cl.error ? ['bad', 'Indisponible', esc(cl.error)] : cl.count ? ['warn', plural(cl.count, 'gros fichier', 'gros fichiers'), `${fmtBytes(cl.size)} dans les téléchargements`] : ['ok', 'Rangé', 'Aucun gros fichier oublié'],
    },
  };
}

function smartShowResult(token, animated = false) {
  if (!$('.sc-grid')) smartBoard();
  smartProgress(1);
  const { c, tasks, values } = smartValues();
  SMART_ORDER.forEach((id, i) => {
    if (animated) setTimeout(() => alive(token) && smartSet(id, ...values[id]), i * 120);
    else smartSet(id, ...values[id]);
  });
  const issues = smartResult.steps.reduce((n, x) => n + (x.issues || 0), 0);
  const canRun = c.size > 0 || tasks > 0;
  const btn = $('#sc-btn');
  btn.classList.remove('busy', 'finished');
  btn.classList.add('ready');
  btn.disabled = false;
  $('#sc-title').textContent = issues ? 'Analyse terminée' : 'Votre PC est en pleine forme';
  $('#sc-lead').textContent = issues
    ? `${plural(issues, 'point à traiter', 'points à traiter')}. Les actions sûres s'appliquent en un clic ; le reste est à examiner.`
    : 'Rien d\'urgent. Vous pouvez tout de même examiner chaque module.';
  const what = [c.size > 0 ? `${fmtBytes(c.size)} à nettoyer` : '', tasks ? plural(tasks, 'tâche', 'tâches') : ''].filter(Boolean).join(' · ');
  $('#sc-hint').innerHTML = `${what ? `${what} · ` : ''}<button class="link" id="sc-new">Nouvelle analyse</button>`;
  $('#sc-btn-label').textContent = canRun ? 'Exécuter' : 'Analyser';
  $('#sc-new').onclick = () => smartScan(token);
  btn.onclick = () => (canRun ? smartRun(token, values) : smartScan(token));
}

async function smartRun(token, values) {
  const { s } = smartValues();
  const steps = ['cleanup', 'performance'].filter((id) => (id === 'cleanup' ? s.cleanup?.size > 0 : s.performance?.tasks?.length));
  const job = await startJob('smart', { label: 'Entretien intelligent' }, async (j) => {
    j.phase = 'run';
    steps.forEach((id) => smartSet(id, 'queued', values[id][1], 'en attente…'));
    j.update('Nettoyage des fichiers inutiles et maintenance du système.', '');
    j.on('smart', (p) => {
      if (!p.step || p.index != null) return;
      if (p.step === 'performance' && steps.includes('cleanup')) smartSet('cleanup', 'done', 'Nettoyé', `${fmtBytes(s.cleanup.size)} supprimés`);
      smartSet(p.step, 'active', p.step === 'cleanup' ? 'Nettoyage…' : 'Maintenance…', values[p.step][1]);
      j.update(null, p.step === 'cleanup' ? 'Suppression des fichiers inutiles' : 'Tâches de maintenance');
    });
    const r = await pcm.v2.smartRun();
    smartResult = null;
    if (steps.includes('cleanup')) smartSet('cleanup', 'done', 'Nettoyé', `${fmtBytes(r.freed)} libérés`);
    if (steps.includes('performance')) smartSet('performance', 'done', 'Optimisé', plural(r.tasks, 'tâche effectuée', 'tâches effectuées'));
    smartDone = { lead: `${fmtBytes(r.freed)} libérés · ${plural(r.tasks, 'tâche effectuée', 'tâches effectuées')}.` };
    return r;
  });
  if (job && alive(token)) smartWatch(token);
}

function smartShowDone(token) {
  if (!$('.sc-grid')) smartBoard();
  smartProgress(1);
  const btn = $('#sc-btn');
  btn.classList.remove('busy');
  btn.classList.add('ready', 'finished');
  btn.disabled = false;
  $('#sc-btn-label').innerHTML = icon('check', 'bold');
  $('#sc-title').textContent = 'Entretien terminé';
  $('#sc-lead').textContent = smartDone.lead;
  $('#sc-hint').innerHTML = '<button class="link" id="sc-new">Nouvelle analyse</button>';
  $('#sc-new').onclick = () => smartScan(token);
  btn.onclick = () => smartScan(token);
}

// ===================== Cleanup =====================
let cleanResult = null;

PAGES.cleanup = async (token) => {
  if (JOBS.cleanup) return showJob(token, 'cleanup', { mod: 'cleanup' }, (r) => (r.freed != null ? cleanDone(r) : renderCleanResult(r, token)));
  if (cleanResult) return renderCleanResult(cleanResult, token);
  page(intro('cleanup', {
    lead: 'Supprimez les fichiers système inutiles, les caches, les journaux et les autres fichiers qui encombrent votre disque.',
    features: [
      ['file', 'Fichiers système', IS_LINUX ? 'Journaux, cache des paquets, rapports de plantage' : 'Windows Update, rapports d\'erreurs, vidages mémoire'],
      ['globe', 'Navigateurs', 'Caches de Chrome, Firefox, Edge, Brave…'],
      ['wrench', 'Développement', 'Caches npm, pip, Yarn, Gradle, Cargo'],
    ],
  }));
  $('#scan').onclick = async () => {
    const job = await startJob('cleanup', { label: 'Analyse du nettoyage' }, async (j) => {
      j.update('Recherche des fichiers inutiles…', '');
      j.on('clean', (p) => j.update(null, `${p.current} (${p.index + 1}/${p.total})`));
      return (cleanResult = await pcm.clean.scan('deep'));
    });
    if (job && alive(token)) showJob(token, 'cleanup', { mod: 'cleanup' }, (r) => renderCleanResult(r, token));
  };
};

function cleanDone(res) {
  page(doneView('cleanup', `${fmtBytes(res.freed)} libérés`, `${plural(res.deleted, 'fichier supprimé', 'fichiers supprimés')}${res.failed ? ` · ${res.failed} ignoré(s) car en cours d'utilisation` : ''}${res.adminCancelled ? ' · éléments système non nettoyés (authentification annulée)' : ''}`, 'cleanup'));
}

const CLEAN_ICONS = {
  temp: 'file', tmp: 'file', webcache: 'globe', thumbs: 'image', trash: 'box', recycle: 'box', appcache: 'apps',
  devjunk: 'wrench', crash: 'warn', wer: 'warn', dumps: 'warn', journal: 'clock', logs: 'clock', pkgcache: 'download',
  flatpakunused: 'download', delivery: 'update', wucache: 'update', dxcache: 'gauge', recent: 'eye',
};

function renderCleanResult(r, token) {
  const total = r.items.reduce((a, i) => a + i.size, 0);
  const empty = (i) => i.size === 0 && !(i.countOnly && i.files);
  page(`${header('cleanup')}
    <div class="card glass" style="display:flex;align-items:center;gap:18px;margin-bottom:14px">
      <div class="hero-icon" style="width:70px;height:70px;border-radius:20px;margin:0;animation:none">${micon('cleanup')}</div>
      <div style="flex:1"><div class="big">${fmtBytes(total)}</div><div class="muted">peuvent être nettoyés</div></div>
      ${r.items.some((i) => i.needsAdmin) && !r.admin ? `<span class="pill warn">${icon('admin')} ${IS_LINUX ? 'Mot de passe demandé pour les éléments système' : 'Certains éléments nécessitent les droits admin'}</span>` : ''}
      <button class="btn" id="clean-new">${icon('refresh')} Nouvelle analyse</button>
    </div>
    <div class="list glass" id="clean-list">${r.items.map((i) => `
      <label class="row" style="cursor:pointer"><input type="checkbox" data-id="${i.id}" data-size="${i.size}" ${i.recommended && !empty(i) ? 'checked' : ''} ${empty(i) ? 'disabled' : ''}/>
        <div class="r-ico tint">${ficon(CLEAN_ICONS[i.id] || 'box')}</div>
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
  $('#clean-new').onclick = () => { cleanResult = null; go('cleanup'); };
  $('#do-clean').onclick = async () => {
    const ids = $$('#clean-list input:checked').map((c) => c.dataset.id);
    if ((ids.includes('recycle') || ids.includes('trash')) && !(await confirmBox('Vider la corbeille ?', 'Les fichiers de la corbeille seront supprimés définitivement.', 'Vider'))) return;
    const job = await startJob('cleanup', { label: 'Nettoyage' }, async (j) => {
      j.update('Nettoyage en cours…', '');
      j.on('clean', (p) => j.update(null, p.current));
      const res = await pcm.clean.run(ids);
      cleanResult = null;
      return res;
    });
    if (job && alive(token)) showJob(token, 'cleanup', { mod: 'cleanup' }, cleanDone);
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
  if (JOBS.protection) return showJob(token, 'protection', { mod: 'protection' }, () => renderProtectionOverview(token));
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
    const job = await startJob('protection', { label: 'Analyse de la protection' }, async (j) => {
      j.update('Analyse de la protection…', 'Menaces, confidentialité et autorisations');
      const [quick, perms, privacy, status] = await Promise.all([
        pcm.v2.malwareQuick().catch(() => null),
        pcm.v2.permList().catch(() => null),
        pcm.v2.privacyScan().catch(() => []),
        pcm.protect.status().catch(() => null),
      ]);
      if (j.cancelled) return null;
      overviewCache.protection = { quick, perms, privacy, status };
      if (quick) malwareResult = { kind: 'quick', engine: IS_LINUX ? 'Analyse heuristique' : 'Vérification de Microsoft Defender', threats: quick.threats, clamav: true, fromOverview: true };
      return overviewCache.protection;
    });
    if (job && alive(token)) showJob(token, 'protection', { mod: 'protection' }, () => renderProtectionOverview(token));
  };
};

function renderProtectionOverview(token) {
  const { quick, perms, privacy, status } = overviewCache.protection;
  const threats = quick?.threats || [];
  const sensitive = (perms?.apps || []).filter((a) => a.perms.some((p) => p.allowed !== false && ['webcam', 'microphone', 'devices-all', 'audio'].includes(p.id)));
  const browser = privacy.filter((i) => i.group !== 'Système');
  const browserSize = browser.reduce((a, i) => a + i.size, 0);
  const topBrowser = [...new Set(browser.map((i) => i.group))];
  const recent = privacy.filter((i) => i.group === 'Système');
  const recentCount = recent.reduce((a, i) => a + (i.count || 0), 0);
  const fw = status?.cards ? status.cards.find((c) => c.id === 'firewall') : null;
  const fwOk = fw ? fw.ok : (status?.firewall || []).every((f) => f.enabled);
  const issues = threats.length + (sensitive.length ? 1 : 0) + (browserSize ? 1 : 0);
  const settingsOnly = threats.length > 0 && threats.every((t) => t.fix);
  page(overview('protection', {
    title: threats.length ? `${plural(threats.length, 'menace détectée', 'menaces détectées')}.` : 'Aucune menace détectée.',
    sub: `${threats.length ? 'Supprimez les menaces et gérez vos éléments de confidentialité.' : issues ? 'Gérez vos éléments de confidentialité.' : 'Votre PC est protégé.'} Pare-feu ${fwOk ? 'activé' : 'désactivé'}.`,
    all: ['protection/threats', threats.length ? 'Voir les menaces détectées' : 'Lancer une analyse approfondie'],
    cards: [
      ovCard({
        size: 'big',
        title: settingsOnly ? 'La protection en temps réel est désactivée' : threats.length ? plural(threats.length, 'menace détectée', 'menaces détectées') : 'Aucune menace',
        sub: settingsOnly ? 'Microsoft Defender ne surveille plus les fichiers. Réactivez-le pour rester protégé.' : threats.length ? 'Supprimez-les dès que vous pouvez pour profiter d\'une bonne protection.' : (quick?.note || 'Lancez une analyse normale ou approfondie pour vérifier tout le système.'),
        art: threats.length ? artTrio(['warn', 'bug', 'folder']) : artTrio(['lock', 'shieldCheck', 'eye']),
        actions: settingsOnly ? [{ label: 'Activer', go: 'protection/threats', primary: true }] : threats.length ? [{ label: 'Examiner', go: 'protection/threats' }, { label: 'Supprimer', go: 'protection/threats', primary: true }] : [{ label: 'Analyser', go: 'protection/threats' }],
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
  if (JOBS['protection/threats']) return showJob(token, 'protection/threats', { mod: 'protection', top }, () => renderThreats(token, top));
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
    const job = await startJob('protection/threats', { label: 'Analyse des menaces' }, async (j) => {
      j.update('Analyse des menaces…', 'Cela peut prendre plusieurs minutes');
      j.on('malware', (p) => j.update(null, p.current));
      const r = await pcm.v2.malwareScan(kind);
      if (!j.cancelled) malwareResult = r;
      return r;
    });
    if (job && alive(token)) showJob(token, 'protection/threats', { mod: 'protection', top }, () => renderThreats(token, top));
  };
}

function renderThreats(token, top) {
  const r = malwareResult;
  const files = r.threats.some((t) => t.removable && t.path);
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
      ${t.fix ? `<div class="pc-foot"><button class="btn primary" data-secfix="${esc(t.fix)}">Activer</button></div>` : ''}
      ${t.path && t.path !== 'crontab' ? `<button class="btn ghost pc-corner" data-reveal="${esc(t.path)}" title="Afficher">${icon('folder')}</button>` : ''}</label>`).join('')}</div>${files ? trashBar('Supprimer les menaces') : ''}` : ''}`);
  $('#new-scan').onclick = () => { malwareResult = null; go('protection/threats'); };
  $$('[data-secfix]').forEach((b) => (b.onclick = async (e) => {
    e.preventDefault();
    b.disabled = true; b.innerHTML = '<span class="spinner mini"></span>';
    const msg = await safe(() => pcm.protect.action(b.dataset.secfix), 'Activer');
    if (msg) { if (String(msg).includes('\n')) await confirmBox('Antivirus', msg, 'OK'); else toast(msg); }
    malwareResult = null; delete overviewCache.protection;
    if (alive(token)) go('protection');
  }));
  if (files) {
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
      <div class="pc-pills">${a.perms.length ? a.perms.map((p) => p.allowed === false
        ? `<span class="pill ok">${esc(p.label)} · bloqué</span>`
        : `<span class="pill ${riskCls[p.risk]}">${esc(p.label)}${p.last ? ` · ${new Date(p.last).toLocaleDateString('fr-FR')}` : ''} <button class="btn ghost" style="min-height:0;padding:0 4px" data-revoke="${i}:${p.id}" title="Retirer">${icon('x')}</button></span>`).join('') : '<span class="pill ok">Aucun accès sensible</span>'}</div>
      <div class="pc-foot"><button class="btn" data-reset="${i}">Réinitialiser</button></div></div>`).join('')}</div>`;
  loadIcons();
  $$('[data-revoke]').forEach((b) => (b.onclick = async (e) => {
    e.preventDefault();
    const [i, perm] = b.dataset.revoke.split(':');
    const a = r.apps[Number(i)];
    if (!(await confirmBox('Retirer cette autorisation ?', `« ${a.name} » ne pourra plus utiliser : ${a.perms.find((p) => p.id === perm).label}. L'application peut cesser de fonctionner correctement ; « Réinitialiser » annule ce changement.`, 'Retirer'))) return;
    const p = a.perms.find((x) => x.id === perm);
    if (await safe(() => pcm.v2.permRevoke(p.key || a.id, perm))) { toast('Autorisation retirée'); delete overviewCache.protection; go('protection/permissions'); }
  }));
  $$('[data-reset]').forEach((b) => (b.onclick = async () => {
    const a = r.apps[Number(b.dataset.reset)];
    // On Windows one app can have several entries (one per program path).
    const keys = [...new Set(a.perms.map((p) => p.key || a.id))];
    if (await safe(async () => { for (const k of keys) await pcm.v2.permReset(k); return true; })) { toast(`Autorisations de ${a.name} réinitialisées`); delete overviewCache.protection; go('protection/permissions'); }
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
  // Another antivirus is in charge: Defender stays passive on purpose.
  const other = (s.antivirus || []).filter((n) => !/defender/i.test(n));
  const passive = d && /passive/i.test(d.mode || '') && other.length;
  return [
    { icon: 'virus', title: 'Antivirus', ok: !!(passive || (d && d.enabled && d.realtime)),
      status: passive ? `Protégé par ${other.join(', ')}` : d ? (d.realtime ? 'Microsoft Defender actif' : 'Protection en temps réel désactivée') : other.join(', ') || 'Inconnu',
      details: d && !passive ? [['Signatures', `${d.signatureVersion} (${d.signatureAge} j)`], ['Dernière analyse', d.lastQuickScan ? new Date(d.lastQuickScan).toLocaleString('fr-FR') : 'Jamais']] : [],
      actions: !d || passive ? [] : [...(d.realtime ? [] : [{ id: 'winRealtime', label: 'Activer', primary: true }]), { id: 'winSig', label: 'Mettre à jour les signatures' }] },
    { icon: 'firewall', title: 'Pare-feu', ok: !!fwAll, warn: !fwAll, status: fwAll ? 'Activé sur tous les réseaux' : 'Désactivé sur certains profils', details: (s.firewall || []).map((f) => [f.name, f.enabled ? 'Activé' : 'Désactivé']),
      actions: fwAll ? [] : [{ id: 'winFirewall', label: 'Activer', primary: true }] },
    { icon: 'shield', title: 'Protection contre la falsification', ok: !!d?.tamper, warn: !d?.tamper, status: d?.tamper ? 'Activée' : 'Désactivée ou inconnue', details: [['Rôle', 'Empêche la désactivation de la sécurité']],
      actions: d && !d.tamper ? [{ id: 'winSecurity', label: 'Ouvrir Sécurité Windows' }] : [] },
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
  if (JOBS.performance) return showJob(token, 'performance', { mod: 'performance' }, () => renderPerfOverview(token));
  const mj = JOBS['performance/maintenance'];
  if (mj) return showJob(token, 'performance/maintenance', { mod: 'performance' }, (res) => maintenanceDone(res, mj.tasks || [], ''));
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
    const job = await startJob('performance', { label: 'Analyse des performances' }, async (j) => {
      j.update('Analyse des performances…', 'Maintenance, démarrage et mémoire');
      const [tasks, startup, procs, stats] = await Promise.all([
        pcm.v2.maintList().catch(() => []),
        pcm.apps.startup().catch(() => []),
        pcm.apps.processes().catch(() => []),
        pcm.system.stats().catch(() => null),
      ]);
      if (j.cancelled) return null;
      return (overviewCache.performance = { tasks, startup, procs, stats });
    });
    if (job && alive(token)) showJob(token, 'performance', { mod: 'performance' }, () => renderPerfOverview(token));
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
  const job = await startJob('performance/maintenance', { label: 'Maintenance' }, async (j) => {
    j.update('Maintenance en cours…', '');
    j.tasks = tasks;
    const res = await pcm.v2.maintRun(ids);
    delete overviewCache.performance;
    return res;
  });
  if (!job || !alive(token)) return;
  showJob(token, 'performance/maintenance', { mod: 'performance', top }, (res) => maintenanceDone(res, tasks, top));
}

function maintenanceDone(res, tasks, top) {
  const okN = res.filter((x) => x.ok).length;
  const failed = res.filter((x) => !x.ok);
  page(`${top}${doneView('performance', `${plural(okN, 'tâche effectuée', 'tâches effectuées')}`, failed.length ? `Non effectuées : ${failed.map((f) => `${tasks.find((t) => t.id === f.id)?.name || f.id} (${f.error || 'échec'})`).join(' · ')}` : 'Votre système est optimisé.', 'performance')}`);
}

async function perfMaintenance(token, top) {
  const mj = JOBS['performance/maintenance'];
  if (mj) return showJob(token, 'performance/maintenance', { mod: 'performance', top }, (res) => maintenanceDone(res, mj.tasks || [], top));
  page(`${top}<div id="diag"></div><h2 class="mt-title">Tâches de maintenance</h2><div id="mt"><div class="loading"><span class="spinner"></span></div></div>`);
  diagSection(token);
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

// ---------- System diagnostic ----------
let diagResult = null;
const DIAG_ICONS = { services: 'process', units: 'process', disk: 'storage', space: 'storage', readonly: 'storage', firewall: 'shield', defender: 'shield',
  dns: 'wifi', time: 'clock', sysfiles: 'file', temp: 'file', reboot: 'refresh', events: 'warn', packages: 'box', journal: 'file' };

function diagSection(token) {
  const box = $('#diag');
  if (!box) return;
  const job = JOBS['performance/diagnose'];
  if (job) {
    box.innerHTML = `<div class="card glass diag-head busy"><span class="diag-orb"><span class="spinner"></span></span><div class="diag-txt"><b>${esc(job.status)}</b><span>${esc(job.detail || 'Services, disque, réseau, horloge et protection')}</span></div></div>`;
    job.promise.then(() => alive(token) && diagSection(token));
    return;
  }
  if (!diagResult) {
    box.innerHTML = `<div class="card glass diag-head"><span class="diag-orb">${ficon('wrench')}</span>
      <div class="diag-txt"><b>Diagnostic du système</b><span>Recherche les problèmes de ${IS_LINUX ? 'services, paquets, disque, horloge et réseau' : 'services, disque, pare-feu, Defender, réseau, horloge et fichiers système'}, puis les corrige.</span></div>
      <button class="btn primary" id="diag-go">${icon('search')} Rechercher les problèmes</button></div>`;
    $('#diag-go').onclick = () => runDiag(token);
    return;
  }
  const checks = diagResult.checks;
  const problems = checks.filter((c) => c.status === 'bad' || c.status === 'warn');
  const fixable = problems.filter((c) => c.fix && !c.fix.long);
  const order = { bad: 0, warn: 1, info: 2, ok: 3 };
  const rows = [...checks].sort((a, b) => order[a.status] - order[b.status]);
  box.innerHTML = `<div class="card glass diag-head ${problems.length ? 'warn' : 'ok'}">
      <span class="diag-orb">${icon(problems.length ? 'warn' : 'check')}</span>
      <div class="diag-txt"><b>${problems.length ? plural(problems.length, 'problème détecté', 'problèmes détectés') : 'Aucun problème détecté'}</b>
        <span>${plural(checks.length, 'point vérifié', 'points vérifiés')}${fixable.length ? ` · ${plural(fixable.length, 'correction automatique possible', 'corrections automatiques possibles')}` : ''}</span></div>
      ${fixable.length ? `<button class="btn primary" id="diag-all">${icon('wrench')} Tout corriger</button>` : ''}
      <button class="btn" id="diag-again">${icon('refresh')} Relancer</button></div>
    <div class="list glass diag-list">${rows.map((c) => `<div class="row diag-row ${c.status}">
      <span class="diag-st">${icon(c.status === 'ok' ? 'check' : c.status === 'info' ? 'info' : 'warn', 'bold')}</span>
      <div class="r-ico tint">${ficon(DIAG_ICONS[c.id] || 'wrench')}</div>
      <div class="r-main"><div class="r-title">${esc(c.title)}</div><div class="r-sub" title="${esc(c.detail)}">${esc(c.detail)}</div></div>
      ${c.fix && c.status !== 'ok' ? `<button class="btn ${c.status === 'info' ? '' : 'primary'}" data-fix="${c.id}">${esc(c.fix.label)}${c.fix.admin ? ` ${icon('admin')}` : ''}</button>`
        : c.route ? `<button class="btn" data-go="${c.route.go}">${esc(c.route.label)}</button>` : ''}</div>`).join('')}</div>`;
  $('#diag-again').onclick = () => runDiag(token);
  $('#diag-all') && ($('#diag-all').onclick = () => fixDiag(token, fixable.map((c) => c.id)));
  $$('[data-fix]', box).forEach((b) => (b.onclick = () => fixDiag(token, [b.dataset.fix])));
}

async function runDiag(token) {
  const job = await startJob('performance/diagnose', { label: 'Diagnostic du système' }, async (j) => {
    j.update('Diagnostic du système…', IS_LINUX ? 'Services, paquets, disque, horloge et réseau' : 'Services, disque, pare-feu, réseau, horloge');
    return (diagResult = await pcm.v2.diagScan());
  });
  if (job && alive(token)) diagSection(token);
}

async function fixDiag(token, ids) {
  const checks = diagResult.checks.filter((c) => ids.includes(c.id));
  const long = checks.some((c) => c.fix?.long);
  const what = checks.map((c) => `• ${c.title} : ${c.fix.label.toLowerCase()}`).join('\n');
  const how = IS_LINUX ? 'Votre mot de passe sera demandé une fois.' : 'Windows demandera une autorisation administrateur une fois.';
  if (!(await confirmBox(ids.length > 1 ? 'Corriger ces problèmes ?' : 'Corriger ce problème ?', `${what}\n\n${how}${long ? '\nCette réparation peut prendre de 10 à 30 minutes.' : ''}`, 'Corriger'))) return;
  const job = await startJob('performance/diagnose', { label: 'Réparation du système' }, async (j) => {
    j.update('Réparation en cours…', checks.map((c) => c.title).join(', '));
    await pcm.v2.diagFix(ids);
    j.update('Nouvelle vérification…', '');
    return (diagResult = await pcm.v2.diagScan());
  });
  if (!job) return;
  const left = checks.filter((c) => c.status !== 'info' && diagResult.checks.some((n) => n.id === c.id && n.status !== 'ok'));
  if (left.length) toast(`Non corrigé : ${left.map((c) => c.title).join(', ')}. Réessayez ou redémarrez le PC.`, true);
  else toast(checks.length > 1 ? 'Problèmes corrigés' : `${checks[0].title} : corrigé`);
  if (alive(token)) diagSection(token);
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
  if (JOBS.applications) return showJob(token, 'applications', { mod: 'applications' }, () => renderAppsOverview(token));
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
    const job = await startJob('applications', { label: 'Analyse des applications' }, async (j) => {
      j.update('Analyse des applications…', 'Applications installées, restes et mises à jour');
      j.on('leftovers', (p) => j.update(null, p.current));
      const [installed, leftovers, updates] = await Promise.all([
        pcm.apps.installed().catch(() => []),
        pcm.v2.leftovers().catch(() => []),
        pcm.protect.updates().catch(() => null),
      ]);
      if (j.cancelled) return null;
      return (overviewCache.applications = { installed, leftovers, updates });
    });
    if (job && alive(token)) showJob(token, 'applications', { mod: 'applications' }, () => renderAppsOverview(token));
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
      if (r?.finished) all.splice(all.indexOf(a), 1);
      if (!alive(token)) return; // The user opened another page during the uninstall.
      if (r?.finished) render(); else { b.disabled = false; b.textContent = 'Désinstaller'; }
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
  // Driver updates have their own section below.
  for (const u of r.updates) if (!/^(drivers|pilotes)$/i.test(u.category || '')) (groups[u.category || 'Système'] ||= []).push(u);
  page(`${top}<div class="card glass" style="display:flex;align-items:center;gap:16px;margin-bottom:6px">
      <div class="status-ico ${r.updates.length ? 'warn' : 'ok'}">${icon(r.updates.length ? 'update' : 'check')}</div>
      <div style="flex:1"><div class="big">${r.updates.length ? plural(r.updates.length, 'mise à jour disponible', 'mises à jour disponibles') : 'Tout est à jour'}</div>
      <div class="muted small">${r.pendingReboot ? 'Un redémarrage est nécessaire pour terminer une mise à jour.' : esc(IS_LINUX ? `Gestionnaire : ${r.manager || '–'}` : 'Windows Update')}</div></div></div>
    ${Object.entries(groups).map(([cat, list]) => `<h2>${esc(cat)} <span class="muted small">(${list.length})</span></h2><div class="cards c3">${list.slice(0, 120).map((u) => `<div class="pick-card glass static">
      <div class="pc-ico g-applications">${ficon(/sécurité/i.test(cat) ? 'shield' : 'update')}</div>
      <div class="pc-title">${esc(u.title)}</div><div class="pc-sub">${u.from ? `${esc(u.from)} → ` : ''}${esc(u.version || u.kb || '')}</div>
      ${u.size ? `<div class="pc-foot"><b>${fmtBytes(u.size)}</b></div>` : ''}</div>`).join('')}</div>`).join('')}
    <h2>Pilotes</h2><div id="drv"></div>
    ${r.updates.length ? `<div class="action-bar">${IS_LINUX ? '<button class="btn-main" id="upd-go">Tout mettre à jour</button>' : '<button class="btn-main" data-tool="windowsUpdate">Ouvrir Windows Update</button>'}</div>` : ''}`);
  $('#upd-go') && ($('#upd-go').onclick = async () => {
    if (!(await confirmBox('Installer les mises à jour ?', 'Les paquets du système, Snap et Flatpak vont être mis à jour. Votre mot de passe sera demandé.', 'Mettre à jour'))) return;
    page(`${top}${scanning('applications', 'Installation des mises à jour…', 'Ne fermez pas l\'application')}`);
    if (await safe(() => pcm.protect.installUpdates(), 'Mise à jour')) toast('Mises à jour installées');
    delete overviewCache.applications;
    if (alive(token)) go('applications/updates');
  });
  driversSection(token);
}

// ---------- Drivers ----------
// Updates come only from official channels: Windows Update on Windows, fwupd (LVFS) on Linux.
let driversResult = null;
let driversStatus = {}; // id -> install progress of the last installation

const DRIVER_STATE = {
  wait: ['info', 'En attente'], download: ['info', 'Téléchargement…'], install: ['info', 'Installation…'],
  ok: ['ok', 'Installé'], fail: ['bad', 'Échec'],
};

function driversSection(token) {
  const box = $('#drv');
  if (!box) return;
  const job = JOBS['applications/drivers'];
  if (job && !driversResult) {
    box.innerHTML = `<div class="card glass drv-card"><span class="spinner"></span><div><b>Recherche des pilotes…</b><div class="muted small">${IS_LINUX ? 'fwupd interroge le service LVFS' : 'Windows Update interroge le catalogue des fabricants'} ; cela peut prendre une minute.</div></div></div>`;
    job.promise.then(() => alive(token) && driversSection(token));
    return;
  }
  if (!driversResult) {
    box.innerHTML = `<div class="card glass drv-card"><div class="pc-ico g-applications">${ficon('process')}</div>
      <div style="flex:1"><b>Mises à jour de pilotes</b><div class="muted small">${IS_LINUX
        ? 'Recherche les mises à jour de micrologiciels publiées par les fabricants sur le service officiel LVFS (fwupd).'
        : 'Recherche les pilotes plus récents publiés par les fabricants sur Windows Update, la source officielle et signée.'}</div></div>
      <button class="btn primary" id="drv-scan">${icon('search')} Rechercher</button></div>`;
    $('#drv-scan').onclick = async () => {
      const j = await startJob('applications/drivers', { label: 'Recherche des pilotes' }, async (jj) => {
        jj.update('Recherche des pilotes…', '');
        const r = await pcm.v2.drivers();
        if (!jj.cancelled) { driversResult = r; driversStatus = {}; }
        return r;
      });
      if (j && alive(token)) driversSection(token);
    };
    return;
  }
  renderDrivers(token, driversResult);
}

function renderDrivers(token, r) {
  const box = $('#drv');
  if (!box) return;
  const job = JOBS['applications/drivers'];
  const installing = job?.label === 'Installation des pilotes';
  const state = (u) => driversStatus[u.id];
  const head = r.missing
    ? `<div class="card glass drv-card"><div class="status-ico warn">${icon('warn')}</div><div style="flex:1"><b>fwupd n'est pas installé</b>
        <div class="muted small">Installez-le avec votre gestionnaire de paquets (par exemple <b>sudo apt install fwupd</b>) pour recevoir les mises à jour des fabricants.</div></div></div>`
    : `<div class="card glass drv-card"><div class="status-ico ${r.updates.length ? 'warn' : 'ok'}">${icon(r.updates.length ? 'update' : 'check')}</div>
        <div style="flex:1"><b>${r.updates.length ? plural(r.updates.length, 'mise à jour de pilote disponible', 'mises à jour de pilotes disponibles') : 'Vos pilotes sont à jour'}</b>
        <div class="muted small">${plural(r.checked || 0, 'pilote vérifié', 'pilotes vérifiés')} · source : ${esc(r.source)}</div></div>
        <button class="btn" id="drv-again" ${installing ? 'disabled' : ''}>${icon('refresh')} Rechercher à nouveau</button></div>`;
  const list = r.updates.length ? `<div class="cards c3" id="drv-list">${r.updates.map((u) => {
    const st = state(u);
    const pill = st ? DRIVER_STATE[st.state] : null;
    return `<label class="pick-card glass ${st ? 'static' : ''}" data-drv="${esc(u.id)}">
      ${st ? '' : `<input type="checkbox" data-id="${esc(u.id)}" checked/>`}
      <div class="pc-ico g-applications">${ficon('process')}</div>
      <div class="pc-title">${esc(u.name)}</div>
      <div class="pc-sub ${st?.error ? 'drv-err' : ''}" title="${esc(st?.error || '')}">${esc(st?.error || [u.provider, u.class].filter(Boolean).join(' · ') || u.title)}</div>
      <div class="pc-foot"><span class="drv-ver">${esc(u.current || '?')} ${icon('chevron')} <b>${esc(u.version || '?')}</b></span>
        ${pill ? `<span class="pill ${pill[0]}">${st.state === 'download' || st.state === 'install' ? '<span class="spinner mini"></span>' : ''}${pill[1]}</span>` : u.size ? `<span class="muted small">${fmtBytes(u.size)}</span>` : ''}</div>
      </label>`;
  }).join('')}</div>` : '';
  const done = Object.values(driversStatus).filter((s) => s.state === 'ok' || s.state === 'fail');
  const reboot = Object.values(driversStatus).some((s) => s.reboot);
  const summary = done.length && !installing
    ? `<div class="card glass drv-card"><div class="status-ico ${done.every((s) => s.state === 'ok') ? 'ok' : 'warn'}">${icon('check')}</div><div style="flex:1"><b>${plural(done.filter((s) => s.state === 'ok').length, 'pilote installé', 'pilotes installés')}${done.some((s) => s.state === 'fail') ? ` · ${done.filter((s) => s.state === 'fail').length} échec(s)` : ''}</b>
        <div class="muted small">${reboot ? 'Redémarrez le PC pour terminer l\'installation.' : 'Installation terminée.'}</div></div></div>` : '';
  const actions = r.updates.length && !installing && !done.length
    ? `<div class="drv-actions"><span class="muted small">${IS_LINUX ? 'Votre mot de passe sera demandé.' : 'Windows demandera une autorisation administrateur une seule fois.'}</span><button class="btn primary" id="drv-install">${icon('download')} Installer la sélection</button></div>` : '';
  const old = r.old?.length ? `<details class="drv-old glass"><summary>${plural(r.old.length, 'pilote tiers de plus de 3 ans', 'pilotes tiers de plus de 3 ans')} sans mise à jour sur Windows Update</summary>
      <p class="muted small">Windows Update ne propose pas de version plus récente. Si un périphérique pose problème, consultez le site de son fabricant.</p>
      <div class="list">${r.old.map((d) => `<div class="row"><div class="r-main"><div class="r-title">${esc(d.device)}</div><div class="r-sub">${esc(d.provider)} · ${esc(d.class || '')}</div></div><div class="r-meta"><b>${esc(d.current || '')}</b><div class="small">${esc(d.currentDate || '')}</div></div></div>`).join('')}</div></details>` : '';
  box.innerHTML = head + summary + list + actions + old;
  $('#drv-again') && ($('#drv-again').onclick = () => { driversResult = null; driversStatus = {}; driversSection(token); $('#drv-scan')?.click(); });
  $('#drv-install') && ($('#drv-install').onclick = () => installDrivers(token, $$('#drv-list input:checked').map((c) => c.dataset.id)));
  if (installing && job.viewToken !== token) {
    job.viewToken = token;
    const view = () => (alive(token) ? renderDrivers(token, r) : job.listeners.delete(view));
    job.listeners.add(view);
    job.promise.then(() => { job.listeners.delete(view); if (alive(token)) renderDrivers(token, r); });
  }
}

async function installDrivers(token, ids) {
  if (!ids.length) return toast('Sélectionnez des pilotes');
  if (!(await confirmBox('Installer les pilotes ?', `${plural(ids.length, 'pilote sera téléchargé', 'pilotes seront téléchargés')} depuis ${IS_LINUX ? 'le service LVFS' : 'Windows Update'} puis installé${ids.length > 1 ? 's' : ''}. Un redémarrage peut être nécessaire.`, 'Installer'))) return;
  driversStatus = Object.fromEntries(ids.map((id) => [id, { state: 'wait' }]));
  const job = await startJob('applications/drivers', { label: 'Installation des pilotes' }, async (j) => {
    j.update('Installation des pilotes…', '');
    j.on('drivers', (p) => {
      if (!p.id) return;
      driversStatus[p.id] = p.phase === 'done' ? { state: p.ok ? 'ok' : 'fail', error: p.ok ? '' : p.error || `Code ${p.code ?? '?'}`, reboot: p.reboot } : { state: p.phase };
      j.update(null, `${p.index + 1} sur ${p.total}`);
    });
    const res = await pcm.v2.driversInstall(ids);
    for (const x of res) driversStatus[x.id] = { state: x.ok ? 'ok' : 'fail', error: x.ok ? '' : x.error || `Code ${x.code ?? '?'}`, reboot: x.reboot };
    delete overviewCache.applications;
    return res;
  });
  if (!job) driversStatus = {};
  if (alive(token)) renderDrivers(token, driversResult);
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
  if (JOBS.clutter) return showJob(token, 'clutter', { mod: 'clutter' }, () => renderClutterOverview(token));
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
    const stop = () => { pcm.storage.cancel(); pcm.v2.similarCancel(); };
    const job = await startJob('clutter', { label: 'Analyse de l\'encombrement', stop }, async (j) => {
      j.update('Recherche des fichiers à trier…', '');
      j.on('storage', (p) => j.update(`${p.dirs} dossiers analysés`, p.current));
      j.on('similar', (p) => j.update(`${p.done} / ${p.total} images comparées`, p.current));
      // Duplicate and large-file scans share one cancellable walker: run them one after the other
      const downloads = await pcm.storage.downloads().catch(() => ({ dir: PATHS.downloads, items: [] }));
      const dups = j.cancelled ? [] : await pcm.storage.duplicates({ root: clutterRoots.dup || downloads.dir }).catch(() => []);
      const similar = j.cancelled ? null : await pcm.v2.similarFind(clutterRoots.sim || PATHS.pictures).catch(() => ({ groups: [], scanned: 0 }));
      const large = j.cancelled ? [] : await pcm.storage.large({ root: clutterRoots.large || PATHS.home, minSize: 100 * 1024 * 1024, olderThanDays: 180 }).catch(() => []);
      if (j.cancelled) return null;
      return (overviewCache.clutter = { done: true, downloads, dups, similar, large, largeKey: `${clutterRoots.large || PATHS.home}|100|180` });
    });
    if (job && alive(token)) showJob(token, 'clutter', { mod: 'clutter' }, () => renderClutterOverview(token));
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
  if (JOBS['clutter/duplicates']) return showJob(token, 'clutter/duplicates', { mod: 'clutter', top }, (g) => renderDuplicates(token, top, g));
  if (overviewCache.clutter?.dups) return renderDuplicates(token, top, overviewCache.clutter.dups);
  const root = clutterRoots.dup || PATHS.downloads || PATHS.home;
  page(`${top}${intro('clutter', { title: 'Doublons', lead: `Trouvez les fichiers identiques (comparaison du contenu) dans <b>${esc(root)}</b>.`, extra: `<div class="list-head" style="justify-content:center;margin-bottom:22px">${rootPicker('dup', root)}</div>`, button: 'Rechercher' })}`);
  bindRootPicker('dup', 'clutter/duplicates');
  $('#scan').onclick = async () => {
    const job = await startJob('clutter/duplicates', { label: 'Recherche des doublons', stop: () => pcm.storage.cancel() }, async (j) => {
      j.update('Recherche des doublons…', '');
      j.on('storage', (p) => j.update(`${p.dirs} dossiers analysés`, p.current));
      const groups = await pcm.storage.duplicates({ root });
      if (!j.cancelled) overviewCache.clutter = { ...overviewCache.clutter, dups: groups };
      return groups;
    });
    if (job && alive(token)) showJob(token, 'clutter/duplicates', { mod: 'clutter', top }, (g) => renderDuplicates(token, top, g));
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
  if (JOBS['clutter/similar']) return showJob(token, 'clutter/similar', { mod: 'clutter', top }, (r) => renderSimilar(token, top, r));
  if (overviewCache.clutter?.similar) return renderSimilar(token, top, overviewCache.clutter.similar);
  const root = clutterRoots.sim || PATHS.pictures;
  page(`${top}${intro('clutter', { title: 'Images similaires', lead: `Repérez les photos presque identiques (rafales, recadrages, copies compressées) dans <b>${esc(root)}</b>. La meilleure version est conservée.`, extra: `<div class="list-head" style="justify-content:center;margin-bottom:22px">${rootPicker('sim', PATHS.pictures)}</div>`, button: 'Rechercher' })}`);
  bindRootPicker('sim', 'clutter/similar');
  $('#scan').onclick = async () => {
    const job = await startJob('clutter/similar', { label: 'Recherche d\'images similaires', stop: () => pcm.v2.similarCancel() }, async (j) => {
      j.update('Comparaison des images…', '', 0);
      j.on('similar', (p) => j.update(`${p.done} / ${p.total} images`, p.current, p.total ? p.done / p.total : 0));
      const r = await pcm.v2.similarFind(root);
      if (!j.cancelled) overviewCache.clutter = { ...overviewCache.clutter, similar: r };
      return r;
    });
    if (job && alive(token)) showJob(token, 'clutter/similar', { mod: 'clutter', top }, (r) => renderSimilar(token, top, r));
  };
}

let largeStopped = null; // Criteria of a large-file search the user stopped

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
  const key = `${root}|${minMb}|${age}`;
  const show = (items) => {
    $('#lg').innerHTML = items.length
      ? `<div class="list glass" id="lg-list">${fileRows(items)}</div>${trashBar()}`
      : `<div class="card glass empty">${icon('check')}<div>Aucun fichier correspondant.</div></div>`;
    if (items.length) { bindSelection($('#lg-list'), { onDone: () => { delete overviewCache.clutter; go('clutter/large'); } }); loadIcons(); }
  };
  if (overviewCache.clutter?.largeKey === key) return show(overviewCache.clutter.large);
  if (largeStopped === key && !JOBS['clutter/large']) {
    $('#lg').innerHTML = `<div class="card glass empty">${icon('warn')}<div>Recherche arrêtée.</div><button class="btn" id="lg-again">${icon('refresh')} Relancer</button></div>`;
    $('#lg-again').onclick = () => { largeStopped = null; go('clutter/large'); };
    return;
  }
  // Restarted only when the criteria change.
  if (JOBS['clutter/large']?.largeKey !== key) {
    const job = await startJob('clutter/large', { label: 'Recherche des gros fichiers', stop: () => { pcm.storage.cancel(); largeStopped = key; }, auto: true }, async (j) => {
      j.update('Recherche des gros fichiers…', '');
      j.on('storage', (p) => j.update(`${p.dirs} dossiers analysés`, p.current));
      const items = await pcm.storage.large({ root, minSize: minMb * 1024 * 1024, olderThanDays: age });
      if (!j.cancelled) overviewCache.clutter = { ...overviewCache.clutter, large: items, largeKey: key };
      return items;
    });
    job.largeKey = key;
  }
  if (!alive(token)) return;
  showJob(token, 'clutter/large', { mod: 'clutter', into: $('#lg') }, show);
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
  if (JOBS.lens) return showJob(token, 'lens', { mod: 'lens' }, () => renderLens(token));
  if (lensData) return renderLens(token);
  page(intro('lens', {
    lead: 'Visualisez ce qui occupe votre disque sous forme de carte interactive. Cliquez sur un dossier pour l\'explorer, supprimez ce qui ne sert plus.',
    features: [
      ['home', 'Dossier personnel', PATHS.home, `data-root="${esc(PATHS.home)}"`],
      ['storage', 'Disque entier', PATHS.root, `data-root="${esc(PATHS.root)}"`],
      ['folder', 'Autre dossier…', 'Choisir le dossier à analyser', 'id="lens-pick"'],
    ],
    button: 'Analyser',
  }));
  let root = PATHS.home;
  const choose = (card, path) => {
    root = path;
    $$('.ms-feature.choice').forEach((c) => c.classList.toggle('on', c === card));
  };
  choose($('[data-root]'), root);
  const start = async (r) => {
    root = r;
    // Stopping keeps the partial map.
    const job = await startJob('lens', { label: 'Carte du disque', stop: () => pcm.v2.lensCancel(), keepPartial: true }, async (j) => {
      j.update('Cartographie du disque…', root);
      j.on('lens', (p) => j.update(`${p.dirs.toLocaleString('fr-FR')} dossiers · ${p.files.toLocaleString('fr-FR')} fichiers`, p.current));
      const res = await pcm.v2.lensScan(root);
      if (!j.cancelled) { lensData = res; lensPath = [res.tree]; }
      return res;
    });
    if (job && alive(token)) showJob(token, 'lens', { mod: 'lens' }, () => renderLens(token));
  };
  $$('[data-root]').forEach((b) => (b.onclick = () => choose(b, b.dataset.root)));
  $('#lens-pick').onclick = async () => {
    const p = await pcm.storage.pickFolder();
    if (!p) return;
    $('#lens-pick > div > span').textContent = p;
    choose($('#lens-pick'), p);
  };
  $('#scan').onclick = () => start(root);
};

// Front-chain circle packing, largest first; `aspect` stretches the cluster to fill a wide area.
function packCircles(radii, aspect = 1) {
  const placed = [];
  const fits = (c) => placed.every((p) => Math.hypot(p.x - c.x, p.y - c.y) >= p.r + c.r - 1e-6);
  const cost = (c) => (c.x / aspect) ** 2 + c.y ** 2;
  for (const r of radii) {
    if (!placed.length) { placed.push({ x: 0, y: 0, r }); continue; }
    if (placed.length === 1) { placed.push({ x: placed[0].r + r, y: 0, r }); continue; }
    let best = null, bestCost = Infinity;
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i], b = placed[j];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        const r1 = a.r + r, r2 = b.r + r;
        if (!d || d > r1 + r2 || d < Math.abs(r1 - r2)) continue;
        const k = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
        const h = Math.sqrt(Math.max(0, r1 * r1 - k * k));
        const px = a.x + (k * dx) / d, py = a.y + (k * dy) / d;
        for (const s of [1, -1]) {
          const c = { x: px - (s * h * dy) / d, y: py + (s * h * dx) / d, r };
          const v = cost(c);
          if (v < bestCost && fits(c)) { best = c; bestCost = v; }
        }
      }
    }
    placed.push(best || { x: placed.reduce((m, p) => Math.max(m, p.x + p.r), 0) + r, y: 0, r });
  }
  return placed;
}

// Pack and scale circles into a w × h box (or inside a circle when round is set).
function packInto(sizes, w, h, { round = false, pad = 0 } = {}) {
  const pack = packCircles(sizes.map((s) => Math.sqrt(s)), round ? 1 : w / h);
  if (!pack.length) return [];
  let scale, ox, oy;
  if (round) {
    const cx = pack.reduce((a, p) => a + p.x, 0) / pack.length, cy = pack.reduce((a, p) => a + p.y, 0) / pack.length;
    const R = Math.max(...pack.map((p) => Math.hypot(p.x - cx, p.y - cy) + p.r));
    scale = (Math.min(w, h) / 2 - pad) / R;
    ox = w / 2 - cx * scale; oy = h / 2 - cy * scale;
  } else {
    const x0 = Math.min(...pack.map((p) => p.x - p.r)), x1 = Math.max(...pack.map((p) => p.x + p.r));
    const y0 = Math.min(...pack.map((p) => p.y - p.r)), y1 = Math.max(...pack.map((p) => p.y + p.r));
    scale = Math.min((w - pad * 2) / (x1 - x0), (h - pad * 2) / (y1 - y0));
    ox = (w - (x1 - x0) * scale) / 2 - x0 * scale; oy = (h - (y1 - y0) * scale) / 2 - y0 * scale;
  }
  return pack.map((p) => ({ x: ox + p.x * scale, y: oy + p.y * scale, r: p.r * scale }));
}

const LENS_PALETTE = [
  ['#7C5CFF', '#B59BFF'],
  ['#FF4F9A', '#FF9CC9'],
  ['#18B9C4', '#7EECDD'],
  ['#FF9F2E', '#FFD27A'],
  ['#3D7DFF', '#8FC1FF'],
  ['#B44CE0', '#E79BFF'],
  ['#1FBF74', '#93F2BF'],
  ['#FF6A4D', '#FFB29E'],
  ['#5865F2', '#A3ACFF'],
  ['#E83E8C', '#F7A1C4'],
];
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
    <div class="lens-wrap"><div><div class="bubbles" id="tm"></div>
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
  const W = tm.clientWidth, H = Math.max(460, tm.clientHeight);
  const order = kids.map((c, i) => i).sort((a, b) => kids[b].size - kids[a].size);
  const circles = packInto(order.map((i) => kids[i].size), W, H, { pad: 10 });
  tm.innerHTML = circles.map((p, n) => {
    const idx = order[n], item = kids[idx], c = colors[idx];
    const r = Math.max(0, p.r - 3);
    if (r < 5) return ''; // Too small to see; the item stays in the list.
    let inner = '';
    if (item.dir && r > 78 && item.children?.length > 1) {
      const subs = item.children.filter((s) => s.size > 0 && !s.other).sort((a, b) => b.size - a.size).slice(0, 14);
      inner = packInto(subs.map((s) => s.size), r * 2, r * 2, { round: true, pad: r * 0.12 })
        .map((q, k) => `<span class="bb-sub" style="left:${q.x - q.r + 1.5}px;top:${q.y - q.r + 1.5}px;width:${Math.max(0, q.r * 2 - 3)}px;height:${Math.max(0, q.r * 2 - 3)}px;animation-delay:${0.25 + n * 0.03 + k * 0.02}s"></span>`).join('');
    }
    const label = r > 30;
    return `<div class="bubble ${item.dir ? 'dir' : 'file'} ${item.other ? 'other' : ''} ${r > 90 ? 'big' : ''}" data-tile="${idx}" title="${esc(item.name)} — ${fmtBytes(item.size)}"
      style="left:${p.x - r}px;top:${p.y - r}px;width:${r * 2}px;height:${r * 2}px;animation-delay:${Math.min(n * 0.035, 0.6)}s;${c ? `--c1:${c[0]};--c2:${c[1]}` : ''}">
      ${inner}${label ? `<div class="bb-label"><span class="bb-name">${esc(item.name)}</span><span class="bb-size">${fmtBytes(item.size)}</span></div>` : ''}</div>`;
  }).join('');
  const open = (c, el) => {
    if (!c?.dir || !c.children?.length) return;
    if (el && !document.body.classList.contains('lite')) {
      tm.style.transformOrigin = `${el.offsetLeft + el.offsetWidth / 2}px ${el.offsetTop + el.offsetHeight / 2}px`;
      tm.classList.add('zooming');
      setTimeout(() => { if (alive(token)) { lensPath.push(c); renderLens(token); } }, 320);
    } else { lensPath.push(c); renderLens(token); }
  };
  $$('[data-tile]').forEach((el) => (el.onclick = () => open(kids[Number(el.dataset.tile)], el)));
  $$('[data-open]').forEach((el) => (el.onclick = () => open(kids[Number(el.dataset.open)], $(`[data-tile="${el.dataset.open}"]`))));
  $$('#lens-list .row').forEach((row, i) => {
    const b = $(`[data-tile="${i}"]`);
    row.onmouseenter = () => b?.classList.add('hl');
    row.onmouseleave = () => b?.classList.remove('hl');
    if (b) { b.onmouseenter = () => row.classList.add('hl'); b.onmouseleave = () => row.classList.remove('hl'); }
  });
  $$('[data-crumb]').forEach((b) => (b.onclick = () => { lensPath = lensPath.slice(0, Number(b.dataset.crumb) + 1); renderLens(token); }));
  $('#lens-new').onclick = () => { lensData = null; go('lens'); };
  bindSelection($('#lens-list'), {
    onDone: () => {
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
  ['terminal', 'terminal', 'Terminal', 'Ligne de commande'],
  ['files', 'folder', 'Fichiers', 'Gestionnaire de fichiers'],
  ['taskmgr', 'task', IS_LINUX ? 'Moniteur système' : 'Gestionnaire des tâches', 'Processus et ressources'],
  ['devmgmt', 'chip', 'Gestionnaire de périphériques', 'Pilotes et matériel'],
  ['hardware', 'chip', 'Informations matériel', 'Détails du matériel'],
  ['diskUsage', 'storage', 'Utilisation des disques', 'Analyseur du système'],
  ['disks', 'chip', 'Disques', 'Santé SMART et partitions'],
  ['software', 'download', 'Logithèque', 'Installer des applications'],
  ['translator', 'translate', 'Traducteur', 'Bing Traduction'],
  ['weather', 'weather', 'Météo', 'Prévisions locales'],
  ['display', 'monitor', 'Affichage', 'Paramètres d\'écran'],
  ['power', 'power', 'Alimentation', 'Mise en veille et batterie'],
];

PAGES.tools = async (token) => {
  page(`<div class="tools-head"><div><h1>${esc(MODULES.tools.title)}</h1><p class="lead">Vos outils système, rassemblés au même endroit.</p></div>
      <button class="btn primary tools-boost" id="boost" title="Libère la mémoire des applications inactives">${icon('rocket')} Boost</button></div>
    <div class="cards c3 tools-grid">${TOOLS.filter(([id]) => CAPS.tools.includes(id)).map(([id, ic, t, s]) => `<button class="row glass" style="border-radius:18px;cursor:pointer;text-align:left" data-tool="${id}" title="${esc(t)} : ${esc(s)}">
      <div class="r-ico tint">${ficon(ic)}</div><div class="r-main"><div class="r-title">${esc(t)}</div><div class="r-sub">${esc(s)}</div></div></button>`).join('')}</div>`);
  $('#boost').onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    b.innerHTML = `<span class="spinner"></span> Boost…`;
    const r = await safe(() => pcm.system.boost(), 'Boost');
    if (r) toast(`Boost terminé : ${fmtBytes(r.freed)} de mémoire libérée`);
    if (!alive(token)) return;
    b.disabled = false;
    b.innerHTML = `${icon('rocket')} Boost`;
  };
};

// ===================== Welcome screen =====================
const WELCOME_ORBIT = ['cleanup', 'protection', 'performance', 'applications', 'clutter', 'lens'];
const WELCOME_TRUST = { ok: 'check', src: 'download', local: 'lock' };
const WELCOME_STEPS = [
  {
    eyebrow: 'Bienvenue',
    title: 'Votre PC, <span>comme au premier jour.</span>',
    lead: 'Boost My Pc réunit tout ce qu\'il faut pour garder un ordinateur propre, sûr et rapide, dans une seule application.',
    next: 'Découvrir',
  },
  {
    eyebrow: 'Tout-en-un',
    title: 'Trois gestes, <span>un seul clic.</span>',
    lead: 'L\'Entretien intelligent analyse votre PC en une fois et propose les actions utiles.',
    points: [
      ['cleanup', 'Nettoyer', 'Fichiers inutiles, caches, doublons et gros fichiers oubliés.'],
      ['protection', 'Protéger', 'Menaces, traces de navigation et autorisations des applications.'],
      ['performance', 'Accélérer', 'Maintenance, démarrage, mémoire et mises à jour des pilotes.'],
    ],
    next: 'Continuer',
  },
  {
    eyebrow: 'En toute confiance',
    title: 'Vous gardez <span>le contrôle.</span>',
    lead: 'Chaque action vous est présentée avant d\'être appliquée.',
    points: [
      ['ok', 'Rien n\'est supprimé sans votre accord', 'Les fichiers passent par la corbeille, sauf avec le Broyeur.'],
      ['src', 'Sources officielles uniquement', 'Pilotes et mises à jour viennent de Windows Update ou de votre distribution.'],
      ['local', 'Vos données restent sur ce PC', 'Aucune analyse n\'est envoyée sur Internet.'],
    ],
    next: 'Commencer',
  },
];

function welcomeVisual(i) {
  if (i === 0) {
    return `<div class="wv wv-orbit" data-v="0">
      <div class="wv-halo"></div><div class="wv-ring r1"></div><div class="wv-ring r2"></div>
      <div class="wv-spin">${WELCOME_ORBIT.map((m, k) => `<div class="wv-planet" style="--a:${k * 60}deg"><div class="wv-moon g-${m}">${micon(m)}</div></div>`).join('')}</div>
      <img class="wv-logo" src="../../assets/icon-256.png" alt=""/></div>`;
  }
  if (i === 1) {
    return `<div class="wv wv-bento" data-v="1">${['smart', 'cleanup', 'protection', 'performance', 'applications', 'clutter', 'lens', 'shredder'].map((m, k) => `
      <div class="wv-tile ${k === 0 ? 'big' : ''}" style="--d:${k * 70}ms"><div class="wv-moon g-${m}">${micon(m)}</div><b>${esc(MODULES[m].title)}</b></div>`).join('')}</div>`;
  }
  return `<div class="wv wv-shield" data-v="2"><div class="wv-halo green"></div><div class="wv-ring r1"></div><div class="wv-ring r2"></div>
    <div class="wv-badge g-protection">${micon('protection')}</div>
    <div class="wv-check">${icon('check', 'bold')}</div></div>`;
}

function showWelcome() {
  const el = document.createElement('div');
  el.id = 'welcome';
  el.className = 'welcome';
  el.innerHTML = `
    <div class="wl-bg"><i></i><i></i></div>
    <button class="wl-skip" id="wl-skip">Passer</button>
    <div class="wl-main">
      <div class="wl-visual">${WELCOME_STEPS.map((_, i) => welcomeVisual(i)).join('')}</div>
      <div class="wl-copy">${WELCOME_STEPS.map((s, i) => `<section class="wl-step" data-step="${i}">
        <span class="wl-eyebrow">${s.eyebrow}</span>
        <h1>${s.title}</h1>
        <p class="wl-lead">${s.lead}</p>
        ${s.points ? `<ul class="wl-points">${s.points.map(([ic, t, d], k) => `<li style="--d:${120 + k * 90}ms">
          <span class="wl-pt-ico ${MODULES[ic] ? `g-${ic}` : `t-${ic}`}">${MODULES[ic] ? micon(ic) : icon(WELCOME_TRUST[ic])}</span><div><b>${t}</b><span>${d}</span></div></li>`).join('')}</ul>` : ''}
      </section>`).join('')}
        <div class="wl-nav">
          <button class="wl-back" id="wl-back" aria-label="Précédent">${icon('chevron')}</button>
          <div class="wl-dots">${WELCOME_STEPS.map((_, i) => `<button class="wl-dot" data-go-step="${i}" aria-label="Étape ${i + 1}"></button>`).join('')}</div>
          <button class="wl-next" id="wl-next"><span></span>${icon('chevron', 'bold')}</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el);
  document.body.classList.add('welcoming');
  let step = -1;
  const show = (n) => {
    if (n < 0 || n >= WELCOME_STEPS.length || n === step) return;
    const back = n < step;
    step = n;
    el.dataset.step = n;
    el.classList.toggle('backwards', back);
    $$('.wl-step', el).forEach((s) => s.classList.toggle('on', Number(s.dataset.step) === n));
    $$('.wv', el).forEach((v) => v.classList.toggle('on', Number(v.dataset.v) === n));
    $$('.wl-dot', el).forEach((d) => d.classList.toggle('on', Number(d.dataset.goStep) === n));
    $('#wl-next span').textContent = WELCOME_STEPS[n].next;
    $('#wl-next').classList.toggle('final', n === WELCOME_STEPS.length - 1);
    $('#wl-back').classList.toggle('hidden-soft', n === 0);
  };
  const finish = () => {
    document.removeEventListener('keydown', onKey);
    pcm.prefs.set({ welcomed: true }).catch(() => {});
    el.classList.add('out');
    document.body.classList.remove('welcoming');
    setTimeout(() => el.remove(), document.body.classList.contains('lite') ? 0 : 800);
  };
  const onKey = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'Enter') step === WELCOME_STEPS.length - 1 ? finish() : show(step + 1);
    else if (e.key === 'ArrowLeft') show(step - 1);
    else if (e.key === 'Escape') finish();
  };
  document.addEventListener('keydown', onKey);
  $('#wl-next').onclick = () => (step === WELCOME_STEPS.length - 1 ? finish() : show(step + 1));
  $('#wl-back').onclick = () => show(step - 1);
  $('#wl-skip').onclick = finish;
  $$('.wl-dot', el).forEach((d) => (d.onclick = () => show(Number(d.dataset.goStep))));
  show(0);
}

// ===================== PC health =====================
let healthResult = null; // cached for a minute
const healthSeries = { cpu: [], mem: [] };

const HEALTH_TITLES = {
  Excellent: 'Votre PC est en excellente forme',
  Bon: 'Votre PC est en bonne santé',
  'À surveiller': 'Quelques points à surveiller',
  Critique: 'Votre PC a besoin d\'attention',
};
const lvlOf = (pct, warn = 75, bad = 90) => (pct >= bad ? 'bad' : pct >= warn ? 'warn' : 'ok');

function arcGauge(id, pct) {
  const len = Math.PI * 80;
  return `<svg class="hx-arc" viewBox="0 0 200 112" id="${id}">
    <defs><linearGradient id="${id}-g" x1="0" x2="1"><stop offset="0" stop-color="#4be3a0"/><stop offset=".6" stop-color="#ffc53d"/><stop offset="1" stop-color="#ff6a88"/></linearGradient></defs>
    <path d="M20 100 A80 80 0 0 1 180 100" class="hx-arc-track"/>
    <path d="M20 100 A80 80 0 0 1 180 100" class="hx-arc-val" stroke="url(#${id}-g)" stroke-dasharray="${len}" stroke-dashoffset="${len * (1 - pct / 100)}"/>
  </svg>`;
}

function sparkPath(values) {
  if (values.length < 2) return { line: '', area: '' };
  const n = values.length, step = 100 / (n - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(2)},${(38 - (Math.min(100, v) / 100) * 34).toFixed(2)}`);
  return { line: `M${pts.join(' L')}`, area: `M0,40 L${pts.join(' L')} L100,40 Z` };
}
function spark(id, cls) {
  return `<svg class="hx-spark ${cls}" id="${id}" viewBox="0 0 100 40" preserveAspectRatio="none"><path class="a"/><path class="l"/></svg>`;
}
function setSpark(id, values) {
  const svg = $(`#${id}`);
  if (!svg) return;
  const { line, area } = sparkPath(values);
  svg.querySelector('.l').setAttribute('d', line);
  svg.querySelector('.a').setAttribute('d', area);
}

function healthSkeleton() {
  return `<div class="hx"><section class="hx-hero glass loading"><div class="hx-orb"><span class="spinner"></span></div>
    <div class="hx-head"><span class="hx-eyebrow">Indice de santé</span><h2>Mesure de l'état du PC…</h2><p class="muted">Processeur, mémoire, stockage, batterie et système.</p></div></section>
    <div class="hx-body"><div class="hx-cards">${'<div class="hx-card glass shimmer"></div>'.repeat(4)}</div><aside class="hx-side glass shimmer"></aside></div></div>`;
}

// One measurement at a time, kept even if the user leaves the tab before it ends.
let healthPending = null;
function measureHealth() {
  healthPending ||= Promise.race([
    pcm.v2.health(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Délai dépassé.')), 30000)),
  ]).then((r) => {
    healthResult = r;
    if (!healthSeries.cpu.length) { healthSeries.cpu.push(r.cpu.usage); healthSeries.mem.push(r.memory.percent); }
    return r;
  }).finally(() => { healthPending = null; });
  return healthPending;
}

// The last measurement shows at once; an older one is refreshed in place.
async function loadHealth(token) {
  const shown = !!healthResult;
  if (shown) showHealth(token, healthResult);
  if (shown && Date.now() - healthResult.at < 60000) return;
  try {
    await measureHealth();
  } catch (e) {
    if (shown || !alive(token) || !$('#health')) return;
    $('#health').innerHTML = `<div class="card glass empty">${icon('warn')}<div>Mesure impossible : ${esc(e.message)}</div><button class="btn" id="hx-retry">${icon('refresh')} Réessayer</button></div>`;
    $('#hx-retry').onclick = () => { $('#health').innerHTML = healthSkeleton(); loadHealth(token); };
    return;
  }
  if (alive(token) && $('#health')) showHealth(token, healthResult, shown);
}

let liveToken = null;
function showHealth(token, h, quiet = false) {
  renderHealth(token, h, quiet);
  if (liveToken !== token) { liveToken = token; liveHealth(token); }
}

function renderHealth(token, h, quiet = false) {
  const days = Math.floor(h.system.uptime / 86400), hours = Math.floor((h.system.uptime % 86400) / 3600);
  const mins = Math.floor((h.system.uptime % 3600) / 60);
  const up = days ? `${plural(days, 'jour', 'jours')}${hours ? ` ${hours} h` : ''}` : hours ? `${hours} h ${String(mins).padStart(2, '0')}` : `${mins} min`;
  const at = new Date(h.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const vols = [...h.volumes].sort((a, b) => (/^(C:|\/)$/i.test(a.id) ? -1 : /^(C:|\/)$/i.test(b.id) ? 1 : 0));
  const usedPct = (v) => (v.size ? Math.round(((v.size - v.free) / v.size) * 100) : 0);
  const main = vols[0];
  const b = h.battery;
  const batLvl = b?.health == null ? 'ok' : b.health < 60 ? 'bad' : b.health < 80 ? 'warn' : 'ok';
  const chips = [
    ['process', 'Processeur', `<b id="hx-chip-cpu">${h.cpu.usage} %</b>`, lvlOf(h.cpu.usage, 80, 95), 'hx-chip-cpu-l'],
    ['memory', 'Mémoire', `<b id="hx-chip-mem">${h.memory.percent} %</b>`, lvlOf(h.memory.percent, 80, 90), 'hx-chip-mem-l'],
    ['storage', 'Stockage', `<b>${main ? `${usedPct(main)} %` : '–'}</b>`, main ? lvlOf(usedPct(main), 80, 90) : 'ok'],
    ...(b ? [['battery', 'Batterie', `<b>${b.health ?? b.charge ?? '–'} %</b>`, batLvl]] : []),
  ];
  const tipIcon = { bad: 'warn', warn: 'warn', info: 'clock', ok: 'check' };
  const TIP_TINT = { bad: 'g-shredder', warn: 'g-performance', info: 'g-lens', ok: 'g-cleanup' };
  const SYS_TINT = { shield: 'g-protection', update: 'g-applications', refresh: 'g-performance', warn: 'g-shredder', clock: 'g-lens' };
  const sysRows = [
    h.system.antivirus ? ['shield', 'Protection en temps réel', h.system.antivirus.on ? 'Active' : 'Désactivée', h.system.antivirus.on ? 'ok' : 'bad'] : null,
    h.system.antivirus ? ['update', 'Signatures antivirus', h.system.antivirus.signatureAge > 0 ? `${plural(h.system.antivirus.signatureAge, 'jour', 'jours')}` : 'À jour', h.system.antivirus.signatureAge > 7 ? 'warn' : 'ok'] : null,
    ['refresh', 'Redémarrage requis', h.system.reboot ? 'Oui' : 'Non', h.system.reboot ? 'warn' : 'ok'],
    IS_LINUX ? ['warn', 'Services en échec', h.system.failed.length ? String(h.system.failed.length) : 'Aucun', h.system.failed.length ? 'warn' : 'ok'] : null,
    ['clock', 'Allumé depuis', up, h.system.uptime > 14 * 86400 ? 'warn' : 'ok'],
  ].filter(Boolean);
  const R = 74, C = 2 * Math.PI * R;
  $('#health').innerHTML = `<div class="hx ${h.level}">
    <section class="hx-hero glass">
      <div class="hx-orb">
        <svg viewBox="0 0 180 180"><defs><linearGradient id="hx-ring-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="s1"/><stop offset="1" class="s2"/></linearGradient></defs>
          <circle cx="90" cy="90" r="${R}" class="hx-ring-track"/><circle cx="90" cy="90" r="${R}" class="hx-ring-val" id="hx-ring" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>
        <div class="hx-score"><b id="hx-score">0</b><span>/100</span></div>
      </div>
      <div class="hx-head">
        <span class="hx-eyebrow"><i class="hx-led"></i>Indice de santé · ${esc(h.label)}</span>
        <h2>${HEALTH_TITLES[h.label] || h.label}</h2>
        <p>${h.tips.length ? `${plural(h.tips.length, 'recommandation', 'recommandations')} pour l'améliorer.` : 'Aucun problème détecté.'} Mesuré à ${at} · ${esc(h.system.os || '')}</p>
        <div class="hx-chips">${chips.map(([ic, t, v, l, id]) => `<span class="hx-chip ${l}" ${id ? `id="${id}"` : ''}>${micon(ic)}<span>${t}</span>${v}</span>`).join('')}</div>
      </div>
      <button class="btn hx-refresh" id="hl-refresh">${icon('refresh')} Actualiser</button>
    </section>
    <div class="hx-body">
      <div class="hx-cards">
        <div class="hx-card glass">
          <div class="hx-card-head"><span class="hx-ico g-performance">${micon('process')}</span><div><b>Processeur</b><span title="${esc(h.cpu.name || '')}">${esc(h.cpu.name || '')}</span></div></div>
          <div class="hx-gauge">${arcGauge('hx-cpu-arc', h.cpu.usage)}<div class="hx-gauge-val"><b id="hx-cpu">${h.cpu.usage}</b><span>%</span></div></div>
          ${spark('hx-cpu-spark', 'cpu')}
          <div class="hx-meta"><span>${plural(h.cpu.cores, 'cœur', 'cœurs')}</span>${h.cpu.temp != null ? `<span class="hx-pill ${lvlOf(h.cpu.temp, 80, 90)}">${h.cpu.temp} °C</span>` : '<span class="muted">Température non communiquée</span>'}</div>
        </div>
        <div class="hx-card glass">
          <div class="hx-card-head"><span class="hx-ico g-applications">${micon('memory')}</span><div><b>Mémoire</b><span>${fmtBytes(h.memory.total)} au total</span></div></div>
          <div class="hx-big"><b id="hx-mem-used">${fmtBytes(h.memory.used)}</b><span>utilisés</span></div>
          <div class="hx-seg"><i id="hx-mem-bar" class="${lvlOf(h.memory.percent, 80, 90)}" style="width:${h.memory.percent}%"></i></div>
          <div class="hx-legend"><span><i class="u ${lvlOf(h.memory.percent, 80, 90)}" id="hx-mem-dot"></i>Utilisée <b id="hx-mem-pct">${h.memory.percent} %</b></span><span><i class="f"></i>Disponible <b id="hx-mem-free">${fmtBytes(h.memory.free)}</b></span></div>
          ${spark('hx-mem-spark', 'mem')}
        </div>
        <div class="hx-card glass">
          <div class="hx-card-head"><span class="hx-ico g-clutter">${micon('storage')}</span><div><b>Stockage</b><span>${plural(vols.length, 'volume', 'volumes')} · ${plural(h.disks.length, 'disque', 'disques')}</span></div></div>
          <div class="hx-vols">${vols.slice(0, 3).map((v) => `<div class="hx-vol">
            <div class="hx-vol-top"><b>${esc(v.id)}</b><span>${fmtBytes(v.free)} libres sur ${fmtBytes(v.size)}</span></div>
            <div class="hx-seg thin"><i class="${lvlOf(usedPct(v), 80, 90)}" style="width:${usedPct(v)}%"></i></div></div>`).join('')}</div>
          <div class="hx-disks">${h.disks.map((d) => {
            const st = d.health === 'bad' ? ['bad', 'Défaillant'] : d.health === 'warn' ? ['warn', 'À surveiller'] : d.health === 'good' ? ['ok', 'Bon état'] : null;
            return `<span class="hx-disk" title="${esc(d.name)}"><i class="${st ? st[0] : ''}"></i><span>${esc(d.type || 'Disque')} · ${esc(d.name)}</span>${st ? ` <em>${st[1]}${d.wear != null ? ` · usure ${d.wear} %` : ''}</em>` : ''}</span>`;
          }).join('')}</div>
        </div>
        <div class="hx-card glass">
          <div class="hx-card-head"><span class="hx-ico g-cleanup">${micon('battery')}</span><div><b>Batterie</b><span>${b ? (b.charging ? 'En charge' : 'Sur batterie') : 'Aucune batterie'}</span></div></div>
          ${b ? `<div class="hx-bat ${batLvl}">
              <div class="hx-bat-body"><i style="width:${b.charge ?? 0}%"></i><span>${b.charge ?? '–'} %${b.charging ? micon('bolt', 'hx-bolt') : ''}</span></div><div class="hx-bat-cap"></div></div>
            <div class="hx-big small"><b class="${batLvl}">${b.health != null ? `${b.health} %` : '–'}</b><span>de la capacité d'origine</span></div>
            <div class="hx-meta"><span>${b.health == null ? 'Usure non communiquée' : b.health >= 80 ? 'Batterie en bon état' : b.health >= 60 ? 'Usure normale' : 'Batterie usée'}</span>${b.cycles ? `<span>${b.cycles} cycles</span>` : ''}</div>`
            : `<div class="hx-plug">${ficon('power')}<span>Ce PC fonctionne sur secteur.</span></div>`}
        </div>
      </div>
      <aside class="hx-side glass">
        <div class="hx-side-head"><b>Recommandations</b>${h.tips.length ? `<span class="hx-count">${h.tips.length}</span>` : ''}</div>
        ${h.tips.length ? `<div class="hx-tips">${h.tips.map((t) => `<div class="hx-tip ${t.level}"><span class="hx-tip-ico ${TIP_TINT[t.level] || 'g-performance'}">${micon(tipIcon[t.level] || 'warn')}</span><p>${esc(t.text)}</p>${t.route ? `<button class="btn" data-go="${t.route}">Corriger</button>` : ''}</div>`).join('')}</div>`
          : `<div class="hx-allgood"><span>${icon('check', 'bold')}</span><b>Tout est en ordre</b><p>Aucune action n'est nécessaire pour le moment.</p></div>`}
        <div class="hx-side-head sys"><b>Système</b></div>
        <div class="hx-sys">${sysRows.map(([ic, t, v, l]) => `<div class="hx-sys-row"><span class="hx-sys-ico ${SYS_TINT[ic] || 'g-tools'}">${micon(ic)}</span><span>${t}</span><b class="${l}">${esc(v)}</b></div>`).join('')}</div>
      </aside>
    </div>
  </div>`;
  $('#hl-refresh').onclick = () => { healthResult = null; $('#health').innerHTML = healthSkeleton(); loadHealth(token); };
  setSpark('hx-cpu-spark', healthSeries.cpu);
  setSpark('hx-mem-spark', healthSeries.mem);
  // Live values change without transitions: animating them would keep redrawing the glass.
  setTimeout(() => $('.hx')?.classList.add('hx-live'), 1500);
  const ring = $('#hx-ring'), scoreEl = $('#hx-score');
  const still = quiet || document.body.classList.contains('lite');
  if (quiet) ring.style.transition = 'none';
  requestAnimationFrame(() => { ring.style.strokeDashoffset = C * (1 - h.score / 100); });
  if (still) scoreEl.textContent = h.score;
  else {
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / 1100);
      scoreEl.textContent = Math.round(h.score * (1 - Math.pow(1 - k, 3)));
      if (k < 1 && scoreEl.isConnected) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

function liveHealth(token) {
  const len = Math.PI * 80;
  let busy = false;
  const tick = async () => {
    if (busy || document.hidden || !alive(token) || !$('#hx-cpu')) return;
    busy = true;
    const s = await pcm.system.stats().catch(() => null);
    busy = false;
    if (!s || !alive(token) || !$('#hx-cpu')) return;
    for (const [k, v] of [['cpu', s.cpu], ['mem', s.memory.percent]]) {
      healthSeries[k].push(v);
      if (healthSeries[k].length > 40) healthSeries[k].shift();
    }
    $('#hx-cpu').textContent = s.cpu;
    // Move the gauge only for visible changes: each transition redraws the glass behind it.
    const arc = $('#hx-cpu-arc .hx-arc-val');
    if (Math.abs((arc.pct ?? -10) - s.cpu) >= 3) { arc.pct = s.cpu; arc.style.strokeDashoffset = len * (1 - s.cpu / 100); }
    $('#hx-chip-cpu').textContent = `${s.cpu} %`;
    $('#hx-chip-cpu-l').className = `hx-chip ${lvlOf(s.cpu, 80, 95)}`;
    $('#hx-mem-used').textContent = fmtBytes(s.memory.used);
    $('#hx-mem-pct').textContent = `${s.memory.percent} %`;
    $('#hx-mem-free').textContent = fmtBytes(s.memory.total - s.memory.used);
    $('#hx-chip-mem').textContent = `${s.memory.percent} %`;
    $('#hx-chip-mem-l').className = `hx-chip ${lvlOf(s.memory.percent, 80, 90)}`;
    const bar = $('#hx-mem-bar');
    bar.style.width = `${s.memory.percent}%`;
    bar.className = lvlOf(s.memory.percent, 80, 90);
    $('#hx-mem-dot').className = `u ${bar.className}`;
    setSpark('hx-cpu-spark', healthSeries.cpu);
    setSpark('hx-mem-spark', healthSeries.mem);
  };
  const timer = setInterval(() => (alive(token) && $('#hx-cpu') ? tick() : clearInterval(timer)), 3000);
}

// ===================== Settings =====================
const SETTINGS_TABS = [['health', 'État de santé'], ['prefs', 'Préférences'], ['about', 'À propos']];

PAGES.settings = async (token, tab = 'health') => {
  if (!SETTINGS_TABS.some(([id]) => id === tab)) tab = 'health';
  const top = `${header('settings')}${tabs('settings', SETTINGS_TABS, tab)}`;
  if (tab === 'health') {
    page(`${top}<div id="health">${healthSkeleton()}</div>`);
    return loadHealth(token);
  }
  if (tab === 'about') return settingsAbout(token, top);
  const [p, admin] = await Promise.all([pcm.prefs.get(), pcm.system.isAdmin().catch(() => false)]);
  if (!alive(token)) return;
  const row = (ic, title, sub, ctrl) => `<div class="row"><div class="r-ico tint">${ficon(ic)}</div><div class="r-main"><div class="r-title">${title}</div><div class="r-sub" style="white-space:normal">${sub}</div></div>${ctrl}</div>`;
  const sw = (id, on) => `<label class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}/><span></span></label>`;
  const group = (title, rows) => `<section class="pref-group"><h3>${title}</h3><div class="list glass">${rows.join('')}</div></section>`;
  const system = IS_LINUX ? [
    row('memory', 'Boost avancé', 'Vide aussi le cache de pages du noyau (mot de passe à chaque Boost)', sw('s-drop', p.boostDropCaches)),
    row('admin', 'Droits administrateur', 'Les actions système demandent votre mot de passe via polkit', `<span class="pill ${admin ? 'ok' : 'info'}">${admin ? 'root' : 'À la demande'}</span>`),
  ] : [
    row('admin', 'Mode administrateur', admin ? 'Boost My Pc s\'exécute avec les droits administrateur' : 'Nécessaire pour certaines tâches système', admin ? '<span class="pill ok">Actif</span>' : '<button class="btn" id="s-admin" title="Redémarrer Boost My Pc avec les droits administrateur">Redémarrer</button>'),
    row('shield', 'Démarrer en administrateur', '<span id="s-adm-sub">Évite de redemander l\'autorisation pendant l\'utilisation.</span>', `<select id="s-adm">
        <option value="off">À la demande</option><option value="prompt">À l'ouverture</option><option value="task">Toujours</option></select>`),
  ];
  page(`${top}
    <div class="prefs">
      ${group('Apparence', [
        row('globe', 'Langue', 'Langue de l\'interface', `<select id="s-lang" data-no-i18n>${Object.entries(i18n.LANGS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>`),
        row('image', 'Thème', 'Apparence de l\'application', '<select id="s-theme"><option value="system">Système</option><option value="dark">Sombre</option><option value="light">Clair</option></select>'),
        row('sparkle', 'Effets visuels', 'Verre et animations. « Automatique » les désactive si la carte graphique n\'est pas accélérée.', '<select id="s-fx"><option value="auto">Automatique</option><option value="on">Activés</option><option value="off">Désactivés</option></select>'),
      ])}
      ${group('Notifications', [
        row('bell', 'Son de fin', 'Petit son quand une analyse ou une action se termine', sw('s-sounds', p.sounds !== false)),
        row('bell', 'Notifications système', 'Prévient quand une analyse se termine alors que Boost My Pc est en arrière-plan', sw('s-notif', p.notifications !== false)),
        row('warn', 'Alertes', 'Mémoire saturée, disque plein, corbeille volumineuse, mises à jour de sécurité', sw('s-alerts', p.alerts !== false)),
      ])}
      ${group('Démarrage et mises à jour', [
        row('power', 'Lancer à l\'ouverture de session', 'Boost My Pc démarre réduit dans la zone de notification', sw('s-startup', p.startup)),
        row('apps', 'Réduire dans la zone de notification', 'La fermeture de la fenêtre laisse l\'application active', sw('s-tray', p.minimizeToTray)),
        row('download', 'Mises à jour automatiques', 'Les nouvelles versions se téléchargent en arrière-plan et s\'installent quand vous redémarrez Boost My Pc', sw('s-autoupdate', p.autoUpdate !== false)),
        ...(IS_LINUX ? [row('apps', 'Mini-panneau', 'Cliquez sur l\'icône de la barre supérieure, ou associez un raccourci clavier à <b>boost-my-pc --mini</b>', '')] : []),
      ])}
      ${group('Système', [
        ...system,
        row('refresh', 'Réinitialiser l\'application', 'Rétablit les préférences par défaut et affiche à nouveau l\'écran de bienvenue', '<button class="btn" id="s-reset">Réinitialiser</button>'),
      ])}
    </div>`);
  $('#s-lang').value = i18n.lang;
  $('#s-lang').onchange = async (e) => { await pcm.prefs.set({ lang: e.target.value }); location.reload(); };
  $('#s-theme').value = p.theme;
  $('#s-fx').value = p.effects || 'auto';
  $('#s-fx').onchange = async (e) => {
    await pcm.prefs.set({ effects: e.target.value });
    CAPS = await pcm.caps();
    document.body.classList.toggle('lite', !!CAPS.lite);
  };
  $('#s-theme').onchange = (e) => pcm.prefs.set({ theme: e.target.value });
  $('#s-startup').onchange = (e) => pcm.prefs.set({ startup: e.target.checked });
  $('#s-autoupdate').onchange = async (e) => {
    await pcm.prefs.set({ autoUpdate: e.target.checked });
    if (e.target.checked) pcm.updates.check().catch(() => {});
  };
  $('#s-sounds').onchange = (e) => { soundPrefs.sounds = e.target.checked; pcm.prefs.set({ sounds: e.target.checked }); if (e.target.checked) chime(); };
  $('#s-notif').onchange = (e) => {
    soundPrefs.notifications = e.target.checked;
    pcm.prefs.set({ notifications: e.target.checked });
    if (e.target.checked) pcm.notify({ title: 'Notifications activées', body: 'Boost My Pc vous préviendra à la fin des analyses.' }).catch(() => {});
  };
  $('#s-tray').onchange = (e) => pcm.prefs.set({ minimizeToTray: e.target.checked });
  $('#s-alerts') && ($('#s-alerts').onchange = (e) => pcm.prefs.set({ alerts: e.target.checked }));
  $('#s-drop') && ($('#s-drop').onchange = (e) => pcm.prefs.set({ boostDropCaches: e.target.checked }));
  $('#s-admin') && ($('#s-admin').onclick = () => safe(() => pcm.system.relaunchAdmin()));
  $('#s-reset').onclick = async () => {
    if (!(await confirmBox('Réinitialiser l\'application ?', 'Les préférences reviennent à leurs valeurs par défaut et l\'écran de bienvenue s\'affichera à nouveau. Vos fichiers ne sont pas touchés.', 'Réinitialiser'))) return;
    if (await safe(() => pcm.prefs.reset(), 'Réinitialisation')) location.reload();
  };
  if ($('#s-adm')) {
    const a = await pcm.adminMode().catch(() => null);
    if (!alive(token) || !a) return;
    const sel = $('#s-adm');
    sel.value = a.mode;
    const task = sel.querySelector('option[value="task"]');
    task.disabled = !a.protectedInstall && a.mode !== 'task';
    $('#s-adm-sub').textContent = a.protectedInstall
      ? '« Toujours » (par défaut) : démarre avec les droits administrateur, autorisés une seule fois.'
      : '« À l\'ouverture » : une autorisation par lancement. « Toujours » nécessite l\'installation dans Program Files.';
    sel.onchange = async () => {
      const mode = sel.value;
      sel.disabled = true;
      const r = await safe(() => pcm.setAdminMode(mode), 'Mode administrateur');
      sel.disabled = false;
      if (!r) { sel.value = a.mode; return; }
      a.mode = mode;
      toast(mode === 'off' ? 'Les droits administrateur seront demandés seulement si nécessaire.' : mode === 'prompt' ? 'Windows demandera l\'autorisation à chaque ouverture de Boost My Pc.' : 'Boost My Pc démarrera désormais avec les droits administrateur, sans demande.');
    };
  }
};

// ===================== Updates =====================
let updateState = { status: 'idle' };
let updateWanted = false; // started from the button: progress shows in the title bar

const updatePercent = (s) => (s.total ? Math.floor((s.done / s.total) * 100) : 0);

async function runUpdate(action) {
  if (action === 'download') updateWanted = true;
  try { await pcm.updates[action](); }
  catch (e) { toast(e.message, true); }
}

function renderUpdateChip(s) {
  const chip = $('#update-chip');
  const busy = s.status === 'installing' || (s.status === 'downloading' && updateWanted);
  const label = {
    available: 'Mise à jour disponible',
    downloading: `Téléchargement… ${updatePercent(s)} %`,
    ready: 'Redémarrer pour mettre à jour',
    installing: 'Installation…',
  }[s.status];
  chip.classList.toggle('hidden', !label || (s.status === 'downloading' && !updateWanted));
  if (!label) return;
  chip.disabled = busy;
  chip.dataset.update = s.status === 'ready' ? 'install' : 'download';
  chip.innerHTML = `${busy ? '<span class="spinner mini"></span>' : icon(s.status === 'ready' ? 'refresh' : 'download')}<span>${label}</span>`;
  chip.title = `Version ${s.version}`;
}

function updateStatusHtml(s) {
  const v = esc(s.version || '');
  const button = (action, label, primary) => `<button class="btn${primary ? ' primary' : ''}" data-update="${action}">${label}</button>`;
  switch (s.status) {
    case 'idle':
    case 'checking':
      return `<span class="update-note"><span class="spinner mini"></span>Recherche de mises à jour…</span>`;
    case 'current':
      return `<span class="pill ok">${icon('check')} À jour</span>${button('check', 'Rechercher les mises à jour')}`;
    case 'available':
      return `<span class="update-note">Version ${v} disponible${s.size ? ` (${fmtBytes(s.size)})` : ''}</span>${button('download', `${icon('download')} Télécharger`, true)}`;
    case 'downloading':
      return `<span class="update-note"><span class="spinner mini"></span>Téléchargement de la version ${v}… ${updatePercent(s)} %</span>`;
    case 'ready':
      return `<span class="update-note">Version ${v} prête</span>${button('install', `${icon('refresh')} Redémarrer pour mettre à jour`, true)}`;
    case 'installing':
      return `<span class="update-note"><span class="spinner mini"></span>Installation de la version ${v}…</span>`;
    case 'unsupported':
      return `<span class="update-note">Version ${v} disponible. Cette copie de Boost My Pc ne peut pas s'installer elle-même : réinstallez-la avec le programme d'installation.</span>`;
    default:
      return `<span class="update-note bad">${esc(s.message || 'Vérification impossible.')}</span>${button('check', 'Réessayer')}`;
  }
}

function renderUpdateStatus(s) {
  const el = $('#s-update');
  if (el) el.innerHTML = updateStatusHtml(s);
}

function showUpdateState(s) {
  if (s.status === 'ready' || s.status === 'error') updateWanted = false;
  updateState = s;
  renderUpdateChip(s);
  renderUpdateStatus(s);
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-update]');
  if (b && !b.disabled) runUpdate(b.dataset.update);
});
pcm.updates.onState(showUpdateState);
pcm.updates.state().then(showUpdateState).catch(() => {});

async function settingsAbout(token, top) {
  page(`${top}<div class="card glass about"><img src="../../assets/icon-256.png" alt=""/><div><b>Boost My Pc</b><span>Version ${esc(CAPS.version || '')}</span>
      <span class="about-by">Créé par <a href="https://github.com/Finoana-Randri" id="s-author">${icon('github')} Finoana-Randri</a></span></div><div class="update-status" id="s-update"></div></div>
    <h2>Informations système</h2><div class="card glass" id="s-info"><div class="loading"><span class="spinner"></span></div></div>`);
  $('#s-author').onclick = (e) => { e.preventDefault(); window.open('https://github.com/Finoana-Randri'); };
  renderUpdateStatus(updateState);
  // First visit in this session: check now.
  if (updateState.status === 'idle') runUpdate('check');
  const info = await pcm.system.info().catch(() => ({}));
  if (!alive(token)) return;
  $('#s-info').innerHTML = `<div class="kv">
    <div>Appareil</div><div>${esc([info.hostname, [info.maker, info.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || '–')}</div>
    <div>Système</div><div>${esc(info.os)} (${IS_LINUX ? 'noyau' : 'build'} ${esc(info.build)})</div>
    ${IS_LINUX ? `<div>Bureau</div><div>${esc([info.desktop, info.session].filter(Boolean).join(' · ') || '–')}</div>` : ''}
    <div>Processeur</div><div>${esc(info.cpu)} · ${info.cores} cœurs</div>
    <div>Mémoire</div><div>${fmtBytes(info.totalMem)}</div>
    <div>Carte graphique</div><div>${esc(info.gpu || '–')}</div></div>`;
}

// ===================== External actions (tray and mini panel) =====================
pcm.onAction((a) => {
  if (a === 'boost') { safe(() => pcm.system.boost()).then((r) => r && toast(`Boost terminé : ${fmtBytes(r.freed)} libérés`)); }
  else if (typeof a === 'string' && a.startsWith('go:')) go(a.slice(3));
});

// ===================== Startup =====================
// System information is slow on Windows: it loads in the background.
(async () => {
  try { PATHS = await pcm.v2.paths(); } catch {}
  go('smart');
  // The launch flag only hides the interface early; the saved preference decides.
  pcm.prefs.get().then((p) => {
    if (!p.welcomed) showWelcome();
    else document.body.classList.remove('welcoming');
  }).catch(() => document.body.classList.remove('welcoming'));
  try { CAPS = await pcm.caps(); } catch {}
  document.body.classList.toggle('lite', !!CAPS.lite);
  $('#admin-badge').textContent = IS_LINUX ? 'root' : 'Administrateur';
  $('#admin-badge').classList.toggle('hidden', !CAPS.isAdmin);
  if (['tools', 'settings'].includes(currentRoute)) go(currentRoute);
  // Measured ahead, so the Health tab opens on a result.
  setTimeout(() => measureHealth().catch(() => {}), 15000);
})();
