(() => {
  const toggle = document.getElementById('terrain-toggle');
  const distance = 1000;
  const pitch = 36 * Math.PI / 180;
  const zoom = 1.32;
  let drag;

  // Unproject viewport coordinates onto the map plane under its CSS perspective.
  function planePoint(x, y) {
    const bounds = mapEl.getBoundingClientRect();
    const centerX = bounds.width / 2;
    const centerY = bounds.height / 2;
    const screenX = x - bounds.left - centerX;
    const screenY = y - bounds.top - centerY;
    const planeY = screenY / (zoom * (Math.cos(pitch) + screenY * Math.sin(pitch) / distance));
    const planeX = screenX * (1 - zoom * planeY * Math.sin(pitch) / distance) / zoom;
    return [centerX + planeX, centerY + planeY];
  }

  function inRelief() {
    return mapEl.classList.contains('relief-view');
  }

  toggle.addEventListener('click', () => {
    const relief = mapEl.classList.toggle('relief-view');
    toggle.setAttribute('aria-pressed', String(relief));
  });

  mapEl.addEventListener('wheel', event => {
    if (!inRelief() || event.target.closest('.ui')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    zoomAt(Math.exp(-event.deltaY * .0015), ...planePoint(event.clientX, event.clientY));
  }, { capture: true, passive: false });

  mapEl.addEventListener('pointerdown', event => {
    if (!inRelief() || event.target.closest('.ui') || event.button !== 0 || !event.isPrimary) return;
    event.stopImmediatePropagation();
    const [x, y] = planePoint(event.clientX, event.clientY);
    drag = { id: event.pointerId, x, y, tx: view.tx, ty: view.ty };
    mapEl.setPointerCapture(event.pointerId);
    mapEl.classList.add('drag');
  }, true);

  mapEl.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    const [x, y] = planePoint(event.clientX, event.clientY);
    view.tx = drag.tx + x - drag.x;
    view.ty = drag.ty + y - drag.y;
    applyView();
  });

  function release(event) {
    if (drag?.id !== event.pointerId) return;
    drag = null;
    mapEl.classList.remove('drag');
  }
  mapEl.addEventListener('pointerup', release);
  mapEl.addEventListener('pointercancel', release);
  mapEl.addEventListener('lostpointercapture', release);

  // Shade the scenario's elevation field at a finer resolution than its contour grid.
  const surface = document.createElement('canvas');
  surface.width = 510;
  surface.height = 480;
  const paint = surface.getContext('2d');
  if (paint) {
    const texture = paint.createImageData(surface.width, surface.height);
    const sample = (x, y) => {
      x = Math.max(0, Math.min(W - 1.001, x));
      y = Math.max(0, Math.min(H - 1.001, y));
      const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j;
      const a = el[j * W + i], b = el[j * W + i + 1];
      const c = el[(j + 1) * W + i], d = el[(j + 1) * W + i + 1];
      return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
    };
    for (let y = 0; y < surface.height; y++) {
      for (let x = 0; x < surface.width; x++) {
        const u = x / 6, v = y / 6;
        const slope = sample(u + .55, v - .55) - sample(u - .55, v + .55);
        const fine = (hash(x, y) - .5) * .13;
        const edge = Math.min(1, x / 32, y / 32, (surface.width - x - 1) / 32, (surface.height - y - 1) / 32);
        const i = 4 * (y * surface.width + x);
        const lit = slope + fine > 0;
        texture.data.set(lit ? [137, 178, 203] : [4, 13, 24], i);
        texture.data[i + 3] = Math.min(118, Math.abs(slope + fine) * 200) * edge;
      }
    }
    paint.putImageData(texture, 0, 0);
    ov.insert('image', '.L-elev').attr('class', 'terrain-hillshade L-elev')
      .attr('href', surface.toDataURL()).attr('width', W * SC).attr('height', H * SC);
  }

  const damageLayer = ov.insert('g', '.L-dmg').attr('class', 'terrain-extrusions');
  for (const [i, footprint] of DMG.entries()) {
    const roof = footprint.map(([x, y]) => [x + 5, y - (18 + i * 3)]);
    for (const [index, point] of footprint.entries()) {
      const next = (index + 1) % footprint.length;
      damageLayer.append('polygon').attr('points', [point, footprint[next], roof[next], roof[index]].join(' '))
        .attr('class', 'L-dmg terrain-wall').attr('fill', index % 2 ? '#693e2d' : '#262b32');
    }
    damageLayer.append('polygon').attr('points', roof.join(' '))
      .attr('class', 'L-dmg terrain-roof').attr('fill', '#967257');
  }
})();
