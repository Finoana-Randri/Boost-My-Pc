// List the interface strings to translate (French source), as normalized keys:
// numbers and interpolated values become {0}, {1}… Usage: node scripts/i18n-extract.js > keys.json
// Uses the TypeScript parser (dev dependency) to read string and template literals exactly.
const fs = require('fs');
const ts = require('typescript');

const FILES = ['src/renderer/app.js', 'src/renderer/mini.js', 'src/renderer/index.html', 'src/renderer/mini.html', 'src/menubar.js', 'src/main.js',
  ...fs.readdirSync('src/services/v2').map((f) => `src/services/v2/${f}`),
  ...fs.readdirSync('src/services').filter((f) => f.endsWith('.js')).map((f) => `src/services/${f}`),
  ...fs.readdirSync('src/services/linux').map((f) => `src/services/linux/${f}`)].filter((f) => fs.existsSync(f));

// Same normalization as the runtime translator (i18n.js). \u0000 marks an interpolated value.
function norm(t) {
  let i = 0;
  return t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
    .replace(/\u0000|\d+(?:[.,  ]\d+)*(?: ?(?:o|Ko|Mo|Go|To)\b)?/g, () => `{${i++}}`);
}
const visible = (k) => /^[A-Za-zÀ-ÿ«{(]/.test(k) && /[a-zà-ÿ]{3}/.test(k) && !/^[\w.:/-]+$/.test(k)
  && !/[=$|\\<>`]|\/dev|--|\.\/|\bnull\b|\bundefined\b|&&|\|\||\?\.|=>|[;{}]\s*$/.test(k.replace(/\{\d+\}/g, ''))
  && !/^(sh|ps|cmd|reg|schtasks|powershell|sudo|apt|dnf|pkexec|DEBIAN_FRONTEND|Set-|Start-|Update-|Get-|Remove-|New-|Stop-|Software|HKLM|HKCU|User Data|Visited Links|Local State|active,|firefox:|xfce|margin|flex|grid|var\(|rgba|linear|radial|conic|translate|cubic)/i.test(k)
  && /[À-ÿ«»…’]|\b(le|la|les|des|du|de|un|une|et|ou|en|vos|votre|sur|pour|avec|sans|est|sont|au|aux|à|ne|pas|plus|d'|l')\b/i.test(k) || /^[A-ZÀ-Ý][a-zà-ÿ]+( [a-zà-ÿ'’]+)*$/.test(k);

const keys = new Set();
const add = (raw) => {
  for (const chunk of raw.split(/<[^>]*>/)) {
    const k = norm(chunk);
    if (k && !/^\{\d+\}$/.test(k) && visible(k)) keys.add(k);
  }
};
for (const f of FILES) {
  const src = fs.readFileSync(f, 'utf8');
  if (f.endsWith('.html')) {
    const html = src.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<!--[\s\S]*?-->/g, '');
    add(html);
    for (const m of html.matchAll(/(?:title|placeholder|aria-label)="([^"]*)"/g)) add(m[1]);
    continue;
  }
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const walk = (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) add(n.text);
    else if (ts.isTemplateExpression(n)) {
      add(n.head.text + n.templateSpans.map((s) => '\u0000' + s.literal.text).join(''));
      // Attribute values such as title="…" inside a template.
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  for (const m of src.matchAll(/(?:title|placeholder|aria-label)="([^"$]*)"/g)) add(m[1]);
}
// Composite texts joined with " · " are also translated piece by piece.
for (const k of [...keys]) if (k.includes(' · ')) k.split(' · ').forEach((p) => { const q = norm(p.replace(/\{\d+\}/g, '\u0000')); if (visible(q) && !/^\{\d+\}$/.test(q)) keys.add(q); });
process.stdout.write(JSON.stringify([...keys].sort(), null, 1));
