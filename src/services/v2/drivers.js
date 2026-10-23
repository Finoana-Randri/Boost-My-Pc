// Driver updates from official sources only:
// - Windows: Windows Update (Windows Update Agent API), the channel through which manufacturers publish signed drivers.
// - Linux: fwupd and the Linux Vendor Firmware Service (LVFS) for device firmware.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const isLinux = process.platform === 'linux';
const OLD_YEARS = 3;

// ---------- Windows ----------
async function windowsList() {
  const { runPSJson, asArray } = require('../ps');
  const r = await runPSJson(`
    $s = New-Object -ComObject Microsoft.Update.Session
    $res = $s.CreateUpdateSearcher().Search("IsInstalled=0 and IsHidden=0 and Type='Driver'")
    $installed = @(Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceName })
    $updates = foreach ($u in $res.Updates) {
      $hw = [string]$u.DriverHardwareID
      $cur = $installed | Where-Object { $_.HardWareID -and $hw -and ($_.HardWareID -ieq $hw -or $hw -like ($_.HardWareID + '*')) } | Select-Object -First 1
      [pscustomobject]@{ id = $u.Identity.UpdateID; title = $u.Title; provider = $u.DriverProvider; class = $u.DriverClass
        model = $u.DriverModel; date = $(if ($u.DriverVerDate) { $u.DriverVerDate.ToString('yyyy-MM-dd') }); size = [int64]$u.MaxDownloadSize
        reboot = [bool]$u.RebootRequired; device = $cur.DeviceName; current = $cur.DriverVersion
        currentDate = $(if ($cur.DriverDate) { $cur.DriverDate.ToString('yyyy-MM-dd') }) }
    }
    $limit = (Get-Date).AddYears(-${OLD_YEARS})
    $old = $installed | Where-Object { $_.DriverProviderName -and $_.DriverProviderName -notmatch 'Microsoft' -and $_.DriverDate -and $_.DriverDate -lt $limit } |
      Sort-Object DriverDate | Select-Object -First 30 | ForEach-Object {
        [pscustomobject]@{ device = $_.DeviceName; provider = $_.DriverProviderName; current = $_.DriverVersion; currentDate = $_.DriverDate.ToString('yyyy-MM-dd'); class = $_.DeviceClass } }
    [pscustomobject]@{ updates = @($updates); old = @($old); checked = $installed.Count } | ConvertTo-Json -Compress -Depth 4
  `, { timeout: 5 * 60000 });
  const updates = asArray(r?.updates).map((u) => ({
    ...u,
    name: u.device || u.model || u.title,
    // Driver titles end with the version, for example "Intel - Display - 31.0.101.4502".
    version: (String(u.title).match(/(\d+(?:\.\d+){2,3})(?!.*\d+\.\d+)/) || [])[1] || u.date || '',
  }));
  return { source: 'Windows Update', updates, old: asArray(r?.old), checked: r?.checked || 0 };
}

// Install the selected updates. Windows Update requires administrator rights: when the app is not
// elevated, one UAC prompt covers the whole batch. Progress is written as JSON lines to a log file.
async function windowsInstall(ids, onProgress, isAdmin) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmp-drivers-'));
  const log = path.join(dir, 'progress.log');
  const script = path.join(dir, 'install.ps1');
  const idList = ids.map((id) => `'${String(id).replace(/[^0-9a-fA-F-]/g, '')}'`).join(',');
  fs.writeFileSync(script, `
$ErrorActionPreference = 'Continue'
$log = '${log.replace(/'/g, "''")}'
function Say($o) { Add-Content -Path $log -Value ($o | ConvertTo-Json -Compress) -Encoding UTF8 }
$s = New-Object -ComObject Microsoft.Update.Session
$res = $s.CreateUpdateSearcher().Search("IsInstalled=0 and Type='Driver'")
$ids = @(${idList})
$i = 0
foreach ($id in $ids) {
  $u = $res.Updates | Where-Object { $_.Identity.UpdateID -eq $id } | Select-Object -First 1
  if (-not $u) { Say @{ id = $id; index = $i; phase = 'done'; ok = $false; error = 'Mise à jour introuvable' }; $i++; continue }
  try {
    $col = New-Object -ComObject Microsoft.Update.UpdateColl
    if (-not $u.EulaAccepted) { $u.AcceptEula() }
    [void]$col.Add($u)
    Say @{ id = $id; index = $i; phase = 'download' }
    $d = $s.CreateUpdateDownloader(); $d.Updates = $col; [void]$d.Download()
    Say @{ id = $id; index = $i; phase = 'install' }
    $inst = $s.CreateUpdateInstaller(); $inst.Updates = $col; $r = $inst.Install()
    Say @{ id = $id; index = $i; phase = 'done'; ok = ($r.ResultCode -eq 2 -or $r.ResultCode -eq 3); code = $r.ResultCode; reboot = [bool]$r.RebootRequired }
  } catch { Say @{ id = $id; index = $i; phase = 'done'; ok = $false; error = $_.Exception.Message } }
  $i++
}
Say @{ phase = 'end' }
`, 'utf8');
  const results = new Map();
  let seen = 0;
  const readLog = () => {
    let lines = [];
    try { lines = fs.readFileSync(log, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean); } catch {}
    for (const line of lines.slice(seen)) {
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.phase === 'done') results.set(m.id, m);
      if (m.phase !== 'end') onProgress?.({ ...m, total: ids.length });
    }
    seen = Math.max(seen, lines.length);
  };
  const timer = setInterval(readLog, 700);
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script];
  try {
    await new Promise((resolve, reject) => {
      if (isAdmin) {
        execFile('powershell.exe', args, { windowsHide: true, timeout: 2 * 3600 * 1000 }, (err) => (err && !fs.existsSync(log) ? reject(err) : resolve()));
      } else {
        // Ask for elevation once; -Wait returns when the elevated installer has finished.
        const elevate = `Start-Process -FilePath powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList ${args.map((a) => `'${a.replace(/'/g, "''")}'`).join(',')}`;
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', elevate], { windowsHide: true, timeout: 2 * 3600 * 1000 }, (err) => {
          if (err && !fs.existsSync(log)) return reject(new Error(/canceled|annul/i.test(String(err.message)) ? 'Autorisation administrateur refusée.' : 'L\'installation n\'a pas pu démarrer (autorisation administrateur refusée ?).'));
          resolve();
        });
      }
    });
  } finally {
    clearInterval(timer);
    readLog();
    fs.rm(dir, { recursive: true, force: true }, () => {});
  }
  return ids.map((id) => results.get(id) || { id, ok: false, error: 'Pas de résultat' });
}

// ---------- Linux (fwupd / LVFS) ----------
function run(cmd, args, timeout = 120000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, LANG: 'C' } }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(stdout), err: String(stderr), missing: err?.code === 'ENOENT' }));
  });
}

async function linuxList() {
  const r = await run('fwupdmgr', ['get-updates', '--json', '--no-unreported-check']);
  if (r.missing) return { source: 'fwupd', missing: true, updates: [], old: [], checked: 0 };
  let devices = [];
  try { devices = JSON.parse(r.out || '{}').Devices || []; } catch {}
  const all = await run('fwupdmgr', ['get-devices', '--json']);
  let checked = 0;
  try { checked = (JSON.parse(all.out || '{}').Devices || []).length; } catch {}
  const updates = devices.flatMap((d) => {
    const rel = (d.Releases || [])[0];
    if (!rel) return [];
    return [{ id: d.DeviceId, name: d.Name, provider: rel.Vendor || d.Vendor, class: (d.Plugin || '').replace(/_/g, ' '), current: d.Version,
      version: rel.Version, title: rel.Summary || d.Name, size: rel.Size || 0, reboot: (d.Flags || []).includes('needs-reboot') }];
  });
  return { source: 'fwupd (LVFS)', updates, old: [], checked };
}

async function linuxInstall(ids, onProgress) {
  const out = [];
  for (const [index, id] of ids.entries()) {
    onProgress?.({ id, index, phase: 'install', total: ids.length });
    // The fwupd daemon asks for authorization through polkit.
    const r = await run('fwupdmgr', ['update', id, '--assume-yes', '--no-reboot-check'], 30 * 60000);
    const res = { id, index, phase: 'done', ok: r.code === 0, error: r.code ? (r.err || r.out).trim().split('\n').pop() : undefined };
    onProgress?.({ ...res, total: ids.length });
    out.push(res);
  }
  return out;
}

module.exports = {
  list: () => (isLinux ? linuxList() : windowsList()),
  install: (ids, onProgress, isAdmin) => (isLinux ? linuxInstall(ids, onProgress) : windowsInstall(ids, onProgress, isAdmin)),
};
