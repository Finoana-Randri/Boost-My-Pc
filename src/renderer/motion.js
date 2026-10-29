// Springs (damping ratio and response) for motion that follows the user. A new target keeps the
// current value and velocity, so a redirected motion never jumps; frames run only while it moves.
(function () {
  const reduced = () => document.body.classList.contains('lite') || matchMedia('(prefers-reduced-motion: reduce)').matches;

  function spring({ damping = 1, response = 0.4, onUpdate }) {
    const stiffness = (2 * Math.PI / response) ** 2;
    const friction = (4 * Math.PI * damping) / response;
    let value = 0, velocity = 0, target = 0, frame = 0, last = 0;
    function step(now) {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      velocity += (-stiffness * (value - target) - friction * velocity) * dt;
      value += velocity * dt;
      if (Math.abs(velocity) < 0.002 && Math.abs(value - target) < 0.001) {
        value = target;
        velocity = 0;
        frame = 0;
      } else frame = requestAnimationFrame(step);
      onUpdate(value);
    }
    return {
      set(next) {
        target = next;
        if (!frame) {
          last = performance.now();
          frame = requestAnimationFrame(step);
        }
      },
    };
  }

  // Home screens: the lens tilts towards the pointer and the lights behind it drift the other way.
  let hero = null;
  const tilt = { x: 0, y: 0 };
  const write = () => {
    if (!hero?.isConnected) return;
    hero.style.setProperty('--px', tilt.x.toFixed(4));
    hero.style.setProperty('--py', tilt.y.toFixed(4));
  };
  const tiltX = spring({ damping: 0.9, response: 0.7, onUpdate: (v) => { tilt.x = v; write(); } });
  const tiltY = spring({ damping: 0.9, response: 0.7, onUpdate: (v) => { tilt.y = v; write(); } });
  const clamp = (v) => Math.max(-1, Math.min(1, v));

  document.addEventListener('pointermove', (e) => {
    hero = document.querySelector('.ms-hero');
    if (!hero || reduced()) return;
    const r = hero.getBoundingClientRect();
    tiltX.set(clamp((e.clientX - (r.left + r.width / 2)) / 420));
    tiltY.set(clamp((e.clientY - (r.top + r.height / 2)) / 320));
  }, { passive: true });
  const settle = () => { tiltX.set(0); tiltY.set(0); };
  document.addEventListener('pointerleave', settle);
  window.addEventListener('blur', settle);

  // Home screens: the lights inside the lens turn on a 30 fps clock. A CSS animation would be
  // stepped on the main thread at the screen's refresh rate, three times, for a motion this slow.
  // The clock runs only while a home screen is shown.
  const SPEEDS = [24, -17, 13]; // degrees per second, one per light
  let orbitAt = 0, orbiting = false;
  const orbit = (now) => {
    const aura = document.querySelector('.ms-aura');
    if (!aura) { orbiting = false; return; }
    requestAnimationFrame(orbit);
    if (now - orbitAt < 33 || document.body.classList.contains('paused') || reduced()) return;
    orbitAt = now;
    const t = now / 1000;
    aura.querySelectorAll('i').forEach((light, k) => { light.style.transform = `rotate(${(t * SPEEDS[k]) % 360}deg)`; });
  };
  const startOrbit = () => {
    if (orbiting || !document.querySelector('.ms-aura')) return;
    orbiting = true;
    requestAnimationFrame(orbit);
  };

  // Segmented tabs: a thumb slides from the tab that was selected to the new one, also when the
  // page is redrawn in between.
  const lastTab = new Map(); // tab group -> { x, w }
  function slideTabs(root) {
    root.querySelectorAll('.tabs').forEach((bar) => {
      const thumb = document.createElement('span');
      thumb.className = 'tab-thumb';
      bar.prepend(thumb);
      const group = bar.querySelector('.tab[data-go]')?.dataset.go.split('/')[0] || '';
      const place = (animate) => {
        const active = bar.querySelector('.tab.active');
        thumb.classList.toggle('hidden', !active);
        if (!active) return;
        thumb.style.transition = animate ? '' : 'none';
        thumb.style.transform = `translateX(${active.offsetLeft}px)`;
        thumb.style.width = `${active.offsetWidth}px`;
        if (group) lastTab.set(group, { x: active.offsetLeft, w: active.offsetWidth });
      };
      const from = group && lastTab.get(group);
      if (from && !reduced()) {
        thumb.style.transition = 'none';
        thumb.style.transform = `translateX(${from.x}px)`;
        thumb.style.width = `${from.w}px`;
        thumb.getBoundingClientRect();
        place(true);
      } else place(false);
      new MutationObserver(() => place(!reduced())).observe(bar, { subtree: true, attributeFilter: ['class'] });
      new ResizeObserver(() => place(false)).observe(bar);
    });
  }

  window.Motion = { spring, slideTabs, startOrbit };
})();
