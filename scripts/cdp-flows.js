// Exercise v2 flows through DevTools: open a module and start a scan.
// Never trigger a destructive action; wait for results, save a screenshot, and collect errors.
// Run: node scripts/cdp-flows.js <folder> <port> <flow...>
// Flows: smart cleanup threats privacy permissions maintenance leftovers lens similar large cloud
const fs = require('fs');
const [out, port, ...flows] = process.argv.slice(2);

const FLOWS = {
  smart: { route: 'smart', click: '#scan', until: '.sc-btn.ready', timeout: 300000 },
  cleanup: { route: 'cleanup', click: '#scan', until: '#do-clean', timeout: 120000 },
  threats: { route: 'protection', click: '#scan', until: '.ov-grid', timeout: 900000 },
  privacy: { route: 'protection/privacy', until: '#pv-go', timeout: 60000 },
  permissions: { route: 'protection/permissions', until: '#perm .pick-card, #perm .empty', timeout: 60000 },
  status: { route: 'protection/status', until: '#sec .card', timeout: 60000 },
  maintenance: { route: 'performance/maintenance', until: '#mt .pick-card', timeout: 30000 },
  startup: { route: 'performance/startup', until: '#su .pick-card, #su .empty', timeout: 30000 },
  network: { route: 'performance/network', until: '.list .row', timeout: 90000 },
  leftovers: { route: 'applications/leftovers', until: '#lo, .empty', timeout: 180000 },
  updates: { route: 'applications/updates', until: '.big', timeout: 300000 },
  lens: { route: 'lens', click: '#scan', until: '.bubble', timeout: 600000 },
  similar: { route: 'clutter/similar', click: '#scan', until: '#sim, .empty', timeout: 600000 },
  large: { route: 'clutter/large', until: '#lg-list, #lg .empty', timeout: 600000 },
  downloads: { route: 'clutter/downloads', until: '#dl-list, #dl .empty', timeout: 60000 },
  cloud: { route: 'cloud', click: '[data-cloud]', until: '#cl-lists, .empty', timeout: 600000, optionalClick: true },
  shredder: { route: 'shredder', until: '#dz', timeout: 10000 },
};

(async () => {
  let list;
  for (let i = 0; i < 60; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.some((t) => t.type === 'page' && t.url.includes('index.html'))) break; } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  const ws = new WebSocket(list.find((t) => t.type === 'page' && t.url.includes('index.html')).webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(d.params.args.map((a) => a.value || a.description).join(' '));
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.result?.value;
  await send('Runtime.enable');
  await new Promise((r) => setTimeout(r, 2500));
  for (const name of flows) {
    const f = FLOWS[name];
    const t0 = Date.now();
    await ev(`go('${f.route}')`);
    await new Promise((r) => setTimeout(r, 800));
    if (f.click) {
      const clicked = await ev(`(() => { const b = document.querySelector('${f.click}'); if (!b) return false; b.click(); return true; })()`);
      if (!clicked && !f.optionalClick) { console.log(`FAIL ${name} : bouton ${f.click} introuvable`); continue; }
    }
    let ok = false;
    while (Date.now() - t0 < f.timeout) {
      if (await ev(`!!document.querySelector('${f.until}')`)) { ok = true; break; }
      await new Promise((r) => setTimeout(r, 1000));
    }
    await new Promise((r) => setTimeout(r, 1200));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${out}/flow-${name}.png`, Buffer.from(shot.result.data, 'base64'));
    const txt = await ev(`document.querySelector('#content').innerText.replace(/\\n+/g, ' | ').slice(0, 260)`);
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(12)} ${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s  ${txt}`);
  }
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'aucune');
  process.exit(0);
})();
