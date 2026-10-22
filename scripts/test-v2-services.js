// Check v2 modules on Windows and Linux. Read-only, except for a temporary shredder file.
// Run: node scripts/test-v2-services.js
const path = require('path');
const os = require('os');
const fs = require('fs');
const V2 = (m) => require(path.join(__dirname, '..', 'src', 'services', 'v2', m));
const isLinux = process.platform === 'linux';

const t = async (name, fn, show) => {
  const s = Date.now();
  try {
    const r = await fn();
    console.log('OK  ', name.padEnd(16), `${Date.now() - s}ms`.padStart(7), JSON.stringify(show ? show(r) : r).slice(0, 500));
  } catch (e) {
    console.log('FAIL', name.padEnd(16), e.stack.split('\n').slice(0, 3).join(' | '));
    process.exitCode = 1;
  }
};

(async () => {
  const protection = require(path.join(__dirname, '..', 'src', 'services', isLinux ? 'linux/protection' : 'protection'));
  await t('maint.list', () => V2('maintenance').list(), (r) => r.map((x) => `${x.id}${x.admin ? '*' : ''}`));
  await t('privacy.scan', () => V2('privacy').scan(), (r) => r.map((x) => [x.id, x.size, x.blocked ? 'bloqué' : '']));
  await t('perm.list', () => V2('permissions').list(), (r) => [r.supported, r.apps.length, r.apps.slice(0, 2)]);
  await t('leftovers', () => V2('leftovers').scan(), (r) => [r.length, r.slice(0, 4).map((x) => [x.name, x.size])]);
  await t('lens', () => V2('spacelens').scan(isLinux ? '/usr/share' : path.join(os.homedir(), 'Documents')), (r) => [r.dirs, r.files, r.tree.size, r.tree.children.slice(0, 3).map((c) => [c.name, c.size])]);
  await t('cloud.detect', () => V2('cloud').detect());
  await t('malware.quick', () => V2('malware').quickCheck(protection), (r) => [r.threats.length, r.threats.slice(0, 3), r.note]);
  const sh = V2('shredder');
  await t('shred.forbidden', async () => {
    const root = path.parse(os.homedir()).root;
    const sys = isLinux ? '/etc/passwd' : path.join(process.env.WINDIR || 'C:\\Windows', 'win.ini');
    const r = [sh.isForbidden(root), sh.isForbidden(os.homedir()), sh.isForbidden(sys), sh.isForbidden(path.join(os.tmpdir(), 'a.txt'))];
    if (r.join() !== 'true,true,true,false') throw new Error(`protection incorrecte : ${r}`);
    return r;
  });
  await t('shred.file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-shred-'));
    const f = path.join(dir, 'secret.txt');
    fs.writeFileSync(f, 'secret'.repeat(5000));
    fs.writeFileSync(path.join(dir, 'b.bin'), Buffer.alloc(3 * 1024 * 1024, 7));
    const r = await sh.shred([dir], { passes: 2 });
    if (fs.existsSync(dir)) throw new Error('le dossier existe encore');
    return r;
  });
})();
