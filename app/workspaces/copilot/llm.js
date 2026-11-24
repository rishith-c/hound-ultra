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

// One prompt, the whole call schema, ten fixed examples. This is the pipeline measured in model-comparison.json
// (the workspace list in the prompt follows the console and may have grown since).
export async function route(text, ent) {
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
