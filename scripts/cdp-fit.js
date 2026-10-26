// Responsive check: open each page at several window sizes and report pages that overflow
// (vertical scroll needed, or anything wider than the window). Saves a screenshot per page and size.
// Run: node scripts/cdp-fit.js <port> <folder> [WxH ...]
const fs = require('fs');
const [port, out, ...sizes] = process.argv.slice(2);
const SIZES = (sizes.length ? sizes : ['880x530', '1093x590', '1280x690']).map((s) => s.split('x').map(Number));
// Pages with a fixed layout (they should fit) and how to open them.
const PAGES = [
  ['smart-intro', "smartResult=null;smartDone=null;go('smart')"],
  ['cleanup-intro', "cleanResult=null;go('cleanup')"],
  ['protection-intro', "delete overviewCache.protection;go('protection')"],
  ['threats-intro', "malwareResult=null;go('protection/threats')"],
  ['performance-intro', "delete overviewCache.performance;go('performance')"],
  ['applications-intro', "delete overviewCache.applications;go('applications')"],
  ['clutter-intro', "delete overviewCache.clutter;go('clutter')"],
  ['duplicates-intro', "go('clutter/duplicates')"],
  ['lens-intro', "lensData=null;go('lens')"],
  ['shredder', "go('shredder')"],
  ['tools', "go('tools')"],
  // settings/prefs scrolls on small windows on purpose (one column, full text): see cdp-reach.js.
  ['settings-about', "go('settings/about')"],
  ['done', "page(doneView('cleanup','2,4 Go libérés','1 234 fichiers supprimés','cleanup'))"],
  ['scanning', "page(scanning('cleanup','Recherche des fichiers inutiles…','Caches des navigateurs (2/11)',{stop:true}))"],
];
(async () => {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const ws = new WebSocket(list.find((t) => t.type === 'page' && t.url.includes('index.html')).webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send('Runtime.enable');
  await send('Page.bringToFront');
  // Load the current code and styles.
  await ev('location.reload()');
  await new Promise((r) => setTimeout(r, 3000));
  let bad = 0;
  for (const [w, h] of SIZES) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    for (const [name, js] of PAGES) {
      await ev(js);
      await new Promise((r) => setTimeout(r, 1300));
      const m = await ev(`(() => { const c = document.querySelector('.content'); const cr = c.getBoundingClientRect().right;
        const wide = [...document.querySelectorAll('.page *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.right > cr + 1 && !e.closest('.ms-stage, .wv, .mi-stage'); }).length;
        const sc = document.querySelector('.dbody') || c; return { over: Math.max(c.scrollHeight - c.clientHeight, sc.scrollHeight - sc.clientHeight), wide }; })()`);
      const fit = m.over <= 1 && !m.wide;
      if (!fit) bad++;
      console.log(`${fit ? 'OK  ' : 'OVER'} ${`${w}x${h}`.padEnd(9)} ${name.padEnd(20)} vertical +${m.over}px  wide ${m.wide}`);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(`${out}/fit-${w}x${h}-${name}.png`, Buffer.from(shot.result.data, 'base64'));
    }
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 0, height: 0, deviceScaleFactor: 0, mobile: false });
  console.log(`${bad} overflow(s) · errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  process.exit(0);
})();
