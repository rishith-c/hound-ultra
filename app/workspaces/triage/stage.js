// A film stage for the Demo heroes of Triage and Training: the twin, driven by a private run of the mission engine, with
// its own camera rig and a few lights, ribbons and markers of its own. The console's own mission is not touched.
import { createTwin } from '../../twin/index.js';
import { createEngine } from '../../core/sim.js';

export function ensureCss(ctx) { if (!document.getElementById('th-css')) document.head.append(ctx.kit.h('link', { id: 'th-css', rel: 'stylesheet', href: new URL('./hero.css', import.meta.url).href })); }

// ---------- a private engine, advanced in short slices so the page never stalls ----------
export function newEngine(ctx, emit, autoplay = true) { const e = createEngine({ nn: ctx.nn, windows: 'scripted', keep: { autoplay, speed: 1 }, emit: (t, p) => emit?.(t, p) }); e.command('start'); return e; }
export async function advance(engine, until, alive = () => true) {
  for (let n = 0; n < 24000 && !engine.done; ) {
    const t0 = performance.now();
    while (n++ < 24000 && !engine.done && performance.now() - t0 < 7) { if (until(engine.state)) return true; engine.step(); }
    await new Promise((r) => setTimeout(r, 0));
    if (!alive()) return false;
  }
  return until(engine.state);
}

function localBus(outer) {
  const m = new Map(), offs = [];
  const on = (e, f) => { if (!m.has(e)) m.set(e, new Set()); m.get(e).add(f); return () => m.get(e)?.delete(f); };
  const emit = (e, p) => { for (const f of m.get(e) || []) f(p); };
  for (const e of ['prefs', 'mode']) offs.push(outer.on(e, (p) => emit(e, p)));
  return { on, off: (e, f) => m.get(e)?.delete(f), emit, dispose: () => offs.forEach((f) => typeof f === 'function' && f()) };
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const ease = (x) => { x = clamp(x, 0, 1); return x * x * x * (x * (x * 6 - 15) + 10); };
const wrap = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };

export async function createStage(host, ctx, engine, { light = 'dawn' } = {}) {
  ensureCss(ctx);
  const bus = localBus(ctx.bus), box = { engine };
  const sim = { get state() { return box.engine.state; }, plan: (...a) => box.engine.plan(...a), get grid() { return box.engine.grid; }, command: (...a) => box.engine.command(...a) };
  const priv = Object.create(ctx, { sim: { value: sim }, bus: { value: bus }, select: { value: () => {} }, selection: { value: null } });
  const twin = await createTwin(host, priv, { interactive: false, caption: false, autostart: false, camera: 'orbit' });
  if (!twin.ok) return { ok: false, dispose() { twin.dispose(); bus.dispose(); } };
  const T = twin.engine.t, { THREE, scene, camera } = T, cams = twin.engine.cams;
  twin.setLayer('labels', false); twin.setLayer('roof', false); twin.setLight(light, { instant: true });
  const reduced = () => ctx.kit.reducedMotion(), hdr = (c, k) => new THREE.Color(ctx.kit.cssVar(c)).multiplyScalar(k);

  // ---------- the camera rig: one pose, critically damped towards a goal, plus what the viewer drags ----------
  const pose = () => ({ x: 62, y: 1, z: -42, yaw: -0.4, pitch: 0.5, dist: 60, fov: 36 });
  const goal = pose(), cur = pose(), vel = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, dist: 0, fov: 0 }, KEYS = Object.keys(vel);
  const rig = { goal, cur, rate: 1.1, snap: true, dof: 0, drift: 0, glass: { x: 0, z: 0, r: 0 }, dragYaw: 0, dragPitch: 0, zoom: 1 };
  Object.defineProperty(cams, 'dof', { get: () => rig.dof, configurable: true });        // this twin instance only: the rig owns focus and the glass wall
  for (const k of ['x', 'z', 'r']) Object.defineProperty(cams.glass, k, { get: () => rig.glass[k], set() {}, configurable: true });
  let down = null, idle = 99;
  const onDown = (e) => { if (e.target.closest('button,a,input')) return; down = { x: e.clientX, y: e.clientY }; host.parentElement.setPointerCapture?.(e.pointerId); };
  const onMove = (e) => { if (!down) return; rig.dragYaw -= (e.clientX - down.x) * 0.004; rig.dragPitch = clamp(rig.dragPitch + (e.clientY - down.y) * 0.003, -0.5, 0.9); down.x = e.clientX; down.y = e.clientY; idle = 0; };
  const onUp = () => { down = null; };
  const onWheel = (e) => { e.preventDefault(); rig.zoom = clamp(rig.zoom * Math.exp(e.deltaY * 0.0012), 0.45, 1.8); idle = 0; };
  const pad = host.parentElement; pad.addEventListener('pointerdown', onDown); pad.addEventListener('pointermove', onMove); pad.addEventListener('pointerup', onUp); pad.addEventListener('pointercancel', onUp); pad.addEventListener('wheel', onWheel, { passive: false });
  const frames = [];
  T.addUpdate((dt, time) => {
    const rd = reduced();
    for (let i = 0; i < frames.length; i++) frames[i](rd ? 0 : dt, time);
    if (!down) { idle += dt; if (idle > 5) { const q = Math.exp(-dt * 0.8); rig.dragYaw *= q; rig.dragPitch *= q; rig.zoom = 1 + (rig.zoom - 1) * q; } }
    if (rig.snap || rd) { for (const k of KEYS) { cur[k] = goal[k]; vel[k] = 0; } rig.snap = false; }
    else {
      const w = rig.rate, e = Math.exp(-w * dt);
      for (let i = 0; i < KEYS.length; i++) {
        const k = KEYS[i], log = k === 'dist', g = log ? Math.log(goal.dist) : k === 'yaw' ? cur.yaw + wrap(goal.yaw - cur.yaw) : goal[k], x = log ? Math.log(cur.dist) : cur[k];
        const d = x - g, q = (vel[k] + w * d) * dt, n = g + (d + q) * e; vel[k] = (vel[k] - w * q) * e; cur[k] = log ? Math.exp(n) : n;
      }
    }
    const yaw = cur.yaw + rig.dragYaw + rig.drift, pitch = clamp(cur.pitch + rig.dragPitch, 0.03, 1.45), dist = cur.dist * rig.zoom, cp = Math.cos(pitch);
    camera.position.set(cur.x + Math.sin(yaw) * cp * dist, cur.y + Math.sin(pitch) * dist, cur.z + Math.cos(yaw) * cp * dist);
    const gy = T.heightAt ? T.heightAt(camera.position.x, -camera.position.z) + 0.35 : 0.35; if (camera.position.y < gy) camera.position.y = gy;
    const P = cams.pose, G = cams.goal; P.target.set(cur.x, cur.y, cur.z); G.target.copy(P.target); P.yaw = G.yaw = yaw; P.pitch = G.pitch = pitch; P.dist = G.dist = dist; P.fov = G.fov = cur.fov;
    const near = clamp(dist * 0.02, 0.06, 2); camera.up.set(0, 1, 0); camera.lookAt(P.target);
    if (camera.fov !== cur.fov || camera.near !== near) { camera.fov = cur.fov; camera.near = near; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
  });

  // ---------- parts ----------
  const NOISE = 'float h2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);} float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h2(i),h2(i+vec2(1,0)),f.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x),f.y);}';
  const uTime = { value: 0 }; frames.push((dt) => { uTime.value += dt; });
  const basis = { blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: true };

  // A column of light over a point. Its height is the only thing it says.
  function beam(p, colorVar, { lit = true } = {}) {
    const g = new THREE.Group(); g.position.copy(T.v3(p, 0)); scene.add(g);
    const u = { uTime, uH: { value: 0.001 }, uW: { value: 3.4 }, uA: { value: 0 }, uPt: { value: 0.16 }, uColor: { value: hdr(colorVar, 1) }, uSeed: { value: p[0] * 0.37 } };
    const col = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), new THREE.ShaderMaterial({ ...basis, uniforms: u, side: THREE.DoubleSide,
      vertexShader: 'uniform float uH,uW; varying vec2 v; varying float vY; void main(){ v=vec2(position.x,position.y); vec3 b=(modelMatrix*vec4(0.,0.,0.,1.)).xyz; vec3 to=cameraPosition-b; vec3 r=normalize(vec3(to.z,0.,-to.x)); float H=uH+1.2; vec3 w=b+r*position.x*uW+vec3(0.,position.y*H,0.); vY=position.y*H; gl_Position=projectionMatrix*viewMatrix*vec4(w,1.); }',
      fragmentShader: NOISE + 'uniform float uTime,uH,uW,uA,uPt,uSeed; uniform vec3 uColor; varying vec2 v; varying float vY; void main(){ float x=v.x*uW, ax=abs(x), y=vY/max(uH,.01); float fw=fwidth(x); float core=exp(-ax*ax/max(.0016,fw*fw*.6))*min(1.,.04/max(fw*.8,.001)+.45); float body=exp(-ax*ax/.05), haze=exp(-ax*ax/.75);'
        + 'float n=n2(vec2(x*2.2+uSeed,vY*.55-uTime*.5)), m=n2(vec2(x*9.,vY*2.2-uTime*1.3+uSeed)); float top=1.-smoothstep(uH-.05,uH+.02,vY), soft=1.-smoothstep(uH-.2,uH+1.,vY); float fall=mix(1.,.42,clamp(y,0.,1.));'
        + 'float cap=exp(-pow((vY-uH)/.05,2.))*(1.-smoothstep(.0,.55,ax)); float k=vY/(uPt*10.), tick=exp(-pow((fract(k+.5)-.5)*uPt*10./max(.02,fwidth(vY)*.8),2.))*step(.4,k)*(1.-smoothstep(.16,.2,ax))*top;'
        + 'float a=core*top*1.5*fall+body*top*(.24+.2*m)*fall+haze*soft*(.05+.08*n)*fall+cap*1.5+tick*.55; a*=smoothstep(0.,.4,vY+.2); vec3 c=mix(uColor,vec3(1.),clamp(core*top*.55+cap*.5,0.,.8)); gl_FragColor=vec4(c*a*uA*1.5,a*uA); }' }));
    col.frustumCulled = false; col.renderOrder = 40; g.add(col);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({ ...basis, depthTest: false, uniforms: { uTime, uA: u.uA, uColor: u.uColor },
      vertexShader: 'varying vec2 v; void main(){ v=position.xz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: 'uniform float uTime,uA; uniform vec3 uColor; varying vec2 v; void main(){ float r=length(v), fw=fwidth(r); float e=fract(uTime*.22); float w=exp(-pow((r-.7-e*3.4)/(.05+fw),2.))*(1.-e)*.35; float a=exp(-r*r*.45)*.2+w; gl_FragColor=vec4(uColor*a*uA,a*uA); }' }));
    pool.position.y = 0.08; pool.renderOrder = 39; g.add(pool);
    let lamp = null; if (lit) { lamp = new THREE.PointLight(new THREE.Color(ctx.kit.cssVar(colorVar)), 0, 11, 1.6); lamp.position.y = 1.7; g.add(lamp); }
    return { group: g, top: new THREE.Vector3(), set(h, a) { u.uH.value = Math.max(0.001, h); u.uA.value = a; if (lamp) lamp.intensity = 26 * a; this.top.set(g.position.x, h, g.position.z); g.visible = a > 0.002; } };
  }

  // Light along a path on the ground. Bright where it can be seen, faint where a wall hides it.
  function ribbon(path, colorVar, { width = 0.5, y = 0.12, hot = null } = {}) {
    const pts = []; for (let i = 0; i < path.length; i++) { if (i === 0) { pts.push(path[0]); continue; } const a = path[i - 1], b = path[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 0.35)); for (let k = 1; k <= n; k++) pts.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); }
    for (let it = 0; it < 4; it++) for (let i = 1; i < pts.length - 1; i++) pts[i] = [(pts[i - 1][0] + pts[i][0] * 2 + pts[i + 1][0]) / 4, (pts[i - 1][1] + pts[i][1] * 2 + pts[i + 1][1]) / 4];
    const n = pts.length, pos = new Float32Array(n * 6), uv = new Float32Array(n * 4), hz = new Float32Array(n * 2), idx = []; let s = 0; const cum = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L; if (i) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); cum[i] = s;
      const inB = ctx.world.roomAt(pts[i]), h = (inB ? 0 : T.heightAt ? Math.max(0, T.heightAt(pts[i][0], pts[i][1])) : 0) + y, bad = hot && hot(pts[i]) ? 1 : 0;
      for (const [j, sd] of [[0, 1], [1, -1]]) { const q = i * 2 + j; pos[q * 3] = pts[i][0] + nx * width * 1.6 * sd; pos[q * 3 + 1] = h; pos[q * 3 + 2] = -(pts[i][1] + ny * width * 1.6 * sd); uv[q * 2] = s; uv[q * 2 + 1] = sd; hz[q] = bad; }
      if (i) idx.push(i * 2 - 2, i * 2 - 1, i * 2, i * 2, i * 2 - 1, i * 2 + 1);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setAttribute('aHot', new THREE.BufferAttribute(hz, 1)); geo.setIndex(idx);
    const u = { uTime, uTo: { value: 0 }, uLen: { value: s }, uA: { value: 1 }, uColor: { value: hdr(colorVar, 1) }, uBad: { value: hdr('--danger', 1) } };
    const mk = (depth, k) => { const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ ...basis, side: THREE.DoubleSide, depthFunc: depth, uniforms: { ...u, uK: { value: k } },
      vertexShader: 'attribute float aHot; varying vec2 v; varying float vB; void main(){ v=uv; vB=aHot; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: 'uniform float uTime,uTo,uLen,uA,uK; uniform vec3 uColor,uBad; varying vec2 v; varying float vB; void main(){ float s=v.x; if(s>uTo) discard; float y=abs(v.y)*1.6, fw=fwidth(v.y)*1.6; float line=1.-smoothstep(.2,.2+fw*1.4+.05,y); float edge=exp(-pow((y-.38)/(.05+fw),2.)); float glow=exp(-y*y*1.7); float head=exp(-(uTo-s)*.55); float flow=pow(.5+.5*cos(6.2832*(s*.16-uTime*.55)),10.);'
        + 'vec3 c=mix(uColor,uBad,smoothstep(.2,.8,vB)); float a=(line*.5+glow*.13+flow*line*.5+head*(line*1.3+glow*.55))*smoothstep(0.,1.2,s); gl_FragColor=vec4(mix(c,vec3(1.),clamp(head*line*.6,0.,.6))*a*uA*uK*1.25,a*uA*uK); }' })); m.frustumCulled = false; m.renderOrder = 30; scene.add(m); return m; };
    const front = mk(THREE.LessEqualDepth, 1), behind = mk(THREE.GreaterDepth, 0.36);
    return { length: s, to(m) { u.uTo.value = m; }, alpha(a) { u.uA.value = a; front.visible = behind.visible = a > 0.004; },
      at(m, out) { m = clamp(m, 0, s); let i = 1; while (i < n - 1 && cum[i] < m) i++; const k = (m - cum[i - 1]) / Math.max(1e-4, cum[i] - cum[i - 1]); out.x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k; out.z = -(pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k); return out; },
      dispose() { scene.remove(front, behind); geo.dispose(); front.material.dispose(); behind.material.dispose(); } };
  }

  // The outline of an opening in a wall, drawn on with light.
  function cut(foot, dir, colorVar, { w = 1.0, hgt = 1.5 } = {}) {
    const g = new THREE.Group(); g.position.copy(T.v3(foot, 0)); g.rotation.y = Math.atan2(dir[0], -dir[1]); scene.add(g);
    const u = { uTime, uDraw: { value: 0 }, uA: { value: 1 }, uColor: { value: hdr(colorVar, 1) }, uSize: { value: new THREE.Vector2(w, hgt) } };
    const mk = (depth, k) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w + 1.2, hgt + 1.2).translate(0, hgt / 2 + 0.1, 0), new THREE.ShaderMaterial({ ...basis, side: THREE.DoubleSide, depthFunc: depth, uniforms: { ...u, uK: { value: k } },
      vertexShader: 'varying vec2 v; void main(){ v=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: 'uniform float uTime,uDraw,uA,uK; uniform vec3 uColor; uniform vec2 uSize; varying vec2 v; void main(){ vec2 p=(v-.5)*(uSize+1.2), b=uSize*.5; vec2 q=abs(p)-b; float d=length(max(q,0.))+min(max(q.x,q.y),0.); float ang=fract(atan(p.x,-p.y)/6.28318+.5+.5); float on=smoothstep(ang,ang+.004,uDraw*1.01); float fw=fwidth(d); float line=exp(-d*d/max(.0005,fw*fw)); float glow=exp(-abs(d)*7.)*.45; float tip=exp(-pow((ang-uDraw)/.012,2.))*step(uDraw,.995)*exp(-abs(d)*14.)*4.; float inside=step(d,0.); float hatch=smoothstep(.85,.95,abs(fract((p.x+p.y)*5.)-.5)*2.)*inside*.3*smoothstep(.9,1.,uDraw); float fill=inside*.08*smoothstep(.6,1.,uDraw);'
        + 'float a=(line*.8+glow*.42)*on+tip*.6+hatch*.45+fill*.6; gl_FragColor=vec4(mix(uColor,vec3(1.),clamp(line*on*.35+tip*.6,0.,.8))*a*uA*uK,a*uA*uK); }' })); m.renderOrder = 45; m.position.z = 0.02; g.add(m); return m; };
    mk(THREE.LessEqualDepth, 1.3); mk(THREE.GreaterDepth, 0.4);
    return { group: g, draw(x) { u.uDraw.value = x; }, alpha(a) { u.uA.value = a; g.visible = a > 0.004; } };
  }

  const v = new THREE.Vector3();
  return {
    ok: true, twin, T, THREE, scene, camera, rig, bus, sim, frames, beam, ribbon, cut, hdr, reduced,
    get engine() { return box.engine; },
    use(next, ev = 'seek') { box.engine = next; bus.emit(ev, { t: next.state.t }); },
    project(p3, out) { v.copy(p3).project(camera); const W = host.clientWidth, H = host.clientHeight; out.x = (v.x * 0.5 + 0.5) * W; out.y = (-v.y * 0.5 + 0.5) * H; out.on = v.z > -1 && v.z < 1; return out; },
    start: () => twin.start(), stop: () => twin.stop(),
    dispose() { for (const [e, f] of [['pointerdown', onDown], ['pointermove', onMove], ['pointerup', onUp], ['pointercancel', onUp], ['wheel', onWheel]]) pad.removeEventListener(e, f); bus.dispose(); twin.dispose(); },
  };
}