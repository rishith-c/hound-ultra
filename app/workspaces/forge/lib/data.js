// Loads data/forge (written by tools/forge_export.py) once and shares it between the exhibits.
import { fromPython, SIZES } from './net.js';

const base = new URL('../../../../data/forge/', import.meta.url);
export function unb64(s, Type) { const bin = atob(s), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return new Type(u8.buffer); }

let docP = null;
export function loadDoc() {
  docP ||= fetch(new URL('forge.json', base)).then(async (r) => {
    if (!r.ok) throw new Error('The measurements file did not load (' + r.status + '). Run tools/forge_export.py to rebuild data/forge.');
    const d = await r.json();
    d.dec = unb64(d.bundle.decode, Float32Array);
    d.W = {}; d.Wpy = {};
    for (const k of ['messy', 'clean']) { d.Wpy[k] = d.bundle.models[k].w.map((s) => unb64(s, Float32Array)); d.W[k] = d.Wpy[k].map((a, i) => fromPython(a, i)); }
    const q = d.int8;
    d.q = { W: q.W.map((s, i) => fromPython(unb64(s, Int8Array), [0, 2, 4, 6, 8, 10][i], Int8Array)), Wpy: q.W.map((s) => unb64(s, Int8Array)), B: q.B.map((b) => Int32Array.from(b)), mult: q.mult,
      lutSub: unb64(q.lut_sub, Int8Array), lutMotion: unb64(q.lut_motion, Int8Array), outScale: q.out_scale, thrInt: q.thr_int };
    for (const k of ['val', 'test']) { const s = d.scores[k]; s.personZ = unb64(s.person, Float32Array); s.movingZ = unb64(s.moving, Float32Array); s.hid = unb64(s.hidden, Float32Array); delete s.person; delete s.moving; delete s.hidden; }
    d.ood.muA = unb64(d.ood.mu, Float32Array); d.ood.precA = unb64(d.ood.precision, Float32Array);
    return d;
  }).catch((e) => { docP = null; throw e; });
  return docP;
}

// A window file (int8 codes, n * 52 * 200). onProgress(received, total) while it streams in.
const sets = new Map();
export function loadSet(name, onProgress) {
  if (!sets.has(name)) sets.set(name, (async () => {
    const r = await fetch(new URL(name + '.i8', base));
    if (!r.ok) throw new Error('The window file ' + name + '.i8 did not load (' + r.status + ').');
    const total = +r.headers.get('content-length') || 0;
    if (!r.body || !onProgress) return new Int8Array(await r.arrayBuffer());
    const reader = r.body.getReader(), parts = []; let got = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; onProgress(got, total); }
    const out = new Uint8Array(got); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return new Int8Array(out.buffer);
  })().catch((e) => { sets.delete(name); throw e; }));
  return sets.get(name);
}
export const N_PARAMS = SIZES.reduce((a, b) => a + b, 0);
