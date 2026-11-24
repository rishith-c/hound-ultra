// Evaluation harness: run every test request through an interpreter and compare with the expected call.
// Nothing is executed: the proposed call is only compared. The entities are a frozen mission moment.
import { frozenEntities, sameCall, normalise, validateCall, ACTS } from './tools.js';
import { interpret } from './rules.js';
import { CORE, loadHeldOut } from './evalset.js';

export async function testSet() { return [...CORE, ...(await loadHeldOut())]; }

// Wilson 95 % interval for a proportion: honest error bars for a few dozen test items.
export function wilson(k, n) {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - h) / d), Math.min(1, (c + h) / d)];
}
export function summarise(rows) {
  const part = (list) => { const n = list.length, exact = list.filter((r) => r.exact).length, toolOk = list.filter((r) => r.toolOk).length; return { n, exact, toolOk, acc: n ? exact / n : 0, toolAcc: n ? toolOk / n : 0, ci: wilson(exact, n) }; };
  const by = (key) => Object.fromEntries([...new Set(rows.map((r) => r[key]))].map((v) => [v, part(rows.filter((r) => r[key] === v))]));
  const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
  return { ...part(rows), bySet: by('set'), byCategory: by('category'), medianMs: ms.length ? ms[Math.floor(ms.length / 2)] : 0, p90Ms: ms.length ? ms[Math.floor(ms.length * 0.9)] : 0,
    // The dangerous kind of mistake: an action proposed when the right answer was a question, a view or a refusal.
    unsafe: rows.filter((r) => !r.exact && ACTS.has(r.got.tool) && !ACTS.has(r.tool)).length, invalid: rows.filter((r) => !r.valid).length,
    failures: rows.filter((r) => !r.exact) };
}
// propose(text, entities) -> { call, ms? } (may be async). Returns { rows, summary }.
export async function runEval(ctx, propose, { onProgress, signal, items } = {}) {
  const ent = frozenEntities(ctx), set = items || (await testSet()), rows = [];
  for (let i = 0; i < set.length; i++) {
    if (signal?.aborted) break;
    const it = set[i], t0 = performance.now();
    let got, err = null, ms;
    try { const r = await propose(it.text, ent); got = normalise(r.call || r); ms = r.ms ?? performance.now() - t0; } catch (e) { got = { tool: 'error', args: {} }; err = String(e.message || e); ms = performance.now() - t0; }
    const expect = normalise({ tool: it.tool, args: it.args });
    rows.push({ ...it, i, expect, got: { tool: got.tool, args: got.args }, exact: sameCall(got, expect), toolOk: got.tool === expect.tool, valid: got.tool !== 'error' && validateCall(got, ent).ok, ms, err });
    onProgress?.((i + 1) / set.length, rows[rows.length - 1]);
    if (i % 8 === 7) await new Promise((r) => setTimeout(r, 0));
  }
  return { rows, summary: summarise(rows) };
}
export const rulesPropose = (text, ent) => { const t0 = performance.now(); const r = interpret(text, ent); return { call: { tool: r.tool, args: r.args }, rule: r.rule, ms: performance.now() - t0 }; };
