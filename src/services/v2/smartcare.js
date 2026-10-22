// Smart Care runs five checks in one scan.
// Run applies only safe actions that do not need a password.
const os = require('os');
const path = require('path');
const fs = require('fs');

function downloadsDir() {
  try {
    const m = fs.readFileSync(path.join(os.homedir(), '.config', 'user-dirs.dirs'), 'utf8').match(/^XDG_DOWNLOAD_DIR="(.+)"$/m);
    if (m) return m[1].replace('$HOME', os.homedir());
  } catch {}
  return path.join(os.homedir(), 'Downloads');
}

function createSmartCare(services) {
  const { cleaner, protection, apps, storage, maintenance, malware } = services;
  let last = null;
  let current = null; // Scan in progress; a new scan stops the previous one.

  async function scan(onProgress) {
    if (current) current.cancelled = true;
    const run = { cancelled: false };
    current = run;
    const step = async (id, fn, _onProgress, index) => {
      if (run.cancelled) throw new Error('Analyse arrêtée.');
      onProgress?.({ step: id, index, total: 5 });
      try { return { id, ...(await fn()) }; }
      catch (e) { return { id, error: e.message, issues: 0 }; }
    };
    const steps = [];
    steps.push(await step('cleanup', async () => {
      const r = await cleaner.scan('health');
      const items = r.items.filter((i) => i.recommended && !i.needsAdmin && i.size > 0);
      const size = items.reduce((a, i) => a + i.size, 0);
      return { size, ids: items.map((i) => i.id), issues: size > 50 * 1024 ** 2 ? 1 : 0, detail: items.map((i) => i.name).join(', ') };
    }, onProgress, 0));
    steps.push(await step('protection', async () => {
      const r = await malware.quickCheck(protection);
      return { threats: r.threats, note: r.note, issues: r.threats.length };
    }, onProgress, 1));
    steps.push(await step('performance', async () => {
      const tasks = (await maintenance.list()).filter((t) => t.recommended && !t.admin);
      const startup = await apps.listStartup().catch(() => []);
      const enabled = startup.filter((s) => s.enabled).length;
      return { tasks: tasks.map((t) => ({ id: t.id, name: t.name })), startup: enabled, issues: tasks.length ? 1 : 0 };
    }, onProgress, 2));
    steps.push(await step('applications', async () => {
      const u = await protection.checkWindowsUpdates();
      const security = u.updates.filter((x) => /sécurité|security/i.test(x.category || '')).length;
      return { updates: u.updates.length, security, pendingReboot: !!u.pendingReboot, issues: u.updates.length ? 1 : 0 };
    }, onProgress, 3));
    steps.push(await step('clutter', async () => {
      const files = await storage.findLargeFiles({ root: downloadsDir(), minSize: 50 * 1024 ** 2, olderThanDays: 60, limit: 50 });
      const size = files.reduce((a, f) => a + f.size, 0);
      return { files: files.slice(0, 10), count: files.length, size, issues: files.length ? 1 : 0 };
    }, onProgress, 4));
    if (run.cancelled) throw new Error('Analyse arrêtée.');
    current = null;
    onProgress?.({ step: 'clutter', index: 5, total: 5 });
    last = { steps, at: Date.now() };
    return last;
  }

  // Run only safe cleanup and maintenance tasks that do not need admin rights.
  async function run(onProgress) {
    if (!last) throw new Error('Lancez d\'abord une analyse.');
    const res = { freed: 0, tasks: 0 };
    const c = last.steps.find((s) => s.id === 'cleanup');
    if (c?.ids?.length) {
      onProgress?.({ step: 'cleanup' });
      const r = await cleaner.clean(c.ids);
      res.freed = r.freed;
    }
    const p = last.steps.find((s) => s.id === 'performance');
    if (p?.tasks?.length) {
      onProgress?.({ step: 'performance' });
      const r = await maintenance.run(p.tasks.map((t) => t.id), { boost: services.boost });
      res.tasks = r.filter((x) => x.ok).length;
    }
    last = null;
    return res;
  }

  // Stop the scan before its next step.
  const cancel = () => { if (current) current.cancelled = true; };

  return { scan, run, cancel };
}

module.exports = { createSmartCare };
