// Timelines: "Why this lead?" The fusion working for one lead as a ladder, and the smallest changes that flip it.
import * as M from './model.js';
import { counterfactuals, SAYS, sensorName, CLS_WORD, LR, PRIOR } from './cf.js';
const { clock } = M;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const logit = (p) => Math.log(p / (1 - p)), LO = logit(0.004), HI = logit(0.9992);

export function mountCf(pane, app) {
  const { h, kit } = app, { icon } = kit;
  const leadsEl = h('div.tl-cf-leads'), ladderEl = h('div.tl-cf-ladder'), listEl = h('div.tl-cf-list');
  pane.append(h('div.tl-cf', null, leadsEl, ladderEl, listEl));
  let pinned = null, cur = null;

  function ladder(steps, { thresholds, title, now, alt }) {
    const W = Math.max(380, ladderEl.clientWidth - 26), L = 196, R = 40, rowH = 38, top = 44, n = steps.length + 1, H = top + n * rowH + 26;
    const X = (p) => L + ((logit(Math.min(0.9992, Math.max(0.004, p))) - LO) / (HI - LO)) * (W - L - R);
    let s = '<svg class="chart tl-ladder" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(title) + '">';
    for (const p of [0.01, 0.05, 0.2, 0.5, 0.8, 0.95, 0.99, 0.999]) s += '<line class="gridline" x1="' + X(p).toFixed(1) + '" x2="' + X(p).toFixed(1) + '" y1="' + (top - 4) + '" y2="' + (H - 22) + '"/><text x="' + X(p).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + (p * 100 >= 99.5 ? '99.9' : p * 100) + ' %</text>';
    for (const [p, cls, word] of [[thresholds.possible, 'warn', 'lead stays open'], [thresholds.confirmed, 'person', 'confirmed']]) s += '<line class="tl-th ' + cls + '" x1="' + X(p).toFixed(1) + '" x2="' + X(p).toFixed(1) + '" y1="' + (top - (cls === 'person' ? 18 : 34)) + '" y2="' + (H - 22) + '"/><text class="tl-th-t ' + cls + '" x="' + (X(p) + 4).toFixed(1) + '" y="' + (top - (cls === 'person' ? 8 : 24)) + '">' + word + ' ≥ ' + (p * 100).toFixed(0) + ' %</text>';
    let prev = PRIOR;
    s += '<text class="tl-ld-l" x="8" y="' + (top + 15) + '">Before any reading</text><text class="tl-ld-lr" x="8" y="' + (top + 29) + '">prior, assumed</text><circle class="tl-ld-dot" cx="' + X(prev).toFixed(1) + '" cy="' + (top + 11) + '" r="3"/>';
    steps.forEach((st, i) => {
      const y = top + (i + 1) * rowH, x0 = X(prev), x1 = X(st.p), up = st.lr > 1.0001, flat = Math.abs(st.lr - 1) < 1e-4;
      const says = SAYS[st.sensor]?.[st.result] || (st.result === 'blind' ? 'could not see' : st.result);
      s += '<g class="' + (st.cf ? 'cf' : '') + '"><text class="tl-ld-l" x="8" y="' + (y + 15) + '"><tspan class="t">' + (st.t != null ? clock(st.t) : 'added') + '</tspan> ' + esc(sensorName(st.sensor)) + (st.repeat ? ' again' : '') + '<title>' + esc(says + (st.note ? '. ' + st.note : '')) + '</title></text>';
      s += '<text class="tl-ld-lr' + (st.assumed ? ' assumed' : '') + '" x="8" y="' + (y + 29) + '">' + (flat ? 'no information' : '×' + (st.lr >= 10 ? st.lr.toFixed(0) : st.lr.toFixed(2)) + (st.assumed ? ' assumed' : ' measured')) + '</text>';
      s += '<line class="tl-ld-drop" x1="' + x0.toFixed(1) + '" x2="' + x0.toFixed(1) + '" y1="' + (y - rowH + 11) + '" y2="' + (y + 11) + '"/>';
      if (!flat) s += '<line class="tl-ld-bar ' + (up ? 'up' : 'down') + '" x1="' + x0.toFixed(1) + '" x2="' + x1.toFixed(1) + '" y1="' + (y + 11) + '" y2="' + (y + 11) + '"/><path class="tl-ld-head ' + (up ? 'up' : 'down') + '" d="M' + x1.toFixed(1) + ',' + (y + 11) + 'l' + (up ? -5 : 5) + ',-3.5v7z"/>';
      else s += '<circle class="tl-ld-nil" cx="' + x0.toFixed(1) + '" cy="' + (y + 11) + '" r="2"/>';
      if (st.cf) s += '<rect class="tl-ld-cf" x="2" y="' + (y + 1) + '" width="' + (W - 4) + '" height="' + (rowH - 2) + '"/>';
      s += '</g>'; prev = st.p;
    });
    const fy = top + n * rowH - 13;
    s += '<circle class="tl-ld-final ' + now.cls + '" cx="' + X(prev).toFixed(1) + '" cy="' + fy + '" r="5"/><text class="tl-ld-ft ' + now.cls + '" x="' + (X(prev) + (prev > 0.9 ? -10 : 10)).toFixed(1) + '" y="' + (fy + 4) + '" text-anchor="' + (prev > 0.9 ? 'end' : 'start') + '">' + (prev * 100).toFixed(prev > 0.99 ? 1 : 0) + ' % ' + CLS_WORD[now.cls] + '</text>';
    if (alt != null) s += '<circle class="tl-ld-ghost" cx="' + X(alt).toFixed(1) + '" cy="' + fy + '" r="5"/>';
    s += '</svg>';
    return s;
  }

  function paint() {
    if (pane.hidden) return;
    const A = app.byId(app.cursor.id), run = A?.run;
    if (!run) { leadsEl.replaceChildren(); ladderEl.replaceChildren(h('div.empty', null, h('div.spinner'), h('p', null, 'Waiting for this branch.'))); listEl.replaceChildren(); return; }
    const s = M.stateAt(run, app.cursor.t);
    if (!s.dets.length) { leadsEl.replaceChildren(); listEl.replaceChildren(); ladderEl.replaceChildren(h('div.empty', null, icon('target', 24), h('h3', null, 'No lead exists yet at ' + clock(app.cursor.t)), h('p', null, 'Move the cursor to a moment after the first reading. The first lead in ' + A.name + ' opens at ' + clock(run.detections[0]?.t ?? 0) + '.'), run.detections[0] ? h('button.btn', { type: 'button', onclick: () => app.setCursor(A.id, run.detections[0].t + 1) }, 'Go there') : null)); return; }
    if (!s.dets.some((d) => d.id === app.lead)) app.lead = (s.dets.find((d) => d.status === 'possible') || s.dets[s.dets.length - 1]).id;
    const d = s.dets.find((x) => x.id === app.lead), ev = d.final.evidence.slice(0, d.nEv);
    const dismissed = d.final.dismissed && d.status === 'rejected';
    const key = A.id + '|' + run.hash + '|' + d.id + '|' + d.nEv + '|' + dismissed;
    if (!cur || cur.key !== key) { cur = { key, cf: counterfactuals(ev, { dismissed, outdoor: d.outdoor }) }; pinned = null; }
    const cf = cur.cf, th = cf.thresholds;
    leadsEl.replaceChildren(h('h4', null, 'Leads in ' + A.name + ' at ' + clock(app.cursor.t)), ...s.dets.map((x) => h('button.tl-cf-lead', { type: 'button', 'aria-pressed': String(x.id === d.id), onclick: () => app.selectLead(x.id, 'cf') },
      h('b', null, x.id), h('span', null, M.leadWhere(x)), h('span.num', { class: x.status === 'confirmed' ? 'c-person' : x.status === 'possible' ? 'c-warn' : 'c-ok' }, (x.p * 100).toFixed(0) + ' %'), h('small', null, x.status === 'rejected' ? (x.final.dismissed ? 'dismissed' : 'closed') : x.status))),
      h('p.caption', null, 'A lead is the console’s belief that someone is at a spot. Pick one, or click it on a map.'));
    const show = pinned != null ? pinned : null;
    const title = 'How ' + d.id + ' got to ' + (cf.now.p * 100).toFixed(0) + ' %';
    ladderEl.innerHTML = '';
    ladderEl.append(h('div.tl-cf-title', null, h('h4', null, show ? 'The closest world where ' + d.id + ' is ' + CLS_WORD[show.cls] : title), h('span.caption', null, show ? 'changed rows are outlined; the hollow dot is where it really stands' : 'each reading multiplies the odds; the axis is in log-odds so equal evidence moves equal distance'), show ? h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => { pinned = null; paint(); } }, 'Back to what happened') : null));
    ladderEl.insertAdjacentHTML('beforeend', ladder(show ? show.steps : cf.now.steps, { thresholds: th, title, now: show ? { cls: show.cls } : cf.now, alt: show ? cf.now.p : null }));
    if (dismissed) ladderEl.append(h('p.note.warn', null, icon('info'), h('span', null, 'The operator dismissed this lead. The evidence alone puts it at ' + (cf.now.p * 100).toFixed(0) + ' %: ' + CLS_WORD[cf.now.fused] + '.')));
    listEl.replaceChildren(h('h4', null, 'What would flip it'), ...cf.targets.map((t) => h('section.tl-cf-target', null,
      h('h5', null, 'To be ', h('span', { class: t.cls === 'confirmed' ? 'c-person' : t.cls === 'possible' ? 'c-warn' : 'c-ok' }, CLS_WORD[t.cls]), h('small', null, t.none ? '' : t.size === 1 ? 'one change is enough' : 'needs two changes')),
      t.dismissedOnly ? h('p.tl-cf-alt', null, 'Had the operator not dismissed it, it would be ' + CLS_WORD[t.cls] + ' on the evidence already there.') : null,
      ...t.list.map((r) => h('button.tl-cf-opt', { type: 'button', 'aria-pressed': String(pinned === r), onclick: () => { pinned = pinned === r ? null : r; paint(); } },
        h('span.tl-cf-p.num', { class: r.cls === 'confirmed' ? 'c-person' : r.cls === 'possible' ? 'c-warn' : 'c-ok' }, (r.p * 100).toFixed(r.p > 0.99 ? 1 : 0) + ' %'),
        h('span.tl-cf-txt', null, ...r.parts.map((p) => h('span', null, p.text, p.assumed ? h('i', null, 'assumed weight') : null)), h('small', null, r.parts.map((p) => p.takes).filter(Boolean).join(' '))))),
      t.none ? h('p.tl-cf-alt', null, 'No change of one or two readings gets there. It would take evidence worth ×' + (t.factor >= 10 ? t.factor.toFixed(0) : t.factor.toFixed(1)) + ' on the odds' + (t.factor < 1 ? ' (that is, against a person)' : '') + '.') : null,
      h('p.tl-cf-alt', null, 'Without new evidence: move the ' + t.line.name + ' from ' + (t.line.from * 100).toFixed(0) + ' % ' + t.line.dir + ' ' + (t.line.to * 100).toFixed(t.line.to > 0.99 ? 1 : 0) + ' %' + (t.prior > 0.001 && t.prior < 0.999 ? ', or start from a prior of ' + (t.prior * 100).toFixed(t.prior < 0.1 ? 1 : 0) + ' % instead of ' + (PRIOR * 100).toFixed(0) + ' %.' : '.')))),
      h('p.caption', null, 'Computed by re-running the console’s fusion (fuse and classify in app/core/fusion.js) on edited evidence: every single change is tried, then every pair. Only the Wi-Fi network’s weight is measured (on simulated test windows); the others are assumed design values. Method: counterfactual explanation, Wachter, Mittelstadt and Russell, 2017.'));
  }
  app.on('tab', (id) => { if (id === 'cf') paint(); });
  app.on('cursor', paint); app.on('lead', paint); app.on('branches', paint); app.on('time', paint);
  let lastW = 0; new ResizeObserver(() => { const w = ladderEl.clientWidth; if (Math.abs(w - lastW) > 2) { lastW = w; paint(); } }).observe(ladderEl);
}
