// Maintenance tasks for routine system upkeep.
const os = require('os');
const path = require('path');
const fs = require('fs');

const isLinux = process.platform === 'linux';

function linuxTasks() {
  const { which, packageManager } = require('../linux/sh');
  const pm = packageManager();
  const home = os.homedir();
  const t = [
    { id: 'dns', name: 'Vider le cache DNS', desc: 'Corrige des sites inaccessibles ou qui chargent mal.', recommended: true, available: !!which('resolvectl'), cmd: 'resolvectl flush-caches', admin: false, fallbackAdmin: true },
    { id: 'fontcache', name: 'Reconstruire le cache des polices', desc: 'Résout des polices manquantes ou mal affichées.', recommended: true, available: !!which('fc-cache'), cmd: 'fc-cache -f', admin: false },
    { id: 'appcache', name: 'Actualiser le menu des applications', desc: 'Met à jour la base des raccourcis et des icônes.', recommended: true,
      available: !!which('update-desktop-database'),
      cmd: `update-desktop-database ${JSON.stringify(path.join(home, '.local/share/applications'))} 2>/dev/null; ` +
        (which('gtk-update-icon-cache') && fs.existsSync(path.join(home, '.local/share/icons/hicolor')) ? `gtk-update-icon-cache -f -t ${JSON.stringify(path.join(home, '.local/share/icons/hicolor'))} 2>/dev/null; ` : '') + 'true',
      admin: false },
    { id: 'ram', name: 'Libérer la mémoire vive', desc: 'Vide le cache de pages du noyau.', recommended: false, available: true, cmd: 'sync; echo 3 > /proc/sys/vm/drop_caches', admin: true },
    { id: 'trim', name: 'Optimiser les SSD (TRIM)', desc: 'Informe les SSD des blocs libres pour garder des écritures rapides.', recommended: true, available: !!which('fstrim'), cmd: 'fstrim -a', admin: true },
    { id: 'journal', name: 'Compacter les journaux système', desc: 'Limite les journaux systemd à 200 Mo.', recommended: false, available: !!which('journalctl'), cmd: 'journalctl --vacuum-size=200M', admin: true },
  ];
  const orphan = {
    apt: 'DEBIAN_FRONTEND=noninteractive apt-get -y autoremove',
    dnf: 'dnf -y autoremove',
    pacman: 'orph=$(pacman -Qdtq); [ -n "$orph" ] && pacman -Rns --noconfirm $orph; true',
    zypper: 'zypper --non-interactive packages --unneeded >/dev/null; true',
  }[pm];
  if (orphan && pm !== 'zypper') t.push({ id: 'orphans', name: 'Supprimer les paquets orphelins', desc: 'Dépendances installées automatiquement et devenues inutiles.', recommended: false, available: true, cmd: orphan, admin: true });
  return t;
}

function windowsTasks() {
  return [
    { id: 'dns', name: 'Vider le cache DNS', desc: 'Corrige des sites inaccessibles ou qui chargent mal.', recommended: true, available: true, ps: 'ipconfig /flushdns | Out-Null', admin: false },
    { id: 'iconcache', name: 'Actualiser le cache des icônes', desc: 'Corrige des icônes manquantes ou incorrectes.', recommended: true, available: true, ps: 'Start-Process ie4uinit.exe -ArgumentList "-show" -WindowStyle Hidden -Wait', admin: false },
    { id: 'ram', name: 'Libérer la mémoire vive', desc: 'Réduit la mémoire inutilisée des processus.', recommended: true, available: true, special: 'boost', admin: false },
    { id: 'trim', name: 'Optimiser les SSD (TRIM)', desc: 'Informe les SSD des blocs libres pour garder des écritures rapides.', recommended: true, available: true, ps: 'Get-Volume | Where-Object { $_.DriveLetter -and $_.DriveType -eq "Fixed" } | ForEach-Object { Optimize-Volume -DriveLetter $_.DriveLetter -ReTrim -ErrorAction SilentlyContinue }', admin: true },
    { id: 'storecache', name: 'Réparer le cache du Microsoft Store', desc: 'Corrige des téléchargements bloqués dans le Store.', recommended: false, available: true, ps: 'Start-Process wsreset.exe -ArgumentList "-i" -WindowStyle Hidden', admin: false },
  ];
}

const tasks = () => (isLinux ? linuxTasks() : windowsTasks()).filter((t) => t.available);

async function list() {
  return tasks().map(({ id, name, desc, recommended, admin }) => ({ id, name, desc, recommended, admin }));
}

async function run(ids, { boost } = {}) {
  const chosen = tasks().filter((t) => ids.includes(t.id));
  const results = [];
  if (isLinux) {
    const { sh, privileged } = require('../linux/sh');
    const asRoot = [];
    for (const t of chosen) {
      if (t.admin) { asRoot.push(t); continue; }
      try { await sh(t.cmd, { timeout: 120000 }); results.push({ id: t.id, ok: true }); }
      catch (e) {
        if (t.fallbackAdmin) asRoot.push(t);
        else results.push({ id: t.id, ok: false, error: e.message });
      }
    }
    if (asRoot.length) {
      try {
        // Ask for the admin password once; report each task's result separately.
        const script = asRoot.map((t) => `if (${t.cmd}) >/dev/null 2>&1; then echo "OK ${t.id}"; else echo "KO ${t.id}"; fi`).join('\n');
        const out = await privileged(script, { timeout: 30 * 60000 });
        for (const t of asRoot) results.push({ id: t.id, ok: new RegExp(`^OK ${t.id}$`, 'm').test(out) });
      } catch (e) {
        for (const t of asRoot) results.push({ id: t.id, ok: false, error: e.cancelled ? 'Authentification annulée' : e.message });
      }
    }
  } else {
    const { runPS } = require('../ps');
    const admin = await require('../cleaner').isAdmin().catch(() => false);
    for (const t of chosen) {
      if (t.admin && !admin) { results.push({ id: t.id, ok: false, error: 'Droits administrateur requis' }); continue; }
      try {
        if (t.special === 'boost') await boost();
        else await runPS(t.ps, { timeout: 15 * 60000 });
        results.push({ id: t.id, ok: true });
      } catch (e) { results.push({ id: t.id, ok: false, error: e.message }); }
    }
  }
  return results;
}

module.exports = { list, run };
