// The command palette. Opens on Cmd/Ctrl+K (the shell emits 'palette:open'), closes on Escape.
// One list for everything the console can do or show: mission commands (with the reason when one is not allowed
// right now), workspaces, every lead, person, room, unit and hazard, replay moments, camera, layers, fault drills,
// preferences and sound. Keyboard first; the list is an ARIA combobox + listbox, so a screen reader reads each row.
import { commandState, keyMoments, parseClock, nextAction, toolByName, whereOf, layerState, LAYERS, CAMERAS, SPEEDS } from '../workspaces/copilot/tools.js';

const RECENT_KEY = 'hound.palette.recent';
const SCOPES = [{ id: 'all', label: 'All', key: '' }, { id: 'cmd', label: 'Commands', key: '>' }, { id: 'thing', label: 'Things', key: '@' }, { id: 'go', label: 'Go to', key: '#' }, { id: 'time', label: 'Replay', key: ':' }, { id: 'pref', label: 'Settings', key: '=' }];
const GROUP_ORDER = ['Next', 'Recent', 'Mission', 'Clock', 'Go to', 'Leads and people', 'Rooms', 'Units', 'Hazards', 'Replay: seek to', 'Camera', 'Layers', 'Fault drills', 'Preferences', 'Sound', 'Copilot'];
const DESCRIBE = (ctx, name) => String(ctx.COMMANDS[name] || '').replace(/^\{[^}]*\}\s*/, '');

function fuzzy(q, text) {
  const t = text.toLowerCase(), sub = t.indexOf(q), edge = (i) => i === 0 || /[\s\-·:,(/]/.test(t[i - 1]);
  if (sub >= 0) return { score: 100 + (edge(sub) ? 40 : 0) - sub * 0.4 - (t.length - q.length) * 0.08, idx: Array.from({ length: q.length }, (_, i) => sub + i) };
  let qi = 0, score = 0, last = -2; const idx = [];
  for (let i = 0; i < t.length && qi < q.length; i++) if (t[i] === q[qi]) { score += 4 + (edge(i) ? 10 : 0) + (last === i - 1 ? 6 : 0); idx.push(i); last = i; qi++; }
  return qi === q.length ? { score: score - (idx[idx.length - 1] - idx[0]) * 0.3, idx } : null;
}
function match(item, tokens) {
  let score = 0; const marks = new Set();
  for (const tok of tokens) {
    const a = fuzzy(tok, item.title), b = item.hay.includes(tok) ? 30 : 0;
    if (!a && !b) return null;
    if (a && a.score >= b) { score += a.score; a.idx.forEach((i) => marks.add(i)); } else score += b;
  }
  return { score: score + (item.disabled ? -25 : 0) + (item.boost || 0), marks };
}

export function init(ctx) {
  const { h, icon, fmt } = ctx.kit, bus = ctx.bus;
  if (!document.getElementById('pal-css')) document.head.append(h('link', { id: 'pal-css', rel: 'stylesheet', href: new URL('../workspaces/copilot/palette.css', import.meta.url).href }));
  let el = null, input, listEl, previewEl, countEl, scopeEls = {}, items = [], shown = [], active = 0, scope = 'all', lastFocus = null, swallowEscape = 0, twinLayers = null;
  const recent = (() => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } })();
  const remember = (id) => { const i = recent.indexOf(id); if (i >= 0) recent.splice(i, 1); recent.unshift(id); recent.length = Math.min(recent.length, 6); try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); } catch { /* private mode */ } };
  bus.on('twin:ready', (p) => { if (p?.layers) twinLayers = p.layers; });
  bus.on('twin:layers', (p) => { if (p?.layers) twinLayers = p.layers; });
  const layerOn = (id) => (layerState.has(id) ? layerState.get(id) : twinLayers?.find((l) => l.id === id)?.on);

  // ---------- what can be done right now ----------
  function build() {
    const S = ctx.sim.state, out = [];
    const add = (o) => out.push({ scope: 'cmd', hay: '', ...o, hay: ((o.keywords || '') + ' ' + (o.sub || '') + ' ' + o.group).toLowerCase() });
    const simCommand = (id, name, args, title, o = {}) => { const st = commandState(ctx, name, args); add({ id, group: 'Mission', icon: o.icon || 'bolt', title, preview: st.ok ? o.preview || DESCRIBE(ctx, name) : 'Not available now. ' + st.reason, disabled: st.ok ? null : st.reason, run: o.run || (() => { if (!ctx.sim.command(name, args)) ctx.shell.toast('The mission did not accept that command.', { level: 'alert' }); }), keywords: o.keywords, danger: o.danger, kbd: o.kbd }); };

    const next = nextAction(ctx);
    if (next?.call) add({ id: 'next', group: 'Next', icon: 'chevron', title: next.say, preview: 'The decision the mission is waiting for.', boost: 30, keywords: 'next suggested recommended', run: () => runTool(next.call) });

    simCommand('cmd:start', 'start', {}, 'Start the mission', { icon: 'play', run: () => { ctx.sim.command('start'); ctx.sim.play(); }, keywords: 'begin launch go' });
    simCommand('cmd:allStop', 'allStop', {}, 'All stop', { icon: 'stop', danger: true, keywords: 'halt emergency freeze hold', preview: 'Every unit stops where it is, at once. Nothing is lost; resume when it is safe.' });
    simCommand('cmd:resume', 'resume', {}, 'Resume after all stop', { icon: 'play', keywords: 'continue carry on release' });
    const possible = S.detections.filter((d) => d.status === 'possible');
    if (possible.length) for (const d of possible) {
      simCommand('cmd:investigate:' + d.id, 'investigate', { id: d.id }, 'Second look at ' + d.id + ' (' + whereOf(d) + ')', { icon: 'rover', keywords: 'investigate check verify closer rover', preview: 'HOUND-01 moves to a clear view of ' + d.id + ' and listens for another 10 seconds.' });
      simCommand('cmd:dismiss:' + d.id, 'dismiss', { id: d.id }, 'Dismiss ' + d.id + ' (' + whereOf(d) + ')', { icon: 'close', keywords: 'reject close false alarm', preview: 'Marks ' + d.id + ' as dismissed by the operator. It stays in the log with your name on it.', run: async () => { if (await ctx.shell.confirm({ title: 'Dismiss ' + d.id + '?', body: d.id + ' is a possible person, ' + whereOf(d) + ', at ' + fmt.pct(d.p) + '. Dismissing it means no one checks it again.', confirmLabel: 'Dismiss lead', danger: true })) ctx.sim.command('dismiss', { id: d.id }); } });
    } else simCommand('cmd:investigate', 'investigate', {}, 'Second look at a possible lead', { icon: 'rover', keywords: 'investigate check verify', preview: 'Not available now. There is no possible lead to check.' , run: () => {} }), out[out.length - 1].disabled = out[out.length - 1].disabled || 'There is no possible lead to check.', out[out.length - 1].preview = 'Not available now. There is no possible lead to check.';
    simCommand('cmd:finishAssess', 'finishAssess', {}, 'Stop checking leads and plan the rescue', { icon: 'check', keywords: 'finish assess move on' });
    simCommand('cmd:planRoute', 'planRoute', {}, 'Plan the rescue route', { icon: 'route', keywords: 'path way in replan', preview: 'Plans a route for the rescue team around every hazard. You approve it afterwards.' });
    simCommand('cmd:approveRoute', 'approveRoute', {}, 'Approve the rescue route', { icon: 'check', keywords: 'green light send team go', preview: 'Asks you to confirm, then the rescue team starts moving.', run: () => runTool({ tool: 'approve_route', args: {} }) });
    simCommand('cmd:rejectRoute', 'rejectRoute', {}, 'Throw the planned route away', { icon: 'close', keywords: 'reject discard cancel route' });
    simCommand('cmd:swapBattery', 'swapBattery', {}, 'Swap the rover battery', { icon: 'bolt', keywords: 'battery change' });
    simCommand('cmd:newHazard', 'newHazard', {}, 'Second slide: new debris in the corridor', { icon: 'alert', keywords: 'aftershock new hazard blockage replan', preview: 'A new blockage appears. Every active route is planned again around it.' });
    add({ id: 'cmd:autoplay', group: 'Mission', icon: 'mission', title: 'Autoplay', state: S.autoplay, keep: true, keywords: 'automatic manual operator decisions', preview: S.autoplay ? 'On: the mission makes the routine choices itself. Turn off to make them yourself.' : 'Off: you start, investigate, plan and approve.', run: () => ctx.sim.command('setAutoplay', { on: !ctx.sim.state.autoplay }) });

    add({ id: 'clock:toggle', group: 'Clock', icon: S.running ? 'pause' : 'play', title: S.running ? 'Pause the clock' : 'Play the clock', kbd: 'Space', keywords: 'play pause time simulation', preview: 'Simulated time ' + (S.running ? 'stops' : 'runs') + '. This is not an all-stop.', run: () => ctx.sim.toggle() });
    for (const x of SPEEDS) add({ id: 'clock:speed:' + x, group: 'Clock', icon: 'clock', title: 'Speed ' + x + '×', sub: x === 1 ? 'real time' : '', state: S.speed === x ? true : undefined, stateWord: 'current', keywords: 'speed faster slower ' + x + 'x', preview: 'One real second becomes ' + x + ' simulated second' + (x === 1 ? '' : 's') + '.', run: () => ctx.sim.setSpeed(x) });
    add({ id: 'clock:reset', group: 'Clock', icon: 'reset', title: 'Restart the mission', keywords: 'reset start over again', preview: 'The mission starts again from 00:00. The operator commands of this run are discarded.', run: async () => { if (await ctx.shell.confirm({ title: 'Restart the mission?', body: 'The mission starts again from 00:00 and the commands you gave in this run are discarded.', confirmLabel: 'Restart' })) ctx.sim.reset(); } });

    const cur = ctx.shell.current();
    for (const m of ctx.manifest) add({ id: 'go:' + m.id, scope: 'go', group: 'Go to', icon: m.icon, title: m.title, sub: m.blurb, state: cur === m.id ? true : undefined, stateWord: 'open', keywords: m.group + ' workspace open', preview: m.blurb, run: () => ctx.shell.open(m.id) });

    const jump = (sel, label) => () => { ctx.select(sel); if (!['mission', 'triage', 'graph', 'fusion'].includes(ctx.shell.current())) ctx.shell.open('mission'); ctx.shell.toast('Selected ' + label + '.', { level: 'ok', ms: 2200 }); };
    for (const d of S.detections) add({ id: 'det:' + d.id, scope: 'thing', group: 'Leads and people', icon: d.status === 'confirmed' ? 'person' : d.status === 'possible' ? 'alert' : 'close', title: d.id + ' · ' + (d.status === 'rejected' ? 'closed: ' + d.kind : d.status + ' person') + ' · ' + whereOf(d), tag: [fmt.pct(d.p), d.status === 'confirmed' ? 'tag-person' : d.status === 'possible' ? 'tag-warn' : ''], keywords: 'lead detection ' + d.status + ' ' + d.kind + ' ' + (d.room || 'outdoors'), preview: d.reason + ' ' + d.evidence.length + ' sensor readings. Enter selects it everywhere and shows it in the 3-D view.', run: jump({ type: 'detection', id: d.id }, d.id) });
    for (const v of Object.values(S.survivors)) add({ id: 'sv:' + v.id, scope: 'thing', group: 'Leads and people', icon: 'person', title: v.id + ' · person ' + (v.status === 'reached' ? 'reached' : 'located') + ' · ' + whereOf(v), tag: [fmt.pct(v.p), 'tag-person'], keywords: 'survivor person found ' + v.detId, preview: 'Found at ' + fmt.clock(v.foundAt) + ' from lead ' + v.detId + (v.reachedAt ? '; reached by the team at ' + fmt.clock(v.reachedAt) : '; not yet reached') + '.', run: jump({ type: 'survivor', id: v.id }, v.id) });
    for (const r of ctx.world.ROOMS) { const c = S.coverage[r.id]; add({ id: 'room:' + r.id, scope: 'thing', group: 'Rooms', icon: 'wall', title: r.name, tag: c ? [c.status === 'clear' ? 'clear, ' + fmt.pct(c.residual) + ' missed' : c.status === 'person' ? 'person' : c.status === 'lead' ? 'possible' : c.status === 'blocked' ? 'blocked' : 'not searched', c.status === 'clear' ? 'tag-ok' : c.status === 'person' ? 'tag-person' : c.status === 'lead' ? 'tag-warn' : ''] : null, keywords: 'room ' + r.id, preview: c ? c.note : 'A corridor: the rover drives through it; it is not a search target.', run: jump({ type: 'room', id: r.id }, r.name) }); }
    for (const u of Object.values(S.units)) add({ id: 'unit:' + u.id, scope: 'thing', group: 'Units', icon: u.kind === 'rover' ? 'rover' : u.kind === 'drone' ? 'drone' : 'person', title: u.name, sub: u.mode + (u.kind === 'rover' ? ' · battery ' + fmt.pct(u.battery) + ' · link ' + fmt.pct(u.link) : ''), tag: u.built ? null : [u.kind === 'drone' ? 'concept' : 'simulated', 'tag-sim'], keywords: u.id + ' ' + u.kind + ' unit', preview: u.built ? 'The rover that exists. Its motion here is simulated.' : u.kind === 'drone' ? 'Concept: no drone has been built.' : 'Simulated rescue team.', run: jump({ type: 'unit', id: u.id }, u.name) });
    for (const z of [...ctx.world.HAZARDS, ...S.hazards]) add({ id: 'hz:' + z.id, scope: 'thing', group: 'Hazards', icon: 'alert', title: z.name, tag: [z.block ? 'never crossed' : 'cost ×' + z.cost, 'tag-danger'], keywords: 'hazard danger ' + z.kind, preview: z.block ? 'The planner never routes anyone through this.' : 'The planner crosses this only when the way around is ' + z.cost + ' times longer.', run: jump({ type: 'hazard', id: z.id }, z.name) });

    let moments = []; try { moments = keyMoments(ctx); } catch (e) { console.warn('[palette] no key moments', e); }
    add({ id: 'seek:0', scope: 'time', group: 'Replay: seek to', icon: 'reset', title: '00:00 · Before the start', keywords: 'beginning rewind seek', preview: 'Replays the mission to the very start.', run: () => runTool({ tool: 'seek_to', args: { event: 'start' } }) });
    moments.forEach((k, i) => add({ id: 'seek:' + k.code + ':' + Math.round(k.t), scope: 'time', group: 'Replay: seek to', icon: 'clock', title: fmt.clock(k.t) + ' · ' + k.label, tag: k.source === 'scripted' ? ['ahead, scripted run', ''] : null, keywords: 'seek jump replay ' + k.code.toLowerCase().replace(/_/g, ' '), preview: k.text + (k.source === 'scripted' ? ' (Not reached yet in this run: the time is from the scripted mission.)' : ''), run: () => runTool({ tool: 'seek_to', args: { event: fmt.clock(Math.min(k.t + 0.99, 99 * 60)) } }), order: i }));

    for (const c of CAMERAS) add({ id: 'cam:' + c.id, scope: 'pref', group: 'Camera', icon: 'eye', title: 'Camera: ' + c.label, keywords: 'camera view 3-d ' + c.id, preview: c.does + ' Applies to the 3-D view.', run: () => { bus.emit('twin:camera', { mode: c.id }); if (ctx.shell.current() !== 'mission') ctx.shell.open('mission'); } });
    for (const l of LAYERS) add({ id: 'layer:' + l.id, scope: 'pref', group: 'Layers', icon: 'layers', title: l.label, state: layerOn(l.id), keep: true, keywords: 'layer overlay show hide 3-d ' + l.id, preview: l.does + ' Enter turns it ' + (layerOn(l.id) ? 'off' : 'on') + ' in the 3-D view.', run: () => { const on = !layerOn(l.id); layerState.set(l.id, on); bus.emit('twin:layer', { id: l.id, on }); } });
    for (const [id, f] of Object.entries(ctx.FAULTS)) add({ id: 'fault:' + id, group: 'Fault drills', icon: 'alert', title: f.label, state: !!S.faults[id], stateWord: 'drill running', keep: true, keywords: 'fault drill inject break failure ' + id, preview: (S.faults[id] ? 'Enter ends the drill. ' : 'Enter starts the drill. ') + f.does, run: () => ctx.sim.command(ctx.sim.state.faults[id] ? 'clearFault' : 'injectFault', { id }) });

    const p = ctx.prefs;
    add({ id: 'pref:contrast', scope: 'pref', group: 'Preferences', icon: 'eye', title: 'High contrast', state: p.contrast === 'high', keep: true, keywords: 'accessibility contrast', preview: 'Stronger lines and brighter secondary text.', run: () => ctx.setPref('contrast', ctx.prefs.contrast === 'high' ? 'normal' : 'high') });
    add({ id: 'pref:palette', scope: 'pref', group: 'Preferences', icon: 'eye', title: 'Colour-blind palette', state: p.palette === 'cb', keep: true, keywords: 'accessibility color colour blind deuteranopia', preview: 'Blue, orange and yellow only: no red and green pair. Every colour still has a word or icon beside it.', run: () => ctx.setPref('palette', ctx.prefs.palette === 'cb' ? 'default' : 'cb') });
    add({ id: 'pref:motion', scope: 'pref', group: 'Preferences', icon: 'eye', title: 'Reduced motion', state: p.motion === 'reduce', keep: true, keywords: 'accessibility animation motion', preview: 'Stops interface animation and camera moves.', run: () => ctx.setPref('motion', ctx.prefs.motion === 'reduce' ? 'auto' : 'reduce') });
    add({ id: 'pref:rail', scope: 'pref', group: 'Preferences', icon: 'menu', title: 'Compact workspace list', state: p.rail === 'closed', keep: true, keywords: 'sidebar rail collapse', preview: 'Shows the workspace list as icons only.', run: () => ctx.setPref('rail', ctx.prefs.rail === 'closed' ? 'open' : 'closed') });

    const snd = ctx.sound;
    if (snd) {
      add({ id: 'sound:on', scope: 'pref', group: 'Sound', icon: 'signals', title: 'Interface sound', state: snd.isOn(), keep: true, keywords: 'audio mute volume', preview: 'Three synthesised sounds: a click on commits, one tone when a person is found, a low double tone on a fault. Off by default.', run: () => snd.setOn(!snd.isOn()) });
      for (const [k, title] of [['click', 'Hear the commit click'], ['person', 'Hear the person-found tone'], ['fault', 'Hear the fault tone']]) add({ id: 'sound:' + k, scope: 'pref', group: 'Sound', icon: 'play', title, keep: true, keywords: 'audio preview test', preview: snd.info[k] + ' Plays once now, even with sound off.', run: () => snd.play(k, { force: true }) });
    }
    add({ id: 'cop:open', group: 'Copilot', icon: 'copilot', title: 'Open the copilot', kbd: '⌘J', keywords: 'assistant chat ask language model', preview: 'Ask in plain words from a side drawer, without leaving this view.', run: () => bus.emit('copilot:open', {}) });
    add({ id: 'cop:sitrep', group: 'Copilot', icon: 'report', title: 'Write a situation report', keywords: 'sitrep summary brief', preview: 'Gathers the facts from the mission state and writes a short report you can check line by line.', run: () => bus.emit('copilot:open', { call: { tool: 'write_sitrep', args: {} }, label: 'Write a situation report' }) });
    return out;
  }
  // Mission actions that need the copilot's confirmation dialog or tool logic go through the same tool code.
  async function runTool(call) {
    const t = toolByName(call.tool), chk = t.check(call.args, ctx);
    if (!chk.ok) { ctx.shell.toast(chk.reason, { level: 'alert' }); return; }
    const conf = t.confirm?.(call.args, ctx);
    if (conf && !(await ctx.shell.confirm({ title: conf.title, confirmLabel: conf.confirmLabel, body: h('ul.cop-confirm', null, conf.lines.map((l) => h('li', null, l))) }))) return;
    const r = t.run(call.args, ctx);
    if (r?.text) ctx.shell.toast(r.text, { level: r.ok ? 'ok' : 'alert' });
  }

  // ---------- filter and render ----------
  function filter() {
    let q = input.value.trim().toLowerCase(), sc = scope;
    const pre = SCOPES.find((s) => s.key && q.startsWith(s.key)); if (pre) { sc = pre.id; q = q.slice(1).trim(); }
    const pool = items.filter((it) => sc === 'all' || it.scope === sc);
    const extra = [];
    const clock = parseClock(q);
    if (clock != null) extra.push({ id: 'seek:typed', scope: 'time', group: 'Replay: seek to', icon: 'clock', title: 'Seek the replay to ' + fmt.clock(clock), hay: '', preview: 'Replays the mission from the start up to ' + fmt.clock(clock) + '.', run: () => runTool({ tool: 'seek_to', args: { event: fmt.clock(clock) } }), marks: new Set(), score: 500 });
    const op = /^operator\s+(.{2,60})$/i.exec(input.value.trim());
    if (op) extra.push({ id: 'cmd:operator', scope: 'cmd', group: 'Mission', icon: 'person', title: 'Set the operator name to “' + op[1] + '”', hay: '', preview: ctx.COMMANDS.setOperator ? 'Your name is written on every approval and stop in the log.' : '', run: () => { ctx.sim.command('setOperator', { name: op[1] }); try { localStorage.setItem('hound_operator', op[1]); } catch { /* no storage */ } }, marks: new Set(), score: 600 });
    if (!q) {
      const rec = recent.map((id) => items.find((it) => it.id === id)).filter((it) => it && !it.disabled).slice(0, 4).map((it) => ({ ...it, id: 'recent:' + it.id, realId: it.id, group: 'Recent' }));
      shown = [...(sc === 'all' ? rec : []), ...pool.filter((it) => sc !== 'all' || !it.disabled || it.group === 'Mission')].map((it) => ({ ...it, marks: new Set() }));
      shown.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || (a.disabled ? 1 : 0) - (b.disabled ? 1 : 0));
    } else {
      const tokens = q.split(/\s+/);
      shown = pool.map((it) => { const m = match(it, tokens); return m ? { ...it, ...m } : null; }).filter(Boolean).concat(extra).sort((a, b) => b.score - a.score).slice(0, 40);
      // keep the best match first, but list each group together in the order its best row appeared
      const order = [...new Set(shown.map((it) => it.group))];
      shown.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || b.score - a.score);
      shown.push({ id: 'cop:ask', scope: 'cmd', group: 'Copilot', icon: 'copilot', title: 'Ask the copilot: “' + input.value.trim() + '”', hay: '', preview: 'Sends your words to the copilot. It turns them into one tool call you can read.', run: () => bus.emit('copilot:open', { ask: input.value.trim() }), marks: new Set(), score: 0, ask: true });
    }
    return sc;
  }
  function titleNode(it) {
    if (!it.marks?.size || it.ask) return h('span.pal-title', null, it.title);
    const out = []; let buf = '', on = false;
    [...it.title].forEach((ch, i) => { const m = it.marks.has(i); if (m !== on) { if (buf) out.push(on ? h('mark', null, buf) : buf); buf = ''; on = m; } buf += ch; });
    if (buf) out.push(on ? h('mark', null, buf) : buf);
    return h('span.pal-title', null, out);
  }
  function render(keepId) {
    const sc = filter();
    for (const s of SCOPES) scopeEls[s.id].setAttribute('aria-pressed', String(s.id === sc));
    if (keepId) { const i = shown.findIndex((it) => it.id === keepId); active = i >= 0 ? i : Math.min(active, shown.length - 1); } else active = Math.max(0, shown.findIndex((it) => !it.disabled));
    const kids = []; let group = null, box = null;
    shown.forEach((it, i) => {
      if (it.group !== group) { group = it.group; const gid = 'pal-g-' + kids.length; box = h('div.pal-group', { role: 'group', 'aria-labelledby': gid }, h('div.pal-group-title', { id: gid }, group)); kids.push(box); }
      const state = it.state === undefined ? null : h('span.pal-state' + (it.state ? '.on' : ''), null, it.stateWord ? (it.state ? it.stateWord : '') : it.state ? 'on' : 'off');
      box.append(h('div.pal-row' + (it.danger ? '.danger' : ''), { role: 'option', id: 'pal-o-' + i, 'data-i': i, 'aria-selected': 'false', 'aria-disabled': it.disabled ? 'true' : null },
        h('span.pal-ico', null, icon(it.icon || 'info', 16)), h('span.pal-text', null, titleNode(it), it.disabled ? h('span.pal-sub.why', null, it.disabled) : it.sub ? h('span.pal-sub', null, it.sub) : null),
        it.tag ? h('span.tag.plain.' + (it.tag[1] || 'pal-tag'), null, it.tag[0]) : null, state && (it.stateWord ? (it.state ? h('span.tag.plain.tag-accent', null, it.stateWord) : null) : state), it.kbd ? h('kbd', null, it.kbd) : null));
    });
    if (!shown.length) kids.push(h('div.pal-empty', null, 'Nothing matches. Try a room number, a lead id such as D4, a time such as 6:30, or a workspace name.'));
    listEl.replaceChildren(...kids);
    countEl.textContent = shown.length + (shown.length === 1 ? ' result' : ' results');
    setActive(active, true);
  }
  function setActive(i, quiet) {
    if (!shown.length) { input.removeAttribute('aria-activedescendant'); previewEl.textContent = ''; return; }
    active = (i + shown.length) % shown.length;
    listEl.querySelectorAll('[aria-selected="true"]').forEach((n) => n.setAttribute('aria-selected', 'false'));
    const row = listEl.querySelector('#pal-o-' + active);
    row.setAttribute('aria-selected', 'true'); input.setAttribute('aria-activedescendant', row.id);
    if (!quiet || active > 6) row.scrollIntoView({ block: 'nearest' }); else listEl.scrollTop = 0;
    const it = shown[active];
    previewEl.replaceChildren(it.disabled ? h('span.why', null, 'Not available now. ' + it.disabled) : it.preview || it.sub || '');
  }
  function run(i) {
    const it = shown[i]; if (!it) return;
    if (it.disabled) { previewEl.replaceChildren(h('span.why', null, 'Not available now. ' + it.disabled)); el.querySelector('.pal').classList.remove('nudge'); void el.offsetWidth; el.querySelector('.pal').classList.add('nudge'); return; }
    if (!it.ask && !it.id.startsWith('seek:typed')) remember(it.realId || it.id);
    if (it.keep) { Promise.resolve(it.run()).then(() => { items = build(); render(it.id); }); return; }
    close(); Promise.resolve().then(() => it.run()).catch((e) => { console.error('[palette] command failed', e); ctx.shell.toast('That command failed: ' + (e.message || e), { level: 'alert' }); });
  }
  function setScope(id) { scope = id; const pre = SCOPES.find((s) => s.key && input.value.startsWith(s.key)); if (pre) input.value = input.value.slice(1).trimStart(); render(); input.focus(); }

  // ---------- open / close ----------
  function open(o = {}) {
    if (el) { if (o.query == null) close(); return; }
    lastFocus = document.activeElement; scope = o.scope || 'all';
    input = h('input.pal-input', { type: 'text', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'pal-list', 'aria-autocomplete': 'list', 'aria-label': 'Search or run a command', placeholder: 'Search leads, rooms, commands, moments…', autocomplete: 'off', spellcheck: false, value: o.query || '' });
    listEl = h('div.pal-list', { role: 'listbox', id: 'pal-list', 'aria-label': 'Results' });
    previewEl = h('div.pal-preview', { 'aria-live': 'polite' }); countEl = h('span.sr-only', { role: 'status' });
    const scopes = h('div.pal-scopes', { role: 'toolbar', 'aria-label': 'Limit the search' }, SCOPES.map((s) => (scopeEls[s.id] = h('button', { type: 'button', tabindex: '-1', 'aria-pressed': 'false', onclick: () => setScope(s.id) }, s.label, s.key ? h('kbd', null, s.key) : null))));
    el = h('div.pal-scrim', { onmousedown: (e) => { if (e.target === el) close(); } },
      h('div.pal.glass', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command palette' },
        h('div.pal-top', null, icon('search', 18), input, h('kbd', null, 'esc')), scopes, listEl,
        h('div.pal-foot', null, previewEl, h('div.pal-keys', { 'aria-hidden': 'true' }, h('span', null, h('kbd', null, '↑'), h('kbd', null, '↓'), 'move'), h('span', null, h('kbd', null, '↵'), 'run'), h('span', null, h('kbd', null, 'tab'), 'scope')), countEl)));
    input.addEventListener('input', () => render());
    input.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
      else if (k === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (k === 'PageDown') { e.preventDefault(); setActive(Math.min(shown.length - 1, active + 8)); }
      else if (k === 'PageUp') { e.preventDefault(); setActive(Math.max(0, active - 8)); }
      else if (k === 'Home' && !input.value) { e.preventDefault(); setActive(0); }
      else if (k === 'End' && !input.value) { e.preventDefault(); setActive(shown.length - 1); }
      else if (k === 'Enter') { e.preventDefault(); run(active); }
      else if (k === 'Tab') { e.preventDefault(); const i = SCOPES.findIndex((s) => s.id === scope); setScope(SCOPES[(i + (e.shiftKey ? SCOPES.length - 1 : 1)) % SCOPES.length].id); }
      else if (k === 'Escape') { if (input.value) { input.value = ''; render(); swallowEscape = performance.now(); } }
    });
    listEl.addEventListener('mousemove', (e) => { const r = e.target.closest('.pal-row'); if (r && +r.dataset.i !== active) setActive(+r.dataset.i, true), r.scrollIntoView({ block: 'nearest' }); });
    listEl.addEventListener('click', (e) => { const r = e.target.closest('.pal-row'); if (r) run(+r.dataset.i); input?.focus(); });
    document.getElementById('overlays').append(el);
    items = build(); render(); input.focus(); input.select();
  }
  function close() { if (!el) return; el.remove(); el = null; scopeEls = {}; if (lastFocus && document.contains(lastFocus)) lastFocus.focus?.(); }
  bus.on('palette:open', (o) => open(o || {}));
  bus.on('escape', () => { if (performance.now() - swallowEscape < 80) return; close(); });
  const refresh = () => { if (el) { const id = shown[active]?.id; items = build(); render(id); } };
  bus.on('phase', refresh); bus.on('detection', refresh); bus.on('route', refresh); bus.on('fault', refresh); bus.on('reset', refresh); bus.on('seek', refresh); bus.on('prefs', refresh); bus.on('sound', refresh);
  ctx.palette = { open, close, isOpen: () => !!el };
}
