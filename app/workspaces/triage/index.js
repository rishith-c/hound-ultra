// Triage: who to reach first, and how to get to them. A planning aid, not a medical tool.
// Everything shown is computed from what the console's sensors found (sim.state) and the live route planner.
import { createPlan } from './plan.js';
import * as M from './model.js';
import world from '../../core/world.js';

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs, ...kids) {
  const el = document.createElementNS(NS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: carry on without saving */ } },
};
const mins = (m) => (m < 1 ? Math.round(m * 60) + ' s' : m < 10 ? m.toFixed(1) + ' min' : Math.round(m) + ' min');
const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };

export default {
  async mount(root, ctx) {
    const { h, icon, realityTag, fmt, reducedMotion } = ctx.kit, sim = ctx.sim, bus = ctx.bus;
    if (!document.getElementById('triage-css')) document.head.append(h('link', { id: 'triage-css', rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href }));
    root.classList.add('triage');

    // ---------- state ----------
    let weights = { ...M.DEFAULT_WEIGHTS, ...store.get('hound.triage.weights', {}) };
    let manual = null, selected = ctx.params?.select || null, nTeams = 1, view = 'building', visible = false, dragging = null;
    let holdAtPlan = false, heldAutoplay = false, lastSend = null, model = null, lastCompute = 0;
    const altPick = new Map(); // detection id -> index of the approach side the operator chose

    // ---------- skeleton ----------
    const live = h('div.sr-only', { 'aria-live': 'polite' });
    const sendBtn = h('button.btn.btn-primary.btn-lg', { onclick: send }, icon('route'), h('span', null, 'Send order to route planner'));
    const sendNote = h('p.triage-sendnote');
    const holdBox = h('label.check.triage-hold', { title: 'When the search ends, the mission waits for you instead of planning by itself.' },
      h('input', { type: 'checkbox', onchange: (e) => setHold(e.target.checked) }), h('span', null, 'Hold the mission at planning for my order'));
    const head = h('header.ws-head.triage-head', null,
      h('div.triage-headline', null,
        h('div.row', null, h('h1', null, 'Triage'), realityTag('live-algo'), h('span.triage-aid', { role: 'note' }, icon('info', 14), 'Planning aid. Not a medical assessment.')),
        h('p', null, 'Who to reach first and how to get to them, from what the sensors found. The score is a transparent sum you can change; the order is yours to overrule.')),
      h('div.triage-send', null, h('div.triage-sendtext', null, sendNote, holdBox), sendBtn));

    const boardList = h('ol.triage-list', { 'aria-label': 'People and open leads, in priority order' });
    const boardState = h('span.triage-orderstate');
    const resetOrder = h('button.btn.btn-sm.btn-ghost', { onclick: () => { manual = null; announce('Order returned to the model.'); refresh(true); } }, icon('reset', 14), 'Model order');
    const reachedList = h('div.triage-reached');
    const board = h('section.triage-board', { 'aria-label': 'Priority board' },
      h('div.triage-boardhead', null, h('h3', null, 'Priority order'), boardState, resetOrder),
      h('div.triage-scroll', null, boardList, reachedList));

    const canvas = h('canvas.triage-canvas', { role: 'img', 'aria-label': 'Plan of the site with each person, the route to them in the order on the board, hazards and walls' });
    const mapNote = h('span.triage-mapnote');
    const viewSeg = h('div.seg', { role: 'group', 'aria-label': 'Map view' }, ...[['building', 'Building'], ['site', 'Whole site']].map(([id, label]) => h('button', { 'aria-pressed': String(id === view), onclick: (e) => { view = id; [...viewSeg.children].forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); plan.setView(id); } }, label)));
    const legend = h('div.triage-legend', null,
      h('span', null, h('i.lg-person'), 'Person found'), h('span', null, h('i.lg-possible'), 'Possible'), h('span', null, h('i.lg-route'), 'Route in board order'),
      h('span', null, h('i.lg-exp'), 'Route inside a hazard'), h('span', null, h('i.lg-haz'), 'Hazard'), h('span', null, h('i.lg-sigma'), 'Where they may be (2σ)'));
    const access = h('section.triage-access', { 'aria-label': 'Access planner' });
    const centre = h('section.triage-centre', null,
      h('div.triage-map', null, canvas, h('div.triage-maptop', null, viewSeg, mapNote, h('div.grow'), realityTag('sim')), legend),
      access);

    const modelPanel = h('section.triage-panel', { 'aria-label': 'Priority model' });
    const teamPanel = h('section.triage-panel', { 'aria-label': 'Resource sketch' });
    const side = h('aside.triage-side', null, modelPanel, teamPanel);
    root.append(head, h('div.triage-body', null, board, centre, side), live);

    const plan = createPlan(canvas, { scene, onPick: (id) => { if (id) pick(id); }, view });

    // ---------- the priority model panel (built once; sliders keep focus while the board reorders) ----------
    const sliders = {};
    function buildModelPanel() {
      const formula = h('div.triage-formula', { 'aria-label': 'Priority equals one hundred times the weighted sum of five terms, divided by the sum of the weights' },
        h('span.f-lhs', null, 'priority'), h('span.f-op', null, '= 100 ×'),
        h('span.f-frac', null,
          h('span.f-num', null, ...M.TERMS.flatMap((t, i) => [i ? h('span.f-op', null, '+') : null, h('span.f-term', { 'data-k': t.key }, h('i', null, 'w'), h('sub', null, t.letter), '·', t.short.toLowerCase())])),
          h('span.f-den', null, 'w', h('sub', null, 'C'), ' + w', h('sub', null, 'L'), ' + w', h('sub', null, 'T'), ' + w', h('sub', null, 'A'), ' + w', h('sub', null, 'H'))));
      const rows = M.TERMS.map((t) => {
        const input = h('input.slider.triage-range', { type: 'range', min: 0, max: 5, step: 0.5, value: weights[t.key], 'aria-label': 'Weight of ' + t.label.toLowerCase(),
          oninput: (e) => { weights[t.key] = +e.target.value; store.set('hound.triage.weights', weights); syncSliders(); refresh(true); } });
        const val = h('span.num.triage-wval'), share = h('span.num.triage-wshare');
        sliders[t.key] = { input, val, share };
        return h('div.triage-wrow', { 'data-k': t.key },
          h('div.triage-wname', null, h('span.triage-chip', { 'data-k': t.key }, t.letter), h('b', null, t.label), t.assumed ? h('span.triage-assumed', { title: 'The shape of this term is a design assumption, not a measurement.' }, 'assumed') : null, h('div.grow'), val, share),
          input, h('p.triage-wdef', null, t.def));
      });
      const presets = h('div.seg.triage-presets', { role: 'group', 'aria-label': 'Weight presets' }, ...M.PRESETS.map((p) => h('button', { 'data-id': p.id, onclick: () => { weights = { ...p.w }; store.set('hound.triage.weights', weights); syncSliders(); announce('Weights set to ' + p.label + '.'); refresh(true); } }, p.label)));
      modelPanel.append(
        h('div.triage-phead', null, h('h3', null, 'Priority model'), realityTag('live-algo')),
        h('p.triage-lede', null, 'Each person gets five numbers between 0 and 1. Your weights decide how much each one counts. Move a slider and the board reorders at once.'),
        formula, presets, ...rows);
      syncSliders();
    }
    function syncSliders() {
      const sum = M.TERMS.reduce((a, t) => a + weights[t.key], 0);
      for (const t of M.TERMS) { const r = sliders[t.key]; if (+r.input.value !== weights[t.key]) r.input.value = weights[t.key]; r.input.style.setProperty('--p', (weights[t.key] / 5) * 100 + '%'); setText(r.val, weights[t.key].toFixed(1)); setText(r.share, sum ? Math.round((weights[t.key] / sum) * 100) + ' %' : '0 %'); }
      for (const b of modelPanel.querySelectorAll('.triage-presets button')) { const p = M.PRESETS.find((x) => x.id === b.dataset.id); b.setAttribute('aria-pressed', String(M.TERMS.every((t) => p.w[t.key] === weights[t.key]))); }
    }
    buildModelPanel();

    // ---------- compute ----------
    function compute() {
      const S = sim.state, from = S.units['TEAM-1'].pos;
      const all = S.detections.filter((d) => d.status === 'confirmed' || d.status === 'possible').map((d) => M.describeTarget(sim, d, from));
      for (const t of all) t.score = M.scoreTarget(t, weights);
      const open = all.filter((t) => !t.reached), reached = all.filter((t) => t.reached).sort((a, b) => (a.reachedAt ?? 0) - (b.reachedAt ?? 0));
      const byModel = [...open].sort((a, b) => b.score.total - a.score.total || a.det.t - b.det.t);
      byModel.forEach((t, i) => { t.modelRank = i + 1; });
      let order = byModel;
      if (manual) { const kept = manual.map((id) => open.find((t) => t.id === id)).filter(Boolean); order = kept.concat(byModel.filter((t) => !manual.includes(t.id))); }
      order.forEach((t, i) => { t.rank = i + 1; t.moved = !!manual && t.rank !== t.modelRank; });
      const overridden = !!manual && order.some((t) => t.moved);
      // the tour in board order, the way the route planner will chain it
      let cur = from; const tour = [];
      for (const t of order) { if (!t.ok) continue; const res = M.planCached(sim, cur, t.det.pos, true); if (!res.ok) continue; tour.push({ id: t.id, path: res.path, length: res.length, exposure: M.exposureAlong(res.path, M.allHazards(S)) }); cur = res.path[res.path.length - 1]; }
      if (!selected || !all.some((t) => t.id === selected)) selected = order[0]?.id || reached[0]?.id || null;
      const sel = all.find((t) => t.id === selected) || null;
      let alts = null, alt = null;
      if (sel && !sel.reached && sel.kind === 'break through') {
        alts = M.approachSides(sim, sel.det, from); const usable = alts.filter((a) => a.usable), i = altPick.get(sel.id);
        if (usable[0]) usable[0].best = true;
        const planners = usable.find((a) => a.wall.id === sel.wall?.id); if (planners) planners.planners = true;
        alt = (i != null && alts[i]?.usable ? alts[i] : planners || usable[0]) || null;
      }
      model = { S, from, all, open, reached, order, byModel, overridden, tour, sel, alts, alt };
      return model;
    }

    // ---------- the board ----------
    const cards = new Map();
    function makeCard(id) {
      const r = {};
      r.grip = h('button.triage-grip', { 'aria-label': 'Move in the order. Drag, or press the up and down arrow keys.', onpointerdown: (e) => startDrag(e, id), onkeydown: (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); move(id, e.key === 'ArrowUp' ? -1 : 1); } } },
        s('svg', { viewBox: '0 0 10 16', width: 10, height: 16, 'aria-hidden': 'true' }, ...[3, 8, 13].flatMap((y) => [s('circle', { cx: 2.5, cy: y, r: 1.2 }), s('circle', { cx: 7.5, cy: y, r: 1.2 })])));
      r.rank = h('div.triage-rank.num');
      r.where = h('b.triage-where'); r.tags = h('span.triage-tags');
      r.sure = h('dd.num'); r.motion = h('dd'); r.wait = h('dd.num');
      r.haz = h('p.triage-haz');
      r.bar = h('div.triage-bar', { role: 'img' }, ...M.TERMS.map((t) => h('i', { 'data-k': t.key }, h('span', null, t.letter))));
      r.score = h('b.num'); r.detail = h('div.triage-detail');
      const el = h('li.triage-card', { 'data-id': id, tabindex: 0, onclick: (e) => { if (!e.target.closest('.triage-grip')) pick(id); }, onkeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); pick(id); } } },
        r.grip, r.rank,
        h('div.triage-main', null,
          h('div.triage-title', null, r.where, r.tags),
          h('dl.triage-facts', null, h('div', null, h('dt', null, 'How sure'), r.sure), h('div', null, h('dt', null, 'Movement'), r.motion), h('div', null, h('dt', null, 'Waiting'), r.wait)),
          h('p.triage-way', null, r.wayIcon = h('span.triage-wayicon'), r.accessV = h('span')),
          r.haz),
        h('div.triage-score', null, r.score, h('span', null, 'of 100')),
        r.bar, r.detail);
      el._r = r; return el;
    }
    function patchCard(el, t) {
      const r = el._r, person = t.status === 'confirmed';
      el.dataset.status = person ? 'person' : 'possible'; el.setAttribute('aria-selected', String(t.id === selected));
      el.setAttribute('aria-label', (person ? 'Person found, ' : 'Possible person, ') + t.where + ', priority ' + t.rank + ', score ' + t.score.total.toFixed(0));
      setText(r.rank, String(t.rank)); setText(r.where, t.where);
      const tagSig = t.status + '|' + t.moved + '|' + t.modelRank + '|' + t.routable;
      if (r.tags.dataset.sig !== tagSig) {
        r.tags.dataset.sig = tagSig;
        r.tags.replaceChildren(...[h('span.tag.' + (person ? 'tag-person' : 'tag-warn'), null, person ? 'Person found' : 'Possible person'),
          t.moved ? h('span.tag.plain.triage-human', { title: 'You moved this card. The model would place it at ' + t.modelRank + '.' }, icon('person', 12), 'Your decision · model said ' + t.modelRank) : null,
          !t.routable ? h('span.tag.plain', { title: 'An open lead is only routed after it is confirmed or handed to the rescue team.' }, 'Not yet handed to the team') : null].filter(Boolean));
      }
      setText(r.sure, fmt.pct(t.p)); setText(r.motion, t.motion === 'still' ? 'Still' : t.motion === 'moving' ? 'Moving' : 'Not known');
      setText(r.wait, fmt.clock(t.waitS));
      setText(r.accessV, !t.ok ? 'No route found' : t.kind === 'walk in' ? 'Walk in: ' + t.length.toFixed(0) + ' m, about ' + mins(t.walkMin) : 'Break through ' + (t.wall ? (t.wall.state === 'damaged' ? 'damaged ' : '') + t.wall.mat : 'debris') + ': ' + t.length.toFixed(0) + ' m walk, then ' + t.through.toFixed(1) + ' m behind the wall');
      if (r.wayIcon.dataset.kind !== t.kind) { r.wayIcon.dataset.kind = t.kind; r.wayIcon.replaceChildren(icon(t.kind === 'walk in' ? 'door' : 'breach', 14)); }
      const hz = !t.ok ? t.reason : t.exposure.by.length ? 'Route crosses ' + t.exposure.by.map((x) => shortHz(x.hz) + ' for ' + x.m.toFixed(1) + ' m').join('; ') + '.' : 'Route stays clear of every marked hazard.';
      setText(r.haz, hz); r.haz.dataset.clear = String(t.ok && !t.exposure.by.length);
      setText(r.score, t.score.total.toFixed(0));
      const sum = t.score.terms.reduce((a, x) => a + x.weight, 0) || 1;
      t.score.terms.forEach((x, i) => { const seg = r.bar.children[i]; seg.style.width = x.points.toFixed(2) + '%'; seg.title = x.label + ': ' + x.value.toFixed(2) + ' × weight ' + x.weight + ' → ' + x.points.toFixed(1) + ' points'; seg.dataset.thin = String(x.points < 5); });
      r.bar.setAttribute('aria-label', 'Score ' + t.score.total.toFixed(0) + ' of 100: ' + t.score.terms.map((x) => x.label + ' ' + x.points.toFixed(0)).join(', '));
      if (t.id === selected) {
        r.detail.hidden = false;
        r.detail.replaceChildren(h('table.triage-break', null,
          h('thead', null, h('tr', null, h('th', null, 'Term and what was seen'), h('th.r', null, 'Value'), h('th.r', null, 'Weight'), h('th.r', null, 'Points'))),
          h('tbody', null, ...t.score.terms.map((x) => h('tr', null, h('td', null, h('span.triage-chip', { 'data-k': x.key }, x.letter), h('span.triage-termname', null, x.label), h('span.triage-seen', null, x.seen)), h('td.r.num', null, x.value.toFixed(2)), h('td.r.num', null, '× ' + x.weight.toFixed(1)), h('td.r.num', null, x.points.toFixed(1))))),
          h('tfoot', null, h('tr', null, h('td', null, 'Sum of weights ' + sum.toFixed(1) + ' · ' + [...new Set(t.det.evidence.map((e) => e.sensor))].length + ' kinds of sensor reading'), h('td.r', { colSpan: 2 }, 'Priority'), h('td.r.num', null, t.score.total.toFixed(1))))),
          h('div.row.triage-cardlinks', null,
            h('button.btn.btn-sm', { onclick: (e) => { e.stopPropagation(); ctx.select({ type: 'detection', id: t.id }); ctx.shell.open('graph', { select: t.id }); } }, icon('graph', 14), 'See the evidence'),
            h('button.btn.btn-sm', { onclick: (e) => { e.stopPropagation(); ctx.select({ type: 'detection', id: t.id }); ctx.shell.open('fusion', { select: t.id }); } }, icon('fusion', 14), 'How ' + fmt.pct(t.p) + ' was reached')));
      } else if (!r.detail.hidden) { r.detail.hidden = true; r.detail.replaceChildren(); }
    }
    const shortHz = (hz) => hz.name.replace(' (concept sensor)', '').replace(/:.*$/, '').toLowerCase();

    function renderBoard(animate) {
      const m = model, ids = m.order.map((t) => t.id);
      const before = new Map(); if (animate && !reducedMotion()) for (const el of boardList.children) before.set(el.dataset.id, el.getBoundingClientRect().top);
      for (const [id, el] of cards) if (!ids.includes(id)) { el.remove(); cards.delete(id); }
      const now = [...boardList.children].map((el) => el.dataset.id);
      for (const t of m.order) { if (!cards.has(t.id)) cards.set(t.id, makeCard(t.id)); patchCard(cards.get(t.id), t); }
      if (now.join() !== ids.join()) { const focus = document.activeElement; for (const id of ids) boardList.append(cards.get(id)); if (focus && boardList.contains(focus)) focus.focus(); }
      if (before.size) for (const el of boardList.children) { const was = before.get(el.dataset.id); if (was == null) { el.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(0.2,0.8,0.2,1)' }); continue; } const dy = was - el.getBoundingClientRect().top; if (Math.abs(dy) > 1) el.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(0.2,0.8,0.2,1)' }); }
      boardList.hidden = !m.order.length;
      let empty = board.querySelector('.triage-empty');
      if (!m.order.length && !m.reached.length) {
        if (!empty) { empty = h('div.empty.triage-empty', null, icon('triage', 30), h('h3', null, 'No one on the board yet'), h('p.muted', null, 'A card appears the moment the drone or the rover reports a possible person. In this exercise the first lead comes from the drone about a minute in.'), h('button.btn', { onclick: () => { if (!sim.state.started) sim.command('start'); sim.play(); } }, icon('play'), 'Run the mission')); board.querySelector('.triage-scroll').append(empty); }
      } else empty?.remove();
      setText(boardState, !m.order.length ? '' : m.overridden ? 'Your order (human decision)' : 'Model order');
      boardState.dataset.human = String(m.overridden); resetOrder.hidden = !manual;
      reachedList.replaceChildren(...(m.reached.length ? [h('h4', null, 'Reached by the team'), ...m.reached.map((t) => h('button.triage-done', { 'aria-pressed': String(t.id === selected), onclick: () => pick(t.id) }, icon('check', 14), h('b', null, t.where), h('span.num.muted', null, t.reachedAt != null ? 'at ' + fmt.clock(t.reachedAt) : 'arrived')))] : []));
    }

    function pick(id) { if (selected === id) return; selected = id; ctx.select({ type: 'detection', id }); refresh(true); }
    function announce(t) { live.textContent = t; }
    function move(id, dir) {
      const ids = model.order.map((t) => t.id), i = ids.indexOf(id), j = i + dir; if (i < 0 || j < 0 || j >= ids.length) return;
      ids.splice(j, 0, ids.splice(i, 1)[0]); manual = ids; refresh(true);
      const t = model.order.find((x) => x.id === id); announce(t.where + ' moved to position ' + t.rank + ' of ' + ids.length + '. Marked as your decision.');
      cards.get(id)?._r.grip.focus();
    }
    function startDrag(e, id) {
      if (e.button) return; e.preventDefault();
      const el = cards.get(id), els = [...boardList.children], rects = els.map((x) => x.getBoundingClientRect()), from = els.indexOf(el), gap = rects[1] ? rects[1].top - rects[0].bottom : 8;
      dragging = { id, el, from, to: from }; el.classList.add('is-dragging'); el.setPointerCapture?.(e.pointerId);
      const y0 = e.clientY, hgt = rects[from].height + gap;
      const onMove = (ev) => {
        const dy = ev.clientY - y0, mid = rects[from].top + rects[from].height / 2 + dy;
        el.style.transform = 'translateY(' + dy + 'px) scale(1.01)';
        let to = 0; rects.forEach((r, i) => { if (i !== from && mid > r.top + r.height / 2) to = i > from ? i : i + 1; });
        if (mid < rects[0].top + rects[0].height / 2) to = 0;
        dragging.to = to;
        els.forEach((x, i) => { if (i === from) return; x.style.transition = 'transform 180ms cubic-bezier(0.2,0.8,0.2,1)'; x.style.transform = from < to && i > from && i <= to ? 'translateY(' + -hgt + 'px)' : from > to && i >= to && i < from ? 'translateY(' + hgt + 'px)' : ''; });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp);
        els.forEach((x) => { x.style.transition = ''; x.style.transform = ''; }); el.classList.remove('is-dragging');
        const d = dragging; dragging = null;
        if (d.to !== d.from) { const ids = els.map((x) => x.dataset.id); ids.splice(d.to, 0, ids.splice(d.from, 1)[0]); manual = ids; refresh(false); const t = model.order.find((x) => x.id === id); announce(t.where + ' moved to position ' + t.rank + '. Marked as your decision.'); }
        else refresh(false);
      };
      window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp);
    }

    // ---------- the map ----------
    function scene() {
      const m = model; if (!m) return {};
      const S = sim.state, r = S.routes.rescue, real = r && (r.status === 'approved' || r.status === 'done');
      const routes = [];
      if (real) for (const leg of r.legs) { if (leg.ok) routes.push({ path: leg.path, tone: leg.det === selected ? 'main' : 'dim', width: leg.det === selected ? 3 : 2, end: true, spans: M.exposureAlong(leg.path, M.allHazards(S)).spans }); }
      else for (const leg of m.tour) routes.push({ path: leg.path, tone: leg.id === selected ? 'main' : 'dim', width: leg.id === selected ? 3 : 2, end: true, spans: leg.exposure.spans, dash: leg.id === selected ? [10, 6] : null, march: true });
      if (m.alt && !real) routes.push({ path: m.alt.path, tone: 'ghost', width: 1.5, dash: [3, 4], arrows: false, end: true });
      const markers = [...m.order, ...m.reached].map((t) => ({ id: t.id, pos: t.det.pos, sigma: t.sigma, kind: t.status === 'confirmed' ? 'person' : 'possible', rank: t.reached ? null : t.rank, reached: t.reached, selected: t.id === selected, label: t.det.room ? 'Room ' + t.det.room : 'Outdoors', pulse: t.id === selected && !t.reached }));
      const team = S.units['TEAM-1'];
      return { hazards: S.hazards, coverage: S.coverage, routes, markers, units: [{ pos: team.pos, kind: 'team', label: 'Rescue team 1' }], wall: m.alt?.wall.id || m.sel?.wall?.id, breach: m.alt && m.sel ? { foot: m.alt.foot, stand: m.alt.stand, pos: m.sel.det.pos, through: m.alt.through } : null };
    }

    // ---------- access planner ----------
    function routeStrip(path, exposure, doors, endLabel, lengthLabel) {
      const W = 560, x0 = 46, x1 = W - 60, len = exposure.length || 1, X = (d) => x0 + (d / len) * (x1 - x0);
      const g = s('svg', { viewBox: '0 0 ' + W + ' 62', class: 'triage-strip', role: 'img', 'aria-label': 'The way in as a straight strip: ' + lengthLabel });
      g.append(s('defs', null, s('pattern', { id: 'triage-hz', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, s('rect', { width: 3, height: 6, class: 'st-hzfill' }))));
      g.append(s('line', { x1: x0, y1: 30, x2: x1, y2: 30, class: 'st-line' }));
      for (const sp of exposure.spans) g.append(s('rect', { x: X(sp.from), y: 24, width: Math.max(2, X(sp.to) - X(sp.from)), height: 12, class: 'st-hz', fill: 'url(#triage-hz)' }), s('text', { x: (X(sp.from) + X(sp.to)) / 2, y: 18, class: 'st-hzlab', 'text-anchor': 'middle' }, shortHz(sp.hz) + ' ' + (sp.to - sp.from).toFixed(1) + ' m'));
      const step = len > 120 ? 40 : len > 50 ? 20 : 10;
      for (let d = step; d < len - step * 0.3; d += step) g.append(s('line', { x1: X(d), y1: 27, x2: X(d), y2: 33, class: 'st-tick' }), s('text', { x: X(d), y: 50, class: 'st-num', 'text-anchor': 'middle' }, d + ' m'));
      for (const dr of doors) g.append(s('path', { d: 'M' + (X(dr.at) - 4) + ' 36 v-12 h8 v12', class: 'st-door' }), s('text', { x: X(dr.at), y: 58, class: 'st-lab', 'text-anchor': 'middle' }, dr.door.id === 'entrance' ? 'entrance' : 'door ' + dr.door.room));
      g.append(s('circle', { cx: x0, cy: 30, r: 5, class: 'st-team' }), s('text', { x: x0 - 9, y: 34, class: 'st-lab', 'text-anchor': 'end' }, 'Team'));
      g.append(s('circle', { cx: x1, cy: 30, r: 5, class: 'st-end' }), s('text', { x: x1 + 9, y: 34, class: 'st-lab' }, endLabel));
      return g;
    }

    function crossSection(t, alt, W, compact) {
      const so = M.standOff(alt, t.sigma), thick = M.ASSUMED.thicknessM[alt.wall.mat], hWall = alt.wall.h;
      const lead = M.ASSUMED.standOffM + 0.75, span = lead + thick + alt.through + so.r95 + 0.5, floor = compact ? 112 : 150, H = floor + 64, pad = 16;
      const k = Math.min(44, (W - pad * 2) / span, (floor - 30) / hWall), xWall = pad + lead * k + Math.max(0, (W - pad * 2 - span * k) / 2), tw = Math.max(5, thick * k), xP = xWall + tw + alt.through * k, yTop = floor - hWall * k;
      const g = s('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, class: 'triage-section', role: 'img', 'aria-label': 'Cross-section: the team ' + M.ASSUMED.standOffM + ' metres in front of a ' + alt.wall.mat + ' wall, the person estimated ' + alt.through.toFixed(1) + ' metres behind it, give or take ' + so.r95.toFixed(1) + ' metres' });
      g.append(s('defs', null,
        s('pattern', { id: 'triage-conc', width: 7, height: 7, patternUnits: 'userSpaceOnUse' }, s('circle', { cx: 1.5, cy: 1.5, r: 0.8, class: 'cs-dot' }), s('circle', { cx: 5, cy: 4.5, r: 0.6, class: 'cs-dot' }), s('path', { d: 'M3 6 l1.5 -1 l1 1.2z', class: 'cs-dot' })),
        s('pattern', { id: 'triage-earth', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, s('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'cs-earth' }))));
      g.append(s('rect', { x: 0, y: floor, width: W, height: 7, fill: 'url(#triage-earth)' }), s('line', { x1: 0, y1: floor, x2: W, y2: floor, class: 'cs-floor' }));
      g.append(s('line', { x1: 0, y1: yTop, x2: W, y2: yTop, class: 'cs-ceiling' }), s('text', { x: 8, y: yTop - 6, class: 'cs-note' }, 'ceiling ' + hWall.toFixed(1) + ' m'));
      // where the person may be: a band, not a point
      const bx0 = Math.max(xWall + tw, xP - so.r95 * k), bx1 = Math.min(W - 2, xP + so.r95 * k);
      g.append(s('rect', { x: bx0, y: yTop + 1, width: bx1 - bx0, height: floor - yTop - 1, class: 'cs-band' }), s('line', { x1: bx0, y1: yTop, x2: bx0, y2: floor, class: 'cs-bandline' }), s('line', { x1: bx1, y1: yTop, x2: bx1, y2: floor, class: 'cs-bandline' }));
      g.append(s('text', { x: Math.min(W - 6, Math.max(bx1, xP + 40)), y: yTop - 6, class: 'cs-person', 'text-anchor': 'end' }, 'person: anywhere in the band (2σ = ' + so.r95.toFixed(1) + ' m)'));
      if (alt.wall.mat === 'concrete') g.append(s('rect', { x: xWall, y: yTop, width: tw, height: floor - yTop, fill: 'url(#triage-conc)', class: 'cs-wall' }));
      else { g.append(s('rect', { x: xWall, y: yTop, width: tw, height: floor - yTop, class: 'cs-wall cs-dry' })); for (let y = yTop + 14; y < floor - 4; y += 20) g.append(s('line', { x1: xWall, y1: y, x2: xWall + tw, y2: y, class: 'cs-stud' })); }
      if (alt.wall.state === 'damaged') g.append(s('path', { d: 'M' + (xWall + tw * 0.2) + ' ' + (yTop + 6) + ' l' + tw * 0.6 + ' 20 l' + -tw * 0.5 + ' 14 l' + tw * 0.7 + ' 22 l' + -tw * 0.6 + ' 18 l' + tw * 0.4 + ' 16', class: 'cs-crack' }));
      const cy = floor - 0.95 * k;
      g.append(s('path', { d: 'M' + (xWall - 4) + ' ' + (cy - 0.42 * k) + ' h-5 v' + 0.84 * k + ' h5', class: 'cs-cut' }));
      const fig = (x, tall, cls, lying) => {
        const u = k * tall, gg = s('g', { class: cls });
        if (lying) gg.append(s('circle', { cx: x - u * 0.4, cy: floor - u * 0.085, r: u * 0.07 }), s('path', { d: 'M' + (x - u * 0.31) + ' ' + (floor - u * 0.075) + ' h' + u * 0.36 + ' l' + u * 0.2 + ' ' + -u * 0.09 + ' l' + u * 0.17 + ' ' + u * 0.13 + ' M' + (x - u * 0.22) + ' ' + (floor - u * 0.075) + ' l' + u * 0.12 + ' ' + u * 0.055 + ' h' + u * 0.13 }));
        else gg.append(s('circle', { cx: x, cy: floor - u * 0.93, r: u * 0.07 }), s('path', { d: 'M' + x + ' ' + (floor - u * 0.86) + ' v' + u * 0.4 + ' M' + x + ' ' + (floor - u * 0.46) + ' l' + -u * 0.09 + ' ' + u * 0.46 + ' M' + x + ' ' + (floor - u * 0.46) + ' l' + u * 0.1 + ' ' + u * 0.46 + ' M' + x + ' ' + (floor - u * 0.78) + ' l' + u * 0.2 + ' ' + u * 0.16 + ' M' + x + ' ' + (floor - u * 0.78) + ' l' + -u * 0.1 + ' ' + u * 0.24 }));
        return gg;
      };
      const xS = xWall - M.ASSUMED.standOffM * k;
      g.append(fig(xS, 1.75, 'cs-team', false), fig(xP, 1.7, 'cs-fig', t.motion !== 'moving'));
      const dim = (xa, xb, y, label, anchor) => { const gg = s('g', { class: 'cs-dim' }); gg.append(s('line', { x1: xa, y1: floor + 3, x2: xa, y2: y + 4, class: 'ext' }), s('line', { x1: xb, y1: floor + 3, x2: xb, y2: y + 4, class: 'ext' }), s('line', { x1: xa, y1: y, x2: xb, y2: y }), s('line', { x1: xa - 3, y1: y + 3, x2: xa + 3, y2: y - 3 }), s('line', { x1: xb - 3, y1: y + 3, x2: xb + 3, y2: y - 3 }), s('text', { x: anchor === 'end' ? xb : anchor === 'start' ? xa : (xa + xb) / 2, y: y + 14, 'text-anchor': anchor || 'middle' }, label)); return gg; };
      g.append(dim(xS, xWall, floor + 20, '', 'end'), s('text', { x: xS - 8, y: floor + 24, class: 'cs-dimlab', 'text-anchor': 'end' }, M.ASSUMED.standOffM.toFixed(1) + ' m'), dim(xWall + tw, xP, floor + 20, alt.through.toFixed(1) + ' m to the estimated position', alt.through * k < 150 ? 'start' : 'middle'));
      g.append(s('text', { x: 8, y: H - 8, class: 'cs-note' }, 'Wall ' + alt.wall.id + ' · ' + (alt.wall.state === 'damaged' ? 'damaged ' : '') + alt.wall.mat + ' · about ' + (thick * 100).toFixed(0) + ' cm (assumed) · to scale'));
      return g;
    }

    function renderAccess() {
      const m = model, t = m.sel;
      if (!t) { access.replaceChildren(h('div.triage-phead', null, h('h3', null, 'Way in')), h('div.empty', null, h('p.muted', null, 'Select a person on the board to see the way in, the hazards on it and, behind a wall, where to break through.'))); return; }
      if (t.reached) { access.replaceChildren(h('div.triage-phead', null, h('h3', null, 'Way in: ' + t.where), h('span.tag.tag-ok', null, 'Reached')), h('div.empty', null, icon('check', 24), h('p', null, 'The rescue team reached this person' + (t.reachedAt != null ? ' at ' + fmt.clock(t.reachedAt) : '') + ' (simulated).'))); return; }
      if (!t.ok) { access.replaceChildren(h('div.triage-phead', null, h('h3', null, 'Way in: ' + t.where)), h('div.note.danger', null, icon('alert'), h('span', null, 'The planner found no way to this position: ' + t.reason + ' Check the hazards the route planner is told to avoid.'))); return; }
      if (t.kind === 'walk in') {
        const eta = t.walkMin;
        access.replaceChildren(
          h('div.triage-phead', null, h('h3', null, 'Way in: ' + t.where), h('span.tag.tag-accent.plain', null, 'Walk in'), h('div.grow'), realityTag('live-algo')),
          h('div.triage-walk', null,
            h('div.triage-walkfacts', null,
              h('div.stat', null, h('b', null, t.length.toFixed(0) + ' m'), h('span', null, 'on foot from the team')),
              h('div.stat', null, h('b', null, mins(eta)), h('span', null, 'at ' + M.TEAM_SPEED + ' m/s (scenario)')),
              h('div.stat', null, h('b', { class: t.exposure.total > 0.05 ? 'bad' : '' }, t.exposure.total.toFixed(1) + ' m'), h('span', null, 'inside marked hazards')),
              h('div.stat', null, h('b', null, '± ' + (2 * t.sigma).toFixed(1) + ' m'), h('span', null, 'position uncertainty (2σ)'))),
            routeStrip(t.path, t.exposure, t.doors, 'Person', t.length.toFixed(0) + ' metres'),
            h('p.triage-walknote', null, t.doors.length ? 'No wall to open: the planner reaches the estimated position through ' + t.doors.map((d) => (d.door.id === 'entrance' ? 'the entrance' : 'the door of room ' + d.door.room)).join(', then ') + '. ' : 'No wall to open: the way is in the open. ',
              t.exposure.by.length ? 'It cannot avoid ' + t.exposure.by.map((x) => shortHz(x.hz)).join(' and ') + ' completely; the red stretch is where.' : 'It keeps out of every marked hazard.')));
        return;
      }
      // break through
      const alt = m.alt, alts = m.alts || [];
      if (!alt) { access.replaceChildren(h('div.triage-phead', null, h('h3', null, 'Breakthrough planner: ' + t.where), realityTag('live-algo')), h('div.note.warn', null, icon('alert'), h('span', null, 'The person is ' + t.through.toFixed(1) + ' m beyond the closest point the planner can reach, and no single wall can be opened from a reachable, safe place. ' + (alts[0]?.why || '')))); return; }
      const so = M.standOff(alt, t.sigma), narrow = access.clientWidth < 660, figW = Math.round(narrow ? access.clientWidth - 42 : Math.max(270, Math.min(470, access.clientWidth - 40 - 18 - 292)));
      const best = alts.find((a) => a.best), planners = alts.find((a) => a.planners);
      const choose = (i) => { altPick.set(t.id, i); refresh(true); };
      const rows = h('div.triage-alts', { role: 'radiogroup', 'aria-label': 'Approach sides, ranked by time and hazard' }, ...alts.map((a, i) => a.usable
        ? h('button.triage-alt', { role: 'radio', 'aria-checked': String(a === alt), onclick: () => choose(i) },
          h('span.triage-altname', null, h('b', null, a.label), a.best ? h('span.tag.tag-ok.plain', null, 'Quickest') : null, a.planners ? h('span.tag.plain', { title: 'The route planner always goes to the closest point it can reach.' }, 'Planner’s route') : null),
          h('span.triage-altnums', { title: 'Time is walking at ' + M.TEAM_SPEED + ' m/s plus an assumed time to open the wall: drywall ' + M.ASSUMED.breachMin.drywall + ' min, concrete ' + M.ASSUMED.breachMin.concrete + ' min, a damaged wall × ' + M.ASSUMED.damagedFactor + '.' },
            h('span', null, (a.wall.state === 'damaged' ? 'damaged ' : '') + a.wall.mat),
            h('span', null, h('b.num', null, a.length.toFixed(0) + ' m'), ' walk'),
            h('span', null, h('b.num', { class: a.exposure.total > 0.05 ? 'bad' : '' }, a.exposure.total.toFixed(1) + ' m'), ' in hazards'),
            h('span', null, h('b.num', null, a.through.toFixed(1) + ' m'), ' behind'),
            h('span', null, h('b.num', null, mins(a.minutes)), ' assumed')))
        : h('div.triage-alt.off', null, h('span.triage-altname', null, h('b', null, a.label), h('span.tag.plain', null, 'Ruled out')), h('span.triage-altwhy', null, a.why))));
      access.replaceChildren(
        h('div.triage-phead', null, h('h3', null, 'Breakthrough planner: ' + t.where), h('span.tag.tag-warn.plain', null, 'Behind a wall'), h('div.grow'), realityTag('live-algo')),
        h('div.triage-breach', { style: { gridTemplateColumns: narrow ? 'minmax(0, 1fr)' : figW + 'px minmax(0, 1fr)' } },
          h('div.triage-breachfig', null, crossSection(t, alt, figW, narrow),
            h('p.triage-standoff', null,
              h('b', null, so.direct ? 'Cut on the direct line. ' : 'Cut ' + so.sideways.toFixed(1) + ' m to one side. '),
              so.direct ? 'The nearest the person is likely to be is ' + so.clear.toFixed(1) + ' m behind the wall. ' : 'The person may be right behind the wall (clear depth ' + Math.max(0, so.clear).toFixed(1) + ' m), so offset the opening by 2σ + ' + M.ASSUMED.clearMarginM + ' m. ',
              so.collapseZone ? 'The wall is damaged: check it first and keep everyone not cutting ' + so.collapseZone.toFixed(1) + ' m back (1.5 × its height). ' : '',
              alt.debris?.length ? 'Debris lies behind this wall. ' : '',
              h('i.triage-assumed', null, 'Rule of thumb, assumed'))),
          h('div.triage-breachside', null,
            h('p.triage-altlede', null, 'Sides the team could open. Ranked by walking and opening time, plus 30 s per metre inside a hazard.'),
            rows,
            best && planners && best !== planners ? h('p.triage-fine', null, 'The route planner goes to the closest point it can reach (' + planners.side.toLowerCase() + ' side). This comparison rates the ' + best.side.toLowerCase() + ' side ' + mins(Math.max(0, planners.rank - best.rank)) + ' better. The planner cannot be told a side yet, so pass it on by radio.') : null)));
    }

    // ---------- resources ----------
    let teamSeg = null, teamBody = null;
    function buildTeamPanel() {
      teamSeg = h('div.seg', { role: 'group', 'aria-label': 'Number of rescue teams' }, ...[1, 2, 3, 4].map((n) => h('button', { 'aria-pressed': String(n === nTeams), onclick: () => { nTeams = n; [...teamSeg.children].forEach((b, i) => b.setAttribute('aria-pressed', String(i + 1 === n))); refresh(true); } }, n + (n === 1 ? ' team' : ' teams'))));
      teamBody = h('div.triage-teambody');
      teamPanel.append(h('div.triage-phead', null, h('h3', null, 'Resource sketch'), realityTag('live-algo')), h('p.triage-lede', null, 'Which team takes whom, and when each person is reached. One team follows the board. More teams are a what-if: the split is solved exactly by trying every assignment and order.'), teamSeg, teamBody);
    }
    buildTeamPanel();
    function renderTeams() {
      const m = model, targets = m.order.filter((t) => t.ok);
      if (!targets.length) { teamBody.replaceChildren(h('p.muted.triage-teamempty', null, 'Nothing to assign yet.')); return; }
      const use = targets.slice(0, 7), scores = use.map((t) => t.score.total);
      const sols = [1, 2, 3, 4].map((n) => M.assignTeams(sim, m.from, use, scores, n, n === 1 ? use.map((_, i) => i) : null));
      const sol = sols[nTeams - 1], span = Math.max(...sols.map((x) => x.makespan), 1), W = 336, x0 = 30, x1 = W - 14, X = (v) => x0 + (v / span) * (x1 - x0);
      const rowH = 30, top = 8, H = top + sol.teams.length * rowH + 24;
      const g = s('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'triage-gantt', role: 'img', 'aria-label': sol.teams.map((line, i) => 'Team ' + (i + 1) + ': ' + line.map((st) => use[st.i].where + ' reached after ' + mins(st.reach)).join(', then ')).join('. ') });
      g.append(s('defs', null, s('pattern', { id: 'triage-work', width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, s('rect', { width: 2, height: 5, class: 'gt-workfill' }))));
      const tick = span > 40 ? 10 : span > 16 ? 5 : span > 8 ? 2 : 1;
      for (let v = 0; v <= span + 1e-6; v += tick) g.append(s('line', { x1: X(v), y1: top - 2, x2: X(v), y2: H - 20, class: 'gt-grid' }), s('text', { x: X(v), y: H - 7, class: 'gt-num', 'text-anchor': 'middle' }, v + (v === 0 ? ' min' : '')));
      sol.teams.forEach((line, i) => {
        const y = top + i * rowH + rowH / 2;
        g.append(s('text', { x: 4, y: y + 4, class: 'gt-team' }, 'T' + (i + 1)));
        for (const st of line) {
          const t = use[st.i];
          g.append(s('line', { x1: X(st.depart), y1: y, x2: X(st.arrive), y2: y, class: 'gt-walk' }));
          if (st.reach > st.arrive) g.append(s('rect', { x: X(st.arrive), y: y - 6, width: Math.max(1.5, X(st.reach) - X(st.arrive)), height: 12, class: 'gt-work', fill: 'url(#triage-work)' }));
          g.append(s('rect', { x: X(st.reach), y: y - 2, width: Math.max(1, X(Math.min(span, st.leave)) - X(st.reach)), height: 4, class: 'gt-stay' }));
          g.append(s('circle', { cx: X(st.reach), cy: y, r: 6.5, class: t.status === 'confirmed' ? 'gt-person' : 'gt-possible' }), s('text', { x: X(st.reach), y: y + 3.5, class: 'gt-rank', 'text-anchor': 'middle' }, String(t.rank)));
          g.append(s('title', null, t.where + ': reached after ' + mins(st.reach)));
        }
      });
      const base = sols[0].makespan;
      teamBody.replaceChildren(
        h('div.triage-teamstats', null,
          h('div.stat', null, h('b', null, mins(sol.makespan)), h('span', null, 'until the last person is reached')),
          nTeams > 1 ? h('div.stat', null, h('b', null, sol.makespan < base - 0.05 ? '−' + mins(base - sol.makespan) : 'no gain'), h('span', null, 'against one team')) : h('div.stat', null, h('b', null, String(use.length)), h('span', null, use.length === 1 ? 'person, in board order' : 'people, in board order')),
          h('span.tag.plain.' + (nTeams > 1 ? 'tag-sim' : 'tag-ok'), { title: nTeams > 1 ? 'Only one rescue team is simulated. Extra teams are a planning what-if.' : 'The simulated rescue team.' }, nTeams > 1 ? 'What if' : 'The plan')),
        g,
        h('div.triage-gkey', null, h('span', null, h('i.k-walk'), 'walking'), h('span', null, h('i.k-work'), 'opening a wall'), h('span', null, h('i.k-stay'), 'with the person, ' + M.ASSUMED.onSiteMin + ' min')),
        h('ol.triage-assign', null, ...sol.teams.map((line, i) => h('li', null, h('b', null, 'Team ' + (i + 1)), h('span', null, line.map((st) => use[st.i].rank + ' ' + (use[st.i].det.room ? 'room ' + use[st.i].det.room : 'outdoors')).join('  →  ') || 'stand by')))),
        h('div.triage-mini', { role: 'img', 'aria-label': 'Time until the last person is reached, by number of teams: ' + sols.map((x, i) => (i + 1) + ': ' + mins(x.makespan)).join(', ') },
          h('p', null, 'Last person reached, by number of teams'),
          ...sols.map((x, i) => h('div.triage-minirow', { 'data-on': String(i + 1 === nTeams) }, h('span.num', null, String(i + 1)), h('div.bar', null, h('i', { style: { width: (x.makespan / span) * 100 + '%' } })), h('span.num', null, mins(x.makespan))))),
        h('p.triage-fine', null, (nTeams > 1 ? sol.tried.toLocaleString() + ' visiting orders checked. Objective: the smallest sum of each person’s time-to-reach × priority score. ' : '') + 'All teams start where Rescue team 1 is now. Wall-opening times are assumed' + (targets.length > 7 ? '; only the first seven on the board are assigned.' : '.')));
    }

    // ---------- sending the order ----------
    function setHold(on) {
      holdAtPlan = on;
      if (on && sim.state.phase === 'plan' && sim.state.autoplay) { sim.command('setAutoplay', { on: false }); heldAutoplay = true; }
      if (!on && heldAutoplay) { sim.command('setAutoplay', { on: true }); heldAutoplay = false; }
      renderSend();
    }
    function send() {
      const S = sim.state, m = compute(), ids = m.order.filter((t) => t.routable).map((t) => t.id), skipped = m.order.filter((t) => !t.routable);
      if (S.phase !== 'plan') { ctx.shell.toast(S.phase === 'rescue' || S.phase === 'complete' ? 'The route is already approved, so the planner is closed. The board still shows who is waiting.' : 'The route planner opens when the search is finished. Now: ' + ctx.PHASE_INFO[S.phase].label + '. Your order is kept on the board until then.', { level: 'info' }); return; }
      if (!ids.length) { ctx.shell.toast('There is no one the planner can route to yet: open leads must be confirmed or handed to the team first.', { level: 'info' }); return; }
      const ok = sim.command('planRoute', { order: ids });
      if (!ok) { ctx.shell.toast('The route planner did not accept the order. Try again in a moment.', { level: 'alert' }); return; }
      lastSend = { t: S.t, ids, human: m.overridden };
      const r = sim.state.routes.rescue;
      ctx.shell.toast('Route planned in ' + (m.overridden ? 'your' : 'the model’s') + ' order: ' + r.length.toFixed(0) + ' m, ' + ids.length + (ids.length === 1 ? ' stop' : ' stops') + '. It waits for approval.' + (skipped.length ? ' ' + skipped.length + ' open lead left out until it is checked.' : ''), { level: 'ok' });
      refresh(true);
    }
    async function approve() {
      const r = sim.state.routes.rescue; if (!r || r.status !== 'planned') return;
      const yes = await ctx.shell.confirm({ title: 'Approve this route?', body: 'The rescue team will start walking: ' + r.length.toFixed(0) + ' m, about ' + Math.max(1, Math.round(r.etaS / 60)) + ' min, ' + r.legs.filter((l) => l.ok).length + ' stops.' + (r.avoided.length ? ' The route avoids: ' + r.avoided.join('; ') + '.' : '') + ' Approval is recorded under your name.', confirmLabel: 'Approve route' });
      if (!yes) return;
      if (sim.command('approveRoute')) { if (heldAutoplay) { sim.command('setAutoplay', { on: true }); heldAutoplay = false; } refresh(true); }
    }
    function renderSend() {
      const S = sim.state, r = S.routes.rescue, ph = S.phase, n = model ? model.order.filter((t) => t.routable).length : 0;
      const open = ph === 'plan';
      sendBtn.classList.toggle('is-waiting', !open || !n);
      holdBox.hidden = ph === 'plan' && !holdAtPlan ? false : ph === 'rescue' || ph === 'complete';
      holdBox.querySelector('input').checked = holdAtPlan;
      let note;
      if (ph === 'rescue' || ph === 'complete') note = [h('b', null, ph === 'complete' ? 'Everyone found has been reached.' : 'Route approved' + (r?.approvedBy ? ' by ' + r.approvedBy : '') + '.'), ' The planner is closed; the board shows who is still waiting.'];
      else if (open && r?.status === 'planned') {
        const mine = lastSend && r.legs.map((l) => l.det).join() === lastSend.ids.join();
        note = [h('b', null, 'Route planned' + (mine ? (lastSend.human ? ' in your order' : ' in the model’s order') : '') + ': ' + r.length.toFixed(0) + ' m, about ' + Math.max(1, Math.round(r.etaS / 60)) + ' min.'), ' Waiting for approval. ', h('button.btn.btn-sm', { onclick: approve }, icon('check', 14), 'Approve'), ' ', h('button.btn.btn-sm.btn-ghost', { onclick: () => ctx.shell.open('mission') }, 'Review in Mission')];
      } else if (open) note = [h('b', null, 'The route planner is open.'), ' ' + n + (n === 1 ? ' person' : ' people') + ' will be routed in the order on the board.'];
      else note = [h('b', null, 'Planner opens after the search.'), ' Now: ' + ctx.PHASE_INFO[ph].label.toLowerCase() + '. The order is kept until then.'];
      const sig = ph + '|' + (r?.status || '') + '|' + (r?.plannedAt || '') + '|' + n + '|' + (lastSend?.t || '');
      if (sendNote.dataset.sig !== sig) { sendNote.dataset.sig = sig; sendNote.replaceChildren(...note); }
    }

    // ---------- refresh ----------
    function refresh(animate = false) {
      if (dragging) return;
      compute(); lastCompute = performance.now();
      renderBoard(animate); renderAccess(); renderTeams(); renderSend();
      const S = sim.state, real = S.routes.rescue && (S.routes.rescue.status === 'approved' || S.routes.rescue.status === 'done');
      setText(mapNote, !model.order.length ? 'Nothing found yet' : real ? 'Showing the approved route' : 'Preview of the route in board order');
      plan.draw();
    }
    const soft = () => { if (visible && performance.now() - lastCompute > 450) refresh(true); };
    bus.on('tick', soft);
    for (const ev of ['detection', 'survivor', 'route', 'reset', 'seek']) bus.on(ev, () => { if (ev === 'reset' || ev === 'seek') { if (ev === 'reset') { manual = null; lastSend = null; altPick.clear(); heldAutoplay = false; } cards.forEach((el) => el.remove()); cards.clear(); } if (visible) refresh(true); });
    bus.on('phase', ({ to }) => { if (to === 'plan' && holdAtPlan && sim.state.autoplay) { sim.command('setAutoplay', { on: false }); heldAutoplay = true; ctx.shell.toast('The mission is holding at the planning step. Set the order in Triage, then send it to the route planner.', { level: 'info', ms: 7000 }); } if (visible) refresh(true); });
    bus.on('select', (sel) => { if (!sel) return; const id = sel.type === 'detection' ? sel.id : sel.type === 'survivor' ? sim.state.survivors[sel.id]?.detId : null; if (id && id !== selected) { selected = id; if (visible) refresh(true); } });
    bus.on('prefs', () => { plan.retheme(); });

    refresh(false);
    return {
      onShow() { visible = true; refresh(false); if (!reducedMotion()) plan.start(); },
      onHide() { visible = false; plan.stop(); },
      onParams(p) { if (p?.select) { selected = p.select; refresh(true); } },
    };
  },
};
