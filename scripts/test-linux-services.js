// Test des services Linux en lecture seule (utilisé dans un conteneur Docker Debian/Fedora/Arch).
// Usage : node scripts/test-linux-services.js
const path = require('path');
const L = (m) => require(path.join(__dirname, '..', 'src', 'services', 'linux', m));
const storage = require(path.join(__dirname, '..', 'src', 'services', 'storage'));

const t = async (name, fn, show) => {
  const s = Date.now();
  try {
    const r = await fn();
    console.log('OK  ', name.padEnd(12), `${Date.now() - s}ms`.padStart(7), JSON.stringify(show ? show(r) : r).slice(0, 600));
  } catch (e) {
    console.log('FAIL', name.padEnd(12), e.stack.split('\n').slice(0, 3).join(' | '));
    process.exitCode = 1;
  }
};

(async () => {
  const sys = L('system'), cl = L('cleaner'), ap = L('apps'), pr = L('protection'), sh = L('sh');
  console.log('distro:', sh.getOsRelease().PRETTY_NAME, '· pm:', sh.packageManager());
  await t('stats', sys.getStats);
  await new Promise((r) => setTimeout(r, 1000));
  await t('stats2', sys.getStats);
  await t('disks', sys.getDisks);
  await t('info', sys.getSystemInfo);
  await t('boost', () => sys.boostMemory({}));
  await t('scanHealth', () => cl.scan('health'), (r) => r.items.map((i) => [i.id, i.size, i.files, i.needsAdmin]));
  await t('scanDeep', () => cl.scan('deep'), (r) => r.items.map((i) => [i.id, i.size, i.files]));
  await t('cleanTmp', async () => {
    const fs = require('fs');
    const f = '/tmp/pcm-test-old.txt';
    fs.writeFileSync(f, 'x'.repeat(5000));
    fs.utimesSync(f, new Date(Date.now() - 3 * 86400000), new Date(Date.now() - 3 * 86400000));
    const r = await cl.clean(['tmp']);
    return { ...r, stillExists: fs.existsSync(f) };
  });
  await t('processes', ap.listProcesses, (r) => [r.length, r.slice(0, 3).map((p) => [p.name, p.desc, p.memory, p.ids.length])]);
  await t('startup', async () => {
    // /etc/xdg/autostart/demo.desktop est créé par root avant le test (voir la commande docker)
    const before = await ap.listStartup();
    if (!before.find((i) => i.file === 'demo.desktop')) return { skipped: 'demo.desktop absent', before };
    await ap.setStartup(before.find((i) => i.file === 'demo.desktop'), false);
    const after = await ap.listStartup();
    return { before: before.map((i) => [i.name, i.enabled, i.hive]), after: after.map((i) => [i.name, i.enabled]) };
  });
  await t('killGraceful', async () => {
    const { spawn } = require('child_process');
    const child = spawn('sleep', ['300']);
    await new Promise((r) => setTimeout(r, 200));
    await ap.killProcesses([child.pid], 'sleep');
    await new Promise((r) => setTimeout(r, 300));
    if (child.exitCode === null && child.signalCode === null) throw new Error('le processus tourne encore');
    return { signal: child.signalCode };
  });
  await t('killRefuse', async () => {
    const out = [];
    for (const [ids, name] of [[[-1], 'x'], [[0, 1], 'x'], [[999999], 'gnome-shell'], [[], 'x']]) {
      try { await ap.killProcesses(ids, name); out.push('ACCEPTÉ (bug)'); } catch (e) { out.push(e.message); }
    }
    if (out.some((m) => m.includes('bug'))) throw new Error(out.join(' | '));
    return out;
  });
  await t('installed', ap.listInstalledApps, (r) => [r.length, r.slice(0, 5)]);
  await t('icon', () => ap.iconDataUrl('xterm-color').then((u) => u && u.slice(0, 40)));
  await t('security', pr.securityStatus, (r) => r.cards.map((c) => [c.title, c.ok, c.status]));
  await t('updates', pr.checkWindowsUpdates, (r) => [r.manager, r.updates.length, r.updates.slice(0, 3), r.pendingReboot]);
  await t('network', pr.networkDiagnose, (r) => [r.latency, r.checks.map((c) => [c.id, c.ok, c.detail])]);
  await t('downloads', storage.listDownloads, (r) => [r.dir, r.items.length]);
  await t('large', () => storage.findLargeFiles({ root: '/usr', minSize: 5 * 1024 * 1024 }), (r) => [r.length, r[0]?.path]);
  await t('duplicates', () => storage.findDuplicates({ root: '/usr/share/doc', minSize: 1 }), (r) => [r.length]);
})();
