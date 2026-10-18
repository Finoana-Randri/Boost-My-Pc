// Informations système temps réel + "Boost" mémoire (équivalent PCBoost / BoostOptionsService).
const os = require('os');
const { execFile } = require('child_process');
const { runPS, runPSJson, asArray } = require('./ps');

let lastCpu = null;
function cpuUsage() {
  const cpus = os.cpus();
  const totals = cpus.reduce(
    (acc, c) => {
      const t = Object.values(c.times).reduce((a, b) => a + b, 0);
      acc.total += t;
      acc.idle += c.times.idle;
      return acc;
    },
    { total: 0, idle: 0 }
  );
  let pct = 0;
  if (lastCpu) {
    const dt = totals.total - lastCpu.total;
    const di = totals.idle - lastCpu.idle;
    pct = dt > 0 ? Math.round((1 - di / dt) * 100) : 0;
  }
  lastCpu = totals;
  return Math.max(0, Math.min(100, pct));
}

let lastNet = null;
function netBytes() {
  // `netstat -e` donne le total d'octets reçus/envoyés, rapide et sans droits admin
  return new Promise((resolve) => {
    execFile('netstat', ['-e'], { windowsHide: true, timeout: 5000 }, (err, out) => {
      if (err) return resolve(null);
      const line = out.split(/\r?\n/).find((l) => /^\s*(Bytes|Octets)/i.test(l));
      if (!line) return resolve(null);
      const nums = line.match(/\d+/g);
      if (!nums || nums.length < 2) return resolve(null);
      resolve({ rx: Number(nums[0]), tx: Number(nums[1]), t: Date.now() });
    });
  });
}

async function netSpeed() {
  const cur = await netBytes();
  let speed = { down: 0, up: 0 };
  if (cur && lastNet) {
    const dt = (cur.t - lastNet.t) / 1000;
    if (dt > 0) {
      speed = {
        down: Math.max(0, (cur.rx - lastNet.rx) / dt),
        up: Math.max(0, (cur.tx - lastNet.tx) / dt),
      };
    }
  }
  if (cur) lastNet = cur;
  return speed;
}

async function getStats() {
  const total = os.totalmem();
  const free = os.freemem();
  const net = await netSpeed();
  return {
    cpu: cpuUsage(),
    memory: { total, used: total - free, percent: Math.round(((total - free) / total) * 100) },
    net,
    uptime: os.uptime(),
  };
}

async function getDisks() {
  const disks = await runPSJson(
    `Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID,VolumeName,FileSystem,Size,FreeSpace | ConvertTo-Json -Compress`
  );
  return asArray(disks).map((d) => ({
    id: d.DeviceID,
    label: d.VolumeName || 'Disque local',
    fs: d.FileSystem,
    size: Number(d.Size),
    free: Number(d.FreeSpace),
  }));
}

let sysInfoCache = null;
async function getSystemInfo() {
  if (sysInfoCache) return sysInfoCache;
  const info = await runPSJson(`
    $os = Get-CimInstance Win32_OperatingSystem
    $cs = Get-CimInstance Win32_ComputerSystem
    $gpu = (Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join ', '
    [pscustomobject]@{ os=$os.Caption; build=$os.BuildNumber; version=$os.Version; model=$cs.Model; maker=$cs.Manufacturer; gpu=$gpu } | ConvertTo-Json -Compress
  `).catch(() => ({}));
  sysInfoCache = {
    ...info,
    hostname: os.hostname(),
    user: os.userInfo().username,
    cpu: os.cpus()[0]?.model?.trim(),
    cores: os.cpus().length,
    totalMem: os.totalmem(),
    arch: os.arch(),
  };
  return sysInfoCache;
}

// Vide le working set de tous les processus accessibles (comme "Boost memory" de PC Manager)
async function boostMemory() {
  const before = os.freemem();
  const count = await runPS(`
    Add-Type -Namespace PCM -Name Mem -MemberDefinition '[DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(System.IntPtr hProcess);'
    $n = 0
    foreach ($p in Get-Process) {
      try { if ([PCM.Mem]::EmptyWorkingSet($p.Handle)) { $n++ } } catch {}
    }
    $n
  `, { timeout: 120000 });
  await new Promise((r) => setTimeout(r, 800));
  const after = os.freemem();
  return { processes: Number(count) || 0, freed: Math.max(0, after - before) };
}

module.exports = { getStats, getDisks, getSystemInfo, boostMemory };
