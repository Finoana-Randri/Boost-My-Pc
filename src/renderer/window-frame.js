// Linux window without a system frame: title bar buttons and invisible edges to resize the window.
// The rounded shape itself is set by the main process (linux-window.js).
(function () {
  if (!window.pcm?.frameless) return;

  const root = document.documentElement;
  root.classList.add('frameless');
  if (pcm.round) root.classList.add('round');

  const svg = (paths) => `<svg viewBox="0 0 16 16" aria-hidden="true">${paths}</svg>`;
  const ICONS = {
    minimize: svg('<path d="M3.5 8.5h9"/>'),
    maximize: svg('<rect x="3.5" y="3.5" width="9" height="9" rx="2"/>'),
    restore: svg('<rect x="3" y="5.5" width="7.5" height="7.5" rx="2"/><path d="M6 3.5h5.5a2 2 0 0 1 2 2V11"/>'),
    close: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
  };

  function addButtons() {
    const button = (action, label, extraClass = '') =>
      `<button data-wc="${action}" class="${extraClass}" title="${label}" aria-label="${label}">${ICONS[action]}</button>`;
    document.querySelector('.titlebar').insertAdjacentHTML('beforeend', `<div class="wc">
      ${button('minimize', 'Réduire')}${button('maximize', 'Agrandir')}${button('close', 'Fermer', 'wc-close')}</div>`);
    for (const b of document.querySelectorAll('[data-wc]')) b.onclick = () => pcm.win.control(b.dataset.wc);
  }

  function addResizeEdges() {
    const edges = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
    document.body.insertAdjacentHTML('beforeend', edges.map((e) => `<i class="rz rz-${e}" data-rz="${e}" aria-hidden="true"></i>`).join(''));
    for (const handle of document.querySelectorAll('.rz')) {
      handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        // Keeps receiving the release even when the pointer leaves the window.
        handle.setPointerCapture(event.pointerId);
        pcm.win.resize(handle.dataset.rz);
        const end = () => {
          pcm.win.resize(null);
          handle.removeEventListener('pointerup', end);
          handle.removeEventListener('pointercancel', end);
        };
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
      });
    }
  }

  function followWindowState() {
    pcm.win.onState(({ maximized }) => {
      root.classList.toggle('maximized', maximized);
      const button = document.querySelector('[data-wc="maximize"]');
      const label = maximized ? 'Restaurer' : 'Agrandir';
      button.innerHTML = maximized ? ICONS.restore : ICONS.maximize;
      button.title = label;
      button.ariaLabel = label;
    });
  }

  addButtons();
  addResizeEdges();
  followWindowState();
})();
