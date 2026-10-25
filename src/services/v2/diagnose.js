// System diagnostic: detect common problems and fix them.
// Detection runs without administrator rights. Fixes that need them run together, with one
// authorization (UAC on Windows, polkit on Linux).
// Each check: { id, title, detail, status: 'ok' | 'warn' | 'bad' | 'info', fix?, route? }
//   fix: { label, admin, long? }   route: { label, go } (handled by another module)
const fs = require('fs');

const isLinux = process.platform === 'linux';
const fmtOffset = (s) => (s >= 3600 ? `${Math.round(s / 360) / 10} h` : s >= 120 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`).replace('.', ',');
const pct = (free, size) => (size ? Math.round((free / size) * 100) : 100);

// ---------- Windows ----------
const WIN_SERVICES = [
  ['wuauserv', 'Windows Update', 'Manual'],
  ['BITS', 'Transfert intelligent en arrière-plan (BITS)', 'Manual'],
  ['WSearch', 'Recherche Windows', 'Automatic'],
  ['Winmgmt', 'Infrastructure de gestion Windows (WMI)', 'Automatic'],
  ['EventLog', 'Journal des événements', 'Automatic'],
  ['mpssvc', 'Pare-feu Windows Defender', 'Automatic'],
  ['CryptSvc', 'Services de chiffrement', 'Automatic'],
];

async function windowsChecks() {
  const { runPSJson, asArray } = require('../ps');
  const r = await runPSJson(`
    $ErrorActionPreference = 'SilentlyContinue'
    $svc = @(${WIN_SERVICES.map(([n]) => `'${n}'`).join(',')} | ForEach-Object { $s = Get-Service -Name $_; if ($s) { [pscustomobject]@{ name = $s.Name; status = [string]$s.Status; start = [string]$s.StartType } } })
    $fw = @(Get-NetFirewallProfile | ForEach-Object { [pscustomobject]@{ name = $_.Name; on = [bool]$_.Enabled } })
    $mp = Get-MpComputerStatus
    $sys = $env:SystemDrive.TrimEnd(':')
    $vol = Get-Volume -DriveLetter $sys
    $dns = [bool](Resolve-DnsName 'www.microsoft.com' -DnsOnly -QuickTimeout -ErrorAction SilentlyContinue)
    $off = $null
    $sc = w32tm /stripchart /computer:time.windows.com /samples:1 /dataonly 2>$null | Select-String -Pattern '([+-]\\d+\\.\\d+)s' | Select-Object -Last 1
    if ($sc) { $off = [double]$sc.Matches[0].Groups[1].Value }
    $w32 = [string](Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\W32Time\\Parameters').Type
    $reboot = (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired') -or (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending')
    $errs = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; Level = 1, 2; StartTime = (Get-Date).AddDays(-1) } -MaxEvents 200).Count
    $tmp = (Get-ChildItem $env:TEMP -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
    [pscustomobject]@{ svc = $svc; fw = $fw; rt = $(if ($mp) { [bool]$mp.RealTimeProtectionEnabled } else { $null })
      vol = [pscustomobject]@{ letter = $sys; size = [int64]$vol.Size; free = [int64]$vol.SizeRemaining; health = [string]$vol.HealthStatus }
      dns = $dns; offset = $off; w32 = $w32; reboot = $reboot; errors = $errs; temp = [int64]$tmp } | ConvertTo-Json -Compress -Depth 4
  `, { timeout: 120000 });
  const out = [];
  // Services that Windows needs.
  const svc = Object.fromEntries(asArray(r?.svc).map((s) => [s.name, s]));
  const broken = WIN_SERVICES.filter(([n, , want]) => svc[n] && (svc[n].start === 'Disabled' || (want === 'Automatic' && svc[n].status !== 'Running')));
  out.push(broken.length
    ? { id: 'services', title: 'Services Windows essentiels', status: 'bad', detail: `${broken.map(([, t]) => t).join(', ')} ${broken.length > 1 ? 'sont arrêtés ou désactivés' : 'est arrêté ou désactivé'}.`, fix: { label: 'Redémarrer les services', admin: true } }
    : { id: 'services', title: 'Services Windows essentiels', status: 'ok', detail: 'Windows Update, recherche, WMI, journal et pare-feu fonctionnent.' });
  // Disk health and space on the system drive.
  const v = r?.vol || {};
  if (v.health && !/Healthy/i.test(v.health)) out.push({ id: 'disk', title: `Disque système (${v.letter}:)`, status: 'bad', detail: `Windows signale ${/Unhealthy/i.test(v.health) ? 'des erreurs' : 'un problème'} sur ce disque : le système de fichiers doit être vérifié et réparé.`, fix: { label: 'Vérifier et réparer', admin: true, long: true } });
  else out.push({ id: 'disk', title: `Disque système (${v.letter || 'C'}:)`, status: 'ok', detail: 'Le système de fichiers ne signale aucune erreur.' });
  const free = pct(v.free, v.size);
  out.push(free < 10
    ? { id: 'space', title: 'Espace libre', status: 'bad', detail: `Seulement ${free} % d'espace libre sur ${v.letter}: : Windows peut ralentir et ne plus installer de mises à jour.`, route: { label: 'Nettoyer', go: 'cleanup' } }
    : free < 20 ? { id: 'space', title: 'Espace libre', status: 'warn', detail: `${free} % d'espace libre sur ${v.letter}:.`, route: { label: 'Nettoyer', go: 'cleanup' } }
      : { id: 'space', title: 'Espace libre', status: 'ok', detail: `${free} % d'espace libre sur ${v.letter}:.` });
  // Protection.
  const fwOff = asArray(r?.fw).filter((p) => !p.on).map((p) => p.name);
  out.push(fwOff.length
    ? { id: 'firewall', title: 'Pare-feu', status: 'bad', detail: `Désactivé pour le profil ${fwOff.join(', ')}.`, fix: { label: 'Activer', admin: true } }
    : { id: 'firewall', title: 'Pare-feu', status: 'ok', detail: 'Activé sur tous les profils réseau.' });
  if (r?.rt === false) out.push({ id: 'defender', title: 'Protection en temps réel', status: 'bad', detail: 'Microsoft Defender ne surveille pas les fichiers en continu.', fix: { label: 'Activer', admin: true } });
  else if (r?.rt === true) out.push({ id: 'defender', title: 'Protection en temps réel', status: 'ok', detail: 'Microsoft Defender surveille les fichiers en continu.' });
  // Network and clock.
  out.push(r?.dns === false
    ? { id: 'dns', title: 'Résolution des noms (DNS)', status: 'warn', detail: 'Les adresses web ne se résolvent pas : cache DNS ou pile réseau à réinitialiser.', fix: { label: 'Réparer le réseau', admin: true } }
    : { id: 'dns', title: 'Résolution des noms (DNS)', status: 'ok', detail: 'Les adresses web se résolvent normalement.' });
  if (r?.offset != null && Math.abs(r.offset) > 60) out.push({ id: 'time', title: 'Horloge', status: 'warn', detail: `L'heure du PC est décalée de ${fmtOffset(Math.abs(r.offset))} : certificats et connexions peuvent échouer.`, fix: { label: 'Synchroniser', admin: true } });
  else if (r?.w32 === 'NoSync') out.push({ id: 'time', title: 'Horloge', status: 'warn', detail: 'La synchronisation automatique de l\'heure est désactivée.', fix: { label: 'Synchroniser', admin: true } });
  else if (r?.offset != null) out.push({ id: 'time', title: 'Horloge', status: 'ok', detail: 'L\'heure est synchronisée avec time.windows.com.' });
  // System files: verified and repaired by DISM and SFC (long, administrator).
  out.push({ id: 'sysfiles', title: 'Fichiers système', status: 'info', detail: 'Vérifie et répare les fichiers de Windows corrompus (DISM puis SFC, 10 à 30 minutes).', fix: { label: 'Vérifier et réparer', admin: true, long: true } });
  if (r?.temp > 2 * 1024 ** 3) out.push({ id: 'temp', title: 'Fichiers temporaires', status: 'warn', detail: `${(r.temp / 1024 ** 3).toFixed(1).replace('.', ',')} Go de fichiers temporaires.`, route: { label: 'Nettoyer', go: 'cleanup' } });
  if (r?.reboot) out.push({ id: 'reboot', title: 'Redémarrage en attente', status: 'warn', detail: 'Des mises à jour attendent un redémarrage pour se terminer.' });
  if (r?.errors > 20) out.push({ id: 'events', title: 'Erreurs système récentes', status: 'info', detail: `${r.errors} erreurs dans le journal Système depuis 24 h.` });
  return out;
}

const WIN_FIX = {
  services: WIN_SERVICES.map(([n, , want]) => `Set-Service -Name ${n} -StartupType ${want} -ErrorAction SilentlyContinue; ${want === 'Automatic' ? `Start-Service -Name ${n} -ErrorAction SilentlyContinue` : ''}`).join('\n'),
  disk: '$d = $env:SystemDrive.TrimEnd(":"); Repair-Volume -DriveLetter $d -Scan | Out-Null; Repair-Volume -DriveLetter $d -SpotFix | Out-Null',
  firewall: 'Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled True',
  defender: 'Set-MpPreference -DisableRealtimeMonitoring $false',
  dns: 'ipconfig /flushdns | Out-Null; netsh winsock reset | Out-Null; netsh int ip reset | Out-Null',
  // Turn network time back on (it may be set to NoSync, where /resync does nothing), then resync.
  // If NTP is blocked, take the time from a web server's Date header.
  time: `Set-Service w32time -StartupType Automatic; Start-Service w32time
    w32tm /config /manualpeerlist:"time.windows.com,0x9 time.google.com,0x9 pool.ntp.org,0x9" /syncfromflags:manual /reliable:no /update | Out-Null
    Restart-Service w32time -Force; Start-Sleep -Seconds 2
    w32tm /resync /force /rediscover | Out-Null; Start-Sleep -Seconds 2
    $s = w32tm /stripchart /computer:time.google.com /samples:1 /dataonly 2>$null | Select-String -Pattern '([+-]\\d+\\.\\d+)s' | Select-Object -Last 1
    if (-not $s -or [math]::Abs([double]$s.Matches[0].Groups[1].Value) -gt 60) {
      $d = (Invoke-WebRequest 'https://www.google.com' -Method Head -UseBasicParsing -TimeoutSec 15).Headers['Date']
      Set-Date -Date ([DateTimeOffset]::ParseExact($d, 'r', [Globalization.CultureInfo]::InvariantCulture).LocalDateTime) | Out-Null
    }`,
  sysfiles: 'DISM /Online /Cleanup-Image /RestoreHealth | Out-Null; sfc /scannow | Out-Null',
};

// ---------- Linux ----------
async function linuxChecks() {
  const { run, sh, which } = require('../linux/sh');
  const quiet = (p) => p.then((x) => x, (e) => (e && e.stdout) || '');
  const out = [];
  const systemd = !!which('systemctl');
  if (systemd) {
    const failed = (await quiet(sh('systemctl --failed --no-legend --plain 2>/dev/null'))).split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((u) => u && u.includes('.'));
    out.push(failed.length
      ? { id: 'units', title: 'Services système', status: 'bad', detail: `${failed.length} service(s) en échec : ${failed.slice(0, 4).join(', ')}.`, fix: { label: 'Redémarrer', admin: true }, units: failed }
      : { id: 'units', title: 'Services système', status: 'ok', detail: 'Aucun service en échec.' });
  }
  if (which('dpkg')) {
    const audit = (await quiet(sh('dpkg --audit 2>/dev/null'))).trim();
    const check = await sh('apt-get -s -o Debug::NoLocking=1 check >/dev/null 2>&1 && echo ok || echo bad').catch(() => 'ok');
    out.push(audit || /bad/.test(check)
      ? { id: 'packages', title: 'Paquets', status: 'bad', detail: 'Des paquets sont mal installés ou ont des dépendances cassées.', fix: { label: 'Réparer les paquets', admin: true, long: true } }
      : { id: 'packages', title: 'Paquets', status: 'ok', detail: 'Tous les paquets sont correctement installés.' });
  }
  let st = null;
  try { st = fs.statfsSync('/'); } catch {}
  if (st) {
    const free = pct(st.bavail * st.bsize, st.blocks * st.bsize);
    out.push({ id: 'space', title: 'Espace libre (/)', status: free < 10 ? 'bad' : free < 20 ? 'warn' : 'ok', detail: `${free} % d'espace libre sur la partition système.`, ...(free < 20 ? { route: { label: 'Nettoyer', go: 'cleanup' } } : {}) });
  }
  const opts = (await quiet(run('findmnt', ['-no', 'OPTIONS', '/']))).trim();
  if (/(^|,)ro(,|$)/.test(opts)) out.push({ id: 'readonly', title: 'Système de fichiers', status: 'bad', detail: 'La partition système est en lecture seule : une vérification du disque (fsck) au démarrage est nécessaire.' });
  if (which('journalctl')) {
    const m = (await quiet(sh('journalctl --disk-usage 2>/dev/null'))).match(/([\d.]+)([KMGT])/);
    const size = m ? Number(m[1]) * { K: 1e3, M: 1e6, G: 1e9, T: 1e12 }[m[2]] : 0;
    if (size > 1e9) out.push({ id: 'journal', title: 'Journaux système', status: 'warn', detail: `Les journaux occupent ${m[1]} ${m[2]}o.`, fix: { label: 'Réduire à 200 Mo', admin: true } });
  }
  if (which('timedatectl')) {
    const sync = (await quiet(sh('timedatectl show -p NTPSynchronized --value 2>/dev/null'))).trim();
    if (sync === 'no') out.push({ id: 'time', title: 'Horloge', status: 'warn', detail: 'L\'heure n\'est pas synchronisée par le réseau.', fix: { label: 'Activer la synchronisation', admin: true } });
    else if (sync === 'yes') out.push({ id: 'time', title: 'Horloge', status: 'ok', detail: 'L\'heure est synchronisée par le réseau.' });
  }
  const dnsOk = await sh('getent hosts debian.org >/dev/null 2>&1 || getent hosts kernel.org >/dev/null 2>&1').then(() => true, () => false);
  out.push(dnsOk
    ? { id: 'dns', title: 'Résolution des noms (DNS)', status: 'ok', detail: 'Les adresses web se résolvent normalement.' }
    : { id: 'dns', title: 'Résolution des noms (DNS)', status: 'warn', detail: 'Les adresses web ne se résolvent pas.', ...(systemd ? { fix: { label: 'Réparer le DNS', admin: true } } : {}) });
  if (fs.existsSync('/var/run/reboot-required')) out.push({ id: 'reboot', title: 'Redémarrage en attente', status: 'warn', detail: 'Des mises à jour attendent un redémarrage pour se terminer.' });
  return out;
}

function linuxFixScript(ids, checks) {
  const parts = [];
  for (const id of ids) {
    if (id === 'units') {
      const units = (checks.find((c) => c.id === 'units')?.units || []).filter((u) => /^[\w@.:-]+$/.test(u));
      parts.push(`systemctl reset-failed; ${units.map((u) => `systemctl restart '${u}' || true`).join('; ')}`);
    }
    if (id === 'packages') parts.push('DEBIAN_FRONTEND=noninteractive dpkg --configure -a; DEBIAN_FRONTEND=noninteractive apt-get -f install -y');
    if (id === 'journal') parts.push('journalctl --vacuum-size=200M');
    if (id === 'time') parts.push('timedatectl set-ntp true');
    if (id === 'dns') parts.push('resolvectl flush-caches 2>/dev/null; systemctl restart systemd-resolved 2>/dev/null || true');
  }
  return parts.join('\n');
}

// ---------- API ----------
function createDiagnose({ runElevated } = {}) {
  let last = [];
  async function scan() {
    last = await (isLinux ? linuxChecks() : windowsChecks());
    return { checks: last, at: Date.now(), platform: isLinux ? 'linux' : 'win32' };
  }
  async function fix(ids = []) {
    const known = ids.filter((id) => last.some((c) => c.id === id && c.fix));
    if (!known.length) return { fixed: [] };
    if (isLinux) {
      const script = linuxFixScript(known, last);
      if (script) await require('../linux/sh').privileged(script, { timeout: 60 * 60000 });
    } else {
      // One elevated PowerShell run for all the selected fixes.
      await runElevated(known.map((id) => `try { ${WIN_FIX[id]} } catch {}`).join('\n'));
    }
    return { fixed: known };
  }
  return { scan, fix };
}

module.exports = { createDiagnose };
