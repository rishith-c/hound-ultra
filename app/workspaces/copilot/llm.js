// The on-device language model. WebLLM runs a small instruct model on this computer's GPU through WebGPU.
// After the weights are downloaded once they are kept in this browser's cache; a request never leaves the laptop.
//
// Design decision (the evidence is in model-comparison.json and the Evaluation tab): none of the small models in
// WebLLM supports native function calling (that list starts at 8-billion-parameter models, about 5 GB). So the
// model's output is CONSTRAINED instead: WebLLM compiles a JSON schema into a grammar and the model can only emit
// tokens that keep the output inside it. The schema is rebuilt from the live mission for every request, so the
// model cannot name a tool that does not exist or a lead id that is not on the board.
import { TOOLS, callSchema, normalise } from './tools.js';

export const WEBLLM_VERSION = '0.2.89';
const WEBLLM_URL = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@' + WEBLLM_VERSION + '/+esm';

// Sizes: downloadMB is the sum of the files in the model's public repository (measured 23 Nov 2026);
// gpuMB is WebLLM's own figure for GPU memory while running.
export const MODELS = [
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', name: 'Qwen2.5 1.5B', by: 'Alibaba', params: '1.5 B', downloadMB: 880, gpuMB: 1630 },
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', name: 'Llama 3.2 1B', by: 'Meta', params: '1.2 B', downloadMB: 705, gpuMB: 879 },
  { id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC', name: 'Qwen2.5 0.5B', by: 'Alibaba', params: '0.5 B', downloadMB: 290, gpuMB: 945 },
  { id: 'SmolLM2-360M-Instruct-q4f16_1-MLC', name: 'SmolLM2 360M', by: 'Hugging Face', params: '0.36 B', downloadMB: 207, gpuMB: 376 },
];
export const modelById = (id) => MODELS.find((m) => m.id === id) || null;

let lib = null, engine = null, loaded = null;
export const loadedModel = () => loaded;

export async function webgpuStatus() {
  if (!('gpu' in navigator)) return { ok: false, reason: 'This browser has no WebGPU. Use a current Chrome or Edge on a computer with a graphics processor.' };
  try {
    const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!a) return { ok: false, reason: 'WebGPU is present but no graphics adapter was offered (it may be disabled or blocked).' };
    const f16 = a.features.has('shader-f16');
    return { ok: f16, f16, vendor: a.info?.vendor || '', arch: a.info?.architecture || '', reason: f16 ? '' : 'This graphics adapter lacks 16-bit float shaders, which these compact model builds need.' };
  } catch (e) { return { ok: false, reason: 'WebGPU could not start: ' + (e.message || e) }; }
}
async function getLib() { if (!lib) lib = await import(/* @vite-ignore */ WEBLLM_URL); return lib; }
export async function isCached(id) { try { return await (await getLib()).hasModelInCache(id); } catch { return false; } }
export async function deleteCached(id) { const l = await getLib(); if (loaded === id) await unload(); await l.deleteModelAllInfoInCache(id); }
export async function unload() { if (engine) { try { await engine.unload(); } catch { /* already gone */ } } engine = null; loaded = null; }

// onProgress({ progress 0..1, text, seconds })
export async function load(id, onProgress) {
  const l = await getLib();
  if (engine) await unload();
  const t0 = performance.now();
  engine = await l.CreateMLCEngine(id, { initProgressCallback: (p) => onProgress?.({ progress: p.progress || 0, text: p.text || '', seconds: p.timeElapsed || 0 }), logLevel: 'WARN' });
  loaded = id;
  return { seconds: (performance.now() - t0) / 1000 };
}

// ---------- prompts ----------
const where = (d) => (d.room ? 'room ' + d.room : d.outdoor ? 'outdoors in the debris field' : 'unknown place');
export function routePrompt(ent) {
  const tools = TOOLS.map((t) => { const s = t.args(ent); const keys = s.properties ? Object.keys(s.properties) : s.anyOf ? ['type', 'id'] : []; return '- ' + t.name + (keys.length ? ' {' + keys.join(', ') + '}' : ' {}') + ': ' + t.llm; }).join('\n');
  const leads = ent.leads.length ? ent.leads.map((d) => d.id + ' = ' + (d.status === 'rejected' ? 'rejected (' + d.kind + ')' : d.status + ' person') + ', ' + where(d)).join('; ') : 'none yet';
  return [
    'You turn a rescue operator\'s request into exactly ONE tool call for the HOUND Command console. Reply with JSON only: {"tool": name, "args": {...}}.',
    'Rules: pick the single best tool. Use only ids from the mission list. A question about one lead (why, how sure, what is it) is explain_lead. "Show / where is / highlight" a thing is select. Pausing time is set_clock; all_stop is the safety stop for the units. If the request is medical, unsafe, destructive or not something these tools do, answer {"tool":"none","args":{}}.',
    'Tools:\n' + tools,
    'Mission now: clock ' + ent.clock + ', phase ' + ent.phaseLabel + '.',
    'Leads: ' + leads + '.',
    'People found: ' + (ent.people.length ? ent.people.map((v) => v.id + ' (lead ' + v.detId + ', ' + where(v) + ')').join('; ') : 'none') + '.',
    'Rooms: ' + ent.rooms.map((r) => r.id).join(', ') + '. Units: ' + ent.units.map((u) => u.id + ' ' + (u.kind === 'rover' ? 'rover' : u.kind === 'drone' ? 'scout drone' : 'rescue team')).join(', ') + '.',
    'Hazards: ' + ent.hazards.map((h) => h.id + ' ' + h.kind).join(', ') + '.',
    'Workspaces: ' + ent.workspaces.map((w) => w.id + ' = ' + w.title).join(', ') + '.',
    'Seek moments: start, map_ready, rover_at_entrance, first_listen, first_possible, first_person_found, route_planned, route_approved, team_arrived, mission_complete, or a clock time like "04:30".',
    'Examples:',
    'give me the picture -> {"tool":"get_mission_status","args":{}}',
    'anything we threw out? -> {"tool":"list_leads","args":{"status":"rejected"}}',
    'route for the team but gas is acceptable -> {"tool":"plan_route","args":{"avoid":["slope","mud","collapse"]}}',
    'stop the clock -> {"tool":"set_clock","args":{"running":false}}',
    'everybody freeze -> {"tool":"all_stop","args":{}}',
    'point out the drone -> {"tool":"select","args":{"type":"unit","id":"DRONE-01"}}',
    'turn the trails off -> {"tool":"set_layer","args":{"layer":"trail","on":false}}',
    'back to minute three -> {"tool":"seek_to","args":{"event":"03:00"}}',
    'kill the thermal camera as a test -> {"tool":"inject_fault","args":{"id":"thermalFail"}}',
    'what is the capital of France -> {"tool":"none","args":{}}',
  ].join('\n');
}
export const PHRASE_SYSTEM = 'You are the copilot of HOUND Command, a search-and-rescue console running a simulated training exercise. Answer the operator in at most three short, plain sentences, using ONLY the facts in the tool result. Copy every number and id exactly as given. Do not add advice, causes, medical judgement or anything that is not in the result. If the result does not answer the question, say that it does not.';
export const SITREP_SYSTEM = 'You write radio situation reports for a search-and-rescue team in a simulated training exercise. Rewrite the facts as one short spoken paragraph of four to six plain sentences, most urgent first: people found, open leads, what is not searched, the route, anything broken, the next decision. Use ONLY the facts given. Copy every number, id and room exactly. No advice, no medical judgement, no added detail.';

// v1 (kept for the recorded comparison): one prompt, the whole call schema, ten fixed examples.
export async function routeV1(text, ent) {
  if (!engine) throw new Error('No model is loaded.');
  const t0 = performance.now();
  const r = await engine.chat.completions.create({
    messages: [{ role: 'system', content: routePrompt(ent) }, { role: 'user', content: String(text).slice(0, 400) }],
    temperature: 0, max_tokens: 96, response_format: { type: 'json_object', schema: JSON.stringify(callSchema(ent)) },
  });
  const raw = r.choices[0]?.message?.content || '', ms = performance.now() - t0;
  let call; try { call = normalise(JSON.parse(raw)); } catch { call = { tool: 'invalid', args: {} }; }
  return { call, raw, ms, tokens: r.usage?.completion_tokens || 0, promptTokens: r.usage?.prompt_tokens || 0, tokPerS: r.usage?.extra?.decode_tokens_per_s || 0 };
}
// ---------- v2: retrieved examples, two short steps ----------
// Step 1 picks the tool (output held to the list of tool names). Step 2, only for tools that take arguments, fills
// them (output held to that tool's argument schema, built from the live mission). Each step sees the handful of
// development requests most similar to this one, found by word and letter-triple overlap: no second model needed.
const feats = (s) => { const t = ' ' + String(s).toLowerCase().replace(/[^a-z0-9: ]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ', out = new Set(t.trim().split(' ').map((w) => 'w:' + w.replace(/(ing|ed|es|s)$/, ''))); for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3)); return out; };
export function makeRetriever(bank) {
  const items = bank.map((b) => ({ ...b, f: feats(b.text) })), df = new Map();
  for (const it of items) for (const f of it.f) df.set(f, (df.get(f) || 0) + 1);
  const w = (f) => Math.log(1 + items.length / (df.get(f) || 0.5));
  for (const it of items) it.norm = Math.sqrt([...it.f].reduce((s, f) => s + w(f) ** 2, 0));
  return (text, k, only) => {
    const q = feats(text), qn = Math.sqrt([...q].reduce((s, f) => s + w(f) ** 2, 0)), key = String(text).trim().toLowerCase();
    return items.filter((it) => it.text.trim().toLowerCase() !== key && (!only || it.tool === only)).map((it) => { let dot = 0; for (const f of q) if (it.f.has(f)) dot += w(f) ** 2; return { it, s: dot / (qn * it.norm || 1) }; }).sort((a, b) => b.s - a.s).slice(0, k).map((x) => x.it);
  };
}
const ARG_GUIDE = {
  list_leads: 'status: "confirmed" = people found for sure; "possible" = uncertain or still open; "rejected" = ruled out, false alarms; "all" = no filter.',
  explain_lead: 'id: the lead the operator means. Resolve a room number or a description (the outdoor one, the fan, the pipe, the confirmed person) with the leads list.',
  investigate: 'id: the possible lead to look at again. Resolve a room number or a description with the leads list.',
  plan_route: 'avoid: start from ["slope","mud","gas","collapse"] and leave out only the kinds the operator says may be crossed or ignored.',
  set_speed: 'speed: 1 = real time, 32 = fastest; otherwise the number the operator gives.',
  set_clock: 'running: false to pause simulated time, true to play it.',
  seek_to: 'event: one of start, map_ready, rover_at_entrance, first_listen, first_possible, first_person_found, route_planned, route_approved, team_arrived, mission_complete; or a clock time "mm:ss".',
  select: 'type and id of the one thing to highlight: lead (D#), person (V#), room (number), unit (HOUND-01 rover, DRONE-01 scout drone, TEAM-1 rescue team) or hazard.',
  open_workspace: 'id: the workspace to open.',
  set_layer: 'layer: which layer of the 3-D view; on: true to show, false to hide.',
  inject_fault: 'id: linkLoss = radio link, csiDropout = Wi-Fi packets dropping, badWindow = corrupt Wi-Fi window, thermalFail = thermal camera, lowBattery = rover battery.',
  clear_fault: 'id: linkLoss = radio link, csiDropout = Wi-Fi packets dropping, badWindow = corrupt Wi-Fi window, thermalFail = thermal camera, lowBattery = rover battery.',
};
const leadsLine = (ent) => 'Leads: ' + (ent.leads.length ? ent.leads.map((d) => d.id + ' = ' + (d.status === 'rejected' ? 'rejected (' + d.kind + ')' : d.status + ' person') + ', ' + where(d)).join('; ') : 'none yet') + '. People found: ' + (ent.people.length ? ent.people.map((v) => v.id + ' (lead ' + v.detId + ', ' + where(v) + ')').join('; ') : 'none') + '.';
function digestFor(tool, ent) {
  if (tool === 'explain_lead' || tool === 'investigate') return leadsLine(ent);
  if (tool === 'select') return leadsLine(ent) + ' Rooms: ' + ent.rooms.map((r) => r.id).join(', ') + '. Units: HOUND-01 rover, DRONE-01 scout drone, TEAM-1 rescue team. Hazards: ' + ent.hazards.map((h) => h.id + ' ' + h.kind).join(', ') + '.';
  if (tool === 'open_workspace') return 'Workspaces: ' + ent.workspaces.map((w) => w.id + ' = ' + w.title + ' (' + w.blurb + ')').join('; ') + '.';
  if (tool === 'set_layer') return 'Layers: walls-xray (see-through walls), hazards, coverage (what was searched), heat, route, trail, scan (drone point cloud), labels, grid, sensing.';
  return '';
}
export function step1Prompt(ent) {
  return ['You route a rescue operator\'s request to exactly ONE tool of the HOUND Command console. Reply with JSON only: {"tool": name}.',
    'Tools:\n' + TOOLS.map((t) => '- ' + t.name + ': ' + t.llm).join('\n'),
    'Notes: a question about ONE lead (why, how sure, what is it) is explain_lead; a list of leads is list_leads. "Show / where is / highlight" a thing is select. Pausing time is set_clock; all_stop is the safety stop. Lifting a stop is resume. If the request is medical, unsafe, destructive or outside these tools, choose none.',
    'Mission now: clock ' + ent.clock + ', phase ' + ent.phaseLabel + '. ' + leadsLine(ent)].join('\n');
}
async function ask(system, user, schema, maxTokens) {
  const r = await engine.chat.completions.create({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0, max_tokens: maxTokens, response_format: { type: 'json_object', schema: JSON.stringify(schema) } });
  let v = null; const raw = r.choices[0]?.message?.content || ''; try { v = JSON.parse(raw); } catch { /* cut off */ }
  return { v, raw, tokens: r.usage?.completion_tokens || 0 };
}
// options: retrieve (from makeRetriever), hint ({ tool, args } from the rule-based interpreter, or null), k
export async function routeV2(text, ent, { retrieve, hint = null, k = 8 } = {}) {
  if (!engine) throw new Error('No model is loaded.');
  const t0 = performance.now(), q = String(text).slice(0, 400);
  const near = retrieve ? retrieve(q, k) : [];
  const user1 = (near.length ? 'Similar requests and the right tool:\n' + near.map((e) => '"' + e.text + '" -> ' + e.tool).join('\n') + '\n\n' : '') + (hint ? 'A keyword matcher guesses: ' + hint.tool + '. It is usually right; overrule it only when it clearly misreads the request.\n\n' : '') + 'Request: "' + q + '"';
  const s1 = await ask(step1Prompt(ent), user1, { type: 'object', properties: { tool: { enum: TOOLS.map((t) => t.name) } }, required: ['tool'], additionalProperties: false }, 24);
  const name = s1.v?.tool, tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { call: { tool: 'invalid', args: {} }, raw: s1.raw, ms: performance.now() - t0, tokens: s1.tokens, steps: 1 };
  const schema = tool.args(ent), hasArgs = schema.anyOf || Object.keys(schema.properties || {}).length;
  if (!hasArgs) return { call: { tool: name, args: {} }, raw: s1.raw, ms: performance.now() - t0, tokens: s1.tokens, steps: 1 };
  const same = retrieve ? retrieve(q, 4, name) : [];
  const sys2 = ['Fill in the arguments of the tool "' + name + '" for the operator\'s request. Reply with JSON only.', name + ': ' + tool.llm, ARG_GUIDE[name] || '', digestFor(name, ent)].filter(Boolean).join('\n');
  const user2 = (same.length ? 'Examples:\n' + same.map((e) => '"' + e.text + '" -> ' + JSON.stringify(normalise(e).args)).join('\n') + '\n\n' : '') + (hint && hint.tool === name ? 'A keyword matcher guesses: ' + JSON.stringify(hint.args) + '. Correct it if it misreads the request.\n\n' : '') + 'Request: "' + q + '"';
  const s2 = await ask(sys2, user2, schema, 64);
  return { call: normalise({ tool: name, args: s2.v || {} }), raw: s1.raw + ' ' + s2.raw, ms: performance.now() - t0, tokens: s1.tokens + s2.tokens, steps: 2 };
}

// Phrase facts as text, streaming. onToken(textSoFar). Returns { text, ms }.
export async function phrase(system, user, onToken, { maxTokens = 150 } = {}) {
  if (!engine) throw new Error('No model is loaded.');
  const t0 = performance.now();
  const stream = await engine.chat.completions.create({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.2, max_tokens: maxTokens, stream: true });
  let text = '';
  for await (const chunk of stream) { text += chunk.choices[0]?.delta?.content || ''; onToken?.(text); }
  return { text: text.trim(), ms: performance.now() - t0 };
}
export const phraseUser = (question, call, facts) => 'Operator asked: "' + String(question).slice(0, 300) + '"\nTool used: ' + call.tool + '\nTool result (the only facts you may use): ' + JSON.stringify(facts);
export async function interrupt() { try { await engine?.interruptGenerate(); } catch { /* nothing running */ } }
