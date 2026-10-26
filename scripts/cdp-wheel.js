// Scroll each page with the mouse wheel (like a user) at a small window size and report whether
// it moved and whether its end can be reached. Run: node scripts/cdp-wheel.js <port> <W>x<H> <route...>
const [port, size, ...routes] = process.argv.slice(2);
const [w, h] = size.split('x').map(Number);
(async () => {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const ws = new WebSocket(list.find((t) => t.type === 'page' && t.url.includes('index.html')).webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  // Position of all scrolled boxes, and how far the lowest visible content goes.
  const state = `(() => { let s = 0; document.querySelectorAll('.content, .content *').forEach((e) => { s += e.scrollTop; });
    let low = 0; document.querySelectorAll('.content *').forEach((e) => { const r = e.getBoundingClientRect(); if (r.height && !e.closest('.dfoot,.modal')) low = Math.max(low, r.bottom); });
    return JSON.stringify({ s, low: Math.round(low) }); })()`;
  for (const r of routes) {
    await ev(`go(${JSON.stringify(r)})`);
    await new Promise((x) => setTimeout(x, 2500));
    const before = JSON.parse(await ev(state));
    for (let i = 0; i < 60; i++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(w * 0.6), y: Math.round(h * 0.6), deltaX: 0, deltaY: 400 });
      await new Promise((x) => setTimeout(x, 40));
    }
    await new Promise((x) => setTimeout(x, 400));
    const after = JSON.parse(await ev(state));
    const foot = await ev("(() => { const f = document.querySelector('.dfoot:not(:empty)'); return f ? Math.round(f.getBoundingClientRect().top) : innerHeight; })()");
    const reachable = after.low <= foot + 2;
    console.log(`${reachable ? 'OK  ' : 'CUT '} ${size} ${r.padEnd(24)} défilé ${after.s - before.s}px · bas du contenu ${after.low} / ${foot}`);
  }
  await send('Emulation.clearDeviceMetricsOverride');
  process.exit(0);
})();
