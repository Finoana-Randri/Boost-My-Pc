// PC health: real measurements for the processor, memory, storage, battery and system,
// combined into a score with recommendations. Values that the system does not expose are null.
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const isLinux = process.platform === 'linux';

// Processor usage measured over a short interval.
function cpuUsage(ms = 1000) {
  const snap = () => os.cpus().reduce((a, c) => {
    const t = Object.values(c.times).reduce((x, y) => x + y, 0);
    return { total: a.total + t, idle: a.idle + c.times.idle };
  }, { total: 0, idle: 0 });
  const a = snap();
  return new Promise((resolve) => setTimeout(() => {
    const b = snap();
    const dt = b.total - a.total;
    resolve(dt > 0 ? Math.round((1 - (b.idle - a.idle) / dt) * 100) : 0);
  }, ms));
}

// ---------- Windows ----------
// Three independent queries run in parallel; the storage counters are the slowest.
const WIN_STORAGE = `
  $disks = @(Get-PhysicalDisk | ForEach-Object {
    $rel = $_ | Get-StorageReliabilityCounter
    [pscustomobject]@{ name = $_.FriendlyName; media = [string]$_.MediaType; bus = [string]$_.BusType; health = [string]$_.HealthStatus
      size = [int64]$_.Size; wear = $rel.Wear; temp = $rel.Temperature } })
  $vols = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { [pscustomobject]@{ id = $_.DeviceID; size = [int64]$_.Size; free = [int64]$_.FreeSpace } })
  [pscustomobject]@{ disks = $disks; vols = $vols } | ConvertTo-Json -Compress -Depth 4`;

const WIN_POWER = `
  $temp = $null
  $tz = Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature
  if ($tz) { $temp = [math]::Round((($tz | Measure-Object CurrentTemperature -Maximum).Maximum / 10) - 273.15) }
  $bat = Get-CimInstance Win32_Battery | Select-Object -First 1
  $design = (Get-CimInstance -Namespace root/wmi -ClassName BatteryStaticData | Select-Object -First 1).DesignedCapacity
  $full = (Get-CimInstance -Namespace root/wmi -ClassName BatteryFullChargedCapacity | Select-Object -First 1).FullChargedCapacity
  $cycles = (Get-CimInstance -Namespace root/wmi -ClassName BatteryCycleCount | Select-Object -First 1).CycleCount
  if ($bat -and (-not $design -or -not $full)) {
    # Without administrator rights, the battery report of powercfg gives the same capacities.
    $f = Join-Path $env:TEMP ('bmp-battery-' + [guid]::NewGuid() + '.xml')
    & powercfg.exe '/batteryreport' '/xml' '/output' $f | Out-Null
    if (Test-Path $f) {
      $b0 = ([xml](Get-Content $f)).BatteryReport.Batteries.Battery | Select-Object -First 1
      $design = [int64]$b0.DesignCapacity; $full = [int64]$b0.FullChargeCapacity
      if (-not $cycles -and [int]$b0.CycleCount -gt 0) { $cycles = [int]$b0.CycleCount }
      Remove-Item -LiteralPath $f -Force
    }
  }
  [pscustomobject]@{ temp = $temp
    battery = $(if ($bat) { [pscustomobject]@{ charge = $bat.EstimatedChargeRemaining; status = $bat.BatteryStatus; design = $design; full = $full; cycles = $cycles } }) } | ConvertTo-Json -Compress -Depth 4`;

const WIN_SYSTEM = `
  $os = Get-CimInstance Win32_OperatingSystem
  $mp = Get-MpComputerStatus
  $reboot = (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired') -or (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending')
  [pscustomobject]@{ cpuName = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name; os = $os.Caption; reboot = $reboot
    av = $(if ($mp) { [pscustomobject]@{ on = [bool]$mp.RealTimeProtectionEnabled; age = $mp.AntivirusSignatureAge } }) } | ConvertTo-Json -Compress -Depth 4`;

async function windowsData() {
  const { runPSJson, asArray } = require('../ps');
  const q = (script) => runPSJson(`$ErrorActionPreference = 'SilentlyContinue'\n${script}`, { timeout: 60000 }).catch(() => null);
  const [st, pw, sy] = await Promise.all([q(WIN_STORAGE), q(WIN_POWER), q(WIN_SYSTEM)]);
  const r = { ...st, ...pw, ...sy };
  const vols = asArray(r.vols);
  const b = r.battery;
  return {
    cpu: { name: r.cpuName || os.cpus()[0]?.model, temp: Number.isFinite(r.temp) && r.temp > 0 && r.temp < 120 ? r.temp : null },
    disks: asArray(r.disks).map((d) => ({
      name: d.name, type: /SSD/i.test(d.media) || /NVMe/i.test(d.bus) ? 'SSD' : /HDD/i.test(d.media) ? 'HDD' : '',
      health: /Healthy/i.test(d.health) ? 'good' : /Warning/i.test(d.health) ? 'warn' : /Unhealthy/i.test(d.health) ? 'bad' : null,
      wear: Number.isFinite(d.wear) ? d.wear : null, temp: Number.isFinite(d.temp) && d.temp > 0 ? d.temp : null, size: d.size,
    })),
    volumes: vols.map((v) => ({ id: v.id, size: v.size, free: v.free })),
    battery: b ? { charge: b.charge ?? null, charging: [2, 6, 7, 8, 9].includes(b.status), health: b.design && b.full ? Math.min(100, Math.round((b.full / b.design) * 100)) : null, cycles: b.cycles || null } : null,
    system: { os: r.os, uptime: os.uptime(), reboot: !!r.reboot, antivirus: r.av ? { on: r.av.on, signatureAge: r.av.age } : null, failed: [] },
  };
}

// ---------- Linux ----------
const read = (f) => { try { return fs.readFileSync(f, 'utf8').trim(); } catch { return null; } };
const num = (f) => { const v = Number(read(f)); return Number.isFinite(v) ? v : null; };
function run(cmd, args, timeout = 8000) {
  return new Promise((resolve) => execFile(cmd, args, { timeout }, (err, out) => resolve(err && !out ? '' : String(out))));
}

function linuxTemp() {
  // Prefer the processor package sensor, then any thermal zone.
  try {
    for (const h of fs.readdirSync('/sys/class/hwmon')) {
      const dir = path.join('/sys/class/hwmon', h);
      if (/coretemp|k10temp|zenpower|cpu/i.test(read(path.join(dir, 'name')) || '')) {
        const t = num(path.join(dir, 'temp1_input'));
        if (t) return Math.round(t / 1000);
      }
    }
  } catch {}
  try {
    for (const z of fs.readdirSync('/sys/class/thermal').filter((x) => x.startsWith('thermal_zone'))) {
      const t = num(`/sys/class/thermal/${z}/temp`);
      if (t && t > 1000) return Math.round(t / 1000);
    }
  } catch {}
  return null;
}

async function linuxData() {
  const df = await run('df', ['-B1', '--output=target,size,avail', '-x', 'tmpfs', '-x', 'devtmpfs', '-x', 'squashfs', '-x', 'overlay']);
  const volumes = df.split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((p) => p.length === 3 && /^\//.test(p[0]))
    .filter((p) => p[0] === '/' || p[0] === '/home' || p[0].startsWith('/mnt') || p[0].startsWith('/media'))
    .map(([id, size, free]) => ({ id, size: Number(size), free: Number(free) }));
  if (!volumes.length) {
    try { const s = fs.statfsSync('/'); volumes.push({ id: '/', size: s.blocks * s.bsize, free: s.bavail * s.bsize }); } catch {}
  }
  let disks = [];
  try {
    disks = fs.readdirSync('/sys/block').filter((d) => !/^(loop|ram|zram|dm-|sr)/.test(d)).map((d) => ({
      name: read(`/sys/block/${d}/device/model`) || d,
      type: read(`/sys/block/${d}/queue/rotational`) === '0' ? 'SSD' : 'HDD',
      health: null, wear: null, temp: null, size: (num(`/sys/block/${d}/size`) || 0) * 512,
    }));
  } catch {}
  let battery = null;
  try {
    const bat = fs.readdirSync('/sys/class/power_supply').find((x) => /^BAT/i.test(x));
    if (bat) {
      const d = `/sys/class/power_supply/${bat}`;
      const full = num(`${d}/energy_full`) ?? num(`${d}/charge_full`);
      const design = num(`${d}/energy_full_design`) ?? num(`${d}/charge_full_design`);
      battery = { charge: num(`${d}/capacity`), charging: /charging|full/i.test(read(`${d}/status`) || ''), health: full && design ? Math.min(100, Math.round((full / design) * 100)) : null, cycles: num(`${d}/cycle_count`) || null };
    }
  } catch {}
  const failed = (await run('systemctl', ['--failed', '--no-legend', '--plain'])).split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((u) => u && u.includes('.'));
  const osName = (read('/etc/os-release') || '').match(/^PRETTY_NAME="?([^"\n]+)/m)?.[1];
  return {
    cpu: { name: os.cpus()[0]?.model, temp: linuxTemp() },
    disks, volumes, battery,
    system: { os: osName, uptime: os.uptime(), reboot: fs.existsSync('/var/run/reboot-required'), antivirus: null, failed },
  };
}

// ---------- Score ----------
// Start from 100 and subtract for each real problem; each deduction comes with a recommendation.
function score(d) {
  let s = 100;
  const tips = [];
  const hit = (pts, level, text, route) => { s -= pts; tips.push({ level, text, route }); };
  if (d.cpu.temp != null) {
    if (d.cpu.temp >= 90) hit(20, 'bad', `Processeur très chaud (${d.cpu.temp} °C) : dépoussiérez les ventilateurs et vérifiez l'aération.`);
    else if (d.cpu.temp >= 80) hit(8, 'warn', `Processeur chaud (${d.cpu.temp} °C) : fermez les applications gourmandes.`, 'performance/processes');
  }
  if (d.cpu.usage >= 90) hit(6, 'warn', 'Le processeur est presque saturé : repérez les applications gourmandes.', 'performance/processes');
  if (d.memory.percent >= 90) hit(15, 'bad', 'Mémoire presque pleine : libérez de la mémoire ou fermez des applications.', 'performance/processes');
  else if (d.memory.percent >= 80) hit(6, 'warn', 'Mémoire bien remplie : un Boost peut libérer de la place.', 'tools');
  for (const v of d.volumes) {
    const free = v.size ? v.free / v.size : 1;
    if (free < 0.1) hit(18, 'bad', `Disque ${v.id} presque plein (${Math.round(free * 100)} % libre) : lancez un nettoyage.`, 'cleanup');
    else if (free < 0.2) hit(7, 'warn', `Disque ${v.id} : moins de 20 % d'espace libre.`, 'lens');
  }
  for (const k of d.disks) {
    if (k.health === 'bad') hit(30, 'bad', `Le disque « ${k.name} » signale une défaillance : sauvegardez vos données au plus vite.`);
    else if (k.health === 'warn') hit(15, 'warn', `Le disque « ${k.name} » signale un avertissement : pensez à sauvegarder vos données.`);
    if (k.wear != null && k.wear >= 80) hit(10, 'warn', `Le SSD « ${k.name} » est usé à ${k.wear} %.`);
  }
  if (d.battery?.health != null) {
    if (d.battery.health < 60) hit(12, 'bad', `Batterie usée (${d.battery.health} % de sa capacité d'origine) : envisagez de la remplacer.`);
    else if (d.battery.health < 80) hit(5, 'warn', `Batterie à ${d.battery.health} % de sa capacité d'origine.`);
  }
  if (d.system.antivirus && !d.system.antivirus.on) hit(20, 'bad', 'La protection en temps réel est désactivée.', 'protection/status');
  if (d.system.antivirus?.signatureAge > 7) hit(6, 'warn', `Signatures antivirus datant de ${d.system.antivirus.signatureAge} jours.`, 'protection/status');
  if (d.system.reboot) hit(5, 'warn', 'Un redémarrage est nécessaire pour terminer des mises à jour.');
  if (d.system.uptime > 14 * 86400) hit(4, 'info', `PC allumé depuis ${Math.floor(d.system.uptime / 86400)} jours : un redémarrage le rafraîchira.`);
  if (d.system.failed.length) hit(Math.min(12, d.system.failed.length * 4), 'warn', `${d.system.failed.length} service(s) système en échec : ${d.system.failed.slice(0, 3).join(', ')}.`);
  s = Math.max(0, Math.min(100, Math.round(s)));
  const grade = s >= 85 ? ['ok', 'Excellent'] : s >= 70 ? ['ok', 'Bon'] : s >= 50 ? ['warn', 'À surveiller'] : ['bad', 'Critique'];
  return { score: s, level: grade[0], label: grade[1], tips };
}

async function check() {
  // Measure the processor first: the queries below would inflate its usage.
  const usage = await cpuUsage();
  const base = await (isLinux ? linuxData() : windowsData());
  const total = os.totalmem(), free = os.freemem();
  const d = { ...base, cpu: { ...base.cpu, usage, cores: os.cpus().length }, memory: { total, used: total - free, free, percent: Math.round(((total - free) / total) * 100) } };
  return { ...d, ...score(d), at: Date.now() };
}

module.exports = { check, score };
