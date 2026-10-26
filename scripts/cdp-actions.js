// Run the app's real actions on test data (Linux Docker test) and check each result on disk.
// Never run it on a real computer: it deletes files. Run: node scripts/cdp-actions.js <port>
const fs = require('fs');
const os = require('os');
const path = require('path');
const [port] = process.argv.slice(2);
const H = os.homedir();
const exists = (p) => fs.existsSync(path.join(H, p));

(async () => {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const ws = new WebSocket(list.find((t) => t.type === 'page' && t.url.includes('index.html')).webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const ev = (e) => new Promise((r) => { const i = ++id; pend.set(i, (d) => r(d.result?.result?.value)); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: `(async()=>{try{return JSON.stringify(await (${e}))}catch(e){return JSON.stringify({error:e.message})}})()`, returnByValue: true, awaitPromise: true } })); });
  const call = async (e) => JSON.parse((await ev(e)) || 'null');
  let fails = 0;
  const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(22)} ${typeof info === 'string' ? info : JSON.stringify(info).slice(0, 160)}`); };

  // Cleanup: run every category the user can clean without the password.
  const scan = await call("pcm.clean.scan('deep')");
  const ids = (scan.items || []).filter((i) => i.size > 0 && !i.needsAdmin).map((i) => i.id);
  const cleaned = await call(`pcm.clean.run(${JSON.stringify(ids)})`);
  check('clean.run', !cleaned?.error && !exists('.cache/thumbnails/large/vignette.png'), { ids, cleaned });

  // Privacy: clean every item that isn't blocked by an open browser.
  const pv = await call('pcm.v2.privacyScan()');
  const pvIds = (pv || []).filter((i) => !i.blocked && i.size > 0).map((i) => i.id);
  const pvRes = await call(`pcm.v2.privacyClean(${JSON.stringify(pvIds)})`);
  check('privacy.clean', !pvRes?.error && pvRes.done === pvIds.length, { pvIds, pvRes });

  // Leftovers and threats go to the trash.
  const lo = await call('pcm.v2.leftovers()');
  const loPaths = (lo?.items || lo || []).map((i) => i.path).filter(Boolean);
  const loRes = await call(`pcm.file.trash(${JSON.stringify(loPaths)})`);
  check('leftovers.trash', !loRes?.error && loPaths.length > 0 && !exists('.config/vieille-appli-supprimee'), { loPaths, loRes });
  const mw = await call("pcm.v2.malwareScan('quick')");
  const mwPaths = (mw?.threats || []).filter((t) => t.removable && t.path).map((t) => t.path);
  const mwRes = await call(`pcm.file.trash(${JSON.stringify(mwPaths)})`);
  check('threats.trash', !mwRes?.error && !exists('.config/autostart/updater.desktop'), { mwPaths, mwRes });

  // Startup apps: turn one off and on again.
  fs.mkdirSync(path.join(H, '.config/autostart'), { recursive: true });
  fs.writeFileSync(path.join(H, '.config/autostart/test-app.desktop'), '[Desktop Entry]\nType=Application\nName=Test App\nExec=/bin/true\n');
  const su = await call('pcm.apps.startup()');
  const item = (su || []).find((i) => /test-app|Test App/.test(i.name + (i.file || '')));
  const off = item && await call(`pcm.apps.setStartup(${JSON.stringify(item)}, false)`);
  const after = (await call('pcm.apps.startup()') || []).find((i) => /test-app|Test App/.test(i.name + (i.file || '')));
  const on = after && await call(`pcm.apps.setStartup(${JSON.stringify(after)}, true)`);
  const back = (await call('pcm.apps.startup()') || []).find((i) => /test-app|Test App/.test(i.name + (i.file || '')));
  check('startup.toggle', !!item && after?.enabled === false && back?.enabled === true, { found: !!item, off, on, after: after?.enabled, back: back?.enabled });

  // Maintenance tasks that don't need the password.
  const mt = await call('pcm.v2.maintList()');
  const mtIds = (mt || []).filter((t) => !t.admin).map((t) => t.id);
  const mtRes = await call(`pcm.v2.maintRun(${JSON.stringify(mtIds)})`);
  check('maintenance.run', Array.isArray(mtRes) && mtRes.every((r) => r.ok), mtRes);

  // Large files, downloads and cloud files go to the trash.
  const lf = path.join(H, 'Downloads/ancien-installateur.iso');
  const lfRes = await call(`pcm.file.trash(${JSON.stringify([lf])})`);
  check('large.trash', !lfRes?.error && !fs.existsSync(lf), lfRes);
  const cf = path.join(H, 'Dropbox/projets/archive.zip');
  const cfRes = await call(`pcm.file.trash(${JSON.stringify([cf])})`);
  check('cloud.trash', !cfRes?.error && !fs.existsSync(cf), cfRes);

  // Shredder.
  const sf = path.join(H, 'secret.txt'); fs.writeFileSync(sf, 'secret'.repeat(1000));
  const shRes = await call(`pcm.v2.shred(${JSON.stringify([sf])}, { passes: 3 })`);
  check('shred', !shRes?.error && !fs.existsSync(sf), shRes);

  // Boost, tools, Smart Care run.
  const boost = await call('pcm.system.boost()');
  check('boost', !boost?.error, boost);
  const tool = await call("pcm.tool.launch('calculator')");
  check('tool.calculator', !tool?.error, tool || 'ok');
  const sc = await call('pcm.v2.smartScan()');
  const run = await call('pcm.v2.smartRun()');
  check('smart.run', !sc?.error && !run?.error, run);

  console.log(`ACTIONS: ${fails ? `${fails} échec(s)` : 'aucun échec'}`);
  process.exit(0);
})();
