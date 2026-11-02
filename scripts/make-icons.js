// Builds src/renderer/icons.js from Phosphor Icons (MIT, https://phosphoricons.com).
// Run: node scripts/make-icons.js
// Each name of the interface points to one Phosphor icon, drawn in four weights:
//   icon()   regular  buttons, text and lists
//   ficon()  duotone  cards, rows and feature tiles
//   micon()  fill     module tiles (sidebar, home screens) and small solid marks
//   bold     regular icons drawn heavier on demand: icon('check', 'bold')
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'node_modules', '@phosphor-icons', 'core', 'assets');
const OUT = path.join(__dirname, '..', 'src', 'renderer', 'icons.js');

const NAMES = {
  // Modules
  smart: 'sparkle',
  cleanup: 'broom',
  protection: 'shield-check',
  performance: 'gauge',
  applications: 'squares-four',
  clutter: 'stack',
  lens: 'chart-pie-slice',
  cloud: 'cloud',
  shredder: 'shredder',
  tools: 'toolbox',
  settings: 'gear-six',
  // Interface
  home: 'house',
  shield: 'shield-check',
  shieldCheck: 'shield-check',
  admin: 'shield-warning',
  storage: 'hard-drives',
  apps: 'squares-four',
  toolbox: 'toolbox',
  rocket: 'rocket-launch',
  heart: 'heartbeat',
  broom: 'broom',
  sparkle: 'sparkle',
  gauge: 'gauge',
  layers: 'stack',
  process: 'cpu',
  chip: 'circuitry',
  memory: 'memory',
  power: 'power',
  bolt: 'lightning',
  battery: 'battery-high',
  trash: 'trash',
  file: 'file-text',
  folder: 'folder',
  image: 'image',
  camera: 'camera',
  copy: 'copy',
  box: 'package',
  download: 'download-simple',
  upload: 'upload-simple',
  update: 'arrows-clockwise',
  refresh: 'arrow-clockwise',
  wifi: 'wifi-high',
  globe: 'globe',
  virus: 'virus',
  bug: 'bug',
  firewall: 'wall',
  lock: 'lock',
  eye: 'eye',
  clock: 'clock',
  calendar: 'calendar-blank',
  bell: 'bell',
  wrench: 'wrench',
  calculator: 'calculator',
  captions: 'closed-captioning',
  notepad: 'notepad',
  mic: 'microphone',
  screenshot: 'selection-plus',
  monitor: 'monitor',
  terminal: 'terminal-window',
  translate: 'translate',
  currency: 'coins',
  book: 'book-open',
  weather: 'cloud-sun',
  edge: 'compass',
  task: 'pulse',
  search: 'magnifying-glass',
  info: 'info',
  warn: 'warning',
  check: 'check',
  x: 'x',
  back: 'caret-left',
  chevron: 'caret-right',
  external: 'arrow-square-out',
  github: 'github-logo',
  play: 'play',
  stop: 'stop',
  viewList: 'list-bullets',
  viewCards: 'squares-four',
};

// On cards a bare mark looks lost: these use the circled version.
const DUOTONE_NAMES = { check: 'check-circle', x: 'x-circle', info: 'info' };

const FILLED = ['smart', 'cleanup', 'protection', 'performance', 'applications', 'clutter', 'lens', 'cloud', 'shredder', 'tools', 'settings', 'bolt',
  'process', 'memory', 'storage', 'battery', 'shield', 'update', 'refresh', 'clock', 'warn', 'check'];
const BOLD = ['check', 'chevron', 'back', 'x', 'warn'];

// Phosphor has no shredder: drawn here on the same 256 grid and 16 px stroke.
const SHREDDER_LINES = '<path d="M72 104V40a8 8 0 0 1 8-8h96a8 8 0 0 1 8 8v64"/><rect x="32" y="104" width="192" height="64" rx="12"/><path d="M80 168v48M112 168v32M144 168v56M176 168v40"/>';
const stroked = (width, body) => `<g fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;
const CUSTOM = {
  shredder: {
    regular: stroked(16, SHREDDER_LINES),
    bold: stroked(24, SHREDDER_LINES),
    duotone: `<path opacity=".2" d="M80 32h96a8 8 0 0 1 8 8v64H72V40a8 8 0 0 1 8-8z"/><rect opacity=".2" x="32" y="104" width="192" height="64" rx="12"/>${stroked(16, SHREDDER_LINES)}`,
    fill: '<path d="M84 24h88a20 20 0 0 1 20 20v52H64V44a20 20 0 0 1 20-20z"/><rect x="24" y="104" width="208" height="72" rx="20"/>'
      + '<rect x="72" y="188" width="16" height="44" rx="8"/><rect x="104" y="188" width="16" height="28" rx="8"/><rect x="136" y="188" width="16" height="52" rx="8"/><rect x="168" y="188" width="16" height="36" rx="8"/>',
  },
};

// Sidebar: the drawings of version 2.5 on a 24 px grid; Disk Map uses its Phosphor icon.
const NAV = {
  smart: '<path opacity=".85" d="M3.3 18.6 12.9 9a1.5 1.5 0 0 1 2.1 2.1l-9.6 9.6a1.5 1.5 0 0 1-2.1-2.1z"/><path fill="#000" opacity=".22" d="M11.6 10.3 13.7 12.4 15 11.1a1.5 1.5 0 0 0-2.1-2.1z"/><path d="M17.4 1.6c.35 2.7 1.85 4.2 4.55 4.55-2.7.35-4.2 1.85-4.55 4.55-.35-2.7-1.85-4.2-4.55-4.55 2.7-.35 4.2-1.85 4.55-4.55z"/><path opacity=".7" d="M7.6 2.4c.18 1.4.95 2.17 2.35 2.35-1.4.18-2.17.95-2.35 2.35-.18-1.4-.95-2.17-2.35-2.35 1.4-.18 2.17-.95 2.35-2.35z"/><path opacity=".55" d="M19.6 13.6c.15 1.15.8 1.8 1.95 1.95-1.15.15-1.8.8-1.95 1.95-.15-1.15-.8-1.8-1.95-1.95 1.15-.15 1.8-.8 1.95-1.95z"/>',
  cleanup: '<path opacity=".6" d="M19.4 2.9a1.2 1.2 0 0 1 1.7 1.7l-6.3 6.3-1.7-1.7z"/><path opacity=".85" d="M11.4 9.7l2.9 2.9c.7.7.7 1.8 0 2.5l-.7.7-5.4-5.4.7-.7c.7-.7 1.8-.7 2.5 0z"/><path d="M7.5 11.2l5.3 5.3c-1.7 3.5-4.9 5.4-9.1 5.7a.7.7 0 0 1-.75-.75c.3-4.2 2.2-7.4 4.55-10.25z"/><path opacity=".7" d="M5.2 2.8l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z"/>',
  protection: '<path d="M12 2.2l8 3.2v6.2c0 5-3.4 9.2-8 10.6-4.6-1.4-8-5.6-8-10.6V5.4z"/><path fill="#000" opacity=".14" d="M12 2.2l8 3.2v6.2c0 5-3.4 9.2-8 10.6z"/><path fill="none" stroke="#000" stroke-opacity=".32" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M8.3 12.2l2.6 2.6 4.9-5.1"/>',
  performance: '<path d="M12 4.2a9.3 9.3 0 0 1 9.3 9.3c0 1.3-.3 2.6-.8 3.8a1.6 1.6 0 0 1-1.5 1H5a1.6 1.6 0 0 1-1.5-1 9.3 9.3 0 0 1 8.5-13.1z"/><path fill="#000" opacity=".3" d="M13.2 14.6a1.9 1.9 0 1 1-2.6-2.6l6.1-4.1z"/><circle fill="#000" opacity=".18" cx="6.6" cy="12.6" r="1"/><circle fill="#000" opacity=".18" cx="8.5" cy="8.4" r="1"/><circle fill="#000" opacity=".18" cx="12" cy="7" r="1"/>',
  applications: '<rect x="3" y="3" width="8" height="8" rx="2.4"/><rect opacity=".72" x="13" y="3" width="8" height="8" rx="2.4"/><rect opacity=".72" x="3" y="13" width="8" height="8" rx="2.4"/><rect opacity=".45" x="13" y="13" width="8" height="8" rx="2.4"/>',
  clutter: '<path opacity=".45" d="M2.6 16.2l9.4 4.9 9.4-4.9-2.4-1.2-7 3.6-7-3.6z"/><path opacity=".72" d="M2.6 12l9.4 4.9 9.4-4.9-2.4-1.2-7 3.6-7-3.6z"/><path d="M12 2.6l9.4 4.9-9.4 4.9-9.4-4.9z"/>',
  cloud: '<path d="M7.2 19.5a5.2 5.2 0 0 1-.9-10.3 6.8 6.8 0 0 1 13 2.1 4.1 4.1 0 0 1-1.3 8.2z"/><path fill="#000" opacity=".16" d="M7.2 19.5a5.2 5.2 0 0 1-3.6-1.5c4.7.6 10.8-.4 16.9-3.3a4.1 4.1 0 0 1-1.6 4.8z"/>',
  shredder: '<path opacity=".7" d="M7 2.5h10v7.5H7z"/><rect x="2.5" y="9" width="19" height="7" rx="2"/><rect fill="#000" opacity=".2" x="5" y="12" width="14" height="1.6" rx=".8"/><g opacity=".7"><rect x="6.2" y="17" width="1.8" height="4.5" rx=".9"/><rect x="9.6" y="17" width="1.8" height="3.2" rx=".9"/><rect x="13" y="17" width="1.8" height="4.8" rx=".9"/><rect x="16.4" y="17" width="1.8" height="3.6" rx=".9"/></g>',
  tools: '<path opacity=".8" d="M8.6 7V5.4A1.9 1.9 0 0 1 10.5 3.5h3a1.9 1.9 0 0 1 1.9 1.9V7h-1.8V5.5h-3.2V7z"/><rect x="2.5" y="7" width="19" height="13.5" rx="2.6"/><rect fill="#000" opacity=".16" x="2.5" y="12.2" width="19" height="2"/><rect fill="#000" opacity=".28" x="10.2" y="11" width="3.6" height="4.4" rx="1"/>',
  settings: '<path fill-rule="evenodd" d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.48.48 0 0 0-.12-.61zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z"/>',
};

function draw(name, weight) {
  const custom = CUSTOM[NAMES[name]];
  if (custom) return custom[weight];
  const suffix = weight === 'regular' ? '' : `-${weight}`;
  const base = (weight === 'duotone' && DUOTONE_NAMES[name]) || NAMES[name];
  const file = path.join(ASSETS, weight, `${base}${suffix}.svg`);
  const svg = fs.readFileSync(file, 'utf8');
  return svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/opacity="0\.2"/g, 'opacity=".2"');
}

function table(names, weight) {
  return `{\n${names.map((n) => `  ${n}: '${draw(n, weight)}',`).join('\n')}\n}`;
}

const all = Object.keys(NAMES);
const source = `// Generated by scripts/make-icons.js from Phosphor Icons (MIT License, Copyright (c) 2023 Phosphor Icons).
// Edit the name list in that script, then run it again.
const ICONS = ${table(all, 'regular')};

const ICONS_BOLD = ${table(BOLD, 'bold')};

const FICONS = ${table(all, 'duotone')};

const MICONS = ${table(FILLED, 'fill')};

const svg = (body, cls) => \`<svg class="svg-ico \${cls}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">\${body || ''}</svg>\`;

function icon(name, cls = '') {
  const bold = /\\bbold\\b/.test(cls) && ICONS_BOLD[name];
  return svg(bold || ICONS[name], cls);
}

function ficon(name, cls = '') {
  return svg(FICONS[name] || ICONS[name], \`f-ico-svg \${cls}\`);
}

function micon(name, cls = '') {
  return svg(MICONS[name] || MICONS.smart, \`m-ico \${cls}\`);
}

const NAV_ICONS = ${JSON.stringify(NAV, null, 2)};

function navicon(name, cls = '') {
  if (!NAV_ICONS[name]) return micon(name, cls);
  return \`<svg class="svg-ico m-ico \${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">\${NAV_ICONS[name]}</svg>\`;
}
`;

fs.writeFileSync(OUT, source);
console.log(`${OUT}: ${all.length} icons`);
