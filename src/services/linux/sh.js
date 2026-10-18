// Utilitaires shell pour Linux : exécution de commandes, détection d'outils, élévation via pkexec.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(cmd, args = [], { timeout = 60000, okCodes = [0] } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
      if (err && !okCodes.includes(code)) {
        const e = new Error((stderr || err.message).toString().trim() || `${cmd} a échoué (code ${code})`);
        e.code = code;
        return reject(e);
      }
      resolve(stdout.toString());
    });
  });
}

const sh = (script, opts) => run('sh', ['-c', script], opts);

const whichCache = new Map();
function which(bin) {
  if (whichCache.has(bin)) return whichCache.get(bin);
  const dirs = (process.env.PATH || '/usr/local/bin:/usr/bin:/bin').split(':').concat(['/usr/sbin', '/sbin']);
  let found = null;
  for (const d of dirs) {
    const p = path.join(d, bin);
    try { fs.accessSync(p, fs.constants.X_OK); found = p; break; } catch {}
  }
  whichCache.set(bin, found);
  return found;
}

const isRoot = () => typeof process.getuid === 'function' && process.getuid() === 0;

// Exécute un script avec les droits administrateur (une seule demande de mot de passe via polkit)
async function privileged(script, opts = {}) {
  if (isRoot()) return sh(script, opts);
  if (!which('pkexec')) throw new Error('pkexec est introuvable : impossible d\'obtenir les droits administrateur.');
  try {
    return await run('pkexec', ['sh', '-c', script], { timeout: 30 * 60000, ...opts });
  } catch (e) {
    // pkexec : 126 = fenêtre d'authentification fermée, 127 = non autorisé
    if (e.code === 126 || e.code === 127 || /dismissed|Not authorized/i.test(e.message)) {
      const err = new Error('Authentification annulée ou refusée.');
      err.cancelled = true;
      throw err;
    }
    throw e;
  }
}

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }

let osRelease = null;
function getOsRelease() {
  if (osRelease) return osRelease;
  osRelease = {};
  const txt = readText('/etc/os-release') || readText('/usr/lib/os-release') || '';
  for (const line of txt.split('\n')) {
    const m = line.match(/^([A-Z_]+)=("?)(.*)\2$/);
    if (m) osRelease[m[1]] = m[3];
  }
  return osRelease;
}

// Gestionnaire de paquets principal de la distribution
function packageManager() {
  if (which('apt-get') && which('dpkg-query')) return 'apt';
  if (which('dnf')) return 'dnf';
  if (which('pacman')) return 'pacman';
  if (which('zypper')) return 'zypper';
  return null;
}

module.exports = { run, sh, which, isRoot, privileged, q, readText, getOsRelease, packageManager };
