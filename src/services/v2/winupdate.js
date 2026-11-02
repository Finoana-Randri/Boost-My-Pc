// Windows Update through its own API (Windows Update Agent), for system updates and drivers.
// Downloads and installs run as one batch with asynchronous jobs, so the progress (percentage,
// bytes, current update) can be read while they run. Administrator rights are needed: when the app
// is not elevated, one UAC prompt covers the whole batch. Progress is written as JSON lines to a
// log file that this process reads.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

// The asynchronous calls want callback objects; progress is read from the job instead, so these do nothing.
const CALLBACKS = `
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
[ComImport, Guid("8C3F1CDD-6173-4591-AEBD-A56A53CA77C1"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IBmpDownloadProgress { void Invoke([MarshalAs(UnmanagedType.IUnknown)] object job, [MarshalAs(UnmanagedType.IUnknown)] object args); }
[ComImport, Guid("77254866-9F5B-4C8E-B9E2-C77A8530D64B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IBmpDownloadDone { void Invoke([MarshalAs(UnmanagedType.IUnknown)] object job, [MarshalAs(UnmanagedType.IUnknown)] object args); }
[ComImport, Guid("E01402D5-F8DA-43BA-A012-38894BD048F1"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IBmpInstallProgress { void Invoke([MarshalAs(UnmanagedType.IUnknown)] object job, [MarshalAs(UnmanagedType.IUnknown)] object args); }
[ComImport, Guid("45F4F6F3-D602-4F98-9A8A-3EFA152AD2D3"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IBmpInstallDone { void Invoke([MarshalAs(UnmanagedType.IUnknown)] object job, [MarshalAs(UnmanagedType.IUnknown)] object args); }
[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public class BmpUpdateCallback : IBmpDownloadProgress, IBmpDownloadDone, IBmpInstallProgress, IBmpInstallDone {
  void IBmpDownloadProgress.Invoke(object job, object args) {}
  void IBmpDownloadDone.Invoke(object job, object args) {}
  void IBmpInstallProgress.Invoke(object job, object args) {}
  void IBmpInstallDone.Invoke(object job, object args) {}
}
'@`;

function script(ids, log) {
  const idList = ids.map((id) => `'${String(id).replace(/[^0-9a-fA-F-]/g, '')}'`).join(',');
  return `
$ErrorActionPreference = 'Continue'
$log = '${log.replace(/'/g, "''")}'
function Say($o) { Add-Content -Path $log -Value ($o | ConvertTo-Json -Compress) -Encoding UTF8 }
$cb = $null
try { ${CALLBACKS}
  $cb = New-Object BmpUpdateCallback } catch {}
$s = New-Object -ComObject Microsoft.Update.Session
$s.ClientApplicationID = 'Boost My Pc'
$res = $s.CreateUpdateSearcher().Search("IsInstalled=0")
$col = New-Object -ComObject Microsoft.Update.UpdateColl
foreach ($id in @(${idList})) {
  $u = $res.Updates | Where-Object { $_.Identity.UpdateID -eq $id } | Select-Object -First 1
  if (-not $u) { Say @{ id = $id; phase = 'done'; ok = $false; error = 'Mise à jour introuvable' }; continue }
  if (-not $u.EulaAccepted) { $u.AcceptEula() }
  [void]$col.Add($u)
}
function Ids($c) { $out = @(); for ($k = 0; $k -lt $c.Count; $k++) { $out += $c.Item($k).Identity.UpdateID }; $out }
if ($col.Count -gt 0) {
  $ids = @(Ids $col)
  $d = $s.CreateUpdateDownloader(); $d.Updates = $col
  try {
    if (-not $cb) { throw 'sync' }
    $job = $d.BeginDownload($cb, $cb, $null)
    while (-not $job.IsCompleted) {
      $p = $job.GetProgress()
      Say @{ phase = 'download'; pct = $p.PercentComplete; index = $p.CurrentUpdateIndex; id = $ids[$p.CurrentUpdateIndex]; itemPct = $p.CurrentUpdatePercentComplete; bytes = [int64]$p.TotalBytesDownloaded; total = [int64]$p.TotalBytesToDownload }
      Start-Sleep -Milliseconds 600
    }
    $dr = $d.EndDownload($job)
  } catch {
    Say @{ phase = 'download'; pct = 0 }
    $dr = $d.Download()
  }
  Say @{ phase = 'download'; pct = 100 }
  $icol = New-Object -ComObject Microsoft.Update.UpdateColl
  for ($k = 0; $k -lt $col.Count; $k++) {
    $r = $dr.GetUpdateResult($k)
    if ($col.Item($k).IsDownloaded) { [void]$icol.Add($col.Item($k)) }
    else { Say @{ id = $ids[$k]; phase = 'done'; ok = $false; code = $r.ResultCode; error = 'Téléchargement impossible' } }
  }
  if ($icol.Count -gt 0) {
    $iids = @(Ids $icol)
    $inst = $s.CreateUpdateInstaller(); $inst.Updates = $icol
    try {
      if (-not $cb) { throw 'sync' }
      $job = $inst.BeginInstall($cb, $cb, $null)
      while (-not $job.IsCompleted) {
        $p = $job.GetProgress()
        Say @{ phase = 'install'; pct = $p.PercentComplete; index = $p.CurrentUpdateIndex; id = $iids[$p.CurrentUpdateIndex]; itemPct = $p.CurrentUpdatePercentComplete }
        Start-Sleep -Milliseconds 600
      }
      $ir = $inst.EndInstall($job)
    } catch {
      Say @{ phase = 'install'; pct = 0 }
      $ir = $inst.Install()
    }
    for ($k = 0; $k -lt $icol.Count; $k++) {
      $r = $ir.GetUpdateResult($k)
      Say @{ id = $iids[$k]; phase = 'done'; ok = ($r.ResultCode -eq 2 -or $r.ResultCode -eq 3); code = $r.ResultCode; reboot = [bool]$r.RebootRequired }
    }
  }
}
Say @{ phase = 'end' }
`;
}

// Install the given update IDs. onProgress receives { phase: 'download' | 'install', pct, id, bytes, total }
// while it runs and { phase: 'done', id, ok, reboot, error } for each update.
async function install(ids, onProgress, isAdmin) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmp-wu-'));
  const log = path.join(dir, 'progress.log');
  const file = path.join(dir, 'install.ps1');
  // UTF-8 with BOM: Windows PowerShell 5 reads the accented messages correctly.
  fs.writeFileSync(file, `﻿${script(ids, log)}`, 'utf8');
  const results = new Map();
  let seen = 0;
  const readLog = () => {
    let lines = [];
    try { lines = fs.readFileSync(log, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean); } catch {}
    for (const line of lines.slice(seen)) {
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.phase === 'done') results.set(m.id, m);
      if (m.phase !== 'end') onProgress?.({ ...m, count: ids.length });
    }
    seen = Math.max(seen, lines.length);
  };
  const timer = setInterval(readLog, 500);
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file];
  try {
    await new Promise((resolve, reject) => {
      if (isAdmin) {
        execFile('powershell.exe', args, { windowsHide: true, timeout: 3 * 3600 * 1000 }, (err) => (err && !fs.existsSync(log) ? reject(err) : resolve()));
      } else {
        // One elevation for the batch; -Wait returns when the elevated installer has finished.
        const elevate = `Start-Process -FilePath powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList ${args.map((a) => `'${a.replace(/'/g, "''")}'`).join(',')}`;
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', elevate], { windowsHide: true, timeout: 3 * 3600 * 1000 }, (err) => {
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

module.exports = { install };
