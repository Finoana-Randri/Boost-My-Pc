// Open every page and state of the app with the translator in collect mode, and list the texts
// that have no translation yet. Run with the app in a language other than French.
// Usage: node scripts/i18n-crawl.js <port> > missing.json
const [port] = process.argv.slice(2);
const STEPS = [
  "smartResult=null;smartDone=null;go('smart')", "showWelcome()", "document.querySelector('#wl-next').click()", "document.querySelector('#wl-next').click()", "document.querySelector('#wl-skip').click()",
  "document.querySelector('#scan').click()", 'WAIT:.sc-btn.ready', "go('smart')",
  "cleanResult=null;go('cleanup')", "document.querySelector('#scan').click()", 'WAIT:#do-clean',
  "page(doneView('cleanup','2,4 Go libérés','1 234 fichiers supprimés','cleanup'))",
  "page(scanning('cleanup','Recherche des fichiers inutiles…','Caches des navigateurs (2/11)',{stop:true}))",
  "delete overviewCache.protection;go('protection')", "document.querySelector('#scan').click()", 'WAIT:.ov-grid',
  "malwareResult=null;go('protection/threats')", "go('protection/privacy')", 'WAIT:#pv .pick-card, #pv .empty', "go('protection/permissions')", 'SLEEP:2500', "go('protection/status')", 'WAIT:#sec .card',
  "delete overviewCache.performance;go('performance')", "document.querySelector('#scan').click()", 'WAIT:.ov-grid',
  "go('performance/maintenance')", 'SLEEP:1500', "document.querySelector('#diag-go').click()", 'WAIT:.diag-list',
  "go('performance/startup')", 'SLEEP:2500', "go('performance/processes')", 'SLEEP:3500', "go('performance/network')", 'SLEEP:2000', "document.querySelector('#net-go, #scan, .btn.primary')?.click()", 'SLEEP:8000',
  "delete overviewCache.applications;go('applications')", "document.querySelector('#scan').click()", 'WAIT:.ov-grid',
  "go('applications/uninstall')", 'WAIT:#un .pick-card', "go('applications/leftovers')", 'SLEEP:3000', "go('applications/updates')", 'SLEEP:4000',
  "driversResult={source:'Windows Update',checked:228,updates:[{id:'a',name:'Intel UHD',provider:'Intel',class:'Display',current:'1',version:'2',size:5e8}],old:[{device:'Realtek Audio',provider:'Realtek',current:'6.0',currentDate:'2020-04-15',class:'MEDIA'}]};driversStatus={};renderDrivers(pageToken,driversResult)",
  "driversStatus={a:{state:'fail',error:'x'}};renderDrivers(pageToken,driversResult)",
  "delete overviewCache.clutter;go('clutter')", "go('clutter/duplicates')", "go('clutter/similar')", "go('clutter/large')", 'SLEEP:3000', "go('clutter/downloads')", 'SLEEP:2000',
  "lensData=null;go('lens')", "go('cloud')", 'SLEEP:2500', "go('shredder')", "go('tools')",
  "go('settings')", 'WAIT:.hx-hero:not(.loading)', "go('settings/prefs')", 'SLEEP:1500', "go('settings/about')", 'SLEEP:2500',
  "choiceBox('Une analyse est déjà en cours','x',[['stop','Arrêter et lancer'],['both','Ne pas arrêter'],['cancel','Annuler']]);document.querySelector('#modal-cancel').click()",
];
(async () => {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const ws = new WebSocket(list.find((t) => t.type === 'page' && t.url.includes('index.html')).webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const ev = (e) => new Promise((r) => { const i = ++id; pend.set(i, (d) => r(d.result?.result?.value)); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: e, returnByValue: true, awaitPromise: true } })); });
  await ev('window.I18N_COLLECT = true; location.reload()');
  await new Promise((r) => setTimeout(r, 3500));
  await ev('window.I18N_COLLECT = true; i18n.t(document.title); 1');
  // Rescan the whole page after each step (collect mode also catches text drawn before).
  const sweep = "(()=>{const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);for(let n=w.nextNode();n;n=w.nextNode())i18n.t(n.nodeValue);document.querySelectorAll('[title],[placeholder]').forEach(e=>{i18n.t(e.title);i18n.t(e.placeholder||'')});return i18n.missing.size})()";
  for (const s of STEPS) {
    if (s.startsWith('WAIT:')) {
      const sel = s.slice(5), t0 = Date.now();
      while (!(await ev(`!!document.querySelector(${JSON.stringify(sel)})`)) && Date.now() - t0 < 240000) await new Promise((r) => setTimeout(r, 700));
    } else if (s.startsWith('SLEEP:')) await new Promise((r) => setTimeout(r, Number(s.slice(6))));
    else { await ev(`try{${s}}catch(e){}`); await new Promise((r) => setTimeout(r, 1300)); }
    const n = await ev(sweep);
    process.stderr.write(`${n} ${s.slice(0, 60)}\n`);
  }
  const keys = await ev('[...i18n.missing]');
  process.stdout.write(JSON.stringify(keys.sort(), null, 1));
  process.exit(0);
})();
