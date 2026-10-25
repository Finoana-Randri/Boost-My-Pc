// Translation for the main process (notification-area menu, tooltips, alerts), with the same
// dictionary and rules as the interface (src/renderer/i18n.js).
const DICT = require('./renderer/i18n-dict');

const SIZE = /\d+(?:[.,  ]\d+)*(?: ?(?:o|Ko|Mo|Go|To)\b)?/g;
const UNITS = { o: 'B', Ko: 'KB', Mo: 'MB', Go: 'GB', To: 'TB' };

function makeT(getLang) {
  return (text) => {
    const lang = getLang();
    if (lang === 'fr' || !text) return text;
    const dict = DICT[lang] || {};
    const vals = [];
    const key = String(text).replace(SIZE, (m) => `{${vals.push(m) - 1}}`);
    const out = dict[key];
    if (out == null) return text;
    return out.replace(/\{(\d+)\}/g, (m, i) => {
      let v = vals[i];
      if (v == null) return m;
      if (lang === 'en') v = v.replace(/(\d)[  ](?=\d)/g, '$1,').replace(/(\d),(\d)/g, '$1.$2').replace(/ ?\b(o|Ko|Mo|Go|To)$/, (x, u) => ` ${UNITS[u]}`);
      return v;
    });
  };
}

module.exports = { makeT };
