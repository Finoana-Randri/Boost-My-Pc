/* global pcm, icon */
'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function fmtBytes(b) {
  b = Number(b) || 0;
  if (b < 1024) return `${Math.round(b)} o`;
  const u = ['Ko', 'Mo', 'Go', 'To'];
  let i = -1;
  do { b /= 1024; i++; } while (b >= 1024 && i < u.length - 1);
  return `${b.toFixed(b >= 100 ? 0 : 1).replace('.', ',')} ${u[i]}`;
}

// Icônes
$$('[data-i]').forEach((el) => (el.innerHTML = icon(el.dataset.i)));
$('#open-settings').innerHTML = icon('settings');
$('#open-main').innerHTML = icon('external');
$('.boost-ico').innerHTML = icon('rocket');

function ring(sel, pct, color) {
  const size = 44, stroke = 5, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const col = color || (pct >= 90 ? 'var(--bad)' : pct >= 75 ? 'var(--warn)' : 'var(--ok)');
  $(sel).innerHTML = `<svg width="${size}" height="${size}"><circle cx="22" cy="22" r="${r}" stroke="var(--track)" stroke-width="${stroke}" fill="none"/>
    <circle cx="22" cy="22" r="${r}" stroke="${col}" stroke-width="${stroke}" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}" style="transition:stroke-dashoffset .5s"/></svg>
    <div class="pct">${pct}%</div>`;
}

// Bouton en deux temps : 1er clic → « Confirmer ? », 2e clic → action
function twoStep(btn, label, run) {
  let armed = false, timer;
  btn.onclick = async () => {
    if (!armed) {
      armed = true; btn.classList.add('confirm'); btn.textContent = 'Confirmer ?';
      timer = setTimeout(() => { armed = false; btn.classList.remove('confirm'); btn.textContent = label; }, 3500);
      return;
    }
    clearTimeout(timer); armed = false; btn.classList.remove('confirm');
    btn.disabled = true; btn.textContent = '…';
    try { await run(); } catch (e) { btn.textContent = 'Erreur'; btn.title = e.message; setTimeout(() => { btn.textContent = label; btn.disabled = false; }, 2500); }
  };
}

function showResult(text) {
  const r = $('#result');
  r.innerHTML = `${icon('check')}<span>${esc(text)}</span>`;
  r.classList.remove('hidden');
}

// ---------- État ----------
const state = { stats: null, disk: null, summary: null, procs: [], net: [] };

function renderHero() {
  const s = state.stats, sum = state.summary, d = state.disk;
  if (!s) return;
  const issues = [];
  if (s.memory.percent >= 85) issues.push('mémoire saturée');
  if (d && d.free / d.size < 0.1) issues.push('disque presque plein');
  if (sum?.junk > 500 * 1024 ** 2) issues.push(`${fmtBytes(sum.junk)} de fichiers inutiles`);
  if (sum?.trash > 1024 ** 3) issues.push('corbeille volumineuse');
  if (sum?.security > 0) issues.push(`${sum.security} mise(s) à jour de sécurité`);
  if (sum?.firewallOk === false) issues.push('pare-feu désactivé');
  if (!issues.length) {
    $('#hero-title').textContent = 'Votre PC est en forme';
    $('#hero-sub').textContent = sum ? 'Rien à signaler. Un Boost reste possible à tout moment.' : 'Analyse rapide en cours…';
  } else {
    $('#hero-title').textContent = issues.length === 1 ? '1 point à vérifier' : `${issues.length} points à vérifier`;
    $('#hero-sub').textContent = issues.slice(0, 3).join(' · ');
  }
}

async function refreshFast() {
  const s = await pcm.system.stats().catch(() => null);
  if (!s) return;
  state.stats = s;
  ring('#ring-mem', s.memory.percent);
  $('#mem-used').textContent = fmtBytes(s.memory.used);
  $('#mem-total').textContent = `sur ${fmtBytes(s.memory.total)}`;
  ring('#ring-cpu', s.cpu, s.cpu >= 90 ? 'var(--bad)' : s.cpu >= 70 ? 'var(--warn)' : '#ffb24c');
  if (s.load != null) {
    $('#cpu-load').textContent = `Charge ${s.load.toFixed(2).replace('.', ',')}`;
    $('#cpu-cores').textContent = `${s.cores} cœurs`;
  } else {
    $('#cpu-load').textContent = s.cpu >= 70 ? 'Très sollicité' : s.cpu >= 30 ? 'Actif' : 'Au repos';
    $('#cpu-cores').textContent = 'utilisation';
  }
  $('#net-down').textContent = `${fmtBytes(s.net.down)}/s`;
  $('#net-up').textContent = `${fmtBytes(s.net.up)}/s`;
  state.net.push(s.net.down); if (state.net.length > 40) state.net.shift();
  const max = Math.max(...state.net, 1024);
  const pts = state.net.map((v, i) => `${(i / 39) * 100},${23 - (v / max) * 21}`).join(' ');
  $('#spark').innerHTML = `<polyline points="${pts}" fill="none" stroke="#b376ff" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
  renderHero();
}

async function refreshDisk() {
  const disks = await pcm.system.disks().catch(() => []);
  const d = disks.find((x) => x.id === '/') || disks.find((x) => /^C:/i.test(x.id)) || disks[0];
  if (!d || !d.size) { $('#disk-free').textContent = '–'; return; }
  state.disk = d;
  ring('#ring-disk', Math.round(((d.size - d.free) / d.size) * 100));
  $('#disk-free').textContent = `${fmtBytes(d.free)} libres`;
  $('#disk-total').textContent = `sur ${fmtBytes(d.size)}`;
}

async function refreshProcs() {
  // Ne pas redessiner pendant une confirmation en cours
  if (document.querySelector('#hogs .confirm, #hogs button:disabled')) return;
  const list = await pcm.apps.processes().catch(() => []);
  if (document.querySelector('#hogs .confirm, #hogs button:disabled')) return;
  state.procs = list;
  const hogs = list.filter((p) => p.mine !== false).slice(0, 3);
  $('#hogs').innerHTML = hogs.map((p, i) => `<div class="hog">
      ${p.icon || p.path ? `<img data-file="${esc(p.icon || p.path)}" class="hidden" alt=""/>` : ''}<span class="ph">${icon('process')}</span>
      <span class="name" title="${esc(p.name)}">${esc(p.desc)}</span><span class="mem">${fmtBytes(p.memory)}</span>
      <button class="act" data-hog="${i}">Quitter</button></div>`).join('') || '<div class="sub" style="padding:6px">Aucun processus à afficher</div>';
  $$('[data-hog]').forEach((b) => {
    const p = hogs[Number(b.dataset.hog)];
    twoStep(b, 'Quitter', async () => {
      await pcm.apps.kill(p.ids, p.name);
      b.classList.add('done'); b.textContent = 'Demandé';
      setTimeout(() => { b.disabled = false; refreshProcs(); }, 1500);
    });
  });
  for (const img of $$('img[data-file]')) {
    pcm.file.icon(img.dataset.file).then((u) => { if (u) { img.src = u; img.classList.remove('hidden'); img.nextElementSibling.classList.add('hidden'); } }).catch(() => {});
  }
}

async function refreshSummary(force = false) {
  const s = await pcm.ui.summary(force).catch(() => null);
  if (!s) return;
  state.summary = s;
  const clean = $('#act-clean');
  if (s.junk > 0) { clean.disabled = false; clean.textContent = `Nettoyer ${fmtBytes(s.junk)}`; }
  else { clean.disabled = true; clean.textContent = s.junk === 0 ? 'Rien à nettoyer' : 'Nettoyer'; }
  const trash = $('#act-trash');
  $('#trash-sub').textContent = s.trash == null ? 'Indisponible' : s.trash > 0 ? `${fmtBytes(s.trash)} à récupérer` : 'Vide';
  trash.disabled = !(s.trash > 0);
  const upd = $('#upd-sub');
  if (s.updates == null) { upd.textContent = 'Recherche…'; upd.className = 'row-sub'; }
  else if (s.updates === 0) { upd.textContent = s.pendingReboot ? 'Redémarrage nécessaire' : 'Système à jour'; upd.className = `row-sub ${s.pendingReboot ? 'warn' : 'ok'}`; }
  else { upd.textContent = `${s.updates} disponible(s)${s.security ? ` dont ${s.security} de sécurité` : ''}`; upd.className = `row-sub ${s.security ? 'bad' : 'warn'}`; }
  const fw = $('#fw-sub');
  fw.textContent = s.firewall || '–';
  fw.className = `row-sub ${s.firewallOk ? 'ok' : s.firewallOk === false ? 'bad' : ''}`;
  renderHero();
}

// ---------- Actions ----------
let boosting = false;
async function boost() {
  if (boosting) return;
  boosting = true;
  $('#boost').classList.add('busy');
  try {
    const mem = await pcm.system.boost();
    const ids = state.summary?.junkIds?.filter((id) => id === 'tmp' || id === 'temp') || [];
    const cleaned = ids.length ? await pcm.clean.run(ids) : { freed: 0 };
    showResult(`Boost terminé : ${fmtBytes(mem.freed + cleaned.freed)} libérés`);
    refreshFast(); refreshSummary(true);
  } catch (e) { showResult(`Boost : ${e.message}`); }
  finally { boosting = false; $('#boost').classList.remove('busy'); }
}
$('#boost').onclick = boost;

$('#act-free').onclick = async (e) => {
  const b = e.currentTarget;
  b.disabled = true; b.textContent = '…';
  const r = await pcm.system.boost().catch(() => null);
  b.textContent = !r ? 'Erreur' : r.freed > 1024 ** 2 ? `+${fmtBytes(r.freed)}` : 'Optimisé';
  b.classList.add('done');
  setTimeout(() => { b.textContent = 'Libérer'; b.disabled = false; b.classList.remove('done'); }, 2500);
  refreshFast();
};

$('#act-clean').onclick = async (e) => {
  const b = e.currentTarget;
  const ids = state.summary?.junkIds || [];
  if (!ids.length) return;
  b.disabled = true; b.textContent = 'Nettoyage…';
  const r = await pcm.clean.run(ids).catch((err) => ({ error: err.message }));
  if (r.error) { b.textContent = 'Erreur'; b.title = r.error; }
  else { showResult(`${fmtBytes(r.freed)} de fichiers inutiles supprimés`); b.textContent = 'Nettoyé'; b.classList.add('done'); }
  setTimeout(() => { b.classList.remove('done'); refreshSummary(true); refreshDisk(); }, 2000);
};

twoStep($('#act-trash'), 'Vider', async () => {
  const r = await pcm.clean.run([pcm.platform === 'linux' ? 'trash' : 'recycle']);
  showResult(`Corbeille vidée : ${fmtBytes(r.freed)} récupérés`);
  $('#act-trash').textContent = 'Vidée';
  $('#act-trash').classList.add('done');
  setTimeout(() => { $('#act-trash').classList.remove('done'); $('#act-trash').textContent = 'Vider'; refreshSummary(true); refreshDisk(); }, 2000);
});

document.addEventListener('click', (e) => {
  const o = e.target.closest('[data-open]');
  if (o) pcm.ui.openMain(o.dataset.open);
});
$('#open-main').onclick = () => pcm.ui.openMain('home');
$('#open-settings').onclick = () => pcm.ui.openMain('settings');
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') pcm.ui.hideMini(); });
pcm.ui.onAction((a) => { if (a === 'boost') boost(); });

// ---------- Rafraîchissement (seulement quand le panneau est visible) ----------
function refreshAll() {
  refreshFast(); refreshDisk(); refreshProcs(); refreshSummary();
}
pcm.ui.onShown(() => { $('#result').classList.add('hidden'); refreshAll(); });
setInterval(() => { if (!document.hidden) refreshFast(); }, 2000);
setInterval(() => { if (!document.hidden) refreshProcs(); }, 6000);
setInterval(() => { if (!document.hidden) refreshDisk(); }, 30000);
refreshAll();
