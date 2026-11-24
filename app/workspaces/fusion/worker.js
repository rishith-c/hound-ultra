// Runs heavy simulator work off the main thread so the console never freezes:
//   mc       the Monte-Carlo missions (monteCarlo from app/core/sim.js, unchanged)
//   predict  replays the current mission to learn which simulated Wi-Fi window the listen in progress will read,
//            so the window can be drawn while it is being collected
import { loadNN } from '../../core/nn.js';
import { monteCarlo, createEngine } from '../../core/sim.js';

self.onmessage = async (e) => {
  const m = e.data;
  try {
    const nn = await loadNN();
    if (m.type === 'mc') {
      const t0 = performance.now();
      const res = await monteCarlo({ nn, runs: m.runs, onProgress: (f) => self.postMessage({ type: 'progress', f, ms: performance.now() - t0 }) });
      self.postMessage({ type: 'done', res, ms: performance.now() - t0 });
    } else if (m.type === 'predict') {
      for (const autoplay of m.autoplay) {
        const eng = createEngine({ nn, seed: m.seed, windows: m.windows, keep: { autoplay } });
        let i = 0;
        while (eng.state.t < m.t - 1e-9) { while (i < m.log.length && m.log[i].t <= eng.state.t + 1e-9) { eng.command(m.log[i].name, m.log[i].args); i++; } eng.step(); }
        const r = eng.state.units['HOUND-01'], L = eng.state.sensors.listen;
        if (!L || L.stop !== m.stop || L.window !== m.window || Math.hypot(r.pos[0] - m.pos[0], r.pos[1] - m.pos[1]) > 0.05) continue;
        const at0 = eng.state.sensors.at; let g = 0;
        while (eng.state.sensors.at === at0 && g++ < 400) eng.step();
        const c = eng.state.sensors.csi;
        self.postMessage({ type: 'predicted', token: m.token, sample: eng.state.sensors.at !== at0 && c && c.ok ? c.sample : null });
        return;
      }
      self.postMessage({ type: 'predicted', token: m.token, sample: null });
    }
  } catch (err) {
    self.postMessage({ type: 'error', token: m.token, message: String(err?.message || err) });
  }
};
