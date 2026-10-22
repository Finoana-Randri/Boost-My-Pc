// Linux firewall, antivirus, Secure Boot, updates, and network diagnostics.
const fs = require('fs');
const os = require('os');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');
const { run, sh, which, privileged, readText, packageManager } = require('./sh');

async function firewallCard() {
  if (which('ufw')) {
    const active = (await run('systemctl', ['is-active', 'ufw'], { okCodes: [0, 3] }).catch(() => '')).trim() === 'active';
    let enabled = active;
    const conf = readText('/etc/ufw/ufw.conf');
    if (conf) enabled = /^ENABLED=yes/m.test(conf);
    return { id: 'firewall', icon: 'firewall', title: 'Pare-feu (UFW)', ok: enabled, status: enabled ? 'Activé' : 'Désactivé',
      details: [['Service', active ? 'actif' : 'inactif'], ['Démarrage', enabled ? 'automatique' : 'désactivé']],
      actions: enabled ? [] : [{ id: 'enableFirewall', label: 'Activer', primary: true }] };
  }
  if (which('firewall-cmd')) {
    const state = (await run('firewall-cmd', ['--state'], { okCodes: [0, 252] }).catch(() => '')).trim();
    const zone = state === 'running' ? (await run('firewall-cmd', ['--get-default-zone']).catch(() => '')).trim() : '';
    return { id: 'firewall', icon: 'firewall', title: 'Pare-feu (firewalld)', ok: state === 'running', status: state === 'running' ? 'Activé' : 'Désactivé',
      details: [['État', state || 'inconnu'], ['Zone par défaut', zone || '–']],
      actions: state === 'running' ? [] : [{ id: 'enableFirewall', label: 'Activer', primary: true }] };
  }
  return { id: 'firewall', icon: 'firewall', title: 'Pare-feu', ok: false, warn: true, status: 'Aucun pare-feu détecté',
    details: [['Conseil', 'Installez ufw ou firewalld']], actions: [] };
}

function clamDbDate() {
  let newest = 0;
  for (const dir of ['/var/lib/clamav', '/var/clamav']) {
    for (const f of ['daily.cld', 'daily.cvd', 'main.cvd', 'main.cld']) {
      try { newest = Math.max(newest, fs.statSync(path.join(dir, f)).mtimeMs); } catch {}
    }
  }
  return newest || null;
}

async function antivirusCard() {
  if (!which('clamscan')) {
    return { id: 'av', icon: 'virus', title: 'Antivirus', ok: true, warn: true, status: 'ClamAV non installé',
      details: [['Remarque', 'Linux est peu ciblé, mais ClamAV permet d\'analyser vos téléchargements']], actions: [] };
  }
  const db = clamDbDate();
  const age = db ? Math.floor((Date.now() - db) / 86400000) : null;
  return { id: 'av', icon: 'virus', title: 'Antivirus (ClamAV)', ok: age !== null && age <= 7, status: age === null ? 'Base de signatures absente' : age <= 7 ? 'Protection à jour' : 'Signatures anciennes',
    details: [['Signatures', db ? new Date(db).toLocaleDateString('fr-FR') + ` (${age} j)` : '–']],
    actions: [{ id: 'clamscan', label: 'Analyser les téléchargements', primary: true }, ...(which('freshclam') ? [{ id: 'freshclam', label: 'Mettre à jour' }] : [])] };
}

async function secureBootCard() {
  let sb = null;
  if (which('mokutil')) {
    const out = await run('mokutil', ['--sb-state'], { okCodes: [0, 1] }).catch(() => '');
    if (/enabled/i.test(out)) sb = true; else if (/disabled/i.test(out)) sb = false;
  } else {
    try {
      const f = fs.readdirSync('/sys/firmware/efi/efivars').find((x) => x.startsWith('SecureBoot-'));
      if (f) sb = fs.readFileSync(path.join('/sys/firmware/efi/efivars', f))[4] === 1;
    } catch {}
  }
  const uefi = fs.existsSync('/sys/firmware/efi');
  const autoUpd = fs.existsSync('/etc/apt/apt.conf.d/20auto-upgrades')
    ? /Unattended-Upgrade\s+"1"/.test(readText('/etc/apt/apt.conf.d/20auto-upgrades') || '')
    : (await run('systemctl', ['is-enabled', 'dnf-automatic.timer'], { okCodes: [0, 1] }).catch(() => '')).trim() === 'enabled';
  return { id: 'boot', icon: 'shield', title: 'Démarrage sécurisé', ok: sb !== false, warn: sb === null, status: sb === true ? 'Secure Boot activé' : sb === false ? 'Secure Boot désactivé' : uefi ? 'État inconnu' : 'Démarrage BIOS (hérité)',
    details: [['Micrologiciel', uefi ? 'UEFI' : 'BIOS'], ['Mises à jour auto', autoUpd ? 'activées' : 'désactivées']], actions: [] };
}

async function securityStatus() {
  const cards = await Promise.all([antivirusCard(), firewallCard(), secureBootCard()]);
  return { cards };
}

async function securityAction(id) {
  switch (id) {
    case 'enableFirewall':
      if (which('ufw')) await privileged('ufw --force enable');
      else await privileged('systemctl enable --now firewalld');
      return 'Pare-feu activé.';
    case 'freshclam':
      await privileged('systemctl stop clamav-freshclam 2>/dev/null; freshclam; systemctl start clamav-freshclam 2>/dev/null; true');
      return 'Signatures ClamAV mises à jour.';
    case 'clamscan': {
      const dir = path.join(os.homedir(), 'Downloads');
      const target = fs.existsSync(dir) ? dir : os.homedir();
      const out = await run('clamscan', ['-r', '-i', '--no-summary', target], { timeout: 60 * 60000, okCodes: [0, 1] });
      const found = out.split('\n').filter((l) => / FOUND$/.test(l));
      return found.length ? `${found.length} menace(s) détectée(s) :\n${found.slice(0, 5).join('\n')}` : 'Aucune menace détectée dans vos téléchargements.';
    }
    default: throw new Error('Action inconnue');
  }
}

// ---------- Updates ----------
async function checkWindowsUpdates() {
  const pm = packageManager();
  const updates = [];
  try {
    if (pm === 'apt') {
      const out = await run('apt', ['list', '--upgradable'], { timeout: 120000 });
      for (const l of out.split('\n')) {
        const m = l.match(/^([^/]+)\/(\S+)\s+(\S+)\s+\S+\s+\[upgradable from: (.+)\]/);
        if (m) updates.push({ title: m[1], version: m[3], from: m[4], category: /security/.test(m[2]) ? 'Sécurité' : 'Système' });
      }
    } else if (pm === 'dnf') {
      const out = await run('dnf', ['-q', 'check-update'], { okCodes: [0, 100], timeout: 300000 });
      for (const l of out.split('\n')) { const f = l.trim().split(/\s+/); if (f.length === 3 && f[0].includes('.')) updates.push({ title: f[0].replace(/\.[^.]+$/, ''), version: f[1], category: 'Système' }); }
    } else if (pm === 'pacman' && which('checkupdates')) {
      const out = await run('checkupdates', [], { okCodes: [0, 2], timeout: 300000 });
      for (const l of out.split('\n')) { const m = l.match(/^(\S+) (\S+) -> (\S+)/); if (m) updates.push({ title: m[1], from: m[2], version: m[3], category: 'Système' }); }
    } else if (pm === 'zypper') {
      const out = await run('zypper', ['-q', '--non-interactive', 'list-updates'], { timeout: 300000 });
      for (const l of out.split('\n')) { const f = l.split('|').map((x) => x.trim()); if (f.length >= 5 && f[0] === 'v') updates.push({ title: f[2], from: f[3], version: f[4], category: 'Système' }); }
    }
  } catch {}
  if (which('flatpak')) {
    const out = await run('flatpak', ['remote-ls', '--updates', '--columns=name,application,version'], { timeout: 120000 }).catch(() => '');
    for (const l of out.split('\n')) { const [n, id, v] = l.split('\t'); if (id) updates.push({ title: n || id, version: v, category: 'Flatpak' }); }
  }
  if (which('snap')) {
    const out = await run('snap', ['refresh', '--list'], { okCodes: [0, 1] }).catch(() => '');
    for (const l of out.split('\n').slice(1)) { const f = l.trim().split(/\s+/); if (f[0] && f[1]) updates.push({ title: f[0], version: f[1], category: 'Snap' }); }
  }
  const pendingReboot = fs.existsSync('/var/run/reboot-required') || fs.existsSync('/run/reboot-required');
  return { updates, pendingReboot, manager: pm };
}

async function installUpdates() {
  const pm = packageManager();
  const sys = {
    // Keep modified configuration files instead of stopping for a prompt.
    apt: 'export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold upgrade',
    dnf: 'dnf -y upgrade',
    pacman: 'pacman -Syu --noconfirm',
    zypper: 'zypper --non-interactive update',
  }[pm];
  const parts = [];
  if (sys) parts.push(sys);
  if (which('snap')) parts.push('snap refresh');
  if (parts.length) await privileged(parts.join(' ; '), { timeout: 2 * 3600000 });
  if (which('flatpak')) await run('flatpak', ['update', '-y', '--noninteractive'], { timeout: 3600000 }).catch(() => {});
  return true;
}

// ---------- Network diagnostics ----------
function tcpPing(host, port = 443, timeout = 3000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const s = net.connect({ host, port, timeout });
    const done = (ok) => { s.destroy(); resolve(ok ? Date.now() - start : null); };
    s.on('connect', () => done(true)); s.on('timeout', () => done(false)); s.on('error', () => done(false));
  });
}

async function networkDiagnose() {
  const route = await run('ip', ['-j', 'route', 'show', 'default']).then(JSON.parse).catch(() => []);
  const def = route[0] || {};
  const addrs = await run('ip', ['-j', 'addr', 'show']).then(JSON.parse).catch(() => []);
  const iface = addrs.find((a) => a.ifname === def.dev) || addrs.find((a) => a.ifname !== 'lo' && a.operstate === 'UP');
  const ipv4 = iface?.addr_info?.find((a) => a.family === 'inet');
  let ssid = null, nm = false;
  if (which('nmcli')) {
    nm = true;
    const out = await run('nmcli', ['-t', '-f', 'active,ssid', 'dev', 'wifi']).catch(() => '');
    ssid = out.split('\n').find((l) => l.startsWith('yes:'))?.slice(4) || null;
  }
  let speed = '';
  try { const s = (readText(`/sys/class/net/${iface?.ifname}/speed`) || '').trim(); if (Number(s) > 0) speed = Number(s) >= 1000 ? `${Number(s) / 1000} Gb/s` : `${s} Mb/s`; } catch {}
  const wireless = iface && fs.existsSync(`/sys/class/net/${iface.ifname}/wireless`);
  const dnsServers = (readText('/etc/resolv.conf') || '').split('\n').filter((l) => l.startsWith('nameserver')).map((l) => l.split(/\s+/)[1]);
  let proxyMode = null;
  if (which('gsettings')) proxyMode = (await run('gsettings', ['get', 'org.gnome.system.proxy', 'mode']).catch(() => '')).trim().replace(/'/g, '') || null;
  const envProxy = process.env.http_proxy || process.env.https_proxy || process.env.HTTP_PROXY || process.env.HTTPS_PROXY || '';

  const checks = [];
  checks.push({ id: 'hardware', name: 'Carte réseau', ok: !!iface, detail: iface ? `${iface.ifname}${wireless ? ' (Wi-Fi)' : ' (Ethernet)'}${speed ? ' · ' + speed : ''}${ssid ? ' · « ' + ssid + ' »' : ''}` : 'Aucune interface active', fix: nm ? 'restartnm' : undefined });
  checks.push({ id: 'dhcp', name: 'Adresse IP', ok: !!ipv4 && !ipv4.local.startsWith('169.254.'), detail: ipv4 ? `${ipv4.local}/${ipv4.prefixlen} · ${ipv4.dynamic ? 'DHCP' : 'statique'}` : 'Pas d\'adresse IPv4', fix: nm ? 'renewip' : undefined });
  let gw = null;
  if (def.gateway) {
    const out = await run('ping', ['-c', '1', '-W', '2', def.gateway], { okCodes: [0, 1] }).catch(() => '');
    const m = out.match(/time[=<]([\d.]+)/);
    gw = m ? Math.round(Number(m[1])) : null;
  }
  checks.push({ id: 'connection', name: 'Connexion au routeur', ok: gw !== null, detail: def.gateway ? (gw !== null ? `Passerelle ${def.gateway} · ${gw} ms` : `Passerelle ${def.gateway} injoignable`) : 'Aucune passerelle par défaut', fix: nm ? 'restartnm' : undefined });
  let dnsOk = false, dnsDetail;
  try { const a = await dns.lookup('www.microsoft.com'); dnsOk = true; dnsDetail = `www.microsoft.com → ${a.address} · Serveurs : ${dnsServers.join(', ') || 'auto'}`; }
  catch (e) { dnsDetail = `Échec de la résolution DNS (${e.code})`; }
  checks.push({ id: 'dns', name: 'Résolution DNS', ok: dnsOk, detail: dnsDetail, fix: 'flushdns' });
  if (proxyMode !== null) checks.push({ id: 'proxy', name: 'Proxy du bureau', ok: proxyMode !== 'manual', warn: true, detail: proxyMode === 'manual' ? 'Proxy manuel configuré' : proxyMode === 'auto' ? 'Configuration automatique' : 'Aucun proxy', fix: proxyMode === 'manual' ? 'disableproxy' : undefined });
  checks.push({ id: 'envproxy', name: 'Variables d\'environnement proxy', ok: !envProxy, warn: true, detail: envProxy ? `http(s)_proxy = ${envProxy}` : 'Aucune variable proxy' });
  const hosts = ['www.microsoft.com', 'www.bing.com', 'www.google.com'];
  const lat = await Promise.all(hosts.map((h) => tcpPing(h)));
  const okLat = lat.filter((x) => x !== null);
  checks.push({ id: 'internet', name: 'Accès Internet', ok: okLat.length > 0, detail: hosts.map((h, i) => `${h} : ${lat[i] !== null ? lat[i] + ' ms' : 'échec'}`).join(' · ') });
  return { checks, latency: okLat.length ? Math.round(okLat.reduce((a, b) => a + b, 0) / okLat.length) : null };
}

async function networkFix(id) {
  switch (id) {
    case 'flushdns':
      if (which('resolvectl')) { await run('resolvectl', ['flush-caches']).catch(() => privileged('resolvectl flush-caches')); return 'Cache DNS vidé.'; }
      await privileged('systemctl restart nscd 2>/dev/null || systemctl restart dnsmasq 2>/dev/null || true');
      return 'Cache DNS vidé.';
    case 'renewip': {
      const dev = (await run('nmcli', ['-t', '-f', 'DEVICE,STATE', 'dev']).catch(() => '')).split('\n').find((l) => /:connected$/.test(l))?.split(':')[0];
      if (!dev) throw new Error('Aucune connexion active');
      await run('nmcli', ['device', 'reapply', dev]).catch(() => run('nmcli', ['device', 'connect', dev]));
      return 'Connexion renouvelée.';
    }
    case 'restartnm':
      await privileged('systemctl restart NetworkManager');
      return 'NetworkManager redémarré.';
    case 'disableproxy':
      await run('gsettings', ['set', 'org.gnome.system.proxy', 'mode', 'none']);
      return 'Proxy désactivé.';
    default: throw new Error('Réparation inconnue');
  }
}

module.exports = { securityStatus, securityAction, checkWindowsUpdates, installUpdates, networkDiagnose, networkFix };
