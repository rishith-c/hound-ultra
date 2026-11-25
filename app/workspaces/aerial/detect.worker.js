// The person detector: a pretrained object-detection network running in this browser, in its own worker.
//
// Model: D-FINE nano (Peng et al., 2024), trained on the COCO photographs, 80 everyday classes; we keep "person".
// Runtime: Transformers.js 3.8.1 on ONNX Runtime Web, WebAssembly backend (see the note in load() about WebGPU).
// The weights (about 15 MB) come from the Hugging Face hub and are cached by the browser after the first load.
const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm', SPARE = 'https://unpkg.com/@huggingface/transformers@3.8.1/dist/';      // the second one is used when the first is blocked or down
const MODEL = 'onnx-community/dfine_n_coco-ONNX';
let T = null, detector = null, backend = null;

const post = (m, t) => self.postMessage(m, t || []);

async function load(id) {
  if (detector) return post({ id, type: 'ready', backend, model: MODEL, cached: true });
  post({ id, type: 'stage', stage: 'library', text: 'Loading the inference library' });
  try { T = await import(LIB).catch(async () => { const L = await import(SPARE + 'transformers.min.js'); L.env.backends.onnx.wasm.wasmPaths = SPARE; return L; }); } catch (e) { throw new Error('The inference library could not be downloaded (' + (e?.message || e) + '). Check the network connection.'); }
  T.env.allowLocalModels = false;
  try { T.env.backends.onnx.logLevel = 'fatal'; } catch { /* older builds */ }
  const files = new Map(); let fromNetwork = false, lastPost = 0;
  const progress_callback = (p) => {
    if (p.status === 'download') fromNetwork = true;
    if (p.status !== 'progress' && p.status !== 'done') return;
    if (p.total) files.set(p.file, { loaded: p.status === 'done' ? p.total : p.loaded, total: p.total });
    const now = performance.now(); if (p.status === 'progress' && now - lastPost < 60) return; lastPost = now;
    let loaded = 0, total = 0; for (const f of files.values()) { loaded += f.loaded; total += f.total; }
    post({ id, type: 'progress', loaded, total, file: p.file });
  };
  const blank = new T.RawImage(new Uint8ClampedArray(64 * 64 * 3).fill(110), 64, 64, 3);
  let note = null;
  const tryDevice = async (device) => {
    const t0 = performance.now();
    const d = await T.pipeline('object-detection', MODEL, { device, dtype: 'fp32', progress_callback, session_options: { logSeverityLevel: 4 } });
    const tl = performance.now();
    await d(blank, { threshold: 0.5 });           // one warm-up run: this is where an unsupported operator shows up
    return { d, loadMs: tl - t0, warmMs: performance.now() - tl };
  };
  // Backend. WebGPU was tested first (November 2026, ONNX Runtime Web as shipped with Transformers.js 3.8.1): it
  // refuses this model ("using ceil() in shape computation is not yet supported for MaxPool"), and after that
  // failure the WebAssembly session will not start either. So the detector goes straight to WebAssembly, where
  // one 640 px tile takes about half a second on a laptop processor, and says which backend it is using.
  let got = null;
  note = 'WebGPU cannot run this model\'s pooling layers yet (tested), so it runs on the processor.';
  post({ id, type: 'stage', stage: 'weights', text: 'Loading the model weights' });
  try { got = await tryDevice('wasm'); backend = 'wasm'; } catch (e) { throw new Error('The model could not be started (' + String(e?.message || e).slice(0, 160) + ').'); }
  detector = got.d;
  let bytes = 0; for (const f of files.values()) bytes += f.total;
  post({ id, type: 'ready', backend, note, model: MODEL, bytes, loadMs: got.loadMs, warmMs: got.warmMs, fromNetwork, threads: T.env.backends.onnx.wasm?.numThreads ?? null });
}

async function detect(m) {
  if (!detector) throw new Error('The model is not loaded.');
  const img = new T.RawImage(new Uint8ClampedArray(m.rgba), m.w, m.h, 4);
  const t0 = performance.now();
  const out = await detector(img, { threshold: m.minScore ?? 0.2 });
  const ms = performance.now() - t0, people = [], others = {};
  for (const o of out) {
    if (o.label === 'person') people.push({ score: o.score, box: [o.box.xmin, o.box.ymin, o.box.xmax, o.box.ymax] });
    else if (o.score >= 0.4) others[o.label] = (others[o.label] || 0) + 1;
  }
  post({ id: m.id, type: 'done', result: { people, others, ms } });
}

self.onmessage = async (e) => {
  const m = e.data;
  try { if (m.op === 'load') await load(m.id); else if (m.op === 'detect') await detect(m); }
  catch (err) { post({ id: m.id, type: 'error', message: String(err?.message || err) }); }
};
