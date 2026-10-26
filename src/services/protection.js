// Windows protection and network services: Defender, firewall, and Windows Update.
// Network diagnostics cover connections, DHCP, DNS, proxy settings, and hardware.
const dns = require('dns').promises;
const net = require('net');
const { runPS, runPSJson, asArray } = require('./ps');

async function securityStatus() {
  const r = await runPSJson(`
    $mp = $null; try { $mp = Get-MpComputerStatus -ErrorAction Stop } catch {}
    $fw = @(); try { $fw = Get-NetFirewallProfile -ErrorAction Stop | Select-Object Name, Enabled } catch {}
    $av = @(); try { $av = Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntivirusProduct -ErrorAction Stop | Select-Object -ExpandProperty displayName } catch {}
    [pscustomobject]@{
      defender = if ($mp) { [pscustomobject]@{
        enabled = $mp.AntivirusEnabled; realtime = $mp.RealTimeProtectionEnabled
        signatureAge = $mp.AntivirusSignatureAge; signatureVersion = $mp.AntivirusSignatureVersion
        lastQuickScan = if ($mp.QuickScanEndTime) { $mp.QuickScanEndTime.ToString('s') } else { $null }
        tamper = $mp.IsTamperProtected; mode = [string]$mp.AMRunningMode } } else { $null }
      firewall = @($fw | ForEach-Object { [pscustomobject]@{ name = [string]$_.Name; enabled = [bool]$_.Enabled } })
      antivirus = @($av)
    } | ConvertTo-Json -Compress -Depth 4
  `, { timeout: 60000 });
  return r;
}

// Security actions (Settings cards and threat list). `runElevated` runs a script with
// administrator rights (one Windows prompt when the app doesn't have them).
async function securityAction(id, { runElevated, openExternal } = {}) {
  switch (id) {
    case 'winRealtime': {
      // Policies left by tweak tools or old antivirus products block Defender: remove them first.
      await runElevated(`
        $p = 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows Defender'
        Remove-ItemProperty -Path $p -Name DisableAntiSpyware, DisableAntiVirus -ErrorAction SilentlyContinue
        Remove-ItemProperty -Path "$p\\Real-Time Protection" -Name DisableRealtimeMonitoring, DisableBehaviorMonitoring, DisableOnAccessProtection, DisableIOAVProtection -ErrorAction SilentlyContinue
        Start-Service WinDefend -ErrorAction SilentlyContinue
        Set-MpPreference -DisableRealtimeMonitoring $false -DisableBehaviorMonitoring $false -DisableIOAVProtection $false -ErrorAction SilentlyContinue`, 120000);
      await new Promise((r) => setTimeout(r, 3000));
      const s = await runPSJson('$m = Get-MpComputerStatus; [pscustomobject]@{ on = [bool]$m.RealTimeProtectionEnabled; mode = [string]$m.AMRunningMode; tamper = [bool]$m.IsTamperProtected } | ConvertTo-Json -Compress').catch(() => null);
      if (s?.on) return 'Protection en temps réel activée.';
      if (/passive/i.test(s?.mode || '')) return 'Un autre antivirus protège ce PC : Microsoft Defender reste en mode passif.';
      // Tamper protection only lets the user change it in Windows Security.
      openExternal?.('windowsdefender://threatsettings');
      return 'Windows n\'autorise pas cette modification depuis une application (protection contre la falsification).\nDans la fenêtre Sécurité Windows qui vient de s\'ouvrir, activez « Protection en temps réel ».';
    }
    case 'winFirewall':
      await runElevated('Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled True', 60000);
      return 'Pare-feu activé.';
    case 'winSecurity':
      openExternal?.('windowsdefender://threatsettings');
      return 'Sécurité Windows est ouvert.';
    default: throw new Error('Action inconnue');
  }
}

async function quickScan() {
  // Start a quick Defender scan; it can take a few minutes.
  await runPS('Start-MpScan -ScanType QuickScan -ErrorAction Stop', { timeout: 30 * 60000 });
  return true;
}

async function updateSignatures() {
  await runPS('Update-MpSignature -ErrorAction Stop', { timeout: 10 * 60000 });
  return true;
}

// Check for updates through the Microsoft.Update.Session COM API.
async function checkWindowsUpdates() {
  const r = await runPSJson(`
    $s = New-Object -ComObject Microsoft.Update.Session
    $searcher = $s.CreateUpdateSearcher()
    $res = $searcher.Search("IsInstalled=0 and IsHidden=0")
    $list = foreach ($u in $res.Updates) {
      [pscustomobject]@{ title = $u.Title; size = [int64]$u.MaxDownloadSize; reboot = [bool]$u.RebootRequired
        category = ($u.Categories | Select-Object -First 1 -ExpandProperty Name); kb = ($u.KBArticleIDs -join ',') }
    }
    $pendingReboot = Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired'
    [pscustomobject]@{ updates = @($list); pendingReboot = $pendingReboot } | ConvertTo-Json -Compress -Depth 4
  `, { timeout: 5 * 60000 });
  return { updates: asArray(r?.updates), pendingReboot: !!r?.pendingReboot };
}

// ---------- Network diagnostics ----------
function tcpPing(host, port = 443, timeout = 3000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const s = net.connect({ host, port, timeout });
    const done = (ok) => { s.destroy(); resolve(ok ? Date.now() - start : null); };
    s.on('connect', () => done(true));
    s.on('timeout', () => done(false));
    s.on('error', () => done(false));
  });
}

async function networkDiagnose() {
  const info = await runPSJson(`
    $cfg = Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1
    $ad = if ($cfg) { $cfg.NetAdapter } else { Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object Status -eq 'Up' | Select-Object -First 1 }
    $dhcp = if ($cfg) { (Get-NetIPInterface -InterfaceIndex $cfg.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).Dhcp } else { $null }
    $ssid = $null; try { $ssid = ((netsh wlan show interfaces) -match '^\\s+SSID\\s+:' | Select-Object -First 1) -replace '^\\s+SSID\\s+:\\s*','' } catch {}
    $ie = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -ErrorAction SilentlyContinue
    [pscustomobject]@{
      adapter = if ($ad) { [string]$ad.InterfaceDescription } else { $null }
      adapterName = if ($ad) { [string]$ad.Name } else { $null }
      linkSpeed = if ($ad) { [string]$ad.LinkSpeed } else { $null }
      ssid = $ssid
      ipv4 = if ($cfg) { [string]$cfg.IPv4Address.IPAddress } else { $null }
      gateway = if ($cfg) { [string]$cfg.IPv4DefaultGateway.NextHop } else { $null }
      dnsServers = if ($cfg) { @($cfg.DNSServer | Where-Object AddressFamily -eq 2 | ForEach-Object { $_.ServerAddresses }) } else { @() }
      dhcp = [string]$dhcp
      proxyEnabled = [bool]$ie.ProxyEnable
      proxyServer = [string]$ie.ProxyServer
      envProxy = [string]([Environment]::GetEnvironmentVariable('http_proxy','Machine') + [Environment]::GetEnvironmentVariable('https_proxy','Machine') + [Environment]::GetEnvironmentVariable('http_proxy','User') + [Environment]::GetEnvironmentVariable('https_proxy','User'))
    } | ConvertTo-Json -Compress -Depth 3
  `, { timeout: 60000 });

  const checks = [];
  checks.push({ id: 'hardware', name: 'Carte réseau', ok: !!info.adapter, detail: info.adapter ? `${info.adapter}${info.linkSpeed ? ' · ' + info.linkSpeed : ''}${info.ssid ? ' · Wi-Fi « ' + info.ssid + ' »' : ''}` : 'Aucune carte réseau active' });
  checks.push({ id: 'dhcp', name: 'Adresse IP (DHCP)', ok: !!info.ipv4 && !/^169\.254\./.test(info.ipv4), detail: info.ipv4 ? `${info.ipv4} · DHCP ${info.dhcp === 'Enabled' ? 'activé' : 'désactivé'}` : 'Pas d\'adresse IPv4', fix: 'renewip' });

  const gwLatency = info.gateway ? await pingIcmp(info.gateway) : null;
  checks.push({ id: 'connection', name: 'Connexion au routeur', ok: gwLatency !== null, detail: info.gateway ? (gwLatency !== null ? `Passerelle ${info.gateway} · ${gwLatency} ms` : `Passerelle ${info.gateway} injoignable`) : 'Aucune passerelle', fix: 'resetwinsock' });

  let dnsOk = false, dnsDetail = '';
  try { const a = await dns.lookup('www.microsoft.com'); dnsOk = true; dnsDetail = `www.microsoft.com → ${a.address} · Serveurs : ${asArray(info.dnsServers).join(', ') || 'auto'}`; }
  catch (e) { dnsDetail = `Échec de résolution DNS (${e.code})`; }
  checks.push({ id: 'dns', name: 'Résolution DNS', ok: dnsOk, detail: dnsDetail, fix: 'flushdns' });

  checks.push({ id: 'proxy', name: 'Proxy Web', ok: !info.proxyEnabled, warn: true, detail: info.proxyEnabled ? `Proxy activé : ${info.proxyServer}` : 'Aucun proxy configuré', fix: 'disableproxy' });
  checks.push({ id: 'envproxy', name: 'Variables d\'environnement proxy', ok: !info.envProxy, warn: true, detail: info.envProxy ? `http(s)_proxy défini : ${info.envProxy}` : 'Aucune variable proxy' });

  const hosts = ['www.microsoft.com', 'www.bing.com', 'www.google.com'];
  const lat = await Promise.all(hosts.map((h) => tcpPing(h)));
  const okLat = lat.filter((x) => x !== null);
  checks.push({ id: 'internet', name: 'Accès Internet', ok: okLat.length > 0, detail: hosts.map((h, i) => `${h} : ${lat[i] !== null ? lat[i] + ' ms' : 'échec'}`).join(' · ') });

  return { info, checks, latency: okLat.length ? Math.round(okLat.reduce((a, b) => a + b, 0) / okLat.length) : null };
}

async function pingIcmp(host) {
  try {
    const r = await runPS(`$r = Test-Connection -ComputerName '${host.replace(/[^0-9a-zA-Z.:-]/g, '')}' -Count 1 -ErrorAction Stop; if ($r.ResponseTime -ne $null) { $r.ResponseTime } else { $r.Latency }`, { timeout: 10000 });
    const n = parseInt(r, 10);
    return Number.isFinite(n) ? n : 0;
  } catch { return null; }
}

async function networkFix(id) {
  switch (id) {
    case 'flushdns': await runPS('ipconfig /flushdns | Out-Null; if ($LASTEXITCODE) { throw "Droits administrateur requis" }'); return 'Cache DNS vidé.';
    case 'renewip': await runPS('ipconfig /release | Out-Null; ipconfig /renew | Out-Null; if ($LASTEXITCODE) { throw "Impossible de renouveler l’adresse IP" }', { timeout: 60000 }); return 'Adresse IP renouvelée.';
    case 'disableproxy':
      await runPS(`Set-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -Name ProxyEnable -Value 0`);
      return 'Proxy désactivé.';
    // netsh fails without administrator rights but only says so in its exit code.
    case 'resetwinsock': await runPS('netsh winsock reset | Out-Null; if ($LASTEXITCODE) { throw "Droits administrateur requis" }'); return 'Winsock réinitialisé (redémarrage recommandé).';
    default: throw new Error('Réparation inconnue');
  }
}

module.exports = { securityStatus, securityAction, quickScan, updateSignatures, checkWindowsUpdates, networkDiagnose, networkFix };
