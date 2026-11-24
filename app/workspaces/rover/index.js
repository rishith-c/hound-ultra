// Workspace: the rover (chapter 04). Demo is the reveal, Advanced is the instrument.
import * as THREE from 'three';

const css = new URL('./style.css', import.meta.url).href;
if (!document.querySelector('link[href="' + css + '"]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = css; document.head.append(l); }

export default {
  async mount(root, ctx) {
    const { h } = ctx.kit;
    const photo = h('img', { alt: 'The real HOUND rover on a wooden floor: black aluminium frame, four mecanum wheels, a white foam-board mast held with red tape, a webcam, a radar and wiring.', src: new URL('../../../assets/img/landing/rover-real.jpg', import.meta.url).href, draggable: 'false', decoding: 'async' });
    const stage = h('div.rover-stage', { tabIndex: -1 }), wait = h('div.rover-wait', null, h('span.spinner'), 'Loading the rover'), wrap = h('div.rover-root', null, stage, wait);
    root.append(wrap);
    const [{ createStudio }, { buildRover }, { createHero }, { createAdvanced }] = await Promise.all([import('./studio.js'), import('./rover.js'), import('./hero.js'), import('./advanced.js')]);
    let st, R;
    try { st = createStudio(stage); st.resize(); R = await buildRover(); }
    catch (e) { console.warn('rover: 3-D view not available', e); wait.remove(); stage.classList.add('flat'); stage.append(h('div.rover-flat', null, photo, h('div.rover-block', null, ctx.kit.realityTag('built'), h('h1.rover-h', null, 'This one is real.'), h('p.rover-sub', null, 'Built by students. The 3-D view needs WebGL, which this browser did not start.')))); return {}; }
    st.scene.add(R.root);
    const hero = createHero({ ctx, stage, st, R, photo }), adv = createAdvanced({ ctx, wrap, stage, st, R });
    wait.remove();
    const o = new THREE.Vector3(); let raf = 0, last = 0, mode = '';
    function frame(now) {
      raf = requestAnimationFrame(frame); const dt = Math.min(.05, (now - last) / 1000 || 0); last = now;
      if (st.resize()) hero.invalidate(); if (mode !== ctx.mode) { mode = ctx.mode; if (mode === 'demo') { adv.leave(); hero.invalidate(); } else { hero.quiet(); adv.enter(); } }
      if (mode === 'demo') hero.update(dt, now / 1000); else adv.update(dt, now / 1000);
      for (let i = 0; i < 4; i++) { R.wheels[i].spin.getWorldPosition(o); st.floorU.uWheel.value[i].set(o.x, o.z, Math.max(0, o.y - .04), 0); }
      R.parts.get('deck')[0].getWorldPosition(o); st.floorU.uBody.value.set(o.x, o.z, Math.max(0, o.y - .1), 0);
      st.render(); st.adapt(dt); if (!stage.classList.contains('ready')) stage.classList.add('ready');
    }
    const start = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }, stop = () => { cancelAnimationFrame(raf); raf = 0; };
    start();
    window.ROVER = { hero, adv, st, R, THREE };
    return { onShow() { hero.show(true); adv.show(true); hero.replayIfDone?.(); start(); }, onHide() { hero.show(false); adv.show(false); stop(); } };
  },
};
