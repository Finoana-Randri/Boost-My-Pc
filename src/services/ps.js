// Run PowerShell and return the result as JSON.
const { execFile } = require('child_process');

// A readable message: the first PowerShell error line (stderr comes as CLIXML), else the output,
// never the encoded command line.
function errorText(stderr, stdout, err) {
  let s = String(stderr || '').trim();
  if (s.startsWith('#< CLIXML')) {
    s = [...s.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)].map((m) => m[1]).join('')
      .replace(/_x000D__x000A_/g, '\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }
  s = s.split('\n').map((l) => l.trim()).find((l) => l && !/^(Au caractère|At line|\+|~)/.test(l)) || '';
  if (!s) s = String(stdout || '').trim().split('\n').pop().trim();
  if (!s) s = err.killed ? 'Délai dépassé.' : `La commande a échoué (code ${err.code ?? '?'}).`;
  return s.replace(/^[\w-]+ : /, '');
}

function runPS(script, { timeout = 60000 } = {}) {
  const wrapped = `$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;\n${script}`;
  const encoded = Buffer.from(wrapped, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(errorText(stderr, stdout, err)));
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

// Always return an array; ConvertTo-Json returns a single object for one result.
const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

// Escape a string for a single-quoted PowerShell value.
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;

module.exports = { runPS, runPSJson, asArray, psq };
