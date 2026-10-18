// Capture le mini-panneau (page mini.html) via le protocole DevTools, puis teste un Boost.
// Usage : node scripts/cdp-mini.js <dossier> <port> <suffixe>
const fs = require('fs');
const [out, port, suffix = ''] = process.argv.slice(2);
(async () => {
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.url.includes('mini.html')); } catch {}
    if (!target) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!target) { console.log('mini.html introuvable'); process.exit(1); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.result.value;
  await send('Runtime.enable');
  await new Promise((r) => setTimeout(r, 9000));
  const shot = async (name) => fs.writeFileSync(`${out}/mini-${name}${suffix}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  await shot('initial');
  console.log('texte :', (await evalJs(`document.body.innerText.replace(/\\n+/g,' | ')`)).slice(0, 700));
  console.log('visible :', await evalJs('document.visibilityState'));
  // Vide la corbeille en deux clics, puis Boost
  await evalJs(`document.querySelector('#act-trash').click(); document.querySelector('#act-trash').click(); 1`);
  await evalJs(`document.querySelector('#boost').click(); 1`);
  await new Promise((r) => setTimeout(r, 5000));
  await shot('apres-actions');
  console.log('résultat :', await evalJs(`document.querySelector('#result').innerText + ' / corbeille: ' + document.querySelector('#trash-sub').innerText`));
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'aucune');
  process.exit(0);
})();
