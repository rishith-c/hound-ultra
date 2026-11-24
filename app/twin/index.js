// HOUND Command's 3-D digital twin. Public API (docs/ARCHITECTURE.md, "The 3-D twin"):
//
//   import { createTwin } from '../../twin/index.js';
//   const twin = await createTwin(hostElement, ctx, { interactive: true, quality: 'high' });
//   twin.setCamera('orbit' | 'top' | 'follow' | 'fpv' | 'cinematic');   twin.focus({ type, id });
//   twin.setLayer(name, on);  twin.layers() -> [{ id, label, on }]
//   twin.setLight('dawn' | 'day' | 'night');  twin.setSafeArea({ left, top, right, bottom })   pixels your panels cover
//   twin.start(); twin.stop(); twin.resize(); twin.dispose();  twin.screenshot() -> dataURL;  twin.three
//
// Options: interactive (true), quality ('high' | 'low'), camera (starting mode, 'orbit'), caption (true: a one-line
// "simulated" note in the corner), autostart (true). ctx needs { sim, bus, world, kit, select() }; nothing else of the
// app shell is used, so the landing page can mount the twin as a hero: { interactive: false, camera: 'cinematic' }.
// Also on the twin: cameraMode, cameraModes, shot (the director's current shot), stats { fps, ms, calls, triangles },
// ok (false when WebGL is missing and a message is shown instead).
//
// What is real here: nothing is measured. The site is a simulated training exercise drawn from app/core/world.js
// at 1 unit = 1 metre; every moving thing follows ctx.sim.state. People are drawn only where the sensors found them.
export const CAMERA_MODES = ['orbit', 'top', 'follow', 'fpv', 'cinematic'];

let cssAdded = false;
function addCss() { if (cssAdded) return; cssAdded = true; const href = new URL('./twin.css', import.meta.url).href; if ([...document.styleSheets].some((s) => s.href === href)) return; const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.append(l); }
function message(host, title, body) {
  host.classList.add('twin-host');
  const el = document.createElement('div'); el.className = 'twin-message'; el.setAttribute('role', 'status');
  const b = document.createElement('b'); b.textContent = title; const p = document.createElement('span'); p.textContent = body;
  const bar = document.createElement('div'); bar.className = 'twin-bar'; bar.append(document.createElement('i'));
  el.append(b, p, bar); host.append(el);
  return { el, set(frac, text) { bar.firstChild.style.width = Math.round(frac * 100) + '%'; if (text) p.textContent = text; }, fail(t2, b2) { b.textContent = t2; p.textContent = b2; bar.remove(); el.setAttribute('role', 'alert'); }, done() { el.classList.add('out'); setTimeout(() => el.remove(), 600); } };
}
function hasWebGL2() { try { const c = document.createElement('canvas'); return !!c.getContext('webgl2'); } catch { return false; } }
function stub(host) {
  const no = () => false;
  return { ok: false, setCamera: no, focus: no, setLayer: no, setLight: no, setSafeArea() {}, light: 'dawn', layers: () => [], start() {}, stop() {}, resize() {}, dispose() { host.querySelector(':scope > .twin-message')?.remove(); host.classList.remove('twin-host'); }, screenshot: () => '', three: null, cameraMode: 'orbit', cameraModes: CAMERA_MODES, shot: '', stats: { fps: 0, ms: 0, calls: 0, triangles: 0 }, running: false };
}

export async function createTwin(host, ctx, opts = {}) {
  if (!host) throw new Error('createTwin needs a host element');
  addCss();
  const msg = message(host, 'Building the 3-D site', 'Loading the renderer');
  if (!hasWebGL2()) { msg.fail('The 3-D view cannot start', 'This browser or device has WebGL 2 switched off. Turn on hardware acceleration, or open the page in a current Chrome, Edge, Safari or Firefox. The rest of the console still works.'); return stub(host); }
  let engine;
  try {
    const { createEngine } = await import('./engine.js');
    engine = await createEngine(host, ctx, { ...opts, onProgress: (f, text) => msg.set(f, text) });
  } catch (e) {
    console.warn('[twin] could not start:', e);
    for (const s of ['canvas.twin-canvas', '.twin-overlay', '.twin-caption']) host.querySelector(':scope > ' + s)?.remove();
    msg.fail('The 3-D view could not start', 'The graphics system refused to start (' + String((e && e.message) || e).slice(0, 140) + '). Reload the page; if it happens again, try another browser. The rest of the console still works.');
    return stub(host);
  }
  msg.done();
  return {
    ok: true,
    setCamera: (m, o) => engine.setCamera(m, o), focus: (sel) => engine.focus(sel),
    setLayer: (id, on) => engine.setLayer(id, on), layers: () => engine.layers(),
    setLight: (m, o) => engine.setLight(m, o), setSafeArea: (a) => engine.setSafeArea(a), get light() { return engine.light; },
    start: () => engine.start(), stop: () => engine.stop(), resize: () => engine.resize(), dispose: () => engine.dispose(),
    screenshot: () => engine.screenshot(), three: engine.three,
    get cameraMode() { return engine.cams.mode; }, cameraModes: CAMERA_MODES, get shot() { return engine.cams.shot; },
    get stats() { return engine.stats; }, get running() { return engine.running; },
    engine,                                             // for the test page and for debugging; not part of the contract
  };
}
export default createTwin;
