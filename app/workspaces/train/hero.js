// Training, Demo mode: one decision at a time, from where the operator stands. A private run of the real mission engine is
// played to the moment, the question is asked, and the answer is carried out in the 3-D site. No answer: autoplay answers.
import { createStage, newEngine, advance, ease, ensureCss } from '../triage/stage.js';
import * as M from '../triage/model.js';

const ASK_S = 11, HOLD_S = 8, PACE = 7, ALL = { slope: true, mud: true, gas: true, collapse: true };
const pct = (p) => Math.round(p * 100) + ' %';

export function createHero(root, ctx, { onDrill }) {
  ensureCss(ctx);
  const { h, realityTag, icon } = ctx.kit, reduced = () => ctx.kit.reducedMotion();
  const scene3d = h('div.th-scene'), tags = h('div.th-tags', { 'aria-hidden': 'true' }), head = h('h1', { 'aria-live': 'polite' }, 'You decide.'), line = h('p.th-line', null, 'Playing the search to its first decision.');
  const btn = (i) => h('button.th-choice', { onclick: () => answer(i, true) }, h('span.th-choice-t'), h('i'));
  const choices = [btn(0), btn(1)], choiceBox = h('div.th-choices', { hidden: true }, ...choices), drillBtn = h('button.btn.btn-primary', { onclick: () => onDrill() }, icon('play', 14), h('span', null, 'Start the full drill'));
  const dots = h('div.th-steps', { role: 'group', 'aria-label': 'Decisions' }, ...['The lead', 'The route'].map((t, i) => h('button', { 'aria-pressed': String(i === 0), onclick: () => goto(i) }, t)));
  const el = h('section.th.demo-only', { 'aria-label': 'Training: one decision' }, scene3d, h('div.th-shade'), tags,
    h('div.th-low', null, h('div.th-title', null, h('div.row', null, realityTag('live-algo'), realityTag('sim')), head, line), h('div.grow'), choiceBox),
    h('div.th-foot', null, dots, h('div.grow'), drillBtn));
  root.append(el);
  const tag = h('div.th-tag', null, h('b.th-rank.th-pct'), h('div', null, h('span.th-where'), h('span.th-sub'))); tags.append(tag);
  const tP = tag.querySelector('.th-pct'), tW = tag.querySelector('.th-where'), tS = tag.querySelector('.th-sub');

  let stage = null, loading = false, on = false, spare = null, spareAt = null, moment = -1, mode = 'load', clock = 0, acc = 0, lead = null, ribbon = null, old = null, chosen = 0, shownP = 0, frame = 0, back = 1.6, busy = 0, glass = 0;
  const px = { x: 0, y: 0, on: true }, pt = { x: 0, z: 0 }, v = { v: null };
  const set = (n, t) => { if (n.textContent !== t) n.textContent = t; };
  let wordsT = 0; function words(a, b) { clearTimeout(wordsT); head.classList.add('swap'); line.classList.add('swap'); wordsT = setTimeout(() => { head.textContent = a; line.textContent = b; head.classList.remove('swap'); line.classList.remove('swap'); }, reduced() ? 0 : 220); }
  function ask(a, b) { choices[0].firstChild.textContent = a; choices[1].firstChild.textContent = b; choices.forEach((c) => { c.disabled = false; c.dataset.picked = ''; }); choiceBox.hidden = false; mode = 'ask'; clock = 0; }
  const open = (S) => S.phase === 'assess' && S.units['HOUND-01'].mode === 'idle' && !S.queue.length && !S.sensors.listen;

  // Two engines are kept ready: one at the first decision, one at the second.
  async function makeLead() { const e = newEngine(ctx, null, false); await advance(e, open); return e; }
  async function makeRoute() { // the same search with every lead followed up, then planned with the slope rule left off
    const e = newEngine(ctx, null, false); await advance(e, open);
    for (let i = 0; i < 6; i++) { const d = e.state.detections.find((x) => x.status === 'possible' && !x.needsTeam); if (!d) break; e.command('investigate', { id: d.id }); e.step(); await advance(e, (S) => open(S) || S.phase !== 'assess'); }
    if (e.state.phase === 'assess') { e.command('finishAssess'); await advance(e, (S) => S.phase === 'plan'); }
    e.command('planRoute', { avoid: { ...ALL, slope: false } }); return e;
  }
  async function load() {
    if (loading || stage) return; loading = true;
    try {
      const e = await makeLead(); stage = await createStage(scene3d, ctx, e, { light: 'night' }); if (!stage.ok) return;
      v.v = new stage.THREE.Vector3(); stage.twin.setLayer('route', false); stage.rig.rate = 1; stage.frames.push(tick);
      spareAt = makeRoute(); begin(0, e); stage.rig.snap = true; stage.start(); if (!on) stage.stop();
    } catch (err) { console.warn('[train] the 3-D view could not start:', err); words('The 3-D view could not start', 'The full drill still works.'); }
    finally { loading = false; }
  }
  async function goto(i) {
    if (!stage?.ok || busy) return; busy = 1; mode = 'load'; choiceBox.hidden = true;
    words(i ? 'The route is ready.' : 'The search so far.', 'Playing to the decision.');
    let e; try { e = i ? await (spareAt || makeRoute()) : await (spare || makeLead()); } finally { busy = 0; } if (i) spareAt = null; else spare = null;
    busy = 0; begin(i, e);
  }
  function begin(i, e) {
    moment = i; [...dots.children].forEach((b, k) => b.setAttribute('aria-pressed', String(k === i)));
    for (const r of [ribbon, old]) r?.dispose(); ribbon = old = null; clock = 0; acc = 0;
    if (e !== stage.engine) stage.use(e, 'seek');
    const S = e.state; stage.twin.setLayer('hazards', i === 1);
    if (i === 0) {
      lead = S.detections.find((d) => d.status === 'possible' && d.room) || S.detections.find((d) => d.status === 'possible'); shownP = lead.p; placeBack();
      words(pct(lead.p) + ' in room ' + lead.room + '.', 'Send someone, or look again?'); ask('Send someone', 'Look again');
      tW.textContent = 'Room ' + lead.room; tS.textContent = 'possible person';
    } else {
      lead = null; const r = draw(S); words('The plan spends ' + r.slope.toFixed(0) + ' m on the unstable slope.', 'Approve it, or send it back?'); ask('Approve', 'Send it back');
    }
    if (reduced()) clock = -1e9;
  }
  function draw(S) {
    const path = []; for (const l of S.routes.rescue.legs) if (l.ok) path.push(...(path.length ? l.path.slice(1) : l.path));
    const hz = M.allHazards(S), ex = M.exposureAlong(path, hz), slope = ex.by.filter((b) => /slope/i.test(b.hz.name + b.hz.id + (b.hz.kind || ''))).reduce((a, b) => a + b.m, 0);
    old?.dispose(); old = ribbon; ribbon = stage.ribbon(path, '--accent', { width: 0.34, hot: (p) => hz.some((z) => M.inside(p, z.poly)) }); ribbon.to(0); ribbon.info = { total: ex.total, slope, length: S.routes.rescue.length };
    // the worst stretch is what the camera looks at
    let best = null; for (const s of ex.spans) if (!best || s.to - s.from > best.to - best.from) best = s; const sp = ex.spans.filter((s) => /slope/i.test(s.hz.name + s.hz.id)).sort((a, b) => b.to - b.from - (a.to - a.from))[0]; ribbon.mid = ((sp || best)?.from + (sp || best)?.to) / 2 || ribbon.length * 0.7;
    return ribbon.info;
  }
  function answer(i, human) {
    if (mode !== 'ask') return; chosen = i; choices.forEach((c, k) => { c.disabled = true; c.dataset.picked = k === i ? 'yes' : 'no'; });
    clock = 0; acc = 0; const who = human ? '' : 'Autoplay chose. '; const e = stage.engine, S = e.state;
    if (moment === 0 && i === 1) { e.command('investigate', { id: lead.id }); mode = 'look'; words('Looking again.', who + 'The rover moves to a better position and listens.'); }
    else if (moment === 0) {
      const r = e.plan(S.units['TEAM-1'].pos, lead.pos, { nearest: true }); if (r.ok) { ribbon = stage.ribbon(r.path, '--accent', { width: 0.3 }); ribbon.to(0); }
      mode = 'send'; words('A team walks ' + (r.ok ? r.length.toFixed(0) : '?') + ' m on a ' + pct(lead.p) + ' lead.', who + 'At ' + pct(lead.p) + ', ' + Math.round((1 - lead.p) * 100) + ' rooms in 100 like this are empty.');
    } else if (i === 1) { e.command('rejectRoute'); e.command('planRoute', { avoid: { ...ALL } }); const was = ribbon.info, r = draw(S); mode = 'back'; words('Slope: ' + was.slope.toFixed(0) + ' m down to ' + r.slope.toFixed(0) + ' m.', who + (r.length - was.length > 0.5 ? (r.length - was.length).toFixed(0) + ' m longer. ' : 'Hardly longer. ') + 'The rule was off; now it is on.'); }
    else { e.command('approveRoute'); mode = 'ride'; words(ribbon.info.slope.toFixed(0) + ' m on ground that can move.', who + 'The planner obeyed its rules. One rule was switched off.'); }
  }
  const NAMES = { csi: 'Wi-Fi network', radar: 'radar', micro: 'presence radar', thermal: 'thermal camera', aerial: 'drone', human: 'team' };
  function agree(d) { // the last reading of each sensor, in words
    const last = {}; for (const e of d.evidence) if (NAMES[e.sensor]) last[e.sensor] = e.result;
    const yes = Object.keys(last).filter((k) => last[k] === 'pos').map((k) => NAMES[k]), say = yes.length > 1 ? 'The ' + yes.slice(0, -1).join(', ') + ' and ' + yes[yes.length - 1] + ' agree.' : 'The ' + (yes[0] || 'sensors') + ' decided it.';
    return say + (last.csi === 'neg' ? ' Wi-Fi alone missed them.' : '');
  }
  const hold = () => { mode = 'hold'; clock = 0; };
  function placeBack() { // how far behind the rover the viewer can stand without a wall between
    const S = stage.engine.state, r = S.units['HOUND-01'].pos, d = Math.hypot(r[0] - lead.pos[0], r[1] - lead.pos[1]) || 1, ux = (r[0] - lead.pos[0]) / d, uy = (r[1] - lead.pos[1]) / d; back = 0.3;
    for (let s = 0.4; s <= 3; s += 0.2) { if (ctx.world.wallsCrossed(r, [r[0] + ux * s, r[1] + uy * s]).length) break; back = s; }
    back = Math.max(0.5, back - 0.35);
  }

  function tick(dt, time) {
    const R = stage.rig, g = R.goal, S = stage.engine.state; clock += dt; frame++;
    R.drift = reduced() ? 0 : Math.sin(time * 0.31) * 0.02 + Math.sin(time * 0.83) * 0.006;
    if (mode === 'ask') { const k = Math.max(0, Math.min(1, clock / ASK_S)); choices[1].lastChild.style.transform = 'scaleX(' + k.toFixed(4) + ')'; if (clock > ASK_S) answer(1, false); }
    else if (mode === 'look') { acc += Math.min(dt, 0.05) * PACE; while (acc >= 0.1 && lead.status === 'possible' && !stage.engine.done) { stage.engine.step(); acc -= 0.1; } if (frame % 12 === 0) placeBack();
      if (lead.status !== 'possible') { const c = lead.status === 'confirmed'; words(c ? pct(lead.p) + '. A person.' : 'Ruled out, ' + pct(lead.p) + '.', c ? agree(lead) : lead.reason || ''); tS.textContent = c ? 'person, confirmed by sensors' : 'ruled out'; hold(); } }
    else if (mode === 'send') { ribbon?.to(ribbon.length * ease(clock / 6)); if (clock > 7) hold(); }
    else if (mode === 'back') { old?.alpha(0.5 * (1 - ease(clock / 1.6))); ribbon.to(ribbon.length * ease((clock - 0.6) / 4)); if (clock > 5.4) hold(); }
    else if (mode === 'ride') { if (clock > 5) hold(); }
    else if (mode === 'hold' && clock > HOLD_S && !busy) goto(moment === 0 ? 1 : 0);
    if (mode === 'hold' && clock > 1.5 && moment === 0 && !spareAt) spareAt = makeRoute();
    if (mode === 'hold' && clock > 1.5 && moment === 1 && !spare) spare = makeLead();

    R.glass.r += (glass - R.glass.r) * (reduced() ? 1 : 1 - Math.exp(-dt * 2.2));
    if (moment === 0 && lead) {
      shownP += (lead.p - shownP) * (reduced() ? 1 : 1 - Math.exp(-dt * 3)); set(tP, pct(shownP));
      const L = lead.pos;
      if (mode === 'send' && ribbon) { const k = ease(clock / 6); ribbon.at(ribbon.length * k, pt); g.x = pt.x; g.y = 1; g.z = pt.z; g.yaw = -0.35; g.pitch = 0.52; g.dist = 20 - 6 * k; g.fov = 38; R.rate = 1.7; R.dof = 0; glass = 5 * k; }
      else if (mode === 'hold' && lead.status !== 'possible') { g.x = L[0]; g.y = 0.7; g.z = -L[1]; g.dist = 6.2; g.pitch = 0.34; g.fov = 40; R.rate = 0.9; R.dof = 0.5; }
      else if (mode !== 'hold') {
        const r = S.units['HOUND-01'].pos, dx = r[0] - L[0], dy = r[1] - L[1], d = Math.hypot(dx, dy) || 1; g.x = L[0]; g.y = 0.75; g.z = -L[1]; g.yaw = Math.atan2(dx, -dy); g.dist = Math.min(d + back, 6.6) - (mode === 'ask' ? 0.7 * ease(clock / ASK_S) : 0); g.pitch = 0.17; g.fov = 48; R.rate = mode === 'look' ? 1.1 : 1.2; R.dof = 0.3; glass = 6.2;
      }
      R.glass.x = L[0]; R.glass.z = -L[1];
      v.v.set(L[0], mode === 'hold' && lead.status === 'confirmed' ? 1.35 : 1.95, -L[1]); stage.project(v.v, px); tag.style.transform = 'translate3d(' + px.x.toFixed(1) + 'px,' + px.y.toFixed(1) + 'px,0) translate(26px,-80%)'; tag.style.opacity = px.on && mode !== 'load' ? '1' : '0';
    } else {
      tag.style.opacity = '0'; glass = 0; R.dof = 0;
      if (ribbon) { if (mode === 'ask') ribbon.to(ribbon.length * ease(clock / 5)); ribbon.at(ribbon.mid, pt); const near = mode === 'ride' || (mode === 'hold' && chosen === 0); const k = mode === 'ask' ? ease(clock / ASK_S) : 1; g.x = pt.x - (near ? 0 : 8); g.y = 1; g.z = pt.z + (near ? 0 : 5); g.yaw = 0.55 + (near ? 0.35 : 0) + time * 0.006 % 1 * 0.2; g.pitch = near ? 0.3 : 0.5; g.dist = near ? 20 : 46 - 8 * k; g.fov = 38; R.rate = 0.8; }
    }
  }
  return {
    show() { on = true; if (stage?.ok) stage.start(); else if (!stage) load(); }, hide() { on = false; stage?.ok && stage.stop(); },
    get stage() { return stage; }, answer, goto, get mode() { return mode; },
  };
}
