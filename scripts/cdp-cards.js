// Check the card overviews: for each module, run the scan, wait for the cards,
// capture the screen, then open the detail views. Never clicks a destructive action.
// Run: node scripts/cdp-cards.js <folder> <port>
const fs = require('fs');
const [out, port] = process.argv.slice(2);

const STEPS = [
  ['performance', '#scan', '.ov-grid'], ['performance/maintenance', null, '#mt .pick-card'], ['performance/startup', null, '#su .pick-card, #su .empty'],
  ['performance/processes', null, '#pr .pick-card'],
  ['protection', '#scan', '.ov-grid'], ['protection/threats', null, '#threats, .card .big'], ['protection/privacy', null, '#pv .pick-card'], ['protection/permissions', null, '#perm .pick-card, #perm .empty'],
  ['applications', '#scan', '.ov-grid'], ['applications/uninstall', null, '#un .pick-card'], ['applications/leftovers', null, '#lo, .empty'],
  ['clutter', '#scan', '.ov-grid'], ['clutter/duplicates', null, '#dp, .empty'], ['clutter/similar', null, '#sim, .empty'],
];

(async () => {
  let list;
  for (let i = 0; i < 60; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.some((t) => t.url.includes('index.html'))) break; } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  const ws = new WebSocket(list.find((t) => t.url.includes('index.html')).webSocketDebuggerUrl);
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
  for (const [route, click, until] of STEPS) {
    const t0 = Date.now();
    await ev(`go('${route}')`);
    await new Promise((r) => setTimeout(r, 700));
    if (click) await ev(`document.querySelector('${click}')?.click()`);
    let ok = false;
    while (Date.now() - t0 < 600000) {
      if (await ev(`!!document.querySelector('${until}')`)) { ok = true; break; }
      await new Promise((r) => setTimeout(r, 1000));
    }
    await new Promise((r) => setTimeout(r, 1500));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${out}/cards-${route.replace('/', '-')}.png`, Buffer.from(shot.result.data, 'base64'));
    const txt = await ev(`document.querySelector('#content').innerText.replace(/\\n+/g, ' | ').slice(0, 200)`);
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${route.padEnd(24)} ${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s  ${txt}`);
  }
  // Same detail views in cards mode (toggle button)
  for (const route of ['performance/maintenance', 'protection/privacy']) {
    await ev(`go('${route}')`);
    await new Promise((r) => setTimeout(r, 2500));
    await ev(`document.querySelector('[data-view="cards"]')?.click()`);
    await new Promise((r) => setTimeout(r, 800));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${out}/cards-mode-${route.replace('/', '-')}.png`, Buffer.from(shot.result.data, 'base64'));
    console.log(`OK   mode cartes ${route} : ${await ev(`document.body.classList.contains('view-cards')`)}`);
  }
  await ev(`document.querySelector('[data-view="list"]')?.click()`);
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'aucune');
  process.exit(0);
})();
