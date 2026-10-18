// Petit utilitaire pour exécuter du PowerShell et récupérer du JSON.
const { execFile } = require('child_process');

function runPS(script, { timeout = 60000 } = {}) {
  const wrapped = `$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;\n${script}`;
  const encoded = Buffer.from(wrapped, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || err.message).toString().trim()));
        resolve(stdout.toString().trim());
      }
    );
  });
}

async function runPSJson(script, opts) {
  const out = await runPS(script, opts);
  if (!out) return null;
  return JSON.parse(out);
}

// Toujours renvoyer un tableau (ConvertTo-Json renvoie un objet seul s'il n'y a qu'un élément)
const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

// Échappe une chaîne pour l'insérer entre guillemets simples PowerShell
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;

module.exports = { runPS, runPSJson, asArray, psq };
