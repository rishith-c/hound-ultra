// The conversation view: a transcript where every request shows its whole path (who interpreted it, the call, the
// checks, the facts, the answer). Used twice: full size in the Copilot workspace and compact in the side drawer.
import { makeRenderers } from './render.js';
import { nextAction, formatCall, toolByName } from './tools.js';

const EXAMPLES = [
  ['Ask', 'info', ['What is the status?', 'Why is the lead in room 103 only possible?', 'Which rooms have not been searched?']],
  ['Act', 'bolt', ['Take a second look at the possible lead', 'Plan a route, the mud is fine to cross', 'Stop everything']],
  ['See', 'eye', ['Show me the rover', 'Jump to when the first person was found', 'Make the walls see-through']],
];
const VIA = { voice: 'spoken', chip: 'suggestion', button: 'button', palette: 'palette' };

export function createChatView(ctx, session, { compact = false, onEngine } = {}) {
  const { h, icon, fmt, realityTag } = ctx.kit;
  const R = makeRenderers(ctx, { run: (call, label) => session.runCall(call, { label }) });
  const recs = new Map();
  let recall = -1;

  const log = h('div.cop-log', { role: 'log', 'aria-live': 'polite', 'aria-label': 'Copilot conversation', tabindex: '0' });
  const chips = h('div.cop-chips', { role: 'group', 'aria-label': 'Suggested requests' });
  const input = h('input.input.cop-input', { type: 'text', 'aria-label': 'Ask or command in plain words', placeholder: 'Ask or command in plain words…', autocomplete: 'off', spellcheck: false, maxlength: 400 });
  const send = h('button.btn.btn-primary.btn-icon', { type: 'submit', 'aria-label': 'Send' }, icon('send'));
  const mic = h('button.btn.btn-icon.cop-mic', { type: 'button', 'aria-label': 'Hold to talk', title: 'Hold to talk' }, icon('mic'));
  const hear = h('div.cop-hear', { 'aria-live': 'polite' });
  const engine = h('div.cop-engine-line');
  const form = h('form.cop-compose', { onsubmit: (e) => { e.preventDefault(); const t = input.value; if (!t.trim() || session.busy) return; input.value = ''; recall = -1; session.ask(t); } }, mic, input, send);
  const el = h('div.cop-chat' + (compact ? '.compact' : ''), null, log, hear, chips, form, engine);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); form.requestSubmit(); return; }
    if (e.key === 'ArrowUp' && (!input.value || recall >= 0) && session.typed.length) { e.preventDefault(); recall = Math.min(session.typed.length - 1, recall + 1); input.value = session.typed[session.typed.length - 1 - recall]; }
    else if (e.key === 'ArrowDown' && recall >= 0) { e.preventDefault(); recall--; input.value = recall >= 0 ? session.typed[session.typed.length - 1 - recall] : ''; }
  });
  const talk = (on) => (e) => { if (e.type.startsWith('key') && e.key !== ' ' && e.key !== 'Enter') return; if (e.type.startsWith('key')) { e.preventDefault(); if (e.repeat) return; } on ? session.startListening() : session.stopListening(); };
  mic.addEventListener('pointerdown', talk(true)); mic.addEventListener('pointerup', talk(false)); mic.addEventListener('pointerleave', () => session.voice.hearing && session.stopListening());
  mic.addEventListener('keydown', talk(true)); mic.addEventListener('keyup', talk(false));

  // ---------- one exchange ----------
  function interpLine(x) {
    const i = x.interp; if (!i) return h('div.cop-line', null, h('span.spinner.sm'), h('span', null, session.live ? session.modelName + ' is reading the request…' : 'Reading the request…'));
    const ms = i.ms == null ? '' : i.ms < 10 ? i.ms.toFixed(1) + ' ms' : i.ms < 1000 ? Math.round(i.ms) + ' ms' : (i.ms / 1000).toFixed(1) + ' s';
    if (i.by === 'model') return h('div.cop-line', null, icon('cpu', 14), h('span', null, h('b', null, i.name), ' on this computer'), h('span.tag.tag-accent', null, 'Live AI'), h('span.num.dim.cop-ms', null, ms));
    if (i.by === 'rules') return h('div.cop-line', null, icon('list', 14), h('span', null, h('b', null, 'Rule-based'), ' (no model loaded) · rule “' + i.rule + '”', i.note ? h('span.c-warn', null, ' · ' + i.note) : null), h('span.num.dim.cop-ms', null, ms));
    return h('div.cop-line', null, icon('chevron', 14), h('span', null, h('b', null, 'Direct'), ' · a button, no interpretation needed'));
  }
  function callLine(x) {
    if (!x.call) return null;
    const args = Object.entries(x.call.args || {});
    return h('div.cop-line.cop-call', null, h('code', null, h('b', null, x.call.tool), ' { ', args.map(([k, v], n) => [h('span.dim', null, k + ': '), Array.isArray(v) ? '[' + v.join(', ') + ']' : JSON.stringify(v), n < args.length - 1 ? ', ' : '']), ' }'),
      h('span.cop-checks', null, x.checks.map((c) => h('span.cop-check' + (c.ok ? '.ok' : '.no'), { title: c.note }, icon(c.ok ? 'check' : 'close', 12), c.name))));
  }
  function body(x) {
    const failed = x.checks.find((c) => !c.ok);
    return [
      h('div.cop-trace', null, interpLine(x), callLine(x),
        x.status === 'confirming' ? h('div.cop-line', null, h('span.spinner.sm'), h('span', null, 'Waiting for your decision in the dialog. Nothing runs until you confirm.')) : null,
        failed && x.status !== 'held' ? h('div.cop-line.cop-why', null, icon(failed.unsafe ? 'hazard' : 'info', 14), h('span', null, failed.note)) : null),
      R.result(x),
    ];
  }
  function answer(x) {
    const a = x.answer; if (!a) return null;
    const lines = String(a.text || '').split('\n');
    const w = x.wording;
    const wording = !w ? null : h('div.cop-wording' + (w.rejected ? '.rejected' : ''), null,
      h('div.row', null, h('span.tag.tag-accent', null, 'Live AI'), h('span.cop-foot', null, w.pending ? [h('span.spinner.sm'), ' ' + w.name + ' is re-wording the facts…'] : 'In the words of ' + w.name + ', on this computer')),
      w.rejected ? null : h('p', null, w.text),
      w.pending ? null : h('p.cop-foot', null, w.rejected ? (w.grounding?.unknown.length ? 'Thrown away: it wrote ' + w.grounding.unknown.map((u) => '“' + u + '”').join(', ') + ', which is not in the tool result.' : 'Thrown away: it came back empty.') : (w.grounding.checked ? 'Its ' + w.grounding.checked + ' numbers and ids match the tool result. ' : '') + 'A small model can still misread a fact; the text above and the panel are the record.'));
    return h('div.cop-answer.' + x.status, null, x.call?.tool === 'write_sitrep' && a.by === 'tool' ? h('p', null, 'Situation report at ' + (x.result?.facts?.as_of || '') + ', written from the mission state. Check any line against the facts.') : lines.map((l) => h('p', null, l)),
      x.held ? h('div.row', null, h('button.btn.btn-sm', { onclick: () => session.runHeld(x.id) }, 'Run it anyway: ' + formatCall(x.call))) : null,
      wording, x.follow?.length && (x.status === 'done' || x.status === 'none') ? h('div.cop-follow', null, x.follow.map((f) => h('button.chip', { onclick: () => session.runCall(f.call, { label: f.label }) }, f.label))) : null);
  }
  function renderExchange(x) {
    let r = recs.get(x.id);
    if (!r) {
      const head = h('header.cop-x-head', null, h('span.num.cop-t', { title: 'Mission clock when you asked' }, fmt.clock(x.t)), h('p.cop-said', null, x.text), VIA[x.via] ? h('span.cop-via', null, VIA[x.via]) : null);
      r = { el: h('article.cop-x', { 'data-id': x.id }, head, h('div.cop-x-body'), h('div.cop-x-ans')), bodySig: '', ansSig: '' };
      recs.set(x.id, r); log.append(r.el);
    }
    const bodySig = [x.status === 'phrasing' ? 'done' : x.status, x.checks.length, !!x.result, !!x.interp].join('|'), ansSig = [x.status, x.answer?.text, x.wording?.text, x.wording?.pending, x.held].join('|');
    r.el.dataset.status = x.status;
    if (bodySig !== r.bodySig) { r.bodySig = bodySig; r.el.children[1].replaceChildren(...body(x).filter(Boolean)); }
    if (ansSig !== r.ansSig) { r.ansSig = ansSig; const a = answer(x); r.el.children[2].replaceChildren(...(a ? [a] : [])); }
  }
  const empty = h('div.cop-empty', null,
    h('h2', null, 'Ask in plain words.'),
    h('p.muted', null, 'Each request becomes one tool call. You see the call, the checks it passed and the facts it returned before you read the answer.'),
    h('div.cop-examples', null, EXAMPLES.map(([title, ic, list]) => h('div', null, h('h4', null, icon(ic, 14), title), list.map((q) => h('button.list-item', { onclick: () => session.ask(q, { via: 'chip' }) }, q))))),
    h('p.cop-foot', null, 'The route is never approved without your confirmation. A request with “don’t” in it is never run as an action. Mission facts come only from the console’s own state; all of it is a simulated exercise.'));

  function render() {
    const near = log.scrollHeight - log.scrollTop - log.clientHeight < 80, before = recs.size;
    if (!session.exchanges.length) { recs.clear(); log.replaceChildren(empty); } else {
      if (empty.isConnected) empty.remove();
      const ids = new Set(session.exchanges.map((x) => x.id));
      for (const [id, r] of recs) if (!ids.has(id)) { r.el.remove(); recs.delete(id); }
      session.exchanges.forEach(renderExchange);
    }
    if (near || recs.size !== before) log.scrollTop = log.scrollHeight;
    // suggestions
    const S = ctx.sim.state, next = nextAction(ctx), list = [];
    if (next?.call) list.push({ label: next.say.replace(/\.$/, ''), call: next.call, primary: true });
    const lead = [...S.detections].reverse().find((d) => d.status !== 'rejected');
    for (const q of ['What is the status?', lead ? 'Explain ' + lead.id : 'Any leads yet?', 'Which rooms have not been searched?', 'Write a sitrep']) list.push({ label: q, ask: q });
    chips.replaceChildren(...list.slice(0, compact ? 3 : 5).map((c) => h('button.chip' + (c.primary ? '.cop-next' : ''), { disabled: session.busy, onclick: () => (c.call ? session.runCall(c.call, { label: c.label }) : session.ask(c.ask, { via: 'chip' })) }, c.primary ? icon(toolByName(c.call.tool).kind === 'act' ? 'bolt' : 'chevron', 12) : null, c.label)));
    // composer state
    send.disabled = session.busy; mic.style.display = session.voice.listen && session.canListen() ? '' : 'none'; mic.classList.toggle('is-on', session.voice.hearing); mic.setAttribute('aria-pressed', String(session.voice.hearing));
    hear.replaceChildren(...(session.voice.hearing ? [h('span.status.person.live', null, 'Listening'), h('span', null, session.voice.interim || 'Speak now. Release to send.'), session.voice.path === 'cloud' ? h('span.dim', null, 'Audio is going to your browser’s speech service.') : ''] : session.voice.error ? [h('span.c-warn', null, session.voice.error)] : []));
    const e = session.engine;
    engine.replaceChildren(session.live ? realityTag('live-ai') : h('span.tag.tag-ok', { title: 'Patterns and rules written by hand. Real computation, no model.' }, session.label()),
      h('span.cop-engine-name', null, e.status === 'loading' ? 'Loading model: ' + Math.round(e.progress * 100) + ' %' : session.live ? session.label() : ''),
      e.status === 'loading' ? h('div.bar.grow', null, h('i', { style: { width: e.progress * 100 + '%' } })) : h('span.grow'),
      session.live || e.status === 'loading' ? h('span.dim', null, 'Nothing leaves this computer') : h('button.cop-link', { onclick: () => onEngine?.() }, compact ? 'Load a model' : 'Load an on-device model'),
      session.exchanges.length ? h('button.btn.btn-ghost.btn-sm', { onclick: () => session.clear(), 'aria-label': 'Clear the conversation' }, 'Clear') : '');
  }
  const off = session.on(render);
  const offs = [ctx.bus.on('detection', render), ctx.bus.on('route', render), ctx.bus.on('command', render)];
  render();
  return { el, focus: () => input.focus(), setText: (t) => { input.value = t; input.focus(); }, destroy() { off(); offs.forEach((f) => f()); el.remove(); } };
}
