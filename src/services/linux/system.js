// Linux stats from /proc, disk usage from df, system info, and Boost.
const os = require('os');
const fs = require('fs');
const { run, sh, which, isRoot, readText, getOsRelease } = require('./sh');

let lastCpu = null;
function cpuUsage() {
  const line = (readText('/proc/stat') || '').split('\n')[0];
  const v = line.trim().split(/\s+/).slice(1).map(Number);
  if (v.length < 4) return 0;
  const idle = v[3] + (v[4] || 0);
  const total = v.reduce((a, b) => a + b, 0);
  let pct = 0;
  if (lastCpu) {
    const dt = total - lastCpu.total;
    pct = dt > 0 ? Math.round((1 - (idle - lastCpu.idle) / dt) * 100) : 0;
  }
  lastCpu = { total, idle };
  return Math.max(0, Math.min(100, pct));
}

function memInfo() {
  const m = {};
  for (const l of (readText('/proc/meminfo') || '').split('\n')) {
    const r = l.match(/^(\w+):\s+(\d+)/);
    if (r) m[r[1]] = Number(r[2]) * 1024;
  }
  const total = m.MemTotal || os.totalmem();
  const avail = m.MemAvailable ?? os.freemem();
  return { total, used: total - avail, available: avail, percent: Math.round(((total - avail) / total) * 100), cached: (m.Cached || 0) + (m.Buffers || 0) };
}

let lastNet = null;
function netSpeed() {
  let rx = 0, tx = 0;
  for (const l of (readText('/proc/net/dev') || '').split('\n').slice(2)) {
    const [iface, rest] = l.split(':');
    if (!rest || /^\s*(lo|docker|veth|br-|virbr)/.test(iface)) continue;
    const f = rest.trim().split(/\s+/).map(Number);
    rx += f[0]; tx += f[8];
  }
  const now = Date.now();
  let speed = { down: 0, up: 0 };
  if (lastNet) {
    const dt = (now - lastNet.t) / 1000;
    if (dt > 0) speed = { down: Math.max(0, (rx - lastNet.rx) / dt), up: Math.max(0, (tx - lastNet.tx) / dt) };
  }
  lastNet = { rx, tx, t: now };
  return speed;
}

async function getStats() {
  const mem = memInfo();
  return { cpu: cpuUsage(), memory: mem, net: netSpeed(), uptime: os.uptime(), load: os.loadavg()[0], cores: os.cpus().length };
}

async function getDisks() {
  const out = await run('df', ['-B1', '-P', '-T']).catch(() => '');
  const seen = new Set();
  const disks = [];
  for (const l of out.split('\n').slice(1)) {
    const f = l.trim().split(/\s+/);
    if (f.length < 7) continue;
    const [src, fs, size, , avail] = f;
    const mount = f.slice(6).join(' ');
    if (!src.startsWith('/dev/') || /^\/dev\/loop/.test(src)) continue;
    if (/^(squashfs|tmpfs|devtmpfs|overlay|efivarfs|vfat)$/.test(fs) && mount !== '/') continue;
    if (/^\/(boot|snap|var\/snap|etc|proc|sys|dev|run)(\/|$)/.test(mount)) continue;
    if (seen.has(src)) continue; // Btrfs can report several subvolumes for one device.
    seen.add(src);
    disks.push({ id: mount, label: mount === '/' ? 'Système' : mount === '/home' ? 'Dossier personnel' : mount.split('/').pop() || mount, fs, size: Number(size), free: Number(avail), device: src });
  }
  // Fall back to statfs on / for ZFS, overlay, and live systems.
  if (!disks.length) {
    try {
      const s = fs.statfsSync('/');
      disks.push({ id: '/', label: 'Système', fs: '', size: s.blocks * s.bsize, free: s.bavail * s.bsize, device: '' });
    } catch {}
  }
  return disks;
}

let infoCache = null;
async function getSystemInfo() {
  if (infoCache) return infoCache;
  const rel = getOsRelease();
  const dmi = (k) => (readText(`/sys/class/dmi/id/${k}`) || '').trim();
  let gpu = '';
  if (which('lspci')) {
    gpu = (await run('lspci').catch(() => '')).split('\n').filter((l) => /VGA|3D controller|Display/.test(l))
      .map((l) => l.replace(/^.*?:\s.*?:\s/, '').replace(/\s*\(rev .*\)$/, '')).join(', ');
  }
  infoCache = {
    os: rel.PRETTY_NAME || 'Linux',
    distroId: rel.ID,
    build: os.release(),
    version: os.release(),
    model: dmi('product_name'),
    maker: dmi('sys_vendor'),
    gpu,
    desktop: process.env.XDG_CURRENT_DESKTOP || process.env.DESKTOP_SESSION || '',
    session: process.env.XDG_SESSION_TYPE || '',
    hostname: os.hostname(),
    user: os.userInfo().username,
    cpu: os.cpus()[0]?.model?.trim(),
    cores: os.cpus().length,
    totalMem: os.totalmem(),
    arch: os.arch(),
  };
  return infoCache;
}

// Linux manages memory itself. Boost syncs disks and can optionally clear the page cache.
async function boostMemory({ dropCaches = false } = {}) {
  const before = memInfo().available;
  await sh('sync').catch(() => {});
  if (dropCaches) {
    const { privileged } = require('./sh');
    await privileged('sync; echo 3 > /proc/sys/vm/drop_caches');
  } else if (isRoot()) {
    fs.writeFileSync('/proc/sys/vm/drop_caches', '1');
  }
  await new Promise((r) => setTimeout(r, 600));
  const after = memInfo().available;
  return { processes: 0, freed: Math.max(0, after - before) };
}

module.exports = { getStats, getDisks, getSystemInfo, boostMemory };
