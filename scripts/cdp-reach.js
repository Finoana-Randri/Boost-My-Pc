// Small screens: on result pages, find content that goes past the window with no scrolling
// container to reach it (cut off), and pages wider than the window.
// Run after the flows (results in memory): node scripts/cdp-reach.js <port> <folder> [WxH ...]
const fs = require('fs');
const [port, out, ...sizes] = process.argv.slice(2);
const SIZES = (sizes.length ? sizes : ['800x500', '900x560', '1024x600', '1280x690']).map((s) => s.split('x').map(Number));
const PAGES = [
  ['smart-result', "go('smart')"], ['cleanup-result', "go('cleanup')"],
  ['protection-ov', "go('protection')"], ['threats', "go('protection/threats')"], ['privacy', "go('protection/privacy')"], ['permissions', "go('protection/permissions')"], ['status', "go('protection/status')"],
  ['performance-ov', "go('performance')"], ['maintenance', "go('performance/maintenance')"], ['startup', "go('performance/startup')"], ['processes', "go('performance/processes')"], ['network', "go('performance/network')"],
  ['applications-ov', "go('applications')"], ['uninstall', "go('applications/uninstall')"], ['leftovers', "go('applications/leftovers')"], ['updates', "go('applications/updates')"],
  ['clutter-ov', "go('clutter')"], ['large', "go('clutter/large')"], ['downloads', "go('clutter/downloads')"],
  ['lens', "go('lens')"], ['cloud', "go('cloud')"], ['shredder', "go('shredder')"], ['tools', "go('tools')"],
  ['health', "go('settings')"], ['prefs', "go('settings/prefs')"], ['about', "go('settings/about')"],
];
// For every visible element past the bottom or right edge, look for an ancestor that can scroll to it.
const PROBE = `(() => {
  const vw = innerWidth, vh = innerHeight, cut = [];
  const scrolls = (e) => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1; };
  for (const el of document.querySelectorAll('.content *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
    if (el.closest('.modal, .toast, [aria-hidden=true], .dfoot')) continue;
    // Decorations placed over a corner (absolute) are meant to be clipped by their card.
    let abs = false;
    for (let a = el; a && !a.classList?.contains('content'); a = a.parentElement) if (/absolute|fixed/.test(getComputedStyle(a).position)) { abs = true; break; }
    if (abs) continue;
    let p = el.parentElement, ok = r.bottom <= vh + 1, inside = false;
    while (p && p !== document.body) {
      const s = getComputedStyle(p), pb = p.getBoundingClientRect().bottom;
      // Content cut inside a box that doesn't scroll (a card too small for its text).
      if (/(hidden|clip)/.test(s.overflowY) && pb < r.bottom - 1 && !scrolls(p)) { ok = false; inside = true; break; }
      if (!ok && scrolls(p)) { ok = true; break; }
      p = p.parentElement;
    }
    if (ok) continue;
    if (inside || r.bottom > vh + 1) cut.push((el.id ? '#' + el.id : el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : el.tagName) + ' +' + Math.round(r.bottom - vh));
  }
  const wide = Math.max(0, document.documentElement.scrollWidth - vw);
  return JSON.stringify({ cut: [...new Set(cut)].slice(0, 6), n: cut.length, wide });
})()`;

(async () => {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const ws = new WebSocket(list.find((t) => t.type === 'page' && t.url.includes('index.html')).webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
  let bad = 0;
  for (const [w, h] of SIZES) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    for (const [name, nav] of PAGES) {
      await ev(`try{${nav}}catch(e){}`);
      await new Promise((r) => setTimeout(r, 1800));
      const res = JSON.parse(await ev(PROBE));
      const ok = !res.n && !res.wide;
      if (!ok) {
        bad++;
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        if (shot.result) fs.writeFileSync(`${out}/reach-${w}x${h}-${name}.png`, Buffer.from(shot.result.data, 'base64'));
      }
      console.log(`${ok ? 'OK  ' : 'CUT '} ${w}x${h}  ${name.padEnd(16)} ${ok ? '' : `${res.n} coupé(s) ${res.cut.join(' ')}${res.wide ? ` · trop large +${res.wide}px` : ''}`}`);
    }
  }
  await send('Emulation.clearDeviceMetricsOverride');
  console.log(`${bad} problème(s)`);
  process.exit(0);
})();
