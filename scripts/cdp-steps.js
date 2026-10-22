// Drive the app through DevTools with a list of steps, for the tests and screenshots.
// Run: node scripts/cdp-steps.js <port> <folder> <step...>
// Steps: eval:<js> | wait:<css> | sleep:<ms> | shot:<name>
const fs = require('fs');
const [port, out, ...steps] = process.argv.slice(2);
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
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await send('Runtime.enable');
  await send('Page.bringToFront');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  for (const s of steps) {
    const [k, ...rest] = s.split(':'); const v = rest.join(':');
    if (k === 'eval') console.log('eval', JSON.stringify(await ev(v)));
    else if (k === 'sleep') await new Promise((r) => setTimeout(r, Number(v)));
    else if (k === 'wait') {
      const t0 = Date.now();
      while (!(await ev(`!!document.querySelector(${JSON.stringify(v)})`))) {
        if (Date.now() - t0 > 600000) { console.log('TIMEOUT', v); break; }
        await new Promise((r) => setTimeout(r, 500));
      }
      console.log('found', v, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } else if (k === 'shot') {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(`${out}/${v}.png`, Buffer.from(r.result.data, 'base64'));
      console.log('shot', v);
    }
  }
  console.log('errors:', errors.length ? errors : 'none');
  process.exit(0);
})();
