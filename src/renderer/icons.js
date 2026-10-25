// Fluent-style outline icons, rendered as inline SVG.
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  storage: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><circle cx="7" cy="7.5" r=".8"/><circle cx="7" cy="16.5" r=".8"/>',
  apps: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  toolbox: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18M10 13v2h4v-2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  rocket: '<path d="M5 15c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.9A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2z"/><path d="M9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/><path d="M3 12h4l2-3 3 6 2-3h7"/>',
  broom: '<path d="m14 4 6 6M17 7l-7 7M3 21l5-1 4-4-4-4-4 4z"/><path d="m8 12 4 4"/>',
  process: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  update: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  wifi: '<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0"/><circle cx="12" cy="19.5" r="1"/>',
  virus: '<circle cx="12" cy="12" r="5"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3.5 3.5M15.5 15.5 19 19M5 19l3.5-3.5M15.5 8.5 19 5"/>',
  firewall: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M3 14.5h18M9 4v5M15 9v5.5M9 14.5V20"/>',
  calculator: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h.01M16 19h.01"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  captions: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M10 10.5a2 2 0 1 0 0 3M17 10.5a2 2 0 1 0 0 3"/>',
  notepad: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M8 13h8M8 17h5M8 9h3"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8"/>',
  screenshot: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  translate: '<path d="M4 5h8M8 3v2M5 9c1.5 3 4 5 7 6M11 5c-1 4-4 8-7 10"/><path d="m13 21 4-9 4 9M14.5 18h5"/>',
  currency: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5a3 3 0 0 0-3-1.5c-1.7 0-3 .9-3 2s1.3 1.7 3 2 3 .9 3 2-1.3 2-3 2a3 3 0 0 1-3-1.5M12 6v2M12 16v2"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  weather: '<path d="M17.5 19H8a5 5 0 1 1 1-9.9 6 6 0 0 1 11.3 2.4A3.5 3.5 0 0 1 17.5 19z"/>',
  edge: '<circle cx="12" cy="12" r="9"/><path d="M7 14c0-3 2.5-5 5.5-5S18 10.5 18 12.5c0 1-1 1.5-2 1.5H9.5c0 2 2 3.5 4.5 3.5 1.5 0 3-.5 4-1.5"/>',
  task: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  chip: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 9h6v6H9z"/>',
  memory: '<rect x="2" y="7" width="20" height="10" rx="1"/><path d="M6 7v10M10 7v10M14 7v10M18 7v10M4 17v3M20 17v3"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  warn: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  back: '<path d="M15 18 9 12l6-6"/>',
  github: '<path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  external: '<path d="M14 3h7v7M10 14 21 3M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  admin: '<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z"/><path d="M12 8v4M12 16h.01"/>',
};

function icon(name, cls = '') {
  return `<svg class="svg-ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

// v2 icons
Object.assign(ICONS, {
  sparkle: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8zM5 15l.6 1.4L7 17l-1.4.6L5 19l-.6-1.4L3 17l1.4-.6z"/>',
  gauge: '<path d="M12 14l4-4"/><path d="M3.5 18a9 9 0 1 1 17 0"/><circle cx="12" cy="14" r="1.5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/><path d="m3 17.5 9 4.5 9-4.5"/>',
  lens: '<circle cx="12" cy="12" r="9"/><path d="M12 3v9l6.4 6.4"/><path d="M12 12 4.2 16.5"/>',
  cloud: '<path d="M17.5 19H8a5 5 0 1 1 1-9.9 6 6 0 0 1 11.3 2.4A3.5 3.5 0 0 1 17.5 19z"/>',
  shredder: '<rect x="4" y="9" width="16" height="6" rx="1.5"/><path d="M7 9V3h10v6M7 15v6M10 15v4M14 15v5M17 15v3"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>',
});

// Solid two-tone icons for the v2 module tiles.
const MICONS = {
  smart: '<path opacity=".85" d="M3.3 18.6 12.9 9a1.5 1.5 0 0 1 2.1 2.1l-9.6 9.6a1.5 1.5 0 0 1-2.1-2.1z"/><path fill="#000" opacity=".22" d="M11.6 10.3 13.7 12.4 15 11.1a1.5 1.5 0 0 0-2.1-2.1z"/><path d="M17.4 1.6c.35 2.7 1.85 4.2 4.55 4.55-2.7.35-4.2 1.85-4.55 4.55-.35-2.7-1.85-4.2-4.55-4.55 2.7-.35 4.2-1.85 4.55-4.55z"/><path opacity=".7" d="M7.6 2.4c.18 1.4.95 2.17 2.35 2.35-1.4.18-2.17.95-2.35 2.35-.18-1.4-.95-2.17-2.35-2.35 1.4-.18 2.17-.95 2.35-2.35z"/><path opacity=".55" d="M19.6 13.6c.15 1.15.8 1.8 1.95 1.95-1.15.15-1.8.8-1.95 1.95-.15-1.15-.8-1.8-1.95-1.95 1.15-.15 1.8-.8 1.95-1.95z"/>',
  cleanup: '<path opacity=".6" d="M19.4 2.9a1.2 1.2 0 0 1 1.7 1.7l-6.3 6.3-1.7-1.7z"/><path opacity=".85" d="M11.4 9.7l2.9 2.9c.7.7.7 1.8 0 2.5l-.7.7-5.4-5.4.7-.7c.7-.7 1.8-.7 2.5 0z"/><path d="M7.5 11.2l5.3 5.3c-1.7 3.5-4.9 5.4-9.1 5.7a.7.7 0 0 1-.75-.75c.3-4.2 2.2-7.4 4.55-10.25z"/><path opacity=".7" d="M5.2 2.8l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z"/>',
  protection: '<path d="M12 2.2l8 3.2v6.2c0 5-3.4 9.2-8 10.6-4.6-1.4-8-5.6-8-10.6V5.4z"/><path fill="#000" opacity=".14" d="M12 2.2l8 3.2v6.2c0 5-3.4 9.2-8 10.6z"/><path fill="none" stroke="#000" stroke-opacity=".32" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M8.3 12.2l2.6 2.6 4.9-5.1"/>',
  performance: '<path d="M12 4.2a9.3 9.3 0 0 1 9.3 9.3c0 1.3-.3 2.6-.8 3.8a1.6 1.6 0 0 1-1.5 1H5a1.6 1.6 0 0 1-1.5-1 9.3 9.3 0 0 1 8.5-13.1z"/><path fill="#000" opacity=".3" d="M13.2 14.6a1.9 1.9 0 1 1-2.6-2.6l6.1-4.1z"/><circle fill="#000" opacity=".18" cx="6.6" cy="12.6" r="1"/><circle fill="#000" opacity=".18" cx="8.5" cy="8.4" r="1"/><circle fill="#000" opacity=".18" cx="12" cy="7" r="1"/>',
  applications: '<rect x="3" y="3" width="8" height="8" rx="2.4"/><rect opacity=".72" x="13" y="3" width="8" height="8" rx="2.4"/><rect opacity=".72" x="3" y="13" width="8" height="8" rx="2.4"/><rect opacity=".45" x="13" y="13" width="8" height="8" rx="2.4"/>',
  clutter: '<path opacity=".45" d="M2.6 16.2l9.4 4.9 9.4-4.9-2.4-1.2-7 3.6-7-3.6z"/><path opacity=".72" d="M2.6 12l9.4 4.9 9.4-4.9-2.4-1.2-7 3.6-7-3.6z"/><path d="M12 2.6l9.4 4.9-9.4 4.9-9.4-4.9z"/>',
  lens: '<path d="M10.8 3.1a9 9 0 1 0 10.1 10.1h-10.1z"/><path opacity=".6" d="M13.2 1.6v9.2h9.2a9.2 9.2 0 0 0-9.2-9.2z"/>',
  cloud: '<path d="M7.2 19.5a5.2 5.2 0 0 1-.9-10.3 6.8 6.8 0 0 1 13 2.1 4.1 4.1 0 0 1-1.3 8.2z"/><path fill="#000" opacity=".16" d="M7.2 19.5a5.2 5.2 0 0 1-3.6-1.5c4.7.6 10.8-.4 16.9-3.3a4.1 4.1 0 0 1-1.6 4.8z"/>',
  shredder: '<path opacity=".7" d="M7 2.5h10v7.5H7z"/><rect x="2.5" y="9" width="19" height="7" rx="2"/><rect fill="#000" opacity=".2" x="5" y="12" width="14" height="1.6" rx=".8"/><g opacity=".7"><rect x="6.2" y="17" width="1.8" height="4.5" rx=".9"/><rect x="9.6" y="17" width="1.8" height="3.2" rx=".9"/><rect x="13" y="17" width="1.8" height="4.8" rx=".9"/><rect x="16.4" y="17" width="1.8" height="3.6" rx=".9"/></g>',
  tools: '<path opacity=".8" d="M8.6 7V5.4A1.9 1.9 0 0 1 10.5 3.5h3a1.9 1.9 0 0 1 1.9 1.9V7h-1.8V5.5h-3.2V7z"/><rect x="2.5" y="7" width="19" height="13.5" rx="2.6"/><rect fill="#000" opacity=".16" x="2.5" y="12.2" width="19" height="2"/><rect fill="#000" opacity=".28" x="10.2" y="11" width="3.6" height="4.4" rx="1"/>',
  settings: '<path fill-rule="evenodd" d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.48.48 0 0 0-.12-.61zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z"/>',
};

function micon(name, cls = '') {
  return `<svg class="svg-ico m-ico ${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${MICONS[name] || MICONS.smart}</svg>`;
}

// View toggle icons (list / cards)
Object.assign(ICONS, {
  viewList: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  viewCards: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
});

// Filled two-tone icons for cards (artwork, card icons, lists)
const FICONS = {
  bug: '<path opacity=".6" d="M9 6.8a3 3 0 0 1 6 0c0 .4-.1.7-.2 1-.8-.4-1.8-.6-2.8-.6s-2 .2-2.8.6A3 3 0 0 1 9 6.8z"/><path d="M12 7.6c3 0 5.5 2.6 5.5 6.3 0 3.9-2.5 7.1-5.5 7.1s-5.5-3.2-5.5-7.1c0-3.7 2.5-6.3 5.5-6.3z"/><path fill="#000" opacity=".2" d="M11.35 8.3h1.3V21h-1.3z"/><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" opacity=".75" d="M6.7 11.6 3.6 10.1M6.4 15H3.2M6.9 18.1l-2.6 1.6M17.3 11.6l3.1-1.5M17.6 15h3.2M17.1 18.1l2.6 1.6M9.7 4.7 8.4 2.9M14.3 4.7l1.3-1.8"/>',
  shieldCheck: '<path d="M12 2.2l8 3.2v6.2c0 5-3.4 9.2-8 10.6-4.6-1.4-8-5.6-8-10.6V5.4z"/><path fill="#000" opacity=".14" d="M12 2.2l8 3.2v6.2c0 5-3.4 9.2-8 10.6z"/><path fill="none" stroke="#000" stroke-opacity=".32" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M8.3 12.2l2.6 2.6 4.9-5.1"/>',
  warn: '<path d="M10.3 3.9a2 2 0 0 1 3.4 0l8.1 13.9A2 2 0 0 1 20.1 21H3.9a2 2 0 0 1-1.7-3.2z"/><path fill="#000" opacity=".3" d="M11 8.8h2v5.6h-2zM11 15.9h2v2.1h-2z"/>',
  globe: '<circle cx="12" cy="12" r="9.5"/><path fill="none" stroke="#000" stroke-opacity=".22" stroke-width="1.4" d="M2.5 12h19M12 2.5c2.6 2.6 4 6 4 9.5s-1.4 6.9-4 9.5c-2.6-2.6-4-6-4-9.5s1.4-6.9 4-9.5z"/>',
  clock: '<circle cx="12" cy="12" r="9.5"/><path fill="none" stroke="#000" stroke-opacity=".3" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" d="M12 6.8v5.4l3.5 2.1"/>',
  camera: '<rect x="2.5" y="6.5" width="13" height="11" rx="3"/><path opacity=".7" d="M16.5 10.2l4.2-2.5c.4-.2.8.1.8.5v7.6c0 .4-.4.7-.8.5l-4.2-2.5z"/><circle fill="#000" opacity=".2" cx="9" cy="12" r="2.6"/>',
  eye: '<path d="M12 5c5.5 0 9.3 4.6 10.3 6.1.4.6.4 1.2 0 1.8C21.3 14.4 17.5 19 12 19S2.7 14.4 1.7 12.9a1.6 1.6 0 0 1 0-1.8C2.7 9.6 6.5 5 12 5z"/><circle fill="#000" opacity=".25" cx="12" cy="12" r="3.6"/>',
  lock: '<path opacity=".6" d="M7.5 10.5V8a4.5 4.5 0 0 1 9 0v2.5h-2.2V8a2.3 2.3 0 0 0-4.6 0v2.5z"/><rect x="4.5" y="10.5" width="15" height="11" rx="2.5"/><circle fill="#000" opacity=".25" cx="12" cy="16" r="1.6"/>',
  wrench: '<path d="M20.7 7.3a5 5 0 0 1-6.4 6.3l-6.6 6.6a2.2 2.2 0 0 1-3.1-3.1l6.6-6.6a5 5 0 0 1 6.3-6.4l-3.1 3.1.6 2.5 2.5.6z"/>',
  refresh: '<path d="M12 4a8 8 0 0 1 7.4 5H21l-3 4-3-4h2.1A6 6 0 0 0 6.6 9.1L5 7.8A8 8 0 0 1 12 4z"/><path opacity=".65" d="M12 20a8 8 0 0 1-7.4-5H3l3-4 3 4H6.9a6 6 0 0 0 10.5-.1l1.6 1.3A8 8 0 0 1 12 20z"/>',
  power: '<path opacity=".55" d="M12 2.5c.8 0 1.4.6 1.4 1.4v7.2a1.4 1.4 0 0 1-2.8 0V3.9c0-.8.6-1.4 1.4-1.4z"/><path d="M6.2 6.3a1.4 1.4 0 0 1 2 2 6 6 0 1 0 7.6 0 1.4 1.4 0 0 1 2-2 8.8 8.8 0 1 1-11.6 0z"/>',
  memory: '<rect x="3" y="7" width="18" height="10" rx="2"/><g opacity=".6"><rect x="5.5" y="17" width="1.6" height="3" rx=".5"/><rect x="9" y="17" width="1.6" height="3" rx=".5"/><rect x="12.5" y="17" width="1.6" height="3" rx=".5"/><rect x="16" y="17" width="1.6" height="3" rx=".5"/></g><g fill="#000" opacity=".18"><rect x="6" y="9.5" width="3" height="5" rx=".8"/><rect x="10.5" y="9.5" width="3" height="5" rx=".8"/><rect x="15" y="9.5" width="3" height="5" rx=".8"/></g>',
  process: '<rect x="5" y="5" width="14" height="14" rx="3"/><rect fill="#000" opacity=".2" x="9" y="9" width="6" height="6" rx="1.2"/><g opacity=".6"><rect x="8.2" y="1.8" width="1.6" height="3" rx=".6"/><rect x="14.2" y="1.8" width="1.6" height="3" rx=".6"/><rect x="8.2" y="19.2" width="1.6" height="3" rx=".6"/><rect x="14.2" y="19.2" width="1.6" height="3" rx=".6"/><rect x="1.8" y="8.2" width="3" height="1.6" rx=".6"/><rect x="1.8" y="14.2" width="3" height="1.6" rx=".6"/><rect x="19.2" y="8.2" width="3" height="1.6" rx=".6"/><rect x="19.2" y="14.2" width="3" height="1.6" rx=".6"/></g>',
  box: '<path d="M12 2.8l8.5 4.6v9.2L12 21.2l-8.5-4.6V7.4z"/><path fill="#000" opacity=".16" d="M12 12v9.2l8.5-4.6V7.4z"/><path fill="#fff" opacity=".3" d="M3.5 7.4 12 12l8.5-4.6L12 2.8z"/>',
  update: '<circle cx="12" cy="12" r="9.5"/><path fill="none" stroke="#000" stroke-opacity=".3" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M12 7v8.2m-3.6-3.6L12 15.2l3.6-3.6"/>',
  copy: '<rect opacity=".55" x="3" y="3" width="12" height="14" rx="2.5"/><rect x="8" y="7" width="13" height="14" rx="2.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="3"/><path fill="#000" opacity=".2" d="M3 16.5l5-5 4 4 3-3 6 6V17a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z"/><circle fill="#000" opacity=".2" cx="16" cy="8.5" r="1.8"/>',
  file: '<path d="M6.5 2.5H14l5 5V19a2.5 2.5 0 0 1-2.5 2.5h-10A2.5 2.5 0 0 1 4 19V5a2.5 2.5 0 0 1 2.5-2.5z"/><path opacity=".5" d="M14 2.5V7a.5.5 0 0 0 .5.5H19z"/>',
  download: '<path opacity=".55" d="M4 15.5h3l2.3 2.3a1 1 0 0 0 .7.3h4a1 1 0 0 0 .7-.3l2.3-2.3h3V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M10.6 3.5h2.8v7h3l-4.4 4.6-4.4-4.6h3z"/>',
  folder: '<path opacity=".6" d="M3 6.5A2.5 2.5 0 0 1 5.5 4h4l2 2h7A2.5 2.5 0 0 1 21 8.5V9H3z"/><path d="M3 9h18v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  wifi: '<path opacity=".45" d="M12 4.5c3.9 0 7.4 1.5 10 4l-1.9 1.9A11.4 11.4 0 0 0 12 7.2c-3.1 0-6 1.2-8.1 3.2L2 8.5c2.6-2.5 6.1-4 10-4z"/><path opacity=".7" d="M12 9.6c2.5 0 4.7 1 6.3 2.6l-1.9 1.9A6.2 6.2 0 0 0 12 12.3c-1.7 0-3.3.7-4.4 1.8l-1.9-1.9A8.9 8.9 0 0 1 12 9.6z"/><circle cx="12" cy="17.8" r="2.2"/>',
  storage: '<rect x="3" y="4" width="18" height="7" rx="2.2"/><rect opacity=".7" x="3" y="13" width="18" height="7" rx="2.2"/><circle fill="#000" opacity=".25" cx="7" cy="7.5" r="1"/><circle fill="#000" opacity=".25" cx="7" cy="16.5" r="1"/>',
  apps: '<rect x="3" y="3" width="8" height="8" rx="2.4"/><rect opacity=".72" x="13" y="3" width="8" height="8" rx="2.4"/><rect opacity=".72" x="3" y="13" width="8" height="8" rx="2.4"/><rect opacity=".45" x="13" y="13" width="8" height="8" rx="2.4"/>',
  gauge: '<path d="M12 4.2a9.3 9.3 0 0 1 9.3 9.3c0 1.3-.3 2.6-.8 3.8a1.6 1.6 0 0 1-1.5 1H5a1.6 1.6 0 0 1-1.5-1 9.3 9.3 0 0 1 8.5-13.1z"/><path fill="#000" opacity=".3" d="M13.2 14.6a1.9 1.9 0 1 1-2.6-2.6l6.1-4.1z"/>',
  bell: '<path d="M12 3a6 6 0 0 0-6 6v3.6L4.4 15.8a1 1 0 0 0 .9 1.4h13.4a1 1 0 0 0 .9-1.4L18 12.6V9a6 6 0 0 0-6-6z"/><path opacity=".6" d="M9.5 18.6a2.6 2.6 0 0 0 5 0z"/>',
  bolt: '<path d="M13.4 2.5 5 13.2h5.6l-1.1 8.3 8.5-10.8h-5.7z"/>',
  battery: '<rect opacity=".55" x="2.5" y="6.5" width="17" height="11" rx="2.6"/><rect x="20" y="10" width="2" height="4" rx="1"/><rect x="4.5" y="8.5" width="9.5" height="7" rx="1.4"/>',
  heart: '<path d="M12 20.3c-.3 0-.6-.1-.8-.3C6.4 15.8 3 12.8 3 9.1 3 6.6 5 4.6 7.4 4.6c1.8 0 3.4 1 4.6 2.6 1.2-1.6 2.8-2.6 4.6-2.6C19 4.6 21 6.6 21 9.1c0 3.7-3.4 6.7-8.2 10.9-.2.2-.5.3-.8.3z"/><path fill="none" stroke="#000" stroke-opacity=".3" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" d="M6 11.5h3l1.4-2.6 2.3 5.2 1.6-2.6H18"/>',
  mic: '<rect x="8.5" y="2.5" width="7" height="12" rx="3.5"/><path opacity=".6" d="M5.5 10.5a1 1 0 0 1 1 1 5.5 5.5 0 0 0 11 0 1 1 0 0 1 2 0 7.5 7.5 0 0 1-6.5 7.4V21h2.5a1 1 0 0 1 0 2h-7a1 1 0 0 1 0-2H11v-2.1a7.5 7.5 0 0 1-6.5-7.4 1 1 0 0 1 1-1z"/>',
};
// Map line-icon names to their filled versions
const FICON_ALIAS = { virus: 'bug', shield: 'shieldCheck', check: 'shieldCheck', firewall: 'shieldCheck', admin: 'shieldCheck', broom: 'box' };
function ficon(name, cls = '') {
  const key = FICONS[name] ? name : FICON_ALIAS[name];
  if (!key) return icon(name, cls);
  return `<svg class="svg-ico f-ico-svg ${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${FICONS[key]}</svg>`;
}
