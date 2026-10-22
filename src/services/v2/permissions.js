// Protection → Autorisations des applications.
// Linux : permissions des applications Flatpak (fichiers, appareils, réseau, micro, affichage) avec révocation.
// Windows : applications ayant utilisé la caméra, le micro ou la localisation (journal du Gestionnaire d'accès).
const isLinux = process.platform === 'linux';

const FLATPAK_PERMS = [
  { id: 'filesystem-host', label: 'Tous vos fichiers', test: (c) => /(^|;)host(:rw)?(;|$)/.test(c.filesystems || ''), revoke: '--nofilesystem=host', risk: 'high' },
  { id: 'filesystem-home', label: 'Dossier personnel', test: (c) => /(^|;)home(:rw)?(;|$)/.test(c.filesystems || ''), revoke: '--nofilesystem=home', risk: 'medium' },
  { id: 'devices-all', label: 'Tous les appareils (caméra, USB…)', test: (c) => /(^|;)all(;|$)/.test(c.devices || ''), revoke: '--nodevice=all', risk: 'high' },
  { id: 'network', label: 'Accès à Internet', test: (c) => /(^|;)network(;|$)/.test(c.shared || ''), revoke: '--unshare=network', risk: 'low' },
  { id: 'audio', label: 'Micro et son', test: (c) => /(^|;)pulseaudio(;|$)/.test(c.sockets || ''), revoke: '--nosocket=pulseaudio', risk: 'medium' },
  { id: 'x11', label: 'Affichage X11 (peut lire l\'écran et le clavier)', test: (c) => /(^|;)x11(;|$)/.test(c.sockets || ''), revoke: '--nosocket=x11', risk: 'medium' },
];

async function linuxList() {
  const { run, which } = require('../linux/sh');
  if (!which('flatpak')) return { supported: false, reason: 'Aucune application Flatpak : les autres applications Linux ne déclarent pas d\'autorisations.', apps: [] };
  const list = await run('flatpak', ['list', '--app', '--columns=application,name,installation']).catch(() => '');
  const apps = [];
  for (const line of list.split('\n')) {
    const [id, name, inst] = line.split('\t');
    if (!id) continue;
    const args = ['info', '--show-permissions', id];
    if (inst === 'user') args.splice(1, 0, '--user');
    const out = await run('flatpak', args).catch(() => '');
    const ctx = {};
    let section = '';
    for (const l of out.split('\n')) {
      const s = l.match(/^\[(.+)\]$/);
      if (s) { section = s[1]; continue; }
      const kv = l.match(/^([^=]+)=(.*)$/);
      if (kv && section === 'Context') ctx[kv[1].trim()] = kv[2].trim();
    }
    const perms = FLATPAK_PERMS.filter((p) => p.test(ctx)).map(({ id: pid, label, risk }) => ({ id: pid, label, risk }));
    apps.push({ id, name: name || id, icon: id, installation: inst, perms });
  }
  apps.sort((a, b) => b.perms.length - a.perms.length || a.name.localeCompare(b.name, 'fr'));
  return { supported: true, apps };
}

async function linuxRevoke(appId, permId) {
  const { run } = require('../linux/sh');
  const p = FLATPAK_PERMS.find((x) => x.id === permId);
  if (!p || !/^[\w.-]+$/.test(appId)) throw new Error('Autorisation inconnue');
  await run('flatpak', ['override', '--user', p.revoke, appId]);
  return true;
}
async function linuxReset(appId) {
  const { run } = require('../linux/sh');
  if (!/^[\w.-]+$/.test(appId)) throw new Error('Application inconnue');
  await run('flatpak', ['override', '--user', '--reset', appId]);
  return true;
}

// Windows : HKCU\...\CapabilityAccessManager\ConsentStore\<capacité>
async function windowsList() {
  const { runPSJson, asArray } = require('../ps');
  const data = await runPSJson(`
    $base = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore'
    $out = @()
    foreach ($cap in 'webcam','microphone','location') {
      $root = Join-Path $base $cap
      if (-not (Test-Path $root)) { continue }
      $keys = @(Get-ChildItem $root -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -ne 'NonPackaged' })
      $keys += @(Get-ChildItem (Join-Path $root 'NonPackaged') -ErrorAction SilentlyContinue)
      foreach ($k in $keys) {
        $p = Get-ItemProperty $k.PSPath -ErrorAction SilentlyContinue
        $last = if ($p.LastUsedTimeStop) { [DateTime]::FromFileTime([int64]$p.LastUsedTimeStop).ToString('s') } else { $null }
        $out += [pscustomobject]@{ cap = $cap; key = $k.PSChildName; value = [string]$p.Value; last = $last }
      }
    }
    ConvertTo-Json -InputObject @($out) -Compress
  `, { timeout: 60000 }).catch(() => []);
  const LABEL = { webcam: 'Caméra', microphone: 'Micro', location: 'Localisation' };
  const apps = new Map();
  for (const r of asArray(data)) {
    const isPath = r.key.includes('#');
    const name = isPath ? r.key.split('#').pop().replace(/\.exe$/i, '') : r.key.replace(/_[a-z0-9]{13}$/, '').split('.').pop();
    const id = r.key;
    if (!apps.has(name)) apps.set(name, { id, name, icon: isPath ? r.key.replace(/#/g, '\\') : null, perms: [] });
    apps.get(name).perms.push({ id: r.cap, label: LABEL[r.cap], risk: r.cap === 'location' ? 'medium' : 'high', allowed: r.value !== 'Deny', last: r.last });
  }
  return { supported: true, readOnly: true, settings: { webcam: 'ms-settings:privacy-webcam', microphone: 'ms-settings:privacy-microphone', location: 'ms-settings:privacy-location' }, apps: [...apps.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr')) };
}

module.exports = {
  list: () => (isLinux ? linuxList() : windowsList()),
  revoke: (appId, permId) => (isLinux ? linuxRevoke(appId, permId) : Promise.reject(new Error('Utilisez les paramètres de confidentialité de Windows'))),
  reset: (appId) => (isLinux ? linuxReset(appId) : Promise.reject(new Error('Non disponible sous Windows'))),
};
