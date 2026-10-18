// Visite les pages de l'app via le protocole DevTools et enregistre une capture de chacune.
// Usage : node scripts/cdp-shots.js <dossier> <port> page[:attenteMs] ...
const fs = require('fs');
const [out, port, ...pages] = process.argv.slice(2);
(async () => {
  let list;
  for (let i = 0; i < 60; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.some((t) => t.type === 'page')) break; } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  await new Promise((r) => setTimeout(r, 3000));
  for (const p of pages) {
    const [name, wait] = p.split(':');
    await send('Runtime.evaluate', { expression: `go('${name}')` });
    await new Promise((r) => setTimeout(r, Number(wait || 2500)));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${out}/linux-${name}.png`, Buffer.from(shot.result.data, 'base64'));
    const txt = await send('Runtime.evaluate', { expression: `currentPage + ' :: ' + document.querySelector('#content').innerText.slice(0,200).replace(/\\n+/g,' | ')`, returnByValue: true });
    console.log(name, '=>', txt.result.result.value);
  }
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'aucune');
  ws.close();
  process.exit(0);
})();
