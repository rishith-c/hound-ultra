// One copilot conversation for the whole console. The workspace and the side drawer are two views of it.
//
// The path of every request, each step visible in the transcript:
//   words -> interpreter (on-device model, or rules) -> ONE call -> schema check -> "allowed now?" check
//         -> negation guard -> human confirmation (always for approve_route) -> tool runs -> facts
//         -> answer (code-written; a model may re-phrase it, and the re-phrasing is thrown away if it mentions a
//            number or id that is not in the facts).
import * as T from './tools.js';
import { interpret } from './rules.js';
import * as llm from './llm.js';
import * as voice from './voice.js';
import { runEval, rulesPropose } from './eval.js';

const NEGATION = /\b(don'?t|do not|never|not yet|hold off|no need to|shouldn'?t|must not|mustn'?t|cancel that)\b/i;
const store = { get(k, d) { try { const v = localStorage.getItem('hound.copilot.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('hound.copilot.' + k, JSON.stringify(v)); } catch { /* private mode */ } } };

let session = null;
export function getSession(ctx) { return session || (session = create(ctx)); }

function create(ctx) {
  const { h } = ctx.kit;
  const subs = new Set();
  let n = 0, scheduled = false;
  const changed = () => { if (scheduled) return; scheduled = true; queueMicrotask(() => { scheduled = false; for (const f of [...subs]) { try { f(); } catch (e) { console.error('[copilot] view failed', e); } } }); };
  const s = {
    exchanges: [], typed: [], busy: false,
    engine: { status: 'idle', modelId: store.get('model', llm.MODELS[0].id), progress: 0, text: '', error: null, gpu: null, cached: {}, loadSeconds: null },
    voice: { listen: store.get('listen', false), speak: store.get('speak', false), hearing: false, interim: '', path: 'none', error: null },
    reword: store.get('reword', true), sitrep: null, evaluation: { running: false, progress: 0, which: '', rules: null, model: null, modelName: null },
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    get live() { return s.engine.status === 'ready'; },
    get modelName() { return llm.modelById(llm.loadedModel())?.name || null; },
    label() { return s.live ? s.modelName + ', on this computer' : 'Rule-based (no model loaded)'; },
  };

  // ---------- engine ----------
  s.checkDevice = async () => {
    if (s.engine.gpu) return s.engine.gpu;
    s.engine.gpu = await llm.webgpuStatus(); changed();
    if (s.engine.gpu.ok) llm.MODELS.forEach((m) => llm.isCached(m.id).then((c) => { s.engine.cached[m.id] = c; changed(); }));
    s.voice.path = await voice.recognitionPath(); changed();
    return s.engine.gpu;
  };
  s.chooseModel = (id) => { s.engine.modelId = id; store.set('model', id); changed(); };
  s.loadModel = async (id = s.engine.modelId) => {
    const e = s.engine; if (e.status === 'loading') return;
    const gpu = await s.checkDevice();
    if (!gpu.ok) { e.status = 'error'; e.error = gpu.reason; changed(); return; }
    Object.assign(e, { status: 'loading', modelId: id, progress: 0, text: 'Fetching the WebLLM runtime…', error: null }); store.set('model', id); changed();
    try {
      const r = await llm.load(id, (p) => { e.progress = p.progress; e.text = p.text.replace(/ It can take a while.*$/, ''); changed(); });
      Object.assign(e, { status: 'ready', progress: 1, text: '', loadSeconds: r.seconds }); e.cached[id] = true;
      ctx.bus.emit('copilot:engine', { live: true, model: id });
    } catch (err) {
      console.warn('[copilot] model load failed', err);
      Object.assign(e, { status: 'error', error: 'The model did not load: ' + String(err.message || err).slice(0, 220) + ' The rule-based interpreter is still working.' });
    }
    changed();
  };
  s.unloadModel = async () => { await llm.unload(); Object.assign(s.engine, { status: 'idle', progress: 0, text: '' }); ctx.bus.emit('copilot:engine', { live: false }); changed(); };
  s.forgetModel = async (id) => { try { await llm.deleteCached(id); } catch (e) { console.warn(e); } s.engine.cached[id] = false; if (!llm.loadedModel() && s.engine.status === 'ready') s.engine.status = 'idle'; changed(); };

  // ---------- one exchange ----------
  const open = (text, via) => { const x = { id: 'x' + ++n, t: ctx.sim.state.t, text, via, status: 'thinking', interp: null, call: null, checks: [], result: null, answer: null, follow: [], held: false }; s.exchanges.push(x); if (s.exchanges.length > 60) s.exchanges.shift(); changed(); return x; };
  const close = (x, status, text) => { x.status = status; if (text) x.answer = { text, by: 'tool' }; s.busy = false; changed(); if (s.voice.speak && x.answer) voice.speak(x.answer.text); return x; };

  s.ask = async (text, { via = 'typed' } = {}) => {
    text = String(text || '').trim(); if (!text || s.busy) return null;
    s.busy = true; if (via === 'typed' || via === 'voice') { s.typed = s.typed.filter((q) => q !== text); s.typed.push(text); }
    const x = open(text, via), ent = T.entities(ctx);
    if (s.live) {
      try { const r = await llm.route(text, ent); x.interp = { by: 'model', name: s.modelName, ms: r.ms, raw: r.raw, tokens: r.tokens }; x.call = r.call; }
      catch (e) { console.warn('[copilot] model route failed', e); const t0 = performance.now(), r = interpret(text, ent); x.interp = { by: 'rules', rule: r.rule, ms: performance.now() - t0, note: 'The model failed on this request, so the rule-based interpreter answered.' }; x.call = { tool: r.tool, args: r.args }; }
    } else { const t0 = performance.now(), r = interpret(text, ent); x.interp = { by: 'rules', rule: r.rule, ms: performance.now() - t0 }; x.call = { tool: r.tool, args: r.args }; }
    return execute(x, text);
  };
  // A call made by a button (a follow-up chip, the palette). No interpretation, the same checks.
  s.runCall = async (call, { via = 'button', label } = {}) => {
    if (s.busy) return null; s.busy = true;
    const x = open(label || T.formatCall(T.normalise(call)), via); x.interp = { by: 'direct' }; x.call = call;
    return execute(x, '');
  };
  s.runHeld = async (id) => { const x = s.exchanges.find((e) => e.id === id); if (!x || !x.held || s.busy) return; s.busy = true; x.held = false; x.checks = x.checks.filter((c) => c.name !== 'Negation guard'); x.checks.push({ name: 'Negation guard', ok: true, note: 'Overridden by the operator' }); return execute(x, '', true); };

  async function execute(x, text, resumed = false) {
    const ent = T.entities(ctx);
    if (!resumed) {
      x.call = T.normalise(x.call);
      const v = T.validateCall(x.call, ent);
      x.checks.push({ name: 'Schema', ok: v.ok, note: v.ok ? 'A known tool with valid arguments' : v.errors.join('; ') });
      if (!v.ok) return close(x, 'refused', 'Refused. That is not a valid call for this console: ' + v.errors[0] + '. Nothing was done.');
    }
    const tool = T.toolByName(x.call.tool), args = x.call.args;
    if (tool.name === 'none') return close(x, 'none', tool.run().text);
    if (!resumed) {
      const c = tool.check(args, ctx);
      x.checks.push({ name: 'Allowed now', ok: c.ok, note: c.ok ? 'The mission state allows it' : c.reason, unsafe: !!c.unsafe });
      if (!c.ok) return close(x, 'refused', (c.unsafe ? '' : 'Not now. ') + c.reason + ' Nothing was done.');
      if (text && T.ACTS.has(tool.name) && tool.name !== 'all_stop' && NEGATION.test(text)) {
        x.checks.push({ name: 'Negation guard', ok: false, note: 'Your words contain a negative ("' + NEGATION.exec(text)[0] + '")' }); x.held = true;
        return close(x, 'held', 'I read this as ' + T.formatCall(x.call) + ', but your message contains "' + NEGATION.exec(text)[0] + '", so I did not run it. Run it only if that is what you meant.');
      }
    }
    const conf = tool.confirm?.(args, ctx);
    if (conf) {
      x.status = 'confirming'; changed();
      const ok = await ctx.shell.confirm({ title: conf.title, confirmLabel: conf.confirmLabel, body: h('ul.cop-confirm', null, conf.lines.map((l) => h('li', null, l))) });
      x.checks.push({ name: 'Human confirmation', ok, note: ok ? 'Confirmed by ' + ctx.sim.state.operator : 'Declined in the dialog' });
      if (!ok) return close(x, 'declined', 'Not done. You declined in the dialog; nothing changed.');
    }
    let res;
    try { res = tool.run(args, ctx); } catch (e) { console.error('[copilot] tool failed', e); return close(x, 'error', 'The tool failed: ' + (e.message || e) + '. Nothing else was done.'); }
    x.result = res; x.follow = res.follow || []; x.answer = { text: res.text, by: 'tool' };
    if (!res.ok) return close(x, 'refused');
    if (s.live && s.reword && text && T.PHRASED.has(tool.name)) {
      x.status = 'phrasing'; x.wording = { text: '', pending: true, name: s.modelName }; changed();
      try {
        const p = await llm.phrase(llm.PHRASE_SYSTEM, llm.phraseUser(text, x.call, res.facts), (sofar) => { x.wording.text = sofar; changed(); });
        const g = T.groundCheck(p.text, res.facts, text);
        x.wording = { text: p.text, name: s.modelName, ms: p.ms, grounding: g, rejected: !g.ok || !p.text };
      } catch (e) { console.warn('[copilot] phrasing failed', e); x.wording = null; }
    }
    return close(x, 'done');
  }
  s.clear = () => { s.exchanges = []; changed(); };

  // ---------- situation report ----------
  s.writeSitrep = async () => {
    const facts = T.sitrepFacts(ctx), lines = T.sitrepLines(facts);
    s.sitrep = { facts, lines, at: facts.as_of, prose: null, status: s.live ? 'phrasing' : 'done' }; changed();
    if (s.live) {
      try {
        const p = await llm.phrase(llm.SITREP_SYSTEM, 'Facts: ' + JSON.stringify(facts), (sofar) => { s.sitrep.prose = { text: sofar, pending: true }; changed(); }, { maxTokens: 260 });
        const g = T.groundCheck(p.text, facts);
        s.sitrep.prose = { text: p.text, by: s.modelName, ms: p.ms, grounding: g, rejected: !g.ok };
      } catch (e) { s.sitrep.prose = { text: '', error: String(e.message || e) }; }
      s.sitrep.status = 'done'; changed();
    }
    return s.sitrep;
  };

  // ---------- evaluation ----------
  s.runEvaluation = async () => {
    const ev = s.evaluation; if (ev.running) return;
    Object.assign(ev, { running: true, progress: 0, which: 'Rule-based interpreter' }); changed();
    ev.rules = await runEval(ctx, rulesPropose, { onProgress: (p) => { ev.progress = p; changed(); } });
    if (s.live) {
      Object.assign(ev, { progress: 0, which: s.modelName, modelName: s.modelName, model: null }); changed();
      ev.model = await runEval(ctx, (text, ent) => llm.route(text, ent), { onProgress: (p) => { ev.progress = p; changed(); } });
      ev.model.modelId = llm.loadedModel();
    }
    ev.running = false; ev.at = new Date(); changed();
  };

  // ---------- voice ----------
  s.setReword = (v) => { s.reword = !!v; store.set('reword', s.reword); changed(); };
  s.setVoice = (k, v) => { s.voice[k] = v; store.set(k, v); if (k === 'speak' && !v) voice.hush(); changed(); };
  s.startListening = () => {
    if (s.voice.hearing) return; s.voice.hearing = true; s.voice.interim = ''; s.voice.error = null; changed();
    voice.listen({ onInterim: (t) => { s.voice.interim = t; changed(); }, onFinal: (t) => { s.ask(t, { via: 'voice' }); }, onEnd: (err) => { s.voice.hearing = false; s.voice.interim = ''; s.voice.error = err; changed(); } });
  };
  s.stopListening = () => voice.stopListening();
  s.canListen = voice.canListen; s.canSpeak = voice.canSpeak;

  ctx.bus.on('reset', changed); ctx.bus.on('seek', changed); ctx.bus.on('phase', changed);
  return s;
}
