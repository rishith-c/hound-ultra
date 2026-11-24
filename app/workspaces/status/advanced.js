// System check, Advanced: results and evidence; fault drills; the ledger; accessibility; device and offline.
import { SUITE, GROUPS, toMarkdown } from './suite.js';
import { createDrillPanel } from './drills.js';
import { ALL, LEDGER, ASSUMED, NETFACTS, checkBuilt } from './ledger.js';
import { auditAll } from './audit.js';
import { deviceReport } from './device.js';
import { drawPlan } from './plan2d.js';
import { offline, openSheet, SHORTCUTS, TEXT_SIZES } from '../../global/a11y.js';

const ms = (x) => (x < 1000 ? x.toFixed(0) + ' ms' : (x / 1000).toFixed(1) + ' s');
export function createAdvanced(ctx, store, { runAll, subscribe }) {
  const { h, icon, panel, realityTag, fitCanvas, cssVar, REALITY } = ctx.kit;
  const TABS = [['tests', 'Self-tests'], ['drills', 'Fault drills'], ['real', 'What is real'], ['access', 'Accessibility'], ['device', 'Device and offline']];
  let tab = 'tests', shown = false, sel = 'nn-parity', filter = 'all', offs = [];
  const body = h('div.status-body'), tabs = h('div.tabs', { role: 'tablist', 'aria-label': 'System check' }, ...TABS.map(([id, t]) => h('button', { role: 'tab', id: 'status-tab-' + id, onclick: () => open(id) }, t)));
  tabs.addEventListener('keydown', (e) => { const i = TABS.findIndex(([x]) => x === tab), d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (d) { const n = TABS[(i + d + TABS.length) % TABS.length][0]; open(n); document.getElementById('status-tab-' + n)?.focus(); } });
  const el = h('div.status-advwrap', null, h('header.ws-head', null, h('div', null, h('h1', null, 'System check'), h('p', null, 'Proof that the console works, proof that it fails safely, and what is real.')), realityTag('live-algo')), tabs, body);
  const pages = {};

  // ---------- self-tests ----------
  pages.tests = () => {
    const rows = new Map(), tbody = h('div.status-rows', { role: 'list' }), sum = h('div.status-sum'), ev = h('div.status-ev'), evHead = h('div.status-evhead'), plan = h('canvas.status-evcanvas', { role: 'img', 'aria-label': 'Picture of the evidence' }), list = h('ol.status-checks', { tabindex: '0', 'aria-label': 'Checks' }), chips = h('div.row');
    const copy = async (b, text) => { const was = b.lastChild.textContent; let ok = true; try { await navigator.clipboard.writeText(text); } catch { ok = false; } b.lastChild.textContent = ok ? 'Copied' : 'Could not copy'; setTimeout(() => { b.lastChild.textContent = was; }, 1500); };
    const device = () => (navigator.userAgentData?.platform || navigator.platform || 'this computer') + ', ' + (navigator.hardwareConcurrency || '?') + ' threads';
    const again = h('button.btn.btn-primary', { onclick: runAll }, icon('play'), h('span', null, 'Run all again')), md = h('button.btn', { onclick: () => copy(md, toMarkdown(store.out, device())) }, icon('copy'), h('span', null, 'Copy as Markdown')), js = h('button.btn', { onclick: () => copy(js, JSON.stringify({ device: device(), ...store.out }, null, 2)) }, icon('copy'), h('span', null, 'Copy as JSON')), page = h('a.btn.btn-ghost', { href: '../tests/', target: '_blank', rel: 'noopener' }, icon('external'), 'Plain page');
    for (const g of GROUPS) {
      tbody.append(h('div.status-ghead', { role: 'presentation' }, h('h3', null, g.title), h('span', null, g.line)));
      for (const t of SUITE.filter((x) => x.group === g.id)) {
        const got = h('span.got'), mark = h('span.mark'), n = h('span.num'), time = h('span.num'), cv = h('canvas.lamps', { 'aria-hidden': 'true', width: 220, height: 12 }), b = h('button.status-row', { role: 'listitem', onclick: () => { sel = t.id; evidence(); pickRow(); } }, mark, h('span.name', null, h('b', null, t.title), h('small', null, t.area)), h('span.exp', null, t.expect), got, cv, n, time);
        rows.set(t.id, { b, got, mark, n, time, cv, p: 0 }); tbody.append(b);
      }
    }
    const colHead = h('div.status-row.head', { 'aria-hidden': 'true' }, h('span'), h('span', null, 'Test'), h('span', null, 'What should happen'), h('span', null, 'What happened'), h('span', null, 'Each check'), h('span.r', null, 'Checks'), h('span.r', null, 'Time'));
    const lamps = (cv, checks) => { const c = cv.getContext('2d'), w = cv.width, hh = cv.height, n = checks.length; c.clearRect(0, 0, w, hh); if (!n) return; const step = w / Math.min(n, 110), col = { 1: cssVar('--ok'), 2: cssVar('--danger'), 3: cssVar('--warn') }, m = Math.min(n, 110); for (let i = 0; i < m; i++) { let s = 1; for (let k = Math.floor((i / m) * n); k < Math.max(Math.floor((i / m) * n) + 1, Math.floor(((i + 1) / m) * n)); k++) { const v = checks[k][0]; if (v === 2) s = 2; else if (v === 3 && s !== 2) s = 3; } c.fillStyle = col[s]; c.globalAlpha = s === 1 ? 0.8 : 1; c.fillRect(i * step, 1, Math.max(1, step - (step > 4 ? 1.5 : 0.6)), hh - 2); } };
    function paintRow(id) {
      const r = rows.get(id), res = store.results.get(id), ch = (store.checks.get(id) || []).flat(), run = store.running.has(id);
      r.b.className = 'status-row ' + (res ? res.state : run ? 'run' : 'wait') + (sel === id ? ' sel' : ''); r.b.setAttribute('aria-current', String(sel === id));
      r.mark.replaceChildren(res ? icon(res.state === 'fail' ? 'x-circle' : 'check-circle', 15) : run ? h('span.spinner.sm') : h('i')); r.mark.title = res ? { pass: 'Pass', limit: 'Pass, with known limits', fail: 'Fail' }[res.state] : run ? 'Running' : 'Waiting';
      r.got.replaceChildren(res ? res.got : run ? 'Running' : '', res?.limits ? h('em', null, ' ' + res.limits + ' known limits') : '', res?.failed ? h('strong', null, ' ' + res.failed + ' failed') : ''); r.n.textContent = ch.length || ''; r.time.textContent = res ? ms(res.ms) : ''; lamps(r.cv, ch);
    }
    function summary() {
      const o = store.out, n = store.results.size, c = { p: 0, f: 0, l: 0 }; for (const r of store.results.values()) { c.p += r.passed; c.f += r.failed; c.l += r.limits; }
      const mc = store.results.get('monte-carlo')?.summary, st = (v, l, cls = '') => h('div', { class: 'stat live ' + cls }, h('b', null, v), h('span', null, l));
      sum.replaceChildren(h('div.status-sumrow', null, st(n + ' / ' + SUITE.length, 'tests finished'), st(c.p.toLocaleString('en'), 'checks passed'), st(String(c.f), 'failed', c.f ? 'bad' : ''), st(String(c.l), 'known limits, measured'), st(o ? ms(o.ms) : '…', o ? 'on ' + o.workers + ' workers' : 'running'),
        mc ? h('div.status-mc', null, h('h4', null, '200 missions, random windows'), ...Object.entries(mc.people).map(([id, p]) => h('div', null, h('span', null, { P1: 'Moving', P2: 'Still', P3: 'Outdoors' }[id]), h('i', { role: 'img', 'aria-label': p.confirmed + ' confirmed by sensors, ' + p.flagged + ' flagged for the team, ' + p.missed + ' missed' }, h('u.c', { style: { width: p.confirmed / 2 + '%' } }), h('u.f', { style: { width: p.flagged / 2 + '%' } }), h('u.m', { style: { width: p.missed / 2 + '%' } })), h('span.num', null, p.confirmed + ' / ' + p.flagged + ' / ' + p.missed))), h('small', null, 'confirmed / flagged for the team / missed. False: ' + mc.falseConfirmed + '. Empty visits: ' + mc.wastedVisits + '.')) : h('div.status-mc', null, h('h4', null, '200 missions, random windows'), h('small', null, 'Running'))),
        store.error ? h('div.note.danger', null, icon('alert'), h('span', null, 'The tests could not run: ' + store.error)) : null);
      md.disabled = js.disabled = !o; again.lastChild.textContent = store.busy ? 'Start over' : 'Run all again';
    }
    let pc = null;
    function evidence() {
      const t = SUITE.find((x) => x.id === sel), res = store.results.get(sel), ch = (store.checks.get(sel) || []).flat(), bad = ch.filter((c) => c[0] === 2), lim = ch.filter((c) => c[0] === 3);
      evHead.replaceChildren(h('div.row.between', null, h('h2', null, t.title), res ? h('span', { class: 'tag ' + (res.state === 'fail' ? 'tag-danger' : res.state === 'limit' ? 'tag-warn' : 'tag-ok') }, res.state === 'fail' ? 'Fail' : res.state === 'limit' ? 'Pass, known limits' : 'Pass') : h('span.tag.plain', null, 'Waiting')),
        h('dl.status-ehl', null, h('dt', null, 'Should'), h('dd', null, t.expect), h('dt', null, 'Did'), h('dd', null, res ? res.got : 'Not finished yet')));
      const paths = ch.filter((c) => c[3]?.path), par = sel === 'nn-parity' && ch.length; plan.parentElement.hidden = !(paths.length || par);
      if (filter === 'fail' && !bad.length) filter = 'all'; if (filter === 'limit' && !lim.length) filter = 'all';
      chips.replaceChildren(...[['all', 'All', ch.length], ['fail', 'Failed', bad.length], ['limit', 'Known limits', lim.length]].map(([id, l, n]) => h('button.chip', { 'aria-pressed': String(filter === id), disabled: id !== 'all' && !n, onclick: () => { filter = id; evidence(); } }, l, h('span.badge-count', null, String(n)))));
      const show = filter === 'fail' ? bad : filter === 'limit' ? lim : [...bad, ...lim, ...ch.filter((c) => c[0] === 1)]; let hot = -1;
      list.replaceChildren(...show.slice(0, 300).map((c) => h('li', { class: 's' + c[0], onmouseenter: c[3]?.path || c[3]?.js != null ? () => { hover = c; paintPlan(); } : null }, h('i', { title: { 1: 'Pass', 2: 'Fail', 3: 'Known limit' }[c[0]] }), h('span', null, c[1]), h('span.num', null, c[2]))), show.length > 300 ? h('li.more', null, 'and ' + (show.length - 300) + ' more in the JSON') : '');
      hover = null; paintPlan();
    }
    let hover = null;
    function paintPlan() {
      if (!pc || plan.parentElement.hidden) return; const r = plan.getBoundingClientRect(), w = r.width, hh = r.height, ch = (store.checks.get(sel) || []).flat(); if (!w) return;
      if (sel === 'nn-parity') {
        const c = pc, L = 46, B = 34, T = 14, Rt = 14, X = (v) => L + v * (w - L - Rt), Y = (v) => hh - B - v * (hh - B - T); c.clearRect(0, 0, w, hh); c.font = '500 11px ' + cssVar('--mono'); c.strokeStyle = cssVar('--line'); c.fillStyle = cssVar('--text-3'); c.lineWidth = 1;
        for (const v of [0, 0.25, 0.5, 0.75, 1]) { c.beginPath(); c.moveTo(X(v), Y(0)); c.lineTo(X(v), Y(1)); c.moveTo(X(0), Y(v)); c.lineTo(X(1), Y(v)); c.stroke(); c.textAlign = 'center'; c.fillText(v, X(v), hh - B + 14); c.textAlign = 'right'; c.fillText(v, L - 7, Y(v) + 4); }
        c.fillStyle = cssVar('--text-2'); c.font = '500 11px ' + cssVar('--font'); c.textAlign = 'center'; c.fillText('Python output', X(0.5), hh - 4); c.save(); c.translate(11, Y(0.5)); c.rotate(-Math.PI / 2); c.fillText('this browser', 0, 0); c.restore(); c.strokeStyle = cssVar('--line-3'); c.beginPath(); c.moveTo(X(0), Y(0)); c.lineTo(X(1), Y(1)); c.stroke();
        for (const k of ch) if (k[3]) { c.beginPath(); c.arc(X(k[3].py), Y(k[3].js), k === hover ? 6 : 3.5, 0, 7); c.fillStyle = k[0] === 1 ? cssVar('--ok') : cssVar('--danger'); c.fill(); if (k === hover) { c.strokeStyle = cssVar('--text'); c.lineWidth = 1.5; c.stroke(); } }
      } else { const ps = ch.filter((c) => c[3]?.path), k = hover?.[3]?.path ? hover : ps.find((c) => c[0] === 2) || ps[ps.length - 1]; drawPlan(pc, w, hh, { world: ctx.world, css: cssVar, view: [-2, -2, 122, 92], path: k?.[3].path }); if (k) { pc.fillStyle = cssVar('--text-2'); pc.font = '500 11px ' + cssVar('--font'); pc.textAlign = 'left'; pc.fillText(k[1] + (k[2] ? '  ' + k[2] : ''), 8, 15); } }
    }
    const pickRow = () => { for (const [id, r] of rows) { r.b.classList.toggle('sel', id === sel); r.b.setAttribute('aria-current', String(id === sel)); } };
    ev.append(evHead, h('div.status-evpic', null, plan), h('div.status-evbar', null, h('h4', null, 'Checks'), chips), list);
    const el2 = h('div.status-tests', null, h('section.panel', { 'aria-label': 'Results' }, h('header.panel-head', null, h('h3', null, 'Results'), page, md, js, again), sum, colHead, tbody), h('section.panel.status-evpanel', { 'aria-label': 'Evidence' }, ev));
    let t0 = 0; const on = (m) => { if (m.type === 'reset') { for (const id of rows.keys()) paintRow(id); summary(); evidence(); return; } if (m.id) { const now = performance.now(), r = rows.get(m.id); if (m.type === 'checks') { if (now - r.p < 120) return; r.p = now; } paintRow(m.id); if (m.type === 'end') { summary(); if (m.id === sel) evidence(); } } if (m.type === 'done' || m.type === 'error') { for (const id of rows.keys()) paintRow(id); summary(); evidence(); } };
    return { el: el2, show() { for (const id of rows.keys()) paintRow(id); summary(); evidence(); return [subscribe(on), fitCanvas(plan, (c) => { pc = c; paintPlan(); }), ctx.bus.on('prefs', () => { for (const id of rows.keys()) paintRow(id); paintPlan(); })]; }, select(id) { sel = id; filter = 'all'; evidence(); pickRow(); rows.get(id)?.b.scrollIntoView({ block: 'center' }); } };
  };

  // ---------- drills ----------
  pages.drills = () => { const d = createDrillPanel(ctx); return { el: d.el, show() { d.show(); return [() => d.hide()]; } }; };

  // ---------- ledger ----------
  pages.real = () => {
    let kinds = new Set(), q = ''; const rowsEl = h('div.status-ledger', { role: 'list', tabindex: '0', 'aria-label': 'Capabilities' }), count = h('span.caption'), chips = h('div.row.wrap'), inp = h('input.input', { type: 'search', placeholder: 'Find a feature', 'aria-label': 'Find a feature', oninput: (e) => { q = e.target.value.toLowerCase(); draw(); } });
    const titleOf = (id) => ctx.manifest.find((m) => m.id === id)?.title;
    function draw() {
      const list = ALL.filter((r) => (!kinds.size || kinds.has(r.built === 'missing' ? 'missing' : r.kind)) && (!q || (r.name + ' ' + r.group + ' ' + r.real + ' ' + r.sim + ' ' + r.proof).toLowerCase().includes(q)));
      const miss = ALL.filter((r) => r.built === 'missing').length; count.textContent = list.length + ' of ' + ALL.length + (miss ? ', ' + miss + ' not built' : '');
      const n = (k) => ALL.filter((r) => (k === 'missing' ? r.built === 'missing' : r.kind === k && r.built !== 'missing')).length;
      chips.replaceChildren(...[...Object.keys(REALITY), 'missing'].filter(n).map((k) => h('button.chip', { 'aria-pressed': String(kinds.has(k)), title: REALITY[k]?.means || 'The code for it was not found.', onclick: () => { kinds.has(k) ? kinds.delete(k) : kinds.add(k); draw(); } }, REALITY[k]?.label || 'Not built', h('span.badge-count', null, String(n(k))))));
      let g = null; const out = []; for (const r of list) { if (r.group !== g) { g = r.group; out.push(h('div.status-ghead', { role: 'presentation' }, h('h3', null, g))); } const there = r.built !== 'missing'; out.push(h('div', { class: 'status-lrow ' + (r.built || ''), role: 'listitem' }, h('b', null, r.name), there ? realityTag(r.kind) : h('span.tag.plain', null, 'Not built'), there && r.ws && titleOf(r.ws) ? h('a', { href: '#/' + r.ws }, titleOf(r.ws)) : h('span.dim', null, there ? 'Everywhere' : 'None'), h('span', null, there ? r.real : 'Planned. The code was not found, so it is not claimed.'), h('span.muted', null, there ? r.sim || 'Nothing.' : ''), h('span.muted', null, there ? r.proof || (r.built === 'unknown' ? 'Could not look (no network)' : 'Code found: ' + r.file.replace('workspaces/', '')) : 'Looked for: ' + r.file.replace('workspaces/', '')))); }
      rowsEl.replaceChildren(...(out.length ? out : [h('div.empty', null, h('p', null, 'Nothing matches. Clear the search or the labels.'))]));
    }
    const el2 = h('div.status-realview', null,
      h('section.panel', { 'aria-label': 'Capabilities' }, h('header.panel-head', null, h('h3', null, 'Every capability'), count, inp), h('div.status-chips', null, chips), h('div.status-lrow.head', { 'aria-hidden': 'true' }, ...['Capability', 'Label', 'Where', 'What is real', 'What is simulated or assumed', 'Proof'].map((x) => h('span', null, x))), rowsEl),
      h('div.status-col', null, panel('Every assumed number', { flush: true }, h('div.status-scroll', { tabindex: '0', role: 'group', 'aria-label': 'Assumed numbers' }, h('table.table', null, h('tbody', null, ...ASSUMED.map(([a, b, c]) => h('tr', null, h('td', null, a), h('td', null, b), h('td', { class: /measured/.test(c) ? 'c-ok' : 'c-warn' }, c))))))),
        panel('The Wi-Fi network, from its test report', { flush: true, tag: h('span.tag.tag-sim', null, 'Simulated people') }, h('div.status-scroll', { tabindex: '0', role: 'group', 'aria-label': 'Facts about the network' }, h('table.table', null, h('tbody', null, ...NETFACTS.map(([a, b]) => h('tr', null, h('td', null, a), h('td', null, b)))))))));
    return { el: el2, show() { draw(); checkBuilt().then(draw); return []; } };
  };

  // ---------- accessibility ----------
  pages.access = () => {
    const seg = (label, key, opts, note) => { const g = h('div.seg', { role: 'group', 'aria-label': label }, ...opts.map(([v, t]) => h('button', { 'data-v': String(v), onclick: () => ctx.setPref(key, v) }, t))); g.paint = () => { for (const b of g.children) b.setAttribute('aria-pressed', String(String(ctx.prefs[key] ?? opts[0][0]) === b.dataset.v)); }; segs.push(g); return h('div.status-pref', null, h('div', null, h('b', null, label), h('span', null, note)), g); }, segs = [];
    const prefs = [seg('Contrast', 'contrast', [['normal', 'Normal'], ['high', 'High']], 'Stronger text, borders and focus rings.'), seg('Colours', 'palette', [['default', 'Standard'], ['cb', 'Colour-blind safe']], 'No pair of colours that depends on telling red from green.'), seg('Motion', 'motion', [['auto', 'Follow system'], ['reduce', 'Reduced']], 'Stops every animation and film. Pictures stay.'), seg('Text size', 'text', TEXT_SIZES, 'Scales the whole console, not only the words.')];
    const bar = h('i'), prog = h('div.bar', null, bar), state = h('p.caption', { role: 'status' }, 'Opens each workspace by itself, off screen, and looks for controls and images without a name and for text that is too faint. About three minutes.'), tb = h('div.status-auditrows', { tabindex: '0', role: 'group', 'aria-label': 'Findings' }); let stop = false, busy = false, results = [];
    const runB = h('button.btn.btn-primary', { onclick: async () => {
      if (busy) { stop = true; return; } busy = true; stop = false; results = []; tb.replaceChildren(); runB.textContent = 'Stop'; copyB.disabled = true;
      const list = ctx.manifest; state.textContent = 'Opening ' + list[0].title;
      await auditAll(list, { stopped: () => stop, onResult(r, all) { results = all; bar.style.width = (all.length / list.length) * 100 + '%'; state.textContent = all.length + ' of ' + list.length + ' checked' + (all.length < list.length ? '. Opening ' + list[all.length].title : ''); tb.append(row(r)); } });
      busy = false; runB.textContent = 'Check every workspace'; copyB.disabled = !results.length; const s = (k) => results.reduce((a, r) => a + (r[k]?.length || 0), 0); state.textContent = results.length + ' workspaces checked: ' + s('unnamed') + ' controls and ' + s('images') + ' images without a name, ' + s('contrast') + ' faint texts.';
    } }, 'Check every workspace'), copyB = h('button.btn', { disabled: true, onclick: async () => { try { await navigator.clipboard.writeText(JSON.stringify(results, null, 2)); ctx.shell.toast('Findings copied', { level: 'ok' }); } catch { ctx.shell.toast('The browser did not allow copying', { level: 'warn' }); } } }, icon('copy'), 'Copy findings');
    const row = (r) => { const n = (r.unnamed?.length || 0) + (r.images?.length || 0) + (r.contrast?.length || 0), det = [...(r.unnamed || []).map((x) => 'No name: ' + x), ...(r.images || []).map((x) => 'Image without a name: ' + x), ...(r.contrast || []).map((x) => 'Faint: ' + x)]; return h('details', null, h('summary', null, h('b', null, r.title), r.error ? h('span.c-warn', null, r.error) : h('span', { class: n ? 'c-warn' : 'c-ok' }, n ? n + ' to look at' : 'Nothing found'), h('span.num', null, r.checked ? r.checked + ' checked, ' + r.unjudged + ' over pictures' : '')), h('ul', null, ...(det.length ? det.slice(0, 40).map((d) => h('li', null, d)) : [h('li', null, r.error ? 'Not checked.' : 'Every control and image has a name and every text that could be judged is at least 4.5 to 1.')]))); };
    const paint = () => segs.forEach((s) => s.paint());
    const el2 = h('div.status-accview', null, h('div.status-col', null, panel('How it looks and moves', { flush: true }, ...prefs), panel('Keyboard', { actions: [h('button.btn.btn-sm', { onclick: openSheet }, 'Open the sheet ', h('kbd', null, '?'))], flush: true }, h('div.status-keys', null, ...SHORTCUTS.flatMap(([g, l]) => [h('h4', null, g), ...l.map(([k, t]) => h('div', null, h('kbd', null, k), h('span', null, t)))])))),
      panel('Automated check', { actions: [copyB, runB], flush: true }, h('div.status-audit', null, state, prog), tb),
      panel('What a screen reader hears', { flush: true }, h('div.status-prose', null, h('p', null, 'A person found, a fault, an all stop and a second slide are spoken at once. Leads, routes, rejected windows and arrivals wait for a pause. The name and purpose of a workspace are spoken when it opens.'), h('p', null, 'Every dialog keeps Tab inside it, hides the page behind it and gives focus back when it closes. The first Tab on any page skips to the workspace.'), h('p', null, 'An automated check finds missing names and faint text. It cannot say whether the console is pleasant to use without sight or without a mouse: no one who relies on that has tried it yet.'))));
    return { el: el2, show() { paint(); return [ctx.bus.on('prefs', paint), () => { stop = true; }]; } };
  };

  // ---------- device and offline ----------
  pages.device = () => {
    const tb = h('div.status-devrows'), oState = h('div.status-off'), save = h('button.btn.btn-primary', { onclick: async () => { save.disabled = true; await offline.saveAll(); } }, icon('download'), 'Save every workspace for offline'), bar = h('i');
    const WORDS = { starting: ['Starting', 'Looking at what this browser can do.'], unsupported: ['Not available', 'This browser has no service worker, so a network is needed to open the console.'], local: ['Off on this computer', 'On a local address nothing is kept, so a developer always sees the newest file. Add ?sw=1 to the address to try it.'], online: ['On, filling up', 'Files are kept as they load.'], ready: ['Ready to work offline', 'The console opens with no network. Files are always fetched fresh first; the kept copy is used only when the network fails.'], error: ['Could not start', 'The browser refused the offline copy.'] };
    const paintO = (s) => { const [a, b] = WORDS[s.state] || WORDS.starting; oState.replaceChildren(h('div.row', null, h('b', null, a), h('span', { class: 'status ' + (s.state === 'ready' ? 'ok' : s.state === 'error' ? 'danger' : s.state === 'online' ? 'accent' : 'off') }, s.online ? 'Network on' : 'No network')), h('p', null, b + (s.message ? ' ' + s.message + '.' : '')), s.files ? h('p.num', null, s.files + ' files kept, version ' + s.version) : null, s.total && s.done < s.total ? h('p.num', null, 'Saving ' + s.done + ' of ' + s.total) : null, s.failed && s.done >= s.total ? h('p.caption', null, s.failed + ' of ' + s.total + ' addresses could not be saved and will need the network.') : null); bar.style.width = s.total ? (s.done / s.total) * 100 + '%' : '0'; save.disabled = !['online', 'ready'].includes(s.state) || (s.total > 0 && s.done < s.total); };
    const el2 = h('div.status-devview', null, panel('What this computer offers', { flush: true, tag: realityTag('device') }, h('div.status-dev.head', { 'aria-hidden': 'true' }, ...['', 'Feature', 'Here', 'What uses it', 'Without it'].map((x) => h('span', null, x))), tb),
      h('div.status-col', null, panel('Offline', { flush: true, tag: realityTag('device') }, h('div.status-offbox', null, oState, h('div.bar', null, bar), h('div.row', null, save), h('p.caption', null, 'Language and vision models, satellite tiles and the earthquake feed come from elsewhere. The models keep their own copy after first use; the feed says when it is showing a saved one.')))));
    return { el: el2, show() { paintO(offline.state); deviceReport().then((l) => tb.replaceChildren(...l.map((d) => h('div', { class: 'status-dev ' + d.state }, icon(d.state === 'yes' ? 'check-circle' : d.state === 'ask' ? 'help' : 'x-circle', 15), h('b', null, d.name), h('span', null, d.value), h('span.muted', null, d.uses), h('span.muted', null, d.without))))); return [offline.on(paintO)]; } };
  };

  const built = {};
  function mountTab() { offs.forEach((f) => f?.()); offs = []; for (const b of tabs.children) { const on = b.id === 'status-tab-' + tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; } const p = (built[tab] ||= pages[tab]()); body.replaceChildren(p.el); if (shown) offs = p.show() || []; }
  function open(id, test) { tab = TABS.some(([x]) => x === id) ? id : 'tests'; mountTab(); if (test && tab === 'tests') requestAnimationFrame(() => built.tests.select(test)); }
  mountTab();
  return { el, open, show() { if (shown) return; shown = true; mountTab(); }, hide() { if (!shown) return; shown = false; offs.forEach((f) => f?.()); offs = []; } };
}
