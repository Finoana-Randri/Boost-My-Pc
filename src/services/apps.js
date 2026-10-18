// Applications : processus, démarrage (StartupScanService) et désinstallation (Plugin.Uninstall).
const { spawn } = require('child_process');
const { runPS, runPSJson, asArray, psq } = require('./ps');

// ---------- Processus ----------
async function listProcesses() {
  const list = await runPSJson(`
    Get-Process | Where-Object { $_.Id -ne 0 -and $_.Id -ne 4 } |
      Select-Object Id, ProcessName, WorkingSet64, Path, MainWindowTitle, @{n='Desc';e={ try { $_.MainModule.FileVersionInfo.FileDescription } catch { $null } }} |
      ConvertTo-Json -Compress
  `, { timeout: 60000 });
  // Regroupe par nom comme le gestionnaire de processus de PC Manager
  const groups = new Map();
  for (const p of asArray(list)) {
    const key = p.ProcessName.toLowerCase();
    if (!groups.has(key)) groups.set(key, { name: p.ProcessName, desc: p.Desc || p.ProcessName, path: p.Path, ids: [], memory: 0, hasWindow: false });
    const g = groups.get(key);
    g.ids.push(p.Id);
    g.memory += Number(p.WorkingSet64) || 0;
    if (p.MainWindowTitle) g.hasWindow = true;
    if (!g.path && p.Path) g.path = p.Path;
    if (p.Desc && g.desc === g.name) g.desc = p.Desc;
  }
  return [...groups.values()].sort((a, b) => b.memory - a.memory);
}

const PROTECTED = /^(system|csrss|wininit|winlogon|services|lsass|smss|svchost|dwm|explorer|fontdrvhost|registry|memcompression|memory compression|secure system|vmmem|vmmemwsl|msmpeng|sgrmbroker|audiodg)$/i;

async function killProcesses(ids, name) {
  if (name && PROTECTED.test(name)) throw new Error(`« ${name} » est un processus système protégé.`);
  const pids = (ids || []).map(Number).filter((id) => Number.isInteger(id) && id > 4);
  if (!pids.length) throw new Error('Aucun processus valide.');
  // Vérifie ensuite que les processus sont vraiment terminés (sinon : accès refusé)
  const left = await runPS(`
    $ids = @(${pids.join(',')})
    Stop-Process -Id $ids -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 600
    @(Get-Process -Id $ids -ErrorAction SilentlyContinue).Count
  `);
  const n = parseInt(left, 10) || 0;
  if (n > 0) throw new Error(n === pids.length ? 'Accès refusé : redémarrez FastBoost en administrateur pour terminer ce processus.' : `${n} instance(s) n'ont pas pu être terminées (droits administrateur requis).`);
  return true;
}

// ---------- Démarrage ----------
const RUN_KEYS = [
  { hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Run', approved: 'Run' },
  { hive: 'HKLM', key: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', approved: 'Run' },
  { hive: 'HKLM', key: 'SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run', approved: 'Run32' },
];
const APPROVED_BASE = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\';

async function listStartup() {
  const keysPs = RUN_KEYS.map((k) => `@{h='${k.hive}';k='${k.key}';a='${k.approved}'}`).join(',');
  const items = await runPSJson(`
    $out = @()
    foreach ($r in @(${keysPs})) {
      $p = "$($r.h):\\$($r.k)"
      if (-not (Test-Path $p)) { continue }
      $props = Get-ItemProperty $p
      foreach ($n in $props.PSObject.Properties) {
        if ($n.Name -like 'PS*') { continue }
        $state = $null
        foreach ($ah in @($r.h, 'HKCU')) {
          $ap = "$($ah):\\${APPROVED_BASE}$($r.a)"
          $v = (Get-ItemProperty $ap -Name $n.Name -ErrorAction SilentlyContinue).($n.Name)
          if ($v) { $state = $v[0]; break }
        }
        $out += [pscustomobject]@{ name=$n.Name; command=[string]$n.Value; hive=$r.h; key=$r.k; approved=$r.a; source='registry'; enabled= -not ($state -and ($state % 2) -eq 1) }
      }
    }
    foreach ($f in @([Environment]::GetFolderPath('Startup'), [Environment]::GetFolderPath('CommonStartup'))) {
      if (-not (Test-Path $f)) { continue }
      $hive = if ($f -like "$env:APPDATA*") { 'HKCU' } else { 'HKLM' }
      foreach ($file in Get-ChildItem $f -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'desktop.ini' }) {
        $ap = "$($hive):\\${APPROVED_BASE}StartupFolder"
        $v = (Get-ItemProperty $ap -Name $file.Name -ErrorAction SilentlyContinue).($file.Name)
        $out += [pscustomobject]@{ name=$file.Name; command=$file.FullName; hive=$hive; key=$f; approved='StartupFolder'; source='folder'; enabled= -not ($v -and ($v[0] % 2) -eq 1) }
      }
    }
    ConvertTo-Json -InputObject @($out) -Compress
  `);
  return asArray(items).map((i) => ({ ...i, exe: extractExe(i.command) }));
}

function extractExe(cmd = '') {
  const m = cmd.match(/^"([^"]+)"/) || cmd.match(/^(.+?\.exe)/i);
  return m ? m[1] : cmd;
}

// Active/désactive via StartupApproved (même mécanisme que le Gestionnaire des tâches et PC Manager)
async function setStartup(item, enabled) {
  const ap = `${item.hive}:\\${APPROVED_BASE}${item.approved}`;
  const bytes = enabled
    ? '[byte[]](2,0,0,0,0,0,0,0,0,0,0,0)'
    : '([byte[]](3,0,0,0) + [BitConverter]::GetBytes([DateTime]::Now.ToFileTime()))';
  await runPS(`
    $ap = ${psq(ap)}
    if (-not (Test-Path $ap)) { New-Item -Path $ap -Force | Out-Null }
    Set-ItemProperty -Path $ap -Name ${psq(item.name)} -Value ${bytes} -Type Binary -ErrorAction Stop
  `);
  return true;
}

// ---------- Désinstallation ----------
async function listInstalledApps() {
  const apps = await runPSJson(`
    $paths = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
             'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
             'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
    $list = foreach ($p in $paths) {
      Get-ItemProperty $p -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -and $_.SystemComponent -ne 1 -and -not $_.ParentKeyName -and ($_.UninstallString -or $_.QuietUninstallString) } |
        Select-Object @{n='id';e={$_.PSChildName}}, @{n='name';e={$_.DisplayName}}, @{n='publisher';e={$_.Publisher}}, @{n='version';e={$_.DisplayVersion}},
          @{n='size';e={[int64]$_.EstimatedSize * 1024}}, @{n='date';e={$_.InstallDate}}, @{n='icon';e={$_.DisplayIcon}},
          @{n='uninstall';e={$_.UninstallString}}, @{n='location';e={$_.InstallLocation}}, @{n='type';e={'desktop'}}
    }
    # Noms lisibles des apps Store via le menu Démarrer (AppID = PackageFamilyName!App)
    $names = @{}
    Get-StartApps -ErrorAction SilentlyContinue | Where-Object { $_.AppID -like '*!*' } | ForEach-Object {
      $pfn = $_.AppID.Split('!')[0]; if (-not $names.ContainsKey($pfn)) { $names[$pfn] = $_.Name } }
    $store = Get-AppxPackage -PackageTypeFilter Main -ErrorAction SilentlyContinue |
      Where-Object { -not $_.IsFramework -and $_.SignatureKind -eq 'Store' -and -not $_.NonRemovable -and $names.ContainsKey($_.PackageFamilyName) } |
      Select-Object @{n='id';e={$_.PackageFullName}}, @{n='name';e={ $names[$_.PackageFamilyName] }}, @{n='publisher';e={$_.Publisher -replace '^CN=([^,]+).*','$1'}},
        @{n='version';e={[string]$_.Version}}, @{n='size';e={0}}, @{n='date';e={$null}}, @{n='icon';e={$null}},
        @{n='uninstall';e={$null}}, @{n='location';e={$_.InstallLocation}}, @{n='type';e={'store'}}
    ConvertTo-Json -InputObject @(@($list) + @($store)) -Compress -Depth 3
  `, { timeout: 90000 });
  const seen = new Set();
  return asArray(apps)
    .filter((a) => { const k = a.name + '|' + a.version; if (seen.has(k)) return false; seen.add(k); return true; })
    .map((a) => ({ ...a, publisher: /^[0-9A-F-]{36}$/i.test(a.publisher || '') ? '' : a.publisher, date: formatDate(a.date) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

function formatDate(d) {
  if (!d || !/^\d{8}$/.test(d)) return null;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

async function uninstallApp(app) {
  if (app.type === 'store') {
    await runPS(`Remove-AppxPackage -Package ${psq(app.id)} -ErrorAction Stop`, { timeout: 300000 });
    return { started: true, finished: true };
  }
  let cmd = app.uninstall || '';
  // Comme PC Manager : MsiExec /I{GUID} -> /X{GUID} pour lancer la désinstallation
  cmd = cmd.replace(/(msiexec(\.exe)?\s+)\/I/i, '$1/X');
  // Chemin non entre guillemets contenant des espaces
  if (!cmd.startsWith('"')) {
    const m = cmd.match(/^(.+?\.exe)(.*)$/i);
    if (m && m[1].includes(' ')) cmd = `"${m[1]}"${m[2]}`;
  }
  const child = spawn('cmd.exe', ['/c', 'start', '""', cmd], { detached: true, windowsHide: true, windowsVerbatimArguments: true, shell: false });
  child.unref();
  return { started: true, finished: false };
}

module.exports = { listProcesses, killProcesses, listStartup, setStartup, listInstalledApps, uninstallApp };
