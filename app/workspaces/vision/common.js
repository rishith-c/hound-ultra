// Vision lab: shared machinery for the seven exhibits.
// Transformers.js is imported only when an exhibit asks for a model. Nothing downloads until the visitor presses a button.
export const TF_VERSION = '3.8.1';
const TF_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@' + TF_VERSION + '/+esm';
export const ROOT = new URL('../../../', import.meta.url);           // repository root, so data/ and assets/ resolve when served from any path
export const asset = (p) => new URL(p, ROOT).href;

let tfPromise = null;
export function tf() {
  tfPromise ||= import(TF_URL).then((T) => {
    T.env.allowLocalModels = false;
    try { T.env.backends.onnx.logLevel = 'error'; T.env.backends.onnx.logSeverityLevel = 3; } catch { /* older builds */ }
    return T;
  }).catch((e) => { tfPromise = null; throw new Error('The model runtime (Transformers.js ' + TF_VERSION + ') did not download. Check the connection and try again. ' + (e.message || e)); });
  return tfPromise;
}

let gpuPromise = null;
// { ok, vendor, arch, f16 }. Asked once. WebGPU is the fast path; WebAssembly on the processor is the fallback.
export function gpu() {
  gpuPromise ||= (async () => {
    try {
      const a = await navigator.gpu?.requestAdapter();
      if (!a) return { ok: false };
      return { ok: true, vendor: a.info?.vendor || '', arch: a.info?.architecture || '', f16: a.features.has('shader-f16') };
    } catch { return { ok: false }; }
  })();
  return gpuPromise;
}

export async function isCached(repo) {
  try { const c = await caches.open('transformers-cache'); const keys = await c.keys(); return keys.some((k) => k.url.includes('/' + repo + '/') && /\.onnx/.test(k.url)); } catch { return false; }
}

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const fmtMs = (ms) => (ms == null ? 'not yet' : ms < 10 ? ms.toFixed(1) + ' ms' : ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + ' s');
export const fmtMB = (mb) => (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + ' MB';
export function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function gauss(r) { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }

const hex = (c) => { const m = c.replace('#', ''); const n = parseInt(m.length === 3 ? m.replace(/./g, '$&$&') : m, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export function ramp(stops) {
  const s = stops.map(([t, c]) => [t, typeof c === 'string' ? hex(c) : c]);
  return (t) => {
    if (!(t > s[0][0])) return s[0][1];
    for (let i = 1; i < s.length; i++) if (t <= s[i][0]) { const [t0, a] = s[i - 1], [t1, b] = s[i], u = (t - t0) / (t1 - t0); return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]; }
    return s[s.length - 1][1];
  };
}
// Data ramps start from the heat tokens in tokens.css.
export const HEAT = ramp([[0, '#10151c'], [0.2, '#2b3f6b'], [0.42, '#7a3f8f'], [0.64, '#d8504d'], [0.84, '#ffb24a'], [1, '#fff3c4']]);
export const DEPTH = ramp([[0, '#0b0e13'], [0.18, '#1b2a4a'], [0.4, '#2f6a8f'], [0.62, '#41d6a0'], [0.82, '#ffd27a'], [1, '#fff3c4']]);
const tokCache = new Map();
export const tok = (name) => { if (!tokCache.has(name)) tokCache.set(name, getComputedStyle(document.documentElement).getPropertyValue(name).trim()); return tokCache.get(name); };
export const clearTok = () => tokCache.clear();

// ---------- signal processing ----------
export const dsp = {
  // In-place radix-2 FFT. re, im: Float64Array of length 2^k.
  fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const a = i + k, b = a + len / 2, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr; re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
    }
  },
  // Power spectrum of a real signal: Hann window, zero-padded to nfft. Returns { power: Float64Array(nfft/2), df }.
  spectrum(x, fs, nfft = 0) {
    let n = 1; while (n < Math.max(x.length, nfft)) n <<= 1;
    const re = new Float64Array(n), im = new Float64Array(n), m = x.length; let mean = 0;
    for (let i = 0; i < m; i++) mean += x[i]; mean /= m || 1;
    for (let i = 0; i < m; i++) re[i] = (x[i] - mean) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (m - 1 || 1)));
    dsp.fft(re, im);
    const power = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) power[i] = re[i] * re[i] + im[i] * im[i];
    return { power, df: fs / n };
  },
  // Second-order Butterworth band-pass as two biquads (high-pass at lo, low-pass at hi). Returns a stateful filter: f(x) -> y, f.reset().
  bandpass(fs, lo, hi) {
    const mk = (type, fc) => {
      const w = 2 * Math.PI * fc / fs, c = Math.cos(w), al = Math.sin(w) / Math.SQRT2;
      const a0 = 1 + al; let b0, b1, b2;
      if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; } else { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
      const k = { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: -2 * c / a0, a2: (1 - al) / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
      return k;
    };
    const st = [mk('hp', lo), mk('lp', hi)];
    const f = (x) => { let v = x; for (const k of st) { const y = k.b0 * v + k.b1 * k.x1 + k.b2 * k.x2 - k.a1 * k.y1 - k.a2 * k.y2; k.x2 = k.x1; k.x1 = v; k.y2 = k.y1; k.y1 = y; v = y; } return v; };
    f.reset = () => st.forEach((k) => { k.x1 = k.x2 = k.y1 = k.y2 = 0; });
    return f;
  },
  // Removes the slow trend: subtracts a centred moving average of 'win' samples.
  detrend(x, win) {
    const n = x.length, out = new Float64Array(n), half = Math.max(1, win >> 1); let s = 0, c = 0, lo = 0, hi = -1;
    for (let i = 0; i < n; i++) { const a = Math.max(0, i - half), b = Math.min(n - 1, i + half); while (hi < b) { s += x[++hi]; c++; } while (lo < a) { s -= x[lo++]; c--; } out[i] = x[i] - s / c; }
    return out;
  },
};

// ---------- images ----------
export function loadImage(src) {
  return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async'; im.onload = () => res(im); im.onerror = () => rej(new Error('That image could not be read.')); im.src = src; });
}
// Draws any image source into a canvas no larger than maxSide on its long side. Returns the canvas.
export function toCanvas(src, maxSide = 1600) {
  const w0 = src.naturalWidth || src.videoWidth || src.width, h0 = src.naturalHeight || src.videoHeight || src.height;
  const s = Math.min(1, maxSide / Math.max(w0, h0)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w0 * s)); c.height = Math.max(1, Math.round(h0 * s));
  c.getContext('2d', { willReadFrequently: true }).drawImage(src, 0, 0, c.width, c.height);
  return c;
}
export function download(name, data, type = 'application/octet-stream') {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type })), a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---------- the lab object handed to every exhibit ----------
export function createLab(ctx) {
  const { h, icon, realityTag } = ctx.kit;
  const models = new Map();       // key -> card
  const streams = new Set();      // every camera / microphone stream opened by an exhibit
  const listeners = new Set();
  const lab = { ctx, tf, gpu, dsp, asset, clamp, fmtMs, fmtMB, HEAT, DEPTH, ramp, rng, gauss, tok, loadImage, toCanvas, download, models, image: null, samples: [] };
  lab.on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const emit = (type, data) => listeners.forEach((fn) => { try { fn(type, data); } catch (e) { console.error(e); } });

  // The one image shared by the three photo exhibits: pick it once, it follows you.
  // image = { canvas, name, kind, note, gsd (metres per pixel, or null), view }
  lab.setImage = (image) => { lab.image = image; emit('image', image); };
  lab.useSample = async (s) => {
    const im = await loadImage(asset(s.src)), canvas = toCanvas(im, 1600);
    lab.setImage({ canvas, name: s.label, kind: s.kind, note: s.note, gsd: s.gsd ? s.gsd * (im.naturalWidth / canvas.width) : null, view: s.view, id: s.id });
  };
  lab.useFile = async (file) => {
    if (!file || !/^image\//.test(file.type)) throw new Error('That file is not an image. Use a JPEG, PNG or WebP.');
    const url = URL.createObjectURL(file);
    try { const im = await loadImage(url); lab.setImage({ canvas: toCanvas(im, 1600), name: file.name || 'Your image', kind: 'Your image', note: 'Stays on this computer', gsd: null, view: 'unknown', id: 'own' }); }
    finally { URL.revokeObjectURL(url); }
  };

  // Camera and microphone: always open through the lab, so leaving the workspace releases them.
  lab.getUserMedia = async (constraints) => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not offer a camera or microphone to web pages.');
    const s = await navigator.mediaDevices.getUserMedia(constraints); streams.add(s); emit('media', streams.size); return s;
  };
  lab.release = (s) => { if (!s) return; s.getTracks().forEach((t) => t.stop()); streams.delete(s); emit('media', streams.size); };
  lab.releaseAll = () => { [...streams].forEach(lab.release); };
  lab.mediaError = (e) => (e?.name === 'NotAllowedError' ? 'Permission was not given. The bundled synthetic source is used instead.' : e?.name === 'NotFoundError' ? 'No device was found. The bundled synthetic source is used instead.' : (e?.message || String(e)));

  // A model card. spec = { key, name, repo, role, mb, what, variants: [{ device: 'webgpu'|'wasm', dtype, mb }], make(T, { device, dtype, progress_callback, session_options }) }
  // card.ensure() loads on first call (shows progress), card.ran(ms) records an inference time.
  lab.model = (spec) => {
    if (models.has(spec.key)) return models.get(spec.key);
    const card = { spec, status: 'idle', instance: null, device: null, dtype: null, loadMs: null, lastMs: null, mb: spec.mb, error: null, els: new Set() };
    let promise = null;
    const render = () => card.els.forEach((el) => el.paint());
    card.ensure = () => {
      if (card.instance) return Promise.resolve(card.instance);
      promise ||= (async () => {
        card.status = 'loading'; card.error = null; card.progress = { loaded: 0, total: 0, file: '' }; render(); emit('models');
        const t0 = performance.now(), T = await tf(), g = await gpu();
        const variants = spec.variants.filter((v) => v.device !== 'webgpu' || g.ok);
        let lastErr = null;
        for (const v of variants) {
          const files = new Map();
          const progress_callback = (p) => {
            if (p.status !== 'progress' && p.status !== 'done') return;
            if (p.total) files.set(p.file, [p.loaded || p.total, p.total]);
            let l = 0, t = 0; files.forEach(([a, b]) => { l += a; t += b; });
            card.progress = { loaded: l, total: Math.max(t, (v.mb || spec.mb) * 1e6 * 0.98), file: p.file }; render();
          };
          try {
            card.device = v.device; card.dtype = v.dtype; card.mb = v.mb || spec.mb; render();
            card.instance = await spec.make(T, { device: v.device, dtype: v.dtype, progress_callback, session_options: { logSeverityLevel: 3 } });
            card.loadMs = performance.now() - t0; card.status = 'ready'; card.fellBack = v !== variants[0] || (!g.ok && spec.variants[0].device === 'webgpu'); render(); emit('models');
            return card.instance;
          } catch (e) { lastErr = e; console.warn('[vision] ' + spec.name + ' on ' + v.device + ' failed, trying the next option', e); }
        }
        throw lastErr || new Error('No way to run this model on this computer.');
      })().catch((e) => { card.status = 'error'; card.mb = spec.mb; card.error = String(e?.message || e).slice(0, 220); promise = null; render(); emit('models'); throw e; });
      return promise;
    };
    card.ran = (ms) => { card.lastMs = ms; render(); };
    // A DOM view of the card. Several exhibits may show the same model.
    card.view = ({ compact = false } = {}) => {
      const bar = h('div.bar', null, h('i')), state = h('span.status', null, 'Not loaded'), meta = h('dl.kv.num.vision-model-kv'), act = h('div.vision-model-act'), err = h('div');
      const el = h('div.vision-model' + (compact ? '.compact' : ''), null,
        h('div.vision-model-top', null, h('div.vision-model-name', null, h('b', null, spec.name), h('span', null, spec.role)), state),
        compact ? null : h('p.vision-model-what', null, spec.what), bar, meta, err, act);
      let cached = null; isCached(spec.repo).then((c) => { cached = c; el.paint(); });
      const row = (k, v) => [h('dt', null, k), h('dd', null, v)];
      el.paint = () => {
        const s = card.status, p = card.progress || { loaded: 0, total: 0 };
        el.dataset.state = s;
        state.className = 'status ' + (s === 'ready' ? 'ok' : s === 'loading' ? 'accent live' : s === 'error' ? 'danger' : 'off');
        state.textContent = s === 'ready' ? 'In memory' : s === 'loading' ? (p.total ? 'Loading ' + Math.min(100, Math.round(100 * p.loaded / p.total)) + ' %' : 'Starting') : s === 'error' ? 'Failed' : 'Not loaded';
        bar.hidden = s !== 'loading'; bar.firstChild.style.width = (p.total ? Math.min(100, 100 * p.loaded / p.total) : 2) + '%';
        const where = card.device ? (card.device === 'webgpu' ? 'This computer, graphics chip (WebGPU)' : 'This computer, processor (WebAssembly)') : 'This computer';
        meta.replaceChildren(
          ...row('Download', s === 'loading' && p.total ? (p.loaded / 1e6).toFixed(1) + ' of ' + fmtMB(p.total / 1e6) : fmtMB(card.mb) + (cached ? ', already cached' : s === 'ready' ? ', now cached' : ', once')),
          ...row('Runs on', where + (card.dtype ? ' · ' + card.dtype : '')),
          ...(s === 'ready' ? row('Loaded in', fmtMs(card.loadMs)) : []),
          ...(card.lastMs != null ? row('Last run', fmtMs(card.lastMs)) : []),
          ...row('Source', h('a', { href: 'https://huggingface.co/' + spec.repo, target: '_blank', rel: 'noopener' }, spec.repo)));
        err.replaceChildren(s === 'error' ? h('div.note.danger', null, icon('alert'), h('div', null, h('b', null, 'The model did not load. '), card.error, ' The rest of the page still works.')) : (card.fellBack && s === 'ready' ? h('div.note.quiet', null, icon('info'), h('div', null, 'WebGPU was not usable here, so this runs on the processor. Expect it to be slower.')) : ''));
        act.replaceChildren(s === 'idle' || s === 'error' ? h('button.btn.btn-sm', { onclick: () => card.ensure().catch(() => {}) }, icon('download'), (s === 'error' ? 'Try again' : 'Load model') + ' · ' + fmtMB(card.mb)) : '');
      };
      card.els.add(el); el.paint(); return el;
    };
    models.set(spec.key, card); emit('models');
    return card;
  };

  // ---------- exhibit frame ----------
  // frame(el, { n, title, tags: ['live-ai', …], lede: [sentence, sentence] }) -> { stage, side, section(title, …nodes), dossier({ research, field, failure }) }
  lab.frame = (el, { n, title, tags = [], lede = [] }) => {
    const stage = h('div.vision-stage'), side = h('aside.vision-side', { 'aria-label': title + ': controls and notes' });
    el.classList.add('vision-ex');
    el.append(h('header.vision-ex-head', null,
      h('span.vision-ex-n.num', { 'aria-hidden': 'true' }, n), h('div.vision-ex-title', null, h('h2', null, title), h('div.row.tight', null, tags.map((t) => realityTag(t)))),
      h('p.vision-ex-lede', null, lede.join(' '))), h('div.vision-ex-body', null, stage, side));
    const section = (name, ...nodes) => { const s = h('section.vision-sec', { 'aria-label': name }, h('h3', null, name), ...nodes); side.append(s); return s; };
    // research: [{ who, year, title, url, note }]. field: what would have to be true, and what is unknown. failure: one failure case we found.
    const dossier = ({ research = [], field, failure, extra = [] }) => {
      const d = h('section.vision-dossier', { 'aria-label': 'Research, field conditions and what we learned' },
        h('div.vision-dos-row', null, h('h4', null, icon('report', 14), 'Research'), h('ul', null, research.map((r) => h('li', null, h('a', { href: r.url, target: '_blank', rel: 'noopener' }, r.title), h('span', null, ' ' + r.who + ', ' + r.year + '.' + (r.note ? ' ' + r.note : '')))))),
        field ? h('div.vision-dos-row', null, h('h4', null, icon('compass', 14), 'For this to work in the field'), h('p', null, field)) : null,
        failure ? h('div.vision-dos-row.fail', null, h('h4', null, icon('alert', 14), 'What we learned'), h('p', null, failure)) : null, ...extra);
      side.append(d); return d;
    };
    return { stage, side, section, dossier };
  };

  // A big live number: readout('Pulse', 'beats per minute') -> { el, set(value, sub) }
  lab.readout = (label, unit = '') => {
    const b = h('b.num', null, '–'), u = h('small', null, unit), sub = h('span', null, label);
    const el = h('div.vision-readout', null, h('div', null, b, u), sub);
    return { el, set(v, s) { b.textContent = v; if (s != null) sub.textContent = s; }, unit(x) { u.textContent = x; } };
  };

  // A labelled slider: slider({ label, min, max, step, value, fmt: (v) => text, assumed, onInput }) -> element with .value and .set(v)
  lab.slider = ({ label, min, max, step = 1, value, fmt = (v) => String(v), assumed = false, onInput, title }) => {
    const out = h('output', null, fmt(value));
    const input = h('input.slider', { type: 'range', min, max, step, value, 'aria-label': label, title, oninput: () => { const v = +input.value; out.textContent = fmt(v); input.style.setProperty('--p', (100 * (v - min) / (max - min)) + '%'); onInput?.(v); } });
    input.style.setProperty('--p', (100 * (value - min) / (max - min)) + '%');
    const el = h('label.vision-field', { title }, h('span', null, label, assumed ? h('span.vision-assumed', { title: 'A design value.' }, 'design value') : null), out, input);
    Object.defineProperty(el, 'value', { get: () => +input.value });
    el.set = (v) => { input.value = v; out.textContent = fmt(+input.value); input.style.setProperty('--p', (100 * (+input.value - min) / (max - min)) + '%'); };
    return el;
  };

  // Sample strip + your own image. Returns an element; picking calls lab.setImage.
  lab.picker = ({ filter = null, label = 'Image' } = {}) => {
    const input = h('input', { type: 'file', accept: 'image/*', hidden: true, 'aria-hidden': 'true', tabindex: -1, onchange: async (e) => { try { await lab.useFile(e.target.files[0]); } catch (er) { ctx.shell.toast(er.message, { level: 'alert' }); } e.target.value = ''; } });
    const strip = h('div.vision-samples', { role: 'listbox', 'aria-label': 'Sample images' });
    const paint = () => {
      const list = lab.samples.filter((s) => !filter || filter(s));
      strip.replaceChildren(...list.map((s) => h('button.vision-sample', { role: 'option', 'aria-selected': String(lab.image?.id === s.id), title: s.label + '. ' + s.note + '. ' + s.kind + '.', onclick: () => lab.useSample(s).catch((e) => ctx.shell.toast(e.message, { level: 'alert' })) },
        h('img', { src: asset(s.thumb || s.src), alt: '', loading: 'lazy' }), h('span', null, s.short || s.label))),
        h('button.vision-sample.own', { 'aria-selected': String(lab.image?.id === 'own'), title: 'Use your own image. It never leaves this computer.', onclick: () => input.click() }, icon('upload', 18), h('span', null, 'Your image')));
    };
    const off = lab.on((t) => { if (t === 'image' || t === 'samples') paint(); });
    paint();
    const el = h('div.vision-picker', null, strip, input, h('p.caption', null, 'Samples are AI-generated illustrations, not photographs of real events. Drop your own image anywhere on the view; it stays on this computer.'));
    el.dispose = off; return el;
  };
  // Makes an element accept a dropped or pasted image.
  lab.dropTarget = (el) => {
    const veil = h('div.vision-dropveil', { hidden: true }, icon('upload', 28), h('b', null, 'Drop the image to use it'), h('span', null, 'It stays on this computer'));
    el.append(veil); let depth = 0;
    el.addEventListener('dragenter', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); depth++; veil.hidden = false; } });
    el.addEventListener('dragover', (e) => { if (!veil.hidden) e.preventDefault(); });
    el.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) veil.hidden = true; });
    el.addEventListener('drop', async (e) => { e.preventDefault(); depth = 0; veil.hidden = true; try { await lab.useFile(e.dataTransfer.files[0]); } catch (er) { ctx.shell.toast(er.message, { level: 'alert' }); } });
  };

  // ---------- image viewport with rulers ----------
  // viewport(host) -> vp. vp.setImage(canvas, gsd); vp.draw = (g, vp) => {…} overlay painter in CSS pixels; vp.rect = { x, y, w, h, s };
  // vp.toImage(clientX, clientY) -> [ix, iy] or null; vp.fromImage(ix, iy) -> [x, y] in overlay CSS pixels; vp.redraw().
  lab.viewport = (host, { rulers = true, onClick, onMove, onLeave, cursor = 'crosshair' } = {}) => {
    const base = h('canvas.vision-vp-base'), over = h('canvas.vision-vp-over', { tabindex: 0, role: 'img' });
    const wrap = h('div.vision-vp', null, base, over); host.append(wrap);
    const M = rulers ? 26 : 8;
    const vp = { el: wrap, over, image: null, gsd: null, rect: { x: 0, y: 0, w: 0, h: 0, s: 1 }, draw: null, W: 0, H: 0 };
    let raf = 0;
    const layout = () => {
      const r = wrap.getBoundingClientRect(); if (!r.width || !r.height) return;
      const dpr = Math.min(2, devicePixelRatio || 1); vp.W = r.width; vp.H = r.height; vp.dpr = dpr;
      for (const c of [base, over]) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
      if (vp.image) {
        const iw = vp.image.width, ih = vp.image.height, s = Math.min((r.width - M - 10) / iw, (r.height - M - 10) / ih);
        const w = iw * s, hh = ih * s; vp.rect = { x: Math.round(M + (r.width - M - 10 - w) / 2), y: Math.round(M + (r.height - M - 10 - hh) / 2), w, h: hh, s };
        const g = base.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, r.width, r.height); g.imageSmoothingQuality = 'high';
        g.drawImage(vp.image, vp.rect.x, vp.rect.y, w, hh);
      }
      paint();
    };
    const paint = () => {
      const g = over.getContext('2d'); g.setTransform(vp.dpr || 1, 0, 0, vp.dpr || 1, 0, 0); g.clearRect(0, 0, vp.W, vp.H);
      if (!vp.image) return;
      if (rulers) drawRulers(g);
      g.save(); try { vp.draw?.(g, vp); } finally { g.restore(); }
    };
    const drawRulers = (g) => {
      const { x, y, w, h: hh, s } = vp.rect, gsd = vp.gsd;
      g.save(); g.font = '10px ' + tok('--mono'); g.fillStyle = tok('--text-3'); g.strokeStyle = tok('--line-3'); g.lineWidth = 1;
      // choose a tick step: metres if the ground resolution is stated, else pixels
      const unitPerPx = gsd || 1, span = (vp.image.width) * unitPerPx, nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
      const step = nice.find((v) => span / v <= 12) || 2000, minor = step / 5;
      const tick = (horizontal, len, extent) => {
        for (let v = 0; v <= extent * unitPerPx + 1e-6; v += minor) {
          const major = Math.abs(v / step - Math.round(v / step)) < 1e-6, p = (v / unitPerPx) * s;
          g.beginPath();
          if (horizontal) { const px = Math.round(x + p) + 0.5; g.moveTo(px, y - 4); g.lineTo(px, y - 4 - (major ? 7 : 3)); } else { const py = Math.round(y + p) + 0.5; g.moveTo(x - 4, py); g.lineTo(x - 4 - (major ? 7 : 3), py); }
          g.stroke();
          if (major) { const t = (step < 1 ? v.toFixed(1) : String(Math.round(v))); if (horizontal) { g.textAlign = 'left'; g.fillText(t, x + p + 3, y - 12); } else { g.save(); g.translate(x - 13, y + p + 3); g.rotate(-Math.PI / 2); g.textAlign = 'right'; g.fillText(t, 0, 0); g.restore(); } }
        }
      };
      tick(true, w, vp.image.width); tick(false, hh, vp.image.height);
      g.textAlign = 'right'; g.fillText(gsd ? 'm' : 'px', x - 6, y - 12);
      g.strokeStyle = tok('--line-2'); g.strokeRect(Math.round(x) - 0.5, Math.round(y) - 0.5, Math.round(w) + 1, Math.round(hh) + 1);
      g.restore();
    };
    vp.redraw = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; paint(); }); };
    vp.setImage = (canvas, gsd = null) => { vp.image = canvas; vp.gsd = gsd; layout(); };
    vp.setGsd = (gsd) => { vp.gsd = gsd; paint(); };
    vp.toImage = (cx, cy) => { const r = over.getBoundingClientRect(), x = (cx - r.left - vp.rect.x) / vp.rect.s, y = (cy - r.top - vp.rect.y) / vp.rect.s; return vp.image && x >= 0 && y >= 0 && x < vp.image.width && y < vp.image.height ? [x, y] : null; };
    vp.fromImage = (ix, iy) => [vp.rect.x + ix * vp.rect.s, vp.rect.y + iy * vp.rect.s];
    over.style.cursor = cursor;
    over.addEventListener('click', (e) => { const p = vp.toImage(e.clientX, e.clientY); if (p) onClick?.(p, e); });
    over.addEventListener('contextmenu', (e) => { const p = vp.toImage(e.clientX, e.clientY); if (p && onClick) { e.preventDefault(); onClick(p, e, true); } });
    over.addEventListener('pointermove', (e) => { const p = vp.toImage(e.clientX, e.clientY); onMove?.(p, e); });
    over.addEventListener('pointerleave', () => onLeave?.());
    const ro = new ResizeObserver(layout); ro.observe(wrap);
    vp.dispose = () => ro.disconnect();
    return vp;
  };

  // A requestAnimationFrame loop that an exhibit starts in onShow and stops in onHide.
  lab.loop = (fn) => { let id = 0, last = 0; const step = (t) => { id = requestAnimationFrame(step); const dt = last ? Math.min(0.1, (t - last) / 1000) : 0.016; last = t; fn(dt, t / 1000); }; return { start() { if (!id) { last = 0; id = requestAnimationFrame(step); } }, stop() { cancelAnimationFrame(id); id = 0; }, get running() { return !!id; } }; };
  lab.reduced = () => ctx.kit.reducedMotion();
  lab.emit = emit;
  return lab;
}
