// Refraction for glass surfaces: an SVG displacement filter shaped like their rounded box pulls
// the backdrop inwards near the edges, like the rim of a lens. CSS applies it through --lg-refract.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const SURFACES = '[data-refract], .sidebar, .action-bar, .tabs, .toast, .modal-box, .sc-tile, .sc-btn, .ov-card, .hx-card, .btn:not(.ghost), .btn-main, .back, .sc-link';
  const defs = document.createElementNS(NS, 'svg');
  defs.setAttribute('aria-hidden', 'true');
  defs.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  document.body.appendChild(defs);

  const filters = new Map(); // "width x height x radius" -> filter id

  // Red and green carry the horizontal and vertical shift (128 = none).
  function displacementMap(width, height, radius) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(width, height);
    const band = Math.min(Math.min(width, height) * 0.3, 26);
    const halfW = width / 2 - radius, halfH = height / 2 - radius;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const px = x + 0.5 - width / 2, py = y + 0.5 - height / 2;
        const qx = Math.abs(px) - halfW, qy = Math.abs(py) - halfH;
        const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
        const depth = radius - outside - Math.min(Math.max(qx, qy), 0);
        let dx = 0, dy = 0;
        if (depth > 0 && depth < band) {
          const strength = (1 - depth / band) ** 2;
          if (qx > 0 && qy > 0) {
            dx = (qx / outside) * Math.sign(px);
            dy = (qy / outside) * Math.sign(py);
          } else if (qx > qy) dx = Math.sign(px);
          else dy = Math.sign(py);
          dx *= -strength;
          dy *= -strength;
        }
        const i = (y * width + x) * 4;
        image.data[i] = 128 + dx * 127;
        image.data[i + 1] = 128 + dy * 127;
        image.data[i + 2] = 128;
        image.data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL();
  }

  function filterFor(width, height, radius) {
    const key = `${width}x${height}x${radius}`;
    if (filters.has(key)) return filters.get(key);
    const id = `lg-${filters.size}`;
    const scale = Math.min(width, height) > 200 ? 36 : Math.min(64, Math.min(width, height) * 0.4);
    defs.insertAdjacentHTML('beforeend', `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feImage href="${displacementMap(width, height, radius)}" x="0" y="0" width="${width}" height="${height}" result="map"/>
      <feDisplacementMap in="SourceGraphic" in2="map" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/></filter>`);
    filters.set(key, id);
    return id;
  }

  function refract(el) {
    const width = Math.round(el.offsetWidth), height = Math.round(el.offsetHeight);
    if (!width || !height) return;
    const radius = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, width / 2, height / 2);
    el.style.setProperty('--lg-refract', `url(#${filterFor(width, height, Math.round(radius))})`);
  }

  const sizes = new ResizeObserver((entries) => entries.forEach((e) => refract(e.target)));
  const each = (node, fn) => {
    if (node.nodeType !== 1) return;
    if (node.matches(SURFACES)) fn(node);
    node.querySelectorAll(SURFACES).forEach(fn);
  };
  new MutationObserver((changes) => changes.forEach((c) => {
    c.removedNodes.forEach((n) => each(n, (el) => sizes.unobserve(el)));
    c.addedNodes.forEach((n) => each(n, (el) => sizes.observe(el)));
  })).observe(document.body, { childList: true, subtree: true });
  each(document.body, (el) => sizes.observe(el));
})();
