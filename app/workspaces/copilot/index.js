// Copilot workspace: the conversation on the left; on the right, the engine (which model, where it runs), the
// evaluation (measured accuracy of the model and of the rules), the situation report, and the tool catalogue.
import { getSession } from './session.js';
import { createChatView } from './chat.js';
import { makeRenderers } from './render.js';
import { MODELS, WEBLLM_VERSION } from './llm.js';
import { TOOLS, entities, commandState, formatCall } from './tools.js';
import { CATEGORIES } from './evalset.js';
import { testSet, wilson } from './eval.js';
import { s as svg } from './maps.js';

const KIND = { ask: 'Questions (read only)', act: 'Mission actions', view: 'Views and replay', drill: 'Fault drills', none: 'When nothing fits' };
const EG = { get_mission_status: 'what is going on?', list_leads: 'who have we found?', explain_lead: 'why is D4 only possible?', list_rooms_not_searched: 'what did we miss?', plan_route: 'plan a route, mud is fine', approve_route: 'approve the route', investigate: 'second look at D4', all_stop: 'stop everything', resume: 'carry on', start_mission: 'start the mission', set_speed: 'run at 16x', set_clock: 'pause', seek_to: 'jump to 06:30', select: 'show me the rover', open_workspace: 'open the evidence graph', set_layer: 'hide the labels', inject_fault: 'simulate losing the radio link', clear_fault: 'restore the radio link', write_sitrep: 'write a sitrep', none: 'order pizza' };
const pc = (x, d = 0) => (x * 100).toFixed(d) + ' %';
const ms = (x) => (x < 10 ? x.toFixed(1) + ' ms' : x < 1000 ? Math.round(x) + ' ms' : (x / 1000).toFixed(1) + ' s');

export default {
  async mount(root, ctx) {
    const { h, icon, realityTag } = ctx.kit;
    if (!document.getElementById('cop-css')) document.head.append(h('link', { id: 'cop-css', rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href }));
    const session = getSession(ctx), R = makeRenderers(ctx, {});
    let tab = ctx.params?.tab || 'engine', recorded = null, set = [], pick = null, shown = false;
    fetch(new URL('./model-comparison.json', import.meta.url)).then((r) => (r.ok ? r.json() : null)).then((j) => { recorded = j; render(); }).catch(() => {});
    testSet().then((t) => { set = t; render(); });

    const tag = h('div.cop-head-tag');
    const head = h('header.ws-head', null, h('div', null, h('h1', null, 'Copilot'), h('p', null, 'Talk to the console. A language model running on this computer turns your words into one checked tool call; with no model loaded, hand-written rules do the same job.')), tag);
    const chat = createChatView(ctx, session, { onEngine: () => { tab = 'engine'; render(); pane.querySelector('.cop-load')?.focus(); } });
    const TABS = [['engine', 'Engine'], ['eval', 'Evaluation'], ['sitrep', 'Situation report'], ['tools', 'Tools']];
    const tabs = h('div.tabs', { role: 'tablist', 'aria-label': 'Copilot panels' }, TABS.map(([id, label]) => h('button', { role: 'tab', id: 'cop-tab-' + id, 'aria-controls': 'cop-pane', onclick: () => { tab = id; render(); if (id === 'eval' && !session.evaluation.rules && !session.evaluation.running) session.runEvaluationRulesOnly?.(); } }, label)));
    const pane = h('div.cop-pane', { id: 'cop-pane', role: 'tabpanel', tabindex: '0' });
    root.append(head, h('div.cop-main', null, h('section.cop-left', { 'aria-label': 'Conversation' }, chat.el), h('aside.cop-side.panel', { 'aria-label': 'Copilot details' }, tabs, pane)));

    // ---------- engine ----------
    function recOf(id) { return recorded?.models.find((m) => m.id === id) || null; }
    function enginePane() {
      const e = session.engine, gpu = e.gpu, m = MODELS.find((x) => x.id === e.modelId), cached = e.cached[e.modelId], isLoaded = session.live && session.engine.modelId === e.modelId;
      const where = h('dl.kv.cop-where', null,
        h('dt', null, 'Graphics processor'), h('dd', null, !gpu ? h('span.dim', null, 'checking…') : gpu.ok ? h('span.status.ok', null, (gpu.vendor ? gpu.vendor.charAt(0).toUpperCase() + gpu.vendor.slice(1) + ' ' : '') + (gpu.arch || '') + ', WebGPU ready') : h('span.status.danger', null, 'WebGPU not available')),
        h('dt', null, 'Runtime'), h('dd', null, 'WebLLM ' + WEBLLM_VERSION + ', in this page'),
        h('dt', null, 'Network during a request'), h('dd', null, 'none'),
        h('dt', null, 'What the model may output'), h('dd', null, 'one call, held to a grammar'));
      const best = recorded ? Math.max(...recorded.models.map((x) => x.eval?.bySet.heldout?.acc || 0)) : 0;
      const table = h('table.table.cop-models', null,
        h('thead', null, h('tr', null, h('th', null, 'Model'), h('th.num', null, 'Download'), h('th.num', null, 'GPU memory'), h('th', { title: 'Share of the 44 held-out requests turned into exactly the right call. Recorded on the development laptop.' }, 'Held-out accuracy'), h('th.num', { title: 'Median time to turn one request into a call. Recorded on the development laptop.' }, 'Per request'))),
        h('tbody', null, MODELS.map((x) => { const r = recOf(x.id), acc = r?.eval?.bySet.heldout?.acc; return h('tr', { 'aria-selected': String(x.id === e.modelId), tabindex: '0', role: 'radio', 'aria-checked': String(x.id === e.modelId), onclick: () => session.chooseModel(x.id), onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); session.chooseModel(x.id); } } },
          h('td', null, h('b', null, x.name), session.live && session.modelName === x.name ? h('span.tag.tag-accent', null, 'Loaded') : e.cached[x.id] ? h('span.tag.plain', null, 'In cache') : null, h('span.cop-model-by', null, x.by + ' · ' + x.params + ' parameters')),
          h('td.num', null, x.downloadMB + ' MB'), h('td.num', null, (x.gpuMB / 1000).toFixed(1) + ' GB'),
          h('td', null, acc == null ? h('span.dim', null, 'not recorded') : h('span.cop-acc', null, h('span.cop-track', null, h('i' + (acc === best ? '.accent' : '.off'), { style: { width: acc * 100 + '%' } })), h('span.num', null, pc(acc)))),
          h('td.num', null, r?.eval ? ms(r.eval.medianMs) : '')); })));
      let action;
      if (!gpu) action = h('p.dim', null, 'Checking this computer…');
      else if (!gpu.ok) action = h('div.note.warn', null, icon('alert'), h('span', null, h('b', null, 'No on-device model on this computer. '), gpu.reason + ' The rule-based interpreter needs none of this and is answering now.'));
      else if (e.status === 'loading') action = h('div.cop-loading', null, h('div.row', null, h('b', null, 'Loading ' + m.name), h('span.grow'), h('span.num', null, Math.round(e.progress * 100) + ' %')), h('div.bar.lg', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(e.progress * 100), 'aria-label': 'Model loading' }, h('i', { style: { width: e.progress * 100 + '%' } })), h('p.cop-foot', null, e.text || 'Starting…'));
      else action = h('div.col', null,
        h('div.row.wrap', null,
          isLoaded ? h('button.btn', { onclick: () => session.unloadModel() }, 'Unload ' + m.name) : h('button.btn.cop-load', { onclick: () => session.loadModel(e.modelId) }, icon(cached ? 'cpu' : 'download'), cached ? 'Load ' + m.name + ' from this browser’s cache' : 'Download and load ' + m.name + ' · ' + m.downloadMB + ' MB'),
          cached && !isLoaded ? h('button.btn.btn-ghost', { onclick: async () => { if (await ctx.shell.confirm({ title: 'Remove ' + m.name + ' from this browser?', body: 'The ' + m.downloadMB + ' MB of weights are deleted from the cache. You can download them again.', confirmLabel: 'Remove', danger: true })) session.forgetModel(e.modelId); } }, 'Remove from cache') : null),
        e.status === 'error' ? h('div.note.warn', null, icon('alert'), h('span', null, e.error)) : null,
        h('p.cop-foot', null, isLoaded ? 'Loaded in ' + e.loadSeconds.toFixed(1) + ' s. Requests and answers are computed on this computer’s graphics processor; nothing is sent anywhere.' : cached ? 'The weights are already in this browser. Loading makes no download.' : 'One download from a public model host, then kept in this browser’s cache. After that the copilot works with the network unplugged.'));
      return [
        h('h3', null, 'Where it runs'), where,
        h('h3', null, 'Model'), h('p.cop-foot', null, 'Loaded only when you ask. Pick one; the figures on the right were recorded on the development laptop' + (recorded ? ' (' + recorded.device + ')' : '') + '.'), table, action,
        recorded ? sizeChart() : null,
        h('h3', null, 'Voice'), voicePane(),
      ];
    }
    function sizeChart() {
      const W = 440, H = 190, L = 40, Rm = 14, T = 16, B = 34, pts = recorded.models.filter((m) => m.eval).map((m) => ({ name: m.name, x: MODELS.find((x) => x.id === m.id).downloadMB, y: m.eval.bySet.heldout.acc, ci: m.eval.bySet.heldout.ci }));
      const xm = 1000, fx = (x) => L + (x / xm) * (W - L - Rm), fy = (y) => T + (1 - y) * (H - T - B), ry = recorded.rules.bySet.heldout.acc;
      const best = pts.reduce((a, b) => (b.y > a.y ? b : a), pts[0]);
      const g = svg('svg', { class: 'cop-chart chart', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Held-out accuracy against download size: ' + pts.map((p) => p.name + ' ' + pc(p.y)).join(', ') + '; rule-based ' + pc(ry) });
      for (const t of [0, 0.25, 0.5, 0.75, 1]) g.append(svg('line', { x1: L, x2: W - Rm, y1: fy(t), y2: fy(t), class: 'gridline' }), svg('text', { x: L - 6, y: fy(t) + 3.5, 'text-anchor': 'end' }, t * 100 + ' %'));
      for (const t of [0, 250, 500, 750, 1000]) g.append(svg('text', { x: fx(t), y: H - B + 14, 'text-anchor': 'middle' }, t));
      g.append(svg('text', { x: (L + W - Rm) / 2, y: H - 4, 'text-anchor': 'middle', class: 'axis-title' }, 'Download size, MB'));
      g.append(svg('line', { x1: L, x2: W - Rm, y1: fy(ry), y2: fy(ry), class: 'cop-chart-rules' }), svg('text', { x: W - Rm, y: fy(ry) - 5, 'text-anchor': 'end', class: 'series-label' }, 'Rules, no download: ' + pc(ry)));
      for (const p of pts) g.append(svg('line', { x1: fx(p.x), x2: fx(p.x), y1: fy(p.ci[0]), y2: fy(p.ci[1]), class: 'cop-chart-ci' }), svg('circle', { cx: fx(p.x), cy: fy(p.y), r: 4.5, class: 'cop-chart-dot' + (p === best ? ' best' : '') }), svg('text', { x: fx(p.x) + (p.x > 800 ? -8 : 8), y: fy(p.y) + (p.y > 0.85 ? 14 : -7), 'text-anchor': p.x > 800 ? 'end' : 'start', class: 'series-label' }, p.name + ' ' + pc(p.y)));
      const beats = pts.filter((p) => p.y > ry).length;
      return h('figure.cop-fig', null, h('figcaption', null, h('b.chart-title', null, beats === 0 ? 'On these requests no small model beats the hand-written rules' : beats === pts.length ? 'Every model beats the rules on unseen phrasing; more parameters buy more accuracy' : 'Only the larger models beat the hand-written rules on unseen phrasing'), h('span.chart-note', null, 'Exact-call accuracy on the 44 held-out requests against download size. Bars are 95 % intervals (44 items is a small test). Recorded ' + recorded.recorded + '.')), g);
    }
    function voicePane() {
      const v = session.voice, canL = session.canListen(), canS = session.canSpeak();
      return h('div.col', null,
        h('label.check.switch', null, h('input', { type: 'checkbox', checked: v.listen && canL, disabled: !canL, onchange: (e) => session.setVoice('listen', e.target.checked) }), h('span', null, 'Push to talk'), h('span.tag.tag-ok', null, 'Your device')),
        h('p.cop-foot', null, !canL ? 'This browser has no speech recognition. Typing works everywhere.' : v.path === 'device' ? 'Hold the microphone button and speak. This browser recognises speech on the device.' : 'Hold the microphone button and speak. Be aware: this browser sends the audio to its maker’s speech service to turn it into text, so it needs the internet and the audio leaves this computer. The text is then handled here. Off by default for that reason.'),
        h('label.check.switch', null, h('input', { type: 'checkbox', checked: v.speak && canS, disabled: !canS, onchange: (e) => session.setVoice('speak', e.target.checked) }), h('span', null, 'Speak replies'), h('span.tag.tag-ok', null, 'Your device')),
        h('p.cop-foot', null, canS ? 'Answers are read aloud by this computer’s own speech synthesiser.' : 'This browser has no speech synthesis.'));
    }

    // ---------- evaluation ----------
    function evalPane() {
      const ev = session.evaluation, live = ev.rules, modelLive = ev.model;
      const core = set.filter((x) => x.set === 'core').length, held = set.filter((x) => x.set === 'heldout').length;
      const recModel = recorded ? recorded.models.find((m) => m.id === session.engine.modelId && m.eval) || recorded.models.filter((m) => m.eval).sort((a, b) => b.eval.bySet.heldout.acc - a.eval.bySet.heldout.acc)[0] : null;
      const cols = [
        { key: 'rules', name: 'Rule-based', sub: live ? 'measured just now, this browser' : recorded ? 'recorded ' + recorded.recorded : 'not run yet', sum: live?.summary || recorded?.rules, rows: live ? live.rows.map((r) => (r.exact ? 1 : 0)) : recorded?.rulesRows, detail: live?.rows },
        modelLive ? { key: 'model', name: ev.modelName, sub: 'measured just now, this computer', sum: modelLive.summary, rows: modelLive.rows.map((r) => (r.exact ? 1 : 0)), detail: modelLive.rows, ai: true }
          : recModel ? { key: 'model', name: recModel.name, sub: 'recorded ' + recorded.recorded + ' on the development laptop', sum: recModel.eval, rows: recModel.rows, ai: true, recorded: true } : null,
      ].filter((c) => c && c.sum);
      const big = (c) => { const hs = c.sum.bySet.heldout, cs = c.sum.bySet.core; return h('div.cop-score' + (c.ai ? '.ai' : ''), null,
        h('div.row', null, h('b', null, c.name), c.ai ? h('span.tag.tag-accent', null, 'Live AI') : h('span.tag.tag-ok', null, 'Live algorithm')), h('p.cop-foot', null, c.sub),
        h('div.stat.lg', null, h('b', null, hs ? (hs.acc * 100).toFixed(0) : '–', h('small', null, '%')), h('span', null, hs ? 'held-out requests right (' + hs.exact + ' of ' + hs.n + '; 95 % interval ' + (hs.ci[0] * 100).toFixed(0) + ' to ' + (hs.ci[1] * 100).toFixed(0) + ' %)' : 'held-out set missing')),
        h('dl.kv', null, h('dt', null, 'Development requests'), h('dd.num', null, cs ? cs.exact + ' / ' + cs.n : '–'), h('dt', null, 'Right tool, any arguments'), h('dd.num', null, pc(c.sum.toolAcc)), h('dt', null, 'Median time per request'), h('dd.num', null, ms(c.sum.medianMs)), h('dt', { title: 'An action proposed when the right answer was a question, a view or a refusal' }, 'Wrongly proposed an action'), h('dd.num' + (c.sum.unsafe ? '.c-warn' : ''), null, c.sum.unsafe + ' of ' + c.sum.n))); };
      const strip = (c) => h('div.cop-strip-row', null, h('span.cop-strip-name', null, c.name), h('div.cop-strip', { role: 'group', 'aria-label': c.name + ': one cell per test request' }, (c.rows || []).map((ok, i) => h('button' + (ok ? '.ok' : '.no') + (set[i]?.set === 'heldout' && set[i - 1]?.set !== 'heldout' ? '.gap' : '') + (pick && pick.i === i && pick.key === c.key ? '.on' : ''), { 'aria-label': (set[i]?.text || 'request ' + (i + 1)) + (ok ? ': right' : ': wrong'), title: set[i]?.text || '', onclick: () => { pick = { i, key: c.key }; render(); } }))));
      const cats = Object.keys(CATEGORIES);
      const bars = h('div.cop-cats', null, cats.map((k) => h('div.cop-cat', null, h('span', null, CATEGORIES[k]), h('div', null, cols.map((c) => { const b = c.sum.byCategory[k]; return b ? h('div.cop-cat-bar', { title: c.name + ': ' + b.exact + ' of ' + b.n }, h('span.cop-track', null, h('i.' + (c.ai ? 'accent' : 'ok'), { style: { width: b.acc * 100 + '%' } })), h('span.num', null, b.exact + '/' + b.n)) : null; })))));
      let detail = null;
      if (pick && set[pick.i]) { const it = set[pick.i], c = cols.find((x) => x.key === pick.key), row = c?.detail?.[pick.i], fail = !row && c?.sum.failures?.find((f) => f.text === it.text);
        const got = row ? row.got : fail ? fail.got : c?.rows?.[pick.i] ? { tool: it.tool, args: it.args } : null;
        detail = h('div.cop-pick', null, h('p', null, h('span.tag.plain', null, it.set === 'heldout' ? 'Held-out' : 'Development'), ' “' + it.text + '”'), h('dl.kv', null, h('dt', null, 'Expected'), h('dd', null, h('code', null, formatCall({ tool: it.tool, args: it.args }))), h('dt', null, c.name), h('dd', null, got ? h('code' + (c.rows[pick.i] ? '.c-ok' : '.c-danger'), null, formatCall(got)) : '–'))); }
      const fails = cols.flatMap((c) => (c.sum.failures || []).map((f) => ({ ...f, by: c.name })));
      return [
        h('p', null, (set.length || 96) + ' plain-language requests, each with one correct call. ', h('b', null, core + ' development'), ' requests were written alongside the rules. ', h('b', null, held + ' held-out'), ' requests were written by a separate author (another AI agent) who was given the tool definitions but never saw the rules or the model’s prompt; both were frozen before that file was opened. Nothing is executed during the test.'),
        h('div.row', null, h('button.btn', { disabled: ev.running, onclick: () => session.runEvaluation() }, icon('play'), session.live ? 'Run evaluation: rules and ' + session.modelName : 'Run evaluation'), ev.running ? h('span.row.grow', null, h('span.dim', null, ev.which), h('div.bar.grow', null, h('i', { style: { width: ev.progress * 100 + '%' } })), h('span.num', null, Math.round(ev.progress * 100) + ' %')) : h('span.cop-foot', null, session.live ? 'The model takes a few minutes for all requests.' : 'Load a model in Engine to measure it here; until then its recorded result is shown.')),
        cols.length ? h('div.cop-scores', null, cols.map(big)) : h('div.empty', null, h('p', null, 'No results yet. Run the evaluation.')),
        cols.length ? h('figure.cop-fig', null, h('figcaption', null, h('b.chart-title', null, 'Every request, one cell: where each interpreter is right and wrong'), h('span.chart-note', null, 'Left block: development requests. Right block: held-out. Pick a cell to see the request.')), cols.map(strip), detail) : null,
        cols.length ? h('figure.cop-fig', null, h('figcaption', null, h('b.chart-title', null, 'Accuracy by kind of request'), h('span.chart-note', null, cols.map((c) => c.name).join(' above, ') + (cols.length > 1 ? ' below.' : '.') + ' “Must refuse” are requests the console should decline.')), bars) : null,
        fails.length ? h('figure.cop-fig', null, h('figcaption', null, h('b.chart-title', null, 'Every miss, shown'), h('span.chart-note', null, fails.length + ' wrong calls. None of them would have run unchecked: each call still passes the schema, the mission-state check and, for the route, your confirmation.')),
          h('div.cop-fails', null, h('table.table.dense', null, h('thead', null, h('tr', null, h('th', null, 'Request'), h('th', null, 'Expected'), h('th', null, 'Got'), h('th', null, 'By'))), h('tbody', null, fails.map((f) => h('tr', null, h('td', null, f.text), h('td', null, h('code', null, formatCall(f.expect))), h('td', null, h('code.c-danger', null, formatCall(f.got))), h('td.dim', null, f.by))))))) : null,
        recorded ? groundingBlock() : null,
      ];
    }
    function groundingBlock() {
      const rows = recorded.models.filter((m) => m.phrasing);
      if (!rows.length) return null;
      return h('figure.cop-fig', null, h('figcaption', null, h('b.chart-title', null, 'Why answers are checked: small models misquote numbers'), h('span.chart-note', null, 'Each model was asked to word 8 tool results. An answer passes only if every number and id in it appears in the facts. A failed answer is thrown away and the code-written text is shown instead. Recorded ' + recorded.recorded + '.')),
        h('table.table.dense', null, h('thead', null, h('tr', null, h('th', null, 'Model'), h('th.num', null, 'Answers that passed'), h('th', null, 'Example of a rejected answer'))), h('tbody', null, rows.map((m) => { const bad = m.phrasing.find((p) => !p.grounded); return h('tr', null, h('td', null, m.name), h('td.num', null, m.phrasing.filter((p) => p.grounded).length + ' / ' + m.phrasing.length), h('td.dim', null, bad ? '“' + bad.text.slice(0, 120) + (bad.text.length > 120 ? '…' : '') + '” (not in the facts: ' + bad.unknown.join(', ') + ')' : 'none')); }))));
    }

    // ---------- sitrep ----------
    function sitrepPane() {
      const sr = session.sitrep;
      const top = h('div.row.wrap', null, h('button.btn', { onclick: () => session.writeSitrep(), disabled: sr?.status === 'phrasing' }, icon('report'), sr ? 'Write it again from the current state' : 'Write the situation report'),
        sr ? h('button.btn.btn-ghost', { onclick: async () => { const text = (sr.prose?.text && !sr.prose.rejected ? sr.prose.text + '\n\n' : '') + sr.lines.map(([k, v]) => k + ': ' + v).join('\n'); try { await navigator.clipboard.writeText(text); ctx.shell.toast('Situation report copied.', { level: 'ok', ms: 2200 }); } catch { ctx.shell.toast('Copy was blocked by the browser. Select the text instead.', { level: 'alert' }); } } }, icon('copy'), 'Copy') : null,
        h('span.tag.' + (session.live ? 'tag-accent' : 'tag-ok'), null, session.live ? 'Live AI wording' : 'Live algorithm'));
      if (!sr) return [h('p', null, 'One click gathers the facts from the mission state and writes a short report. The facts are shown beside the text so any line can be checked. With a model loaded it also words the report as a spoken paragraph; the paragraph is rejected if it contains a number that is not in the facts.'), top];
      return [top, h('div.cop-sit', null, h('div', null, h('h4', null, 'Report at ' + sr.at), R.sitrepBlock(sr.facts, sr.prose)), h('div', null, h('h4', null, 'Facts it is built from'), R.factTree(sr.facts)))];
    }

    // ---------- tools ----------
    function toolsPane() {
      const ent = entities(ctx);
      const avail = (t) => { try { const a = t.name === 'plan_route' ? commandState(ctx, 'planRoute') : t.name === 'investigate' ? (ent.leads.some((d) => commandState(ctx, 'investigate', { id: d.id }).ok) ? { ok: true } : { ok: false, reason: ctx.sim.state.phase === 'assess' ? 'No possible lead to check.' : 'Only while checking leads.' }) : ['inject_fault', 'clear_fault', 'explain_lead', 'select', 'seek_to', 'set_layer', 'set_speed', 'set_clock', 'open_workspace'].includes(t.name) ? (t.name === 'explain_lead' && !ent.leads.length ? { ok: false, reason: 'No leads yet.' } : { ok: true }) : t.check({}, ctx); return a; } catch { return { ok: true }; } };
      return [h('p', null, 'These ' + (TOOLS.length - 1) + ' tools are everything the copilot can do. A request that fits none of them is declined. The arguments are rebuilt from the live mission, so an id that is not on the board cannot be called.'),
        Object.keys(KIND).map((k) => [h('h4', null, KIND[k]), h('ul.cop-tools', null, TOOLS.filter((t) => t.kind === k).map((t) => { const a = t.kind === 'none' ? { ok: true } : avail(t), s = t.args(ent), keys = s.properties ? Object.keys(s.properties) : s.anyOf ? ['type', 'id'] : [];
          return h('li', null, h('div', null, h('code', null, h('b', null, t.name), keys.length ? ' { ' + keys.join(', ') + ' }' : ''), t.confirm && t.name === 'approve_route' ? h('span.tag.tag-warn', null, 'Always asks you') : null, h('span.grow'), t.kind === 'none' ? null : a.ok ? h('span.status.ok', null, 'available now') : h('span.status.off', { title: a.reason }, 'not now')),
            h('p', null, t.llm.charAt(0).toUpperCase() + t.llm.slice(1) + '.', a.ok ? null : h('span.c-warn', null, ' ' + a.reason)), h('button.cop-link', { onclick: () => chat.setText(EG[t.name]) }, 'Try: “' + EG[t.name] + '”')); }))])];
    }

    function render() {
      if (!shown) return;
      tag.replaceChildren(session.live ? realityTag('live-ai') : realityTag('live-algo'), h('span.cop-head-name', null, session.label()));
      [...tabs.children].forEach((b, i) => b.setAttribute('aria-selected', String(TABS[i][0] === tab)));
      pane.setAttribute('aria-labelledby', 'cop-tab-' + tab);
      const top = pane.scrollTop, same = pane.dataset.tab === tab;
      const kids = tab === 'engine' ? enginePane() : tab === 'eval' ? evalPane() : tab === 'sitrep' ? sitrepPane() : toolsPane();
      pane.replaceChildren(...kids.flat(3).filter(Boolean)); pane.dataset.tab = tab; pane.scrollTop = same ? top : 0;
    }
    session.on(render);
    session.runEvaluationRulesOnly = async () => { const { runEval, rulesPropose } = await import('./eval.js'); session.evaluation.rules = await runEval(ctx, rulesPropose); render(); };
    const offs = [ctx.bus.on('phase', render), ctx.bus.on('detection', render), ctx.bus.on('route', render), ctx.bus.on('fault', render)];
    return {
      onShow() { shown = true; session.checkDevice(); render(); chat.focus(); },
      onHide() { shown = false; session.stopListening(); },
      onParams(p) { if (p?.tab) { tab = p.tab; render(); } if (p?.ask) session.ask(p.ask, { via: 'palette' }); },
      dispose() { offs.forEach((f) => f()); chat.destroy(); },
    };
  },
};
