// Interface languages: French (source), English, Malagasy.
// The interface is written in French; for another language this script translates the page as it
// is drawn: text, tooltips and placeholders. Numbers and sizes inside a text become {0}, {1}… so
// "3 tâches" and "12 tâches" share one entry; sizes are written the target language's way.
(function () {
  const LANGS = { fr: 'Français', en: 'English', mg: 'Malagasy' };
  const lang = (window.pcm && pcm.lang) || 'fr';
  const dict = (window.I18N_DICT && window.I18N_DICT[lang]) || {};
  const SIZE = /\d+(?:[.,  ]\d+)*(?: ?(?:o|Ko|Mo|Go|To)\b)?/g;
  const UNITS = { o: 'B', Ko: 'KB', Mo: 'MB', Go: 'GB', To: 'TB' };

  function localize(v) {
    if (lang !== 'en') return v;
    return v.replace(/(\d) (?=\d)/g, '$1,').replace(/(\d) (?=\d)/g, '$1,').replace(/(\d),(\d)/g, '$1.$2')
      .replace(/ ?\b(o|Ko|Mo|Go|To)$/, (m, u) => ` ${UNITS[u]}`);
  }

  const missing = new Set();
  function tr(text) {
    if (lang === 'fr' || !text) return text;
    // Signs before the text, and a progress count or a separator after it, stay as they are.
    const lead = text.match(/^[\s\-+–·]*/)[0], tail = text.slice(lead.length).match(/(\s*\(\d+\/\d+\))?[\s·]*$/)[0];
    const core = text.slice(lead.length, text.length - tail.length).replace(/\s+/g, ' ');
    if (!core || !/[A-Za-zÀ-ÿ]/.test(core)) return text;
    const vals = [];
    const key = core.replace(SIZE, (m) => `{${vals.push(m) - 1}}`);
    // Only numbers and sizes ("14,1 Go"): just write them the target language's way.
    if (!/[A-Za-zÀ-ÿ]/.test(key.replace(/\{\d+\}/g, ''))) { const t = core.replace(SIZE, localize); return t === core ? text : lead + t + tail; }
    let out = dict[key];
    if (out == null && key.includes(' · ')) {
      // Composite text: translate each part.
      const parts = core.split(' · ');
      const done = parts.map((p) => tr(p));
      if (done.some((d, i) => d !== parts[i])) return lead + done.join(' · ') + tail;
    }
    if (out == null && /^\{0\} ./.test(key)) {
      // "3 tâches": translate what follows the number.
      const rest = core.slice(vals[0].length + 1), t = tr(rest);
      if (t !== rest) return `${lead}${localize(vals[0])} ${t}${tail}`;
    }
    if (out == null) { if (window.I18N_COLLECT) missing.add(key); return text; }
    out = out.replace(/\{(\d+)\}/g, (m, i) => (vals[i] != null ? localize(vals[i]) : m));
    return lead + out + tail;
  }

  const ATTRS = ['title', 'placeholder', 'aria-label'];
  const done = new WeakMap(); // text node -> translated value (avoids translating twice)
  function translateNode(root) {
    if (root.nodeType === 3) {
      if (done.get(root) === root.nodeValue) return;
      const t = tr(root.nodeValue);
      if (t !== root.nodeValue) root.nodeValue = t;
      done.set(root, root.nodeValue);
      return;
    }
    if (root.nodeType !== 1 || root.closest?.('script, style, [data-no-i18n]')) return;
    for (const a of ATTRS) if (root.hasAttribute?.(a)) { const v = root.getAttribute(a), t = tr(v); if (t !== v) root.setAttribute(a, t); }
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (n.nodeType === 3) {
        if (done.get(n) === n.nodeValue) continue;
        const p = n.parentNode;
        if (p && (p.nodeName === 'SCRIPT' || p.nodeName === 'STYLE')) continue;
        const t = tr(n.nodeValue);
        if (t !== n.nodeValue) n.nodeValue = t;
        done.set(n, n.nodeValue);
      } else {
        for (const a of ATTRS) if (n.hasAttribute(a)) { const v = n.getAttribute(a), t = tr(v); if (t !== v) n.setAttribute(a, t); }
      }
    }
  }

  function start() {
    document.documentElement.lang = lang;
    if (lang === 'fr') return;
    translateNode(document.body);
    // Translate what the app draws next. Mutations are handled in one pass per task.
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'characterData') translateNode(m.target);
        else if (m.type === 'attributes') translateNode(m.target);
        else for (const n of m.addedNodes) translateNode(n);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  window.i18n = { lang, LANGS, t: tr, missing, localize };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
