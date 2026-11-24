(() => {
  const dialog = document.getElementById('flood-briefing');
  const canvas = document.getElementById('flood-scene');
  const stage = dialog.querySelector('.flood-stage');
  const progressBar = dialog.querySelector('.flood-progress i');
  const enter = dialog.querySelector('.flood-enter');
  const context = canvas.getContext('2d');
  const landing = dialog.hasAttribute('data-landing');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const seenKey = 'hound-cinematic-seen';
  const duration = 10500;
  const still = new Image();
  still.src = new URL('../img/nepal-flood.webp', document.currentScript.src);
  let width = 0;
  let height = 0;
  let frame = 0;
  let started = 0;
  let closing = false;
  let frameTime = 0;
  let memorySeen = false;
  let lastPlate;

  // Trace the riverbanks in the source plate so the terrain stays still while the water moves.
  const banks = [
    [228, 875, 933], [255, 871, 942], [282, 824, 935], [315, 776, 940],
    [350, 804, 980], [390, 868, 1055], [427, 917, 1150], [467, 943, 1214],
    [505, 969, 1305], [544, 997, 1354], [583, 1036, 1436], [620, 1076, 1506],
    [660, 1114, 1560], [700, 1155, 1608], [746, 1146, 1672], [790, 1103, 1672],
    [836, 1105, 1672], [889, 1205, 1672], [941, 1212, 1672]
  ];
  const drops = Array.from({length: 76}, (_, i) => [
    ((i * 73.842) % 101) / 101,
    ((i * 43.137) % 103) / 103,
    .35 + ((i * 5.137) % 13) / 13
  ]);
  const labels = ['Himalayan river valley', 'Flood surge · downstream', 'Search and rescue'];

  function seen() {
    try { return memorySeen || sessionStorage.getItem(seenKey) === '1'; }
    catch (_) { return memorySeen; }
  }

  function markSeen() {
    memorySeen = true;
    try { sessionStorage.setItem(seenKey, '1'); } catch (_) {}
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    const density = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = width * density;
    canvas.height = height * density;
    context.setTransform(density, 0, 0, density, 0, 0);
  }

  function paintWater(x, y, scale, seconds, progress) {
    context.save();
    context.translate(x, y);
    context.scale(scale, scale);
    context.beginPath();
    banks.forEach(([row, left], i) => {
      if (i === 0) context.moveTo(left, row);
      else context.lineTo(left, row);
    });
    [...banks].reverse().forEach(([row, , right]) => context.lineTo(right, row));
    context.closePath();
    context.clip();

    const opacity = context.globalAlpha;
    const surgeFront = 255 + Math.pow(Math.max(0, (progress - .12) / .82), 1.45) * 720;
    for (let row = 229; row < 941; row += 8) {
      const depth = Math.max(0, (row - 230) / 711);
      const surge = Math.max(0, 1 - Math.abs(row - surgeFront) / 104);
      const bend = Math.sin(row * .051 - seconds * 7.4) * (1 + depth * 6 + surge * 5);
      const sway = Math.cos(row * .035 - seconds * 5.2) * depth * 4;
      const sourceY = Math.max(0, row - 5 + sway);
      context.globalAlpha = opacity * (.37 + surge * .25);
      context.drawImage(still, 0, sourceY, 1672, 16, bend, row, 1672, 9);
    }

    const crest = context.createLinearGradient(0, surgeFront - 90, 0, surgeFront + 55);
    crest.addColorStop(0, '#a9896700');
    crest.addColorStop(.48, '#b69b7838');
    crest.addColorStop(.78, '#c8e5dd29');
    crest.addColorStop(1, '#c8e5dd00');
    context.globalAlpha = opacity;
    context.fillStyle = crest;
    context.fillRect(0, surgeFront - 90, 1672, 145);
    context.globalAlpha = opacity * .2;
    context.globalCompositeOperation = 'screen';
    for (let i = 0; i < 62; i++) {
      const depth = ((i * 79 + seconds * (38 + i % 7 * 4)) % 703) / 703;
      const row = 250 + Math.pow(depth, 1.38) * 703;
      let index = 1;
      while (index < banks.length - 1 && banks[index][0] < row) index++;
      const [a, leftA, rightA] = banks[index - 1];
      const [b, leftB, rightB] = banks[index];
      const t = (row - a) / (b - a);
      const left = leftA + (leftB - leftA) * t;
      const right = rightA + (rightB - rightA) * t;
      const center = left + (right - left) * (0.09 + ((i * 43) % 83) / 100);
      const size = 4 + (row - 230) / 711 * (12 + i % 9);
      context.globalAlpha = opacity * (row < surgeFront ? .28 : .12);
      context.strokeStyle = i % 3 ? '#a0bac0' : '#f1ede0';
      context.lineWidth = .7 + size * .045;
      context.beginPath();
      context.moveTo(center - size * .4, row - 2);
      context.quadraticCurveTo(center, row + size * .25, center + size, row + size * .31);
      context.stroke();
    }
    context.restore();
  }

  function draw(progress) {
    if (!width || !height) return;
    context.fillStyle = '#070c10';
    context.fillRect(0, 0, width, height);
    if (!still.naturalWidth) return;

    const seconds = progress * duration / 1000;
    const ease = progress * progress * (3 - 2 * progress);
    const stillWidth = 1672;
    const stillHeight = 941;
    const scale = Math.max(width / stillWidth, height / stillHeight) * (1.025 + ease * .17);
    const x = width / 2 - stillWidth * scale * (.56 + ease * .035);
    const y = height / 2 - stillHeight * scale * (.52 + ease * .019);
    const left = Math.max(width - stillWidth * scale, Math.min(0, x));
    const top = Math.max(height - stillHeight * scale, Math.min(0, y));

    lastPlate = [left, top, stillWidth * scale, stillHeight * scale];
    context.save();
    context.globalAlpha = reduced.matches ? 1 : Math.min(1, progress / .12);
    context.drawImage(still, left, top, stillWidth * scale, stillHeight * scale);
    if (!reduced.matches) paintWater(left, top, scale, seconds, progress);
    context.restore();

    if (reduced.matches) return;
    context.save();
    context.globalCompositeOperation = 'screen';
    for (let i = 0; i < 3; i++) {
      const drift = (seconds * .032 + i * .34) % 1;
      const cx = width * (.08 + drift * .85);
      const cy = height * (.18 + i * .22);
      const fog = context.createRadialGradient(0, 0, 0, 0, 0, 1);
      fog.addColorStop(0, 'rgba(121,151,164,0.13)');
      fog.addColorStop(1, 'rgba(121,151,164,0)');
      context.save();
      context.translate(cx, cy);
      context.scale(width * .25, height * .09);
      context.fillStyle = fog;
      context.fillRect(-1, -1, 2, 2);
      context.restore();
    }
    context.strokeStyle = 'rgba(185,214,226,.14)';
    context.lineWidth = .7;
    context.beginPath();
    for (const [horizontal, vertical, speed] of drops) {
      const y = ((vertical + seconds * speed * .37) % 1) * height;
      const x = ((horizontal + seconds * speed * .037) % 1) * width;
      context.moveTo(x, y);
      context.lineTo(x + 4 * speed, y + 18 * speed);
    }
    context.stroke();
    context.restore();
  }

  function tick(now) {
    const progress = Math.min(1, (now - started) / duration);
    if (now - frameTime > 25 || progress === 1) {
      draw(progress);
      frameTime = now;
    }
    const label = labels[Math.min(2, Math.floor(progress * 3))];
    if (stage.textContent !== label) stage.textContent = label;
    progressBar.style.width = progress * 100 + '%';
    if (progress === 1) handoff();
    else frame = requestAnimationFrame(tick);
  }

  function open() {
    if (dialog.open || !context) return;
    closing = false;
    document.body.classList.add('flood-playing');
    dialog.showModal();
    resize();
    if (reduced.matches) {
      draw(.8);
      progressBar.style.width = '100%';
    } else {
      started = performance.now();
      frameTime = 0;
      frame = requestAnimationFrame(tick);
    }
  }

  function handoff() {
    if (!dialog.open || closing) return;
    closing = true;
    cancelAnimationFrame(frame);
    markSeen();
    if (landing) {
      if (lastPlate) {
        const [x,y,w,h] = lastPlate;
        document.body.style.setProperty('--plate-x', x+'px');
        document.body.style.setProperty('--plate-y', y+'px');
        document.body.style.setProperty('--plate-size', w+'px '+h+'px');
      }
      document.body.classList.add('flood-handoff');
    }
    dialog.classList.add('leaving');
    setTimeout(() => {
      dialog.close();
      dialog.classList.remove('leaving');
      document.body.classList.remove('flood-playing');
      if (!landing) {
        document.querySelector('[data-tab=op]').click();
        reset();
        startSearch();
      }
    }, reduced.matches ? 0 : landing ? 1050 : 550);
  }

  enter.addEventListener('click', handoff);
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    handoff();
  });
  still.addEventListener('load', () => {
    if (dialog.open && reduced.matches) draw(.8);
  });
  addEventListener('resize', () => {
    if (!dialog.open) return;
    resize();
    if (reduced.matches) draw(.8);
  });
  document.querySelector('#show-flood')?.addEventListener('click', open);

  const entry = new URL(location.href);
  if (entry.searchParams.get('briefing') === '1') {
    entry.searchParams.delete('briefing');
    history.replaceState(history.state, '', entry);
    if (!landing && !seen() && ['', '#operation'].includes(location.hash)) open();
  }
  if (landing && !location.hash && !seen()) open();
})();
