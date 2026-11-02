// Live system information and memory Boost.
const os = require('os');
const { execFile } = require('child_process');
const { runPSJson, asArray } = require('./ps');

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
  // `netstat -e` reports total bytes received and sent without admin rights.
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

// Trim the working set of each process we can access.
// Memory Boost:
// 1. every process gives back the memory it is not using (its working set is trimmed);
// 2. as administrator, modified pages are written out and the standby list (cached files) is
//    emptied, as RAMMap does, so that the memory shows up as free;
// 3. memory is measured before and after with the Windows performance counters.
const BOOST_PS = `
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Diagnostics;
public static class BmpMem {
  [DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(IntPtr process);
  [DllImport("ntdll.dll")] static extern int NtSetSystemInformation(int infoClass, ref int info, int length);
  [StructLayout(LayoutKind.Sequential, Pack = 1)] struct Privilege { public int Count; public long Luid; public int Attributes; }
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, int access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool LookupPrivilegeValue(string host, string name, out long luid);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool AdjustTokenPrivileges(IntPtr token, bool disableAll, ref Privilege state, int length, IntPtr previous, IntPtr returned);
  public static bool Enable(string name) {
    IntPtr token;
    if (!OpenProcessToken(Process.GetCurrentProcess().Handle, 0x28, out token)) return false;
    Privilege p; p.Count = 1; p.Attributes = 2;
    if (!LookupPrivilegeValue(null, name, out p.Luid)) return false;
    return AdjustTokenPrivileges(token, false, ref p, 0, IntPtr.Zero, IntPtr.Zero) && Marshal.GetLastWin32Error() == 0;
  }
  // SystemMemoryListInformation: 3 writes the modified pages, 4 empties the standby list.
  public static bool MemoryList(int command) { return NtSetSystemInformation(80, ref command, 4) == 0; }
}
'@
function Mem { $m = Get-CimInstance Win32_PerfRawData_PerfOS_Memory; [pscustomobject]@{ avail = [int64]$m.AvailableBytes; free = [int64]$m.FreeAndZeroPageListBytes } }
$total = [int64](Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory
$before = Mem
$sizes = @{}
foreach ($p in Get-Process) { $sizes[$p.Id] = $p.WorkingSet64 }
$n = 0
foreach ($p in Get-Process) { try { if ([BmpMem]::EmptyWorkingSet($p.Handle)) { $n++ } } catch {} }
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$purged = $false
if ($admin -and [BmpMem]::Enable('SeProfileSingleProcessPrivilege')) {
  [void][BmpMem]::MemoryList(3)
  $purged = [BmpMem]::MemoryList(4)
}
Start-Sleep -Milliseconds 600
$after = Mem
$top = @(Get-Process | Where-Object { $sizes.ContainsKey($_.Id) } | ForEach-Object {
  [pscustomobject]@{ name = $(if ($_.Description) { ($_.Description -split ':')[0].Trim() } else { $_.ProcessName }); saved = [int64]($sizes[$_.Id] - $_.WorkingSet64) } } |
  Where-Object { $_.saved -gt 0 } | Group-Object name | ForEach-Object { [pscustomobject]@{ name = $_.Name; saved = [int64]($_.Group | Measure-Object saved -Sum).Sum } } |
  Sort-Object saved -Descending | Select-Object -First 5)
[pscustomobject]@{ total = $total; before = $before; after = $after; trimmed = $n; admin = $admin; purged = $purged; top = $top } | ConvertTo-Json -Compress -Depth 4
`;

async function boostMemory() {
  const r = await runPSJson(BOOST_PS, { timeout: 120000 });
  const total = Number(r?.total) || os.totalmem();
  const used = (m) => total - (Number(m?.avail) || 0);
  const before = used(r?.before);
  const after = used(r?.after);
  const freed = Math.max(0, before - after);
  // The standby list holds files kept in memory: emptying it shows as free memory, not as memory
  // given back by the apps.
  const cache = Math.max(0, (Number(r?.after?.free) || 0) - (Number(r?.before?.free) || 0) - freed);
  return {
    freed,
    cache,
    processes: Number(r?.trimmed) || 0,
    admin: !!r?.admin,
    purged: !!r?.purged,
    before: { used: before, total, pct: Math.round((before / total) * 100) },
    after: { used: after, total, pct: Math.round((after / total) * 100) },
    top: asArray(r?.top).map((t) => ({ name: t.name, saved: Number(t.saved) || 0 })),
  };
}

module.exports = { getStats, getDisks, getSystemInfo, boostMemory };
