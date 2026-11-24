// Evidence, Demo mode: the whole case as one space-time picture. The building lies on the floor; height is time.
// The rover's path climbs as the mission runs, every reading hangs where and when it was taken, and its thread runs to
// the lead it argues for or against. Positions, times and weights come from a finished run (run.js): nothing is staged.
import * as THREE from 'three';
import { finishedRun } from './run.js';
import { whyChain, buildGraph, clock, pct, SENSOR_INFO, LR } from './model.js';

const BG = 0x080a0d, CX = 64, CY = 44, Y0 = 4.2, YH = 25;
const PLAY = 21;                                                       // seconds for the whole mission
const REST = 15;                                                       // seconds held on each person
const HUE = { steel: [0.72, 0.80, 0.90], cold: [0.30, 0.52, 0.78], warm: [1.0, 0.40, 0.20], white: [0.95, 0.97, 1.0], grey: [0.38, 0.42, 0.47] };
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = (x) => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };
const SHORT = { csi: 'Wi-Fi', radar: 'Radar', micro: 'Micro-motion', thermal: 'Thermal', signature: 'Motion pattern', temperature: 'Temperature', aerial: 'Drone image', human: 'Team on site', acoustic: 'Sound' };

const NOISE = 'float gh31(vec3 p){p=fract(p*.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}' +
  'float gnoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(gh31(i),gh31(i+vec3(1,0,0)),f.x),mix(gh31(i+vec3(0,1,0)),gh31(i+vec3(1,1,0)),f.x),f.y),mix(mix(gh31(i+vec3(0,0,1)),gh31(i+vec3(1,0,1)),f.x),mix(gh31(i+vec3(0,1,1)),gh31(i+vec3(1,1,1)),f.x),f.y),f.z);}';
function concrete({ color, rough = 0.88, scale = 1, top = null, fade = 0, stain = 1 }) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, dithering: true });
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGW; varying vec3 vGN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vec4 gw=vec4(transformed,1.0); vec3 gn=objectNormal;\n#ifdef USE_INSTANCING\n gw=instanceMatrix*gw; gn=mat3(instanceMatrix)*gn;\n#endif\n vGW=(modelMatrix*gw).xyz; vGN=normalize(mat3(modelMatrix)*gn);');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vGW; varying vec3 vGN;\n' + NOISE)
      .replace('#include <map_fragment>', '#include <map_fragment>\n vec3 gp=vGW*' + scale.toFixed(2) + '; float gf=gnoise(gp*.55)*.5+gnoise(gp*2.3)*.3+gnoise(gp*9.)*.2; float gs='+stain.toFixed(2)+'*smoothstep(.62,.82,gnoise(gp*vec3(.9,.16,.9)+7.));' +
        ' diffuseColor.rgb*=.62+.75*gf; diffuseColor.rgb*=1.-.28*gs;' + (top ? ' diffuseColor.rgb=mix(diffuseColor.rgb,vec3(' + top + '),smoothstep(.6,.9,vGN.y));' : ''))
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor=clamp(roughnessFactor-.22*gs+.1*(gf-.5),.3,1.);')
      .replace('#include <dithering_fragment>', (fade ? ' gl_FragColor.rgb=mix(gl_FragColor.rgb,vec3(' + new THREE.Color(BG).toArray().map((v) => v.toFixed(5)).join(',') + '),0.0); gl_FragColor.a*=1.-smoothstep(' + (fade * 0.42).toFixed(1) + ',' + fade.toFixed(1) + ',length(vGW.xz));' : '') + '\n#include <dithering_fragment>');
  };
  if (fade) m.transparent = true;
  return m;
}

export function createGraphHero(host, ctx) {
  const { h, icon, realityTag, reducedMotion } = ctx.kit;
  const canvas = h('canvas.gh-canvas', { 'aria-hidden': 'true' });
  const svgNS = 'http://www.w3.org/2000/svg', leaders = document.createElementNS(svgNS, 'svg'); leaders.setAttribute('class', 'gh-leaders'); leaders.setAttribute('aria-hidden', 'true');
  const callouts = h('ol.gh-callouts', { 'aria-label': 'The readings, in order' });
  const tagRow = h('div.gh-tags', null, realityTag('live-algo'), h('span.tag.tag-sim', { title: 'A complete run of the simulated exercise. The Wi-Fi network and the fusion are the real ones, running in this page.' }, 'Simulated exercise'));
  const title = h('h1.gh-h1', null, 'Every claim has a thread.'), sub = h('p.gh-sub', null, 'Running the mission once, in the background.');
  const replay = h('button.btn.btn-primary', { type: 'button', onclick: () => start(0) }, icon('reset') , h('span', null, 'Play the mission again'));
  const steps = h('div.gh-steps', { role: 'group', 'aria-label': 'Show the evidence for' });
  const clockEl = h('b.num', null, '00:00'), nRead = h('b', null, '0'), nPeople = h('b', null, '0'), nClosed = h('b', null, '0');
  const figs = h('div.gh-figs', null, h('div', null, clockEl, h('span', null, 'mission clock')), h('div', null, nRead, h('span', null, 'readings')), h('div.gh-warm', null, nPeople, h('span', null, 'people')), h('div', null, nClosed, h('span', null, 'leads closed')));
  const scrub = h('div.gh-scrub', { role: 'slider', tabindex: 0, 'aria-label': 'Mission time', 'aria-valuemin': 0, 'aria-valuemax': 650, 'aria-valuenow': 0 }), sFill = h('i.gh-fill'), sTicks = h('div.gh-ticks'), sKnob = h('i.gh-knob');
  scrub.append(h('i.gh-rail'), sTicks, sFill, sKnob);
  const tip = h('div.gh-tip', { hidden: true, role: 'tooltip' });
  host.append(canvas, h('div.gh-vig', { 'aria-hidden': 'true' }), leaders, callouts, h('div.gh-copy', null, tagRow, title, sub, h('div.gh-row', null, replay, steps)), figs, scrub, tip);

  let renderer, scene, camera, run = null, ready = false, visible = false, raf = 0, last = 0, failed = false;
  let leads = [], chains = [], warp = null, end = 650, readings = [];
  let mode = 'play', clockT = 0, now = 0, focus = 0, focusK = 0, auto = true, time = 0, yawUser = 0, pitchUser = 0, dragging = false, scrubbing = false, dpr = 1, slow = 0, lastCap = '', leadLines = [];
  const pNow = new Float32Array(8), uP = { value: pNow }, uWarm = { value: new Float32Array(8) };
  const uni = { uNow: { value: 0 }, uTime: { value: 0 }, uFocus: { value: -1 }, uF: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uPx: { value: 1 }, uP, uWarm };
  const camPos = new THREE.Vector3(40, 30, 60), camTgt = new THREE.Vector3(0, 8, 0), wantPos = new THREE.Vector3(), wantTgt = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const yOf = (t) => Y0 + (t / end) * YH;
  const X = (x) => x - CX, Z = (y) => -(y - CY);
  let lights = [], nowPlane = null;

  // ---------- the building, as an architect's model ----------
  function buildModel() {
    const W = ctx.world, rng = (() => { let a = 7; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
    const g = new THREE.Group(); scene.add(g);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(95, 64).rotateX(-Math.PI / 2), concrete({ color: 0x2b3138, rough: 0.96, scale: 1.6, fade: 88, stain: 0 })); ground.receiveShadow = true; g.add(ground);
    const [bx0, by0, bx1, by1] = W.BUILDING.rect;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(bx1 - bx0 + 1.6, 0.35, by1 - by0 + 1.6), concrete({ color: 0x707985, rough: 0.72, scale: 0.8 })); slab.position.set(X((bx0 + bx1) / 2), 0.0, Z((by0 + by1) / 2)); slab.receiveShadow = slab.castShadow = true; g.add(slab);
    const box = new THREE.BoxGeometry(1, 1, 1), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), Sv = new THREE.Vector3(), E = new THREE.Euler();
    const parts = [];
    const put = (x, y, z, sx, sy, sz, ry = 0, rx = 0, rz = 0) => parts.push([x, y, z, sx, sy, sz, ry, rx, rz]);
    const wallSet = [], H = 2.5;
    for (const w of W.WALLS) {
      const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], L = Math.hypot(dx, dy), th = w.mat === 'concrete' ? 0.42 : 0.22, ry = Math.atan2(dy, dx);
      if (w.state === 'collapsed') { const n = Math.ceil(L / 0.9); for (let i = 0; i < n; i++) { const f = (i + 0.5) / n, hh = 0.3 + rng() * 1.3; wallSet.push([X(w.a[0] + dx * f), hh / 2 + 0.17, Z(w.a[1] + dy * f), L / n * (0.8 + rng() * 0.3), hh, th * (0.8 + rng() * 0.5), ry + (rng() - 0.5) * 0.3, (rng() - 0.5) * 0.3, (rng() - 0.5) * 0.25]); } continue; }
      wallSet.push([X((w.a[0] + w.b[0]) / 2), H / 2 + 0.17, Z((w.a[1] + w.b[1]) / 2), L + th * 0.98, H, th, ry, 0, 0]);
    }
    const inst = (list, mat, geo = box) => { const im = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((p, i) => { P.set(p[0], p[1], p[2]); Sv.set(p[3], p[4], p[5]); Q.setFromEuler(E.set(p[7], p[6], p[8], 'YXZ')); im.setMatrixAt(i, M.compose(P, Q, Sv)); }); im.castShadow = im.receiveShadow = true; im.computeBoundingSphere(); g.add(im); return im; };
    inst(wallSet, concrete({ color: 0x90959b, rough: 0.82, scale: 1.1, top: '0.60,0.64,0.69' }));
    // classroom desks, in rows, so a room reads as a room
    for (const r of W.ROOMS) { if (r.corridor) continue; const [x0, y0, x1, y1] = r.rect; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const x = x0 + 1.7 + i * 1.85 + (rng() - 0.5) * 0.35, y = y0 + 2.2 + j * 2.4 + (rng() - 0.5) * 0.4; if (r.id === '112' && x > 79 && y > 51) continue; if (r.id === '103' && Math.abs(y - 36) < 1.1 && x > 68) continue; const a = (rng() - 0.5) * 0.35; put(X(x), 0.9, Z(y), 1.15, 0.06, 0.6, a); put(X(x) - 0.5 * Math.cos(a), 0.53, Z(y) + 0.5 * Math.sin(a), 0.05, 0.72, 0.55, a); put(X(x) + 0.5 * Math.cos(a), 0.53, Z(y) - 0.5 * Math.sin(a), 0.05, 0.72, 0.55, a); } }
    put(X(70.4), 0.55, Z(36), 1.15, 0.06, 0.7, 0.3, 0, 1.3); put(X(72.3), 0.5, Z(36.1), 1.15, 0.06, 0.7, -0.5, 0, -1.2);
    inst(parts, concrete({ color: 0x39404a, rough: 0.7, scale: 3 }));
    // rubble, inside the polygons the planner treats as rubble
    const rock = new THREE.DodecahedronGeometry(0.5, 0), rocks = [];
    for (const o of W.OBSTACLES) {
      if (o.kind === 'building') { const xs = o.poly.map((p) => p[0]), ys = o.poly.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys); const b = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 1.1, y1 - y0), concrete({ color: 0x3f4751, rough: 0.9, scale: 1.2, stain: 0, top: '0.10,0.115,0.135' })); b.position.set(X((x0 + x1) / 2), 0.55, Z((y0 + y1) / 2)); b.castShadow = b.receiveShadow = true; g.add(b); }
      if (o.kind !== 'rubble') continue;
      const xs = o.poly.map((p) => p[0]), ys = o.poly.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), n = Math.round((x1 - x0) * (y1 - y0) * (o.passable ? 1.4 : 5));
      for (let i = 0, k = 0; i < n && k < n * 6; k++) { const x = x0 + rng() * (x1 - x0), y = y0 + rng() * (y1 - y0); let c = false; for (let a = 0, b = o.poly.length - 1; a < o.poly.length; b = a++) { const p = o.poly[a], q = o.poly[b]; if ((p[1] > y) !== (q[1] > y) && x < ((q[0] - p[0]) * (y - p[1])) / (q[1] - p[1]) + p[0]) c = !c; } if (!c) continue; i++; const s = 0.18 + rng() ** 2.2 * 1.5; rocks.push([X(x), 0.15 + s * 0.28 + rng() * o.h * 0.35, Z(y), s * (0.8 + rng()), s * (0.35 + rng() * 0.5), s * (0.7 + rng() * 0.6), rng() * 6, rng() * 0.9, rng() * 0.9]); }
    }
    inst(rocks, concrete({ color: 0x5f5d59, rough: 0.95, scale: 2 }), rock);
    // light: one raking key from the west, a breath of sky, and the people
    const key = new THREE.DirectionalLight(0xc9d8ec, 2.1); key.position.set(-46, 34, 26); key.target.position.set(0, 0, -2); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03; key.shadow.radius = 3;
    Object.assign(key.shadow.camera, { left: -52, right: 52, top: 42, bottom: -42, near: 5, far: 140 }); key.shadow.autoUpdate = false; key.shadow.needsUpdate = true; scene.add(key, key.target);
    scene.add(new THREE.HemisphereLight(0x53667e, 0x0a0c10, 0.42));
  }

  // ---------- ribbons: every line in the picture is one draw call ----------
  const RIB_V = 'attribute vec3 aDir; attribute float aSide,aU,aT,aW,aLead,aDash,aKind; uniform vec2 uRes; uniform float uPx,uNow,uF,uFocus; uniform float uP[8]; uniform float uWarm[8]; varying float vS,vU,vAge,vLead,vDash,vKind,vA; varying float vWarm;' +
    'void main(){ vec4 c=projectionMatrix*modelViewMatrix*vec4(position,1.); vec4 d=projectionMatrix*modelViewMatrix*vec4(position+aDir*.05,1.); vec2 s=(d.xy/d.w-c.xy/c.w)*uRes; float sl=length(s); s=sl>1e-5?s/sl:vec2(1.,0.); float near=clamp(52./c.w,.35,2.6); float w=(aW*near+1.1)*uPx; vec2 o=vec2(-s.y,s.x)*aSide*w/uRes; c.xy+=o*2.*c.w*.5; gl_Position=c; vS=aSide; vU=aU; vAge=uNow-aT; vLead=aLead; vDash=aDash; vKind=aKind; int li=int(aLead+.5); vWarm=aLead<-.5?0.:uWarm[li]; float isF=abs(aLead-uFocus)<.5?1.:0.; vA=mix(1.,isF>.5?1.75:(aLead<-.5?.42:.09),uF)*clamp(1.25-c.w/190.,.25,1.); }';
  const RIB_F = 'varying float vS,vU,vAge,vLead,vDash,vKind,vA,vWarm; uniform float uTime; void main(){ if(vAge<0.) discard; float e=vS*vS; float core=exp(-e*9.), halo=exp(-e*2.6)*.22*(1.-e); float head=exp(-vAge/5.)*1.6; vec3 col; float a=1.;' +
    ' if(vKind<.5){ col=vec3(.80,.87,.95); a=.75; } else if(vKind<1.5){ col=mix(vec3(.70,.79,.90),vec3(1.,.42,.20),vWarm*smoothstep(0.,.55,vU)); a=.62; float p=fract(vU*1.2-uTime*.22); head+=smoothstep(.88,1.,p)*smoothstep(1.,.985,p)*1.5*vWarm; } else if(vKind<2.5){ col=vec3(.26,.50,.80); a=.60; float p=fract(vU*1.2+uTime*.16); head+=smoothstep(.9,1.,p)*.5; } else if(vKind<3.5){ col=vec3(.5,.55,.6); a=.14; } else if(vKind<4.5){ col=vec3(1.,.40,.19); a=vWarm*(.18+.82*pow(vU,1.6))*.85; } else if(vKind<5.5){ col=vec3(.55,.62,.70); a=.16; } else { col=vec3(.35,.60,1.); a=.62; }' +
    ' if(vDash>.5){ float k=fract(vU*vDash); a*=smoothstep(.0,.08,k)*smoothstep(.56,.48,k); } gl_FragColor=vec4(col*(core+halo)*(a+head*.55*min(a*2.,1.))*vA,1.); }';
  function ribbons(list) {
    let n = 0; for (const r of list) n += r.pts.length; const f = (k) => new Float32Array(n * 2 * k);
    const pos = f(3), dir = f(3), side = f(1), U = f(1), T = f(1), Wd = f(1), Ld = f(1), Ds = f(1), Kd = f(1), idx = []; let v = 0;
    for (const r of list) {
      const N = r.pts.length; let len = 0; const acc = [0]; for (let i = 1; i < N; i++) { len += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1], r.pts[i][2] - r.pts[i - 1][2]); acc.push(len); }
      for (let i = 0; i < N; i++) {
        const a = r.pts[Math.max(0, i - 1)], b = r.pts[Math.min(N - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], l = Math.hypot(dx, dy, dz) || 1;
        for (let s = 0; s < 2; s++) { const k = v * 3; pos[k] = r.pts[i][0]; pos[k + 1] = r.pts[i][1]; pos[k + 2] = r.pts[i][2]; dir[k] = dx / l; dir[k + 1] = dy / l; dir[k + 2] = dz / l; side[v] = s ? 1 : -1; U[v] = len ? acc[i] / len : 0; T[v] = r.times ? r.times[i] : r.t + (r.travel || 0) * U[v]; Wd[v] = r.w; Ld[v] = r.lead ?? -1; Ds[v] = r.dash ? r.dash * len : 0; Kd[v] = r.kind; v++; }
        if (i) { const q = v - 4; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
      }
    }
    const geo = new THREE.BufferGeometry(); const A = (nm, arr, k) => geo.setAttribute(nm, new THREE.BufferAttribute(arr, k));
    A('position', pos, 3); A('aDir', dir, 3); A('aSide', side, 1); A('aU', U, 1); A('aT', T, 1); A('aW', Wd, 1); A('aLead', Ld, 1); A('aDash', Ds, 1); A('aKind', Kd, 1); geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: RIB_V, fragmentShader: RIB_F, uniforms: uni, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })); mesh.frustumCulled = false; mesh.renderOrder = 3; scene.add(mesh);
  }
  const PT_V = 'attribute float aT,aLead,aKind,aSize; uniform float uNow,uPx,uF,uFocus,uTime; uniform float uP[8]; uniform float uWarm[8]; varying float vK,vA,vWarm,vAge,vB; void main(){ vec4 m=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*m; float z=-m.z; vK=aKind; vAge=uNow-aT; int li=int(max(aLead,0.)+.5); vWarm=uWarm[li]; float isF=abs(aLead-uFocus)<.5?1.:0.; vA=mix(1.,isF>.5?1.5:.16,uF); float born=smoothstep(0.,3.,vAge); float s=aSize; if(aKind>3.5){ s*=.55+1.6*vWarm*vWarm+.35*uP[li]; s*=1.+.04*sin(uTime*1.7+aLead*2.); } vB=born; gl_PointSize=vAge<0.?0.:clamp(s*uPx*(760./z)*(1.+1.4*exp(-vAge/2.2)),2.,620.); }';
  const PT_F = 'varying float vK,vA,vWarm,vAge,vB; void main(){ vec2 q=gl_PointCoord*2.-1.; float r=length(q); if(r>1.) discard; vec3 col; float a; if(vK<.5){ col=vec3(.55,.60,.66); a=exp(-r*r*14.)*.35; } else if(vK<1.5){ col=mix(vec3(.92,.96,1.),vec3(1.,.55,.32),vWarm*.8); a=exp(-r*r*26.)*1.6+exp(-r*r*5.)*.22*(1.-r); } else if(vK<2.5){ col=vec3(.34,.60,.95); float ring=smoothstep(.10,.0,abs(r-.42)); a=ring*.9+exp(-r*r*6.)*.12*(1.-r); } else if(vK<3.5){ col=vec3(.7,.78,.88); a=exp(-r*r*20.)*.5; } else { vec3 c0=vec3(.62,.70,.80); col=mix(c0,vec3(1.,.40,.18),vWarm); float core=exp(-r*r*520.)*2.2, mid=exp(-r*r*60.)*.42, hal=pow(1.-r,4.)*.30; a=core+(mid+hal)*(.3+.7*vWarm); vec3 x=col*(mid+hal)*(.3+.7*vWarm)+vec3(1.,.95,.9)*core; gl_FragColor=vec4((1.-exp(-x*1.5))*vA*vB,1.); return; } gl_FragColor=vec4(col*a*vA*vB,1.); }';
  function points(list) {
    const n = list.length, pos = new Float32Array(n * 3), T = new Float32Array(n), L = new Float32Array(n), K = new Float32Array(n), S = new Float32Array(n);
    list.forEach((p, i) => { pos.set(p.p, i * 3); T[i] = p.t; L[i] = p.lead; K[i] = p.kind; S[i] = p.size; });
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aT', new THREE.BufferAttribute(T, 1)); geo.setAttribute('aLead', new THREE.BufferAttribute(L, 1)); geo.setAttribute('aKind', new THREE.BufferAttribute(K, 1)); geo.setAttribute('aSize', new THREE.BufferAttribute(S, 1));
    const o = new THREE.Points(geo, new THREE.ShaderMaterial({ vertexShader: PT_V, fragmentShader: PT_F, uniforms: uni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); o.frustumCulled = false; o.renderOrder = 4; scene.add(o);
  }

  const posAt = (unit, t) => { const tr = run.tracks[unit]; const i = clamp(Math.floor(t), 0, tr.length - 2), a = tr[i], b = tr[i + 1], f = clamp((t - a[0]) / Math.max(0.01, b[0] - a[0])); return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; };
  function buildEvidence() {
    const S = run.state; end = run.end; const rib = [], pts = [];
    for (const [id, kind, w, dash] of [['DRONE-01', 5, 1.0, 0], ['HOUND-01', 0, 3.0, 0], ['TEAM-1', 6, 2.2, 0]]) {
      const tr = run.tracks[id], P = [], Ti = []; let moving = -1; for (let i = 0; i < tr.length; i++) { if (i < tr.length - 1 && Math.hypot(tr[i + 1][1] - tr[i][1], tr[i + 1][2] - tr[i][2]) > 0.05) { moving = moving < 0 ? i : moving; } }
      const lastMove = (() => { for (let i = tr.length - 1; i > 0; i--) if (Math.hypot(tr[i][1] - tr[i - 1][1], tr[i][2] - tr[i - 1][2]) > 0.05) return i; return tr.length - 1; })();
      for (let i = Math.max(0, moving); i <= lastMove; i++) { P.push([X(tr[i][1]), yOf(tr[i][0]), Z(tr[i][2])]); Ti.push(tr[i][0]); }
      if (P.length > 2) rib.push({ pts: P, times: Ti, w, kind, dash });
    }
    leads = S.detections.map((d, li) => {
      const ch = whyChain(d), ev = d.evidence.filter((e) => e.sensor !== 'human'), tl = ev.length ? ev[ev.length - 1].t : d.t;
      return { li, d, ch, where: d.room ? 'room ' + d.room : 'the debris field', name: d.room ? 'Room ' + d.room : 'Debris field', star: new THREE.Vector3(X(d.pos[0]), yOf(tl) + 3.4, Z(d.pos[1])), t0: d.evidence[0].t, person: !!d.survivorId, groups: [] };
    }).slice(0, 8);
    readings = [];
    for (const L of leads) {
      const seen = new Map();
      L.ch.steps.forEach((s, i) => {
        const e = L.d.evidence[i], u = s.sensor === 'human' ? 'TEAM-1' : s.sensor === 'aerial' ? 'DRONE-01' : 'HOUND-01', at = posAt(u, s.t), k = s.vantage + ':' + s.t;
        if (!seen.has(k)) { seen.set(k, { t: s.t, vantage: s.vantage, items: [], c: new THREE.Vector3(), p: 0, stopPos: at }); L.groups.push(seen.get(k)); }
        const G = seen.get(k), base = Math.atan2(Z(L.d.pos[1]) - Z(at[1]), X(L.d.pos[0]) - X(at[0])), a = base + (G.items.length - 1.5) * 0.62, rad = s.sensor === 'human' || s.sensor === 'aerial' ? 0.01 : 1.9;
        const p = new THREE.Vector3(X(at[0]) + Math.cos(a) * rad, yOf(s.t), Z(at[1]) + Math.sin(a) * rad), kind = s.lr > 1.001 ? 1 : s.lr < 0.999 ? 2 : 0;
        G.items.push({ s, p, kind }); G.c.add(p); G.p = s.p;
        readings.push({ L, s, p, kind, unit: u });
        pts.push({ p: p.toArray(), t: s.t, lead: L.li, kind, size: kind ? 1.15 + Math.min(2.1, Math.abs(Math.log(s.lr))) * 0.62 : 0.9 });
        rib.push({ pts: [[X(at[0]), yOf(s.t), Z(at[1])], p.toArray()], t: s.t, w: 0.5, kind: 3, lead: L.li });
        const c1 = p.clone().lerp(L.star, 0.25); c1.y = p.y + (L.star.y - p.y) * 0.06; const c2 = p.clone().lerp(L.star, 0.82); c2.y = L.star.y - Math.abs(L.star.y - p.y) * 0.42;
        const curve = new THREE.CubicBezierCurve3(p, c1, c2, L.star);
        rib.push({ pts: curve.getPoints(40).map((v) => v.toArray()), t: s.t + 0.5, travel: 6, w: kind ? 0.9 + Math.min(2.1, Math.abs(Math.log(s.lr))) * 0.9 : 0.5, kind: kind === 1 ? 1 : kind === 2 ? 2 : 3, lead: L.li, dash: kind === 2 ? 1.1 : 0 });
      });
      for (const G of L.groups) { G.c.multiplyScalar(1 / G.items.length); rib.push({ pts: [[X(G.stopPos[0]), 0.3, Z(G.stopPos[1])], [X(G.stopPos[0]), yOf(G.t), Z(G.stopPos[1])]], t: G.t, w: 0.4, kind: 5, dash: 1.2, lead: L.li }); }
      pts.push({ p: L.star.toArray(), t: L.t0, lead: L.li, kind: 4, size: L.person ? 15 : 7 });
      const beam = []; for (let i = 0; i <= 24; i++) beam.push([L.star.x, 0.25 + (L.star.y - 0.25) * (i / 24), L.star.z]);
      if (L.person) rib.push({ pts: beam, t: L.t0, w: 3.4, kind: 4, lead: L.li }); else rib.push({ pts: beam, t: L.t0, w: 0.5, kind: 5, lead: L.li, dash: 0.9 });
    }
    // a quiet time ruler: one tick a minute, on the building's north-west corner
    const rx = -21.6, rz = -15.6; rib.push({ pts: [[rx, 0.2, rz], [rx, yOf(end), rz]], t: 0, travel: end, w: 0.5, kind: 5 });
    for (let t = 0; t <= end; t += 60) rib.push({ pts: [[rx, yOf(t), rz], [rx + (t % 120 ? 0.5 : 1.1), yOf(t), rz]], t, w: 0.5, kind: 5 });
    // dust, so the air has depth
    let a = 11; const rnd = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
    for (let i = 0; i < 260; i++) pts.push({ p: [(rnd() - 0.5) * 90, rnd() * 38, (rnd() - 0.5) * 70], t: -10, lead: -1, kind: 3, size: 0.12 + rnd() * 0.22 });
    ribbons(rib); points(pts);
    // the people are the only warm light in the model
    lights = leads.filter((L) => L.person).map((L) => { const l = new THREE.PointLight(0xff5c26, 0, 26, 1.7); l.position.set(L.star.x, 1.15, L.star.z); l.castShadow = true; l.shadow.mapSize.set(512, 512); l.shadow.bias = -0.004; l.shadow.autoUpdate = false; l.shadow.needsUpdate = true; scene.add(l); return { l, L }; });
    // the plane of "now"
    nowPlane = new THREE.Mesh(new THREE.PlaneGeometry(46, 34).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uA: { value: 0 } }, vertexShader: 'varying vec2 vP; void main(){ vP=position.xz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }', fragmentShader: 'varying vec2 vP; uniform float uA; void main(){ vec2 e=vec2(23.,17.)-abs(vP); float ed=min(e.x,e.y); vec2 g=abs(fract(vP/4.)-.5)*4.; float w=fwidth(vP.x)*1.2; float ln=1.-smoothstep(0.,max(w,.02),2.-max(g.x,g.y)); float edge=smoothstep(.35,.0,ed); gl_FragColor=vec4(vec3(.42,.60,.85)*(ln*.10+edge*.45+.012)*uA,1.); }' })); nowPlane.renderOrder = 2; scene.add(nowPlane);
    // time warp: the film lingers where evidence arrives
    const n = Math.ceil(end) + 1, wt = new Float32Array(n); let sum = 0; const ts = [...new Set(readings.map((r) => r.s.t))];
    for (let i = 0; i < n; i++) { let d = 0.35; for (const t of ts) d += 3.2 * Math.exp(-(((i - t - 4) / 9) ** 2)); sum += d; wt[i] = sum; }
    warp = (x) => { const g = clamp(x) * sum; let lo = 0, hi = n - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (wt[m] < g) lo = m + 1; else hi = m; } const p = lo ? wt[lo - 1] : 0; return Math.min(end, lo - 1 + (g - p) / (wt[lo] - p || 1) + 0); };
    // interface
    scrub.setAttribute('aria-valuemax', String(Math.round(end)));
    sTicks.replaceChildren(...readings.map((r) => h('i' + (r.L.person ? '.p' : ''), { style: { left: (r.s.t / end) * 100 + '%' } })));
    const order = [...leads].sort((a2, b2) => (b2.person - a2.person) || (b2.ch.steps.length - a2.ch.steps.length));
    steps.replaceChildren(...order.map((L) => h('button.gh-step' + (L.person ? '.is-person' : ''), { type: 'button', 'data-li': L.li, 'aria-pressed': 'false', onclick: () => { auto = false; hold(L.li); } }, h('i'), h('span', null, L.name))));
    tour = order.filter((L) => L.person).map((L) => L.li); focus = tour[0] ?? 0;
  }
  let tour = [0];

  // ---------- words ----------
  function verdict(L) {
    const st = L.ch.steps, no = (k) => st.filter((s) => s.sensor === k && s.lr < 0.999).length, yes = (k) => st.filter((s) => s.sensor === k && s.lr > 1.001).length, ups = [...new Set(st.filter((s) => s.lr > 1.001).map((s) => s.sensor))], times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : n === 3 ? 'three times' : n + ' times');
    if (!L.person) { const why = st.filter((s) => s.lr < 0.999).sort((a, b) => a.lr - b.lr)[0]; return { t: 'Why is no one in ' + L.where + '?', s: why ? SHORT[why.sensor] + ': ' + (why.note || why.word).replace(/\.$/, '') + '. Now ' + pct(L.d.p) + '.' : 'The evidence fell away. Now ' + pct(L.d.p) + '.' }; }
    if (ups.includes('human')) { const b4 = st.filter((s) => s.sensor !== 'human'), k = b4.find((s) => s.lr > 1.001); return { t: 'Why do we believe someone is in ' + L.where + '?', s: (k ? SHORT[k.sensor] + ' alone: ' + pct(b4[b4.length - 1].p) + '. ' : '') + 'Then the team got there and saw for itself: ' + pct(L.d.p) + '.' }; }
    if (no('csi') && !yes('csi')) return { t: 'Why do we believe someone is in ' + L.where + '?', s: 'The Wi-Fi network said no, ' + times(no('csi')) + '. ' + ups.map((k, i) => (i ? SHORT[k].toLowerCase() : SHORT[k])).join(' and ') + ' outvoted it: ' + pct(L.d.p) + '.' };
    return { t: 'Why do we believe someone is in ' + L.where + '?', s: ups.map((k, i) => (i ? SHORT[k].toLowerCase() : SHORT[k])).join(' and ') + ' agreed' + (L.groups.length > 1 ? ', ' + times(L.groups.length) : '') + ': ' + pct(L.d.p) + '.' };
  }
  const VANT = { S1: 'corridor by 102', S2: 'corridor, west', S3: 'inside the door', S4: 'room 111', V1: 'second viewpoint', V2: 'second viewpoint', V3: 'second viewpoint', aerial: 'drone pass', team: 'on site' };
  function showCallouts(L) {
    leaders.replaceChildren(); leadLines = [];
    callouts.replaceChildren(...L.groups.slice(0, 3).map((G, gi) => {
      const rows = G.items.filter((it) => it.kind).map((it) => h('span.gh-r' + (it.kind === 1 ? '.up' : '.down'), null, h('i'), SHORT[it.s.sensor] || it.s.sensor, h('b.num', null, '×' + it.s.lr.toFixed(it.s.lr < 1 ? 2 : it.s.lr >= 20 ? 0 : 1))));
      const li = h('li.gh-co', { style: { animationDelay: 500 + gi * 450 + 'ms' } }, h('div.gh-co-h', null, h('span.num', null, clock(G.t)), h('span', null, VANT[G.vantage] || G.vantage)), ...rows, h('b.gh-co-p' + (L.person && G.p > 0.5 ? '.hot' : ''), null, pct(G.p)));
      const path = document.createElementNS(svgNS, 'path'), dot = document.createElementNS(svgNS, 'circle'); dot.setAttribute('r', '3'); leaders.append(path, dot); leadLines.push({ G, li, path, dot }); return li;
    }));
    if (L.ch.steps.some((s) => s.assumed)) callouts.prepend(h('li.gh-co-note', null, 'Weights assumed' + (L.ch.steps.some((s) => !s.assumed) ? ', except Wi-Fi: measured on simulated test windows' : '')));
  }
  function hold(li) {
    mode = 'rest'; clockT = 0; focus = li; now = end; const L = leads[li], v = verdict(L); title.textContent = v.t; sub.textContent = v.s; host.classList.add('is-rest'); host.classList.remove('is-play'); showCallouts(L);
    steps.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.li === li)));
    if (!raf) frameOnce();
  }
  function start(at) { mode = 'play'; auto = true; clockT = at; host.classList.add('is-play'); host.classList.remove('is-rest'); callouts.replaceChildren(); leaders.replaceChildren(); leadLines = []; title.textContent = 'Every claim has a thread.'; lastCap = ''; steps.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false')); if (reducedMotion()) hold(tour[0]); else kick(); }
  function caption() {
    let best = null; for (const e of run.state.events) { if (e.t > now + 0.01) break; if (e.code === 'PHASE' || e.level === 'alert' || e.level === 'ok' || /LEAD|ROUTE|POSSIBLE|PERSON|INVEST/.test(e.code)) best = e; }
    const s = best ? best.text.split(/(?<=[.:])\s/)[0].replace(/[:]$/, '.') : 'The drone maps the site.';
    if (s !== lastCap) { lastCap = s; sub.textContent = s; }
  }

  // ---------- frame ----------
  function probs(dt) {
    let people = 0, closed = 0, reads = 0; const seen = showSeen; seen.clear();
    for (const L of leads) {
      let p = now >= L.t0 ? L.ch.prior : 0; for (const s of L.ch.steps) if (s.t <= now) p = s.p; const target = now < L.t0 ? 0 : p; pNow[L.li] += (target - pNow[L.li]) * Math.min(1, dt * 5);
      const w = L.person ? clamp((target - 0.12) / 0.75) : 0; uWarm.value[L.li] += (w - uWarm.value[L.li]) * Math.min(1, dt * 3);
      if (L.person && target >= 0.85) people++; if (!L.person && now > L.ch.steps[L.ch.steps.length - 1].t && target < 0.15) closed++;
    }
    for (const r of readings) if (r.s.t <= now) { const k = r.s.node; if (!seen.has(k)) { seen.add(k); reads++; } }
    setT(clockEl, clock(now)); setT(nRead, String(reads)); setT(nPeople, String(people)); setT(nClosed, String(closed));
    for (const o of lights) { const f = mode === 'rest' ? (o.L.li === focus ? 1.5 : 0.55) : 1; o.l.intensity += (uWarm.value[o.L.li] * 46 * f - o.l.intensity) * Math.min(1, dt * 3); }
  }
  const showSeen = new Set(); const setT = (el, s) => { if (el.firstChild?.nodeValue !== s) el.textContent = s; };
  function cameraWant() {
    const asp = host.clientWidth / Math.max(1, host.clientHeight);
    if (mode === 'rest' && leads[focus]) {
      const L = leads[focus]; tmp.set(0, 0, 0); for (const G of L.groups) tmp.add(G.c); tmp.multiplyScalar(1 / L.groups.length); 
      const yaw = -0.34 + Math.sin(time * 0.1) * 0.14 + yawUser, top = Math.max(L.star.y, L.groups[L.groups.length - 1].c.y) + 2.5, dist = clamp(top * 2.35, 46, 72) * (asp < 1.75 ? 1.06 : 1), pit = 0.56 + pitchUser; wantTgt.set(L.star.x * 0.82 + tmp.x * 0.18 + 1.5, top * 0.43, L.star.z * 0.8 + tmp.z * 0.2);
      wantPos.set(wantTgt.x + Math.sin(yaw) * Math.cos(pit) * dist, wantTgt.y + Math.sin(pit) * dist, wantTgt.z + Math.cos(yaw) * Math.cos(pit) * dist);
    } else {
      const x = clamp(clockT / PLAY), yaw = -0.62 + x * 1.15 + yawUser, pit = 0.60 - 0.22 * ease(x) + pitchUser, dist = 70 + 16 * ease(x) + (asp < 1.75 ? 5 : 0); wantTgt.set(2, 3.5 + 8.5 * ease(x * 1.25), -1);
      wantPos.set(wantTgt.x + Math.sin(yaw) * Math.cos(pit) * dist, wantTgt.y + Math.sin(pit) * dist, wantTgt.z + Math.cos(yaw) * Math.cos(pit) * dist);
    }
    if (wantPos.y < 4) wantPos.y = 4;
  }
  function frame(ts) {
    raf = 0; if (!visible || !ready) return; const raw = Math.min(0.1, (ts - last) / 1000 || 0.016), dt = Math.min(0.05, raw); last = ts; time += dt;
    if (mode === 'play') { if (!scrubbing) clockT += dt; now = warp(clamp(clockT / PLAY)); caption(); if (clockT >= PLAY + 1.2) hold(tour[0]); }
    else if (auto) { clockT += dt; if (clockT > REST && !dragging) { const i = tour.indexOf(focus); if (i < tour.length - 1) hold(tour[i + 1]); else start(0); } }
    draw(dt);
    slow = slow * 0.95 + (raw > 0.0215 ? 0.05 : 0); if (slow > 0.4 && dpr > 0.8) { dpr = Math.max(0.8, dpr * 0.85); slow = 0; resize(); }
    kick();
  }
  function draw(dt, snap = false) {
    if (mode === 'rest') now = end;
    const k = mode === 'rest' ? 1.7 : 1.4, a = snap ? 1 : 1 - Math.exp(-dt * k); cameraWant(); camPos.lerp(wantPos, a); camTgt.lerp(wantTgt, a); camera.position.copy(camPos); camera.lookAt(camTgt);
    focusK += ((mode === 'rest' ? 1 : 0) - focusK) * (snap ? 1 : 1 - Math.exp(-dt * 2)); uni.uF.value = focusK; uni.uFocus.value = mode === 'rest' || focusK > 0.02 ? focus : -1; uni.uNow.value = now; uni.uTime.value = time;
    probs(snap ? 1 : dt); nowPlane.position.y = yOf(now); nowPlane.material.uniforms.uA.value = 1 - focusK; 
    sFill.style.transform = 'scaleX(' + (now / end).toFixed(4) + ')'; sKnob.style.transform = 'translateX(' + ((now / end) * scrubW).toFixed(1) + 'px)';
    renderer.render(scene, camera);
    if (mode === 'rest') for (const o of leadLines) {
      tmp.copy(o.G.c).project(camera); const x = (tmp.x * 0.5 + 0.5) * hw, y = (-tmp.y * 0.5 + 0.5) * hh; if (!o.bx) { const r = o.li.getBoundingClientRect(), b = host.getBoundingClientRect(); o.bx = r.left - b.left - 10; o.by = r.top - b.top + 12; }
      const op = y < 4 || y > hh || x > o.bx - 20 ? 0 : clamp((focusK - 0.55) / 0.35); o.path.setAttribute('d', 'M' + x.toFixed(1) + ',' + y.toFixed(1) + 'L' + Math.max(x + 14, o.bx - 70).toFixed(1) + ',' + o.by.toFixed(1) + 'H' + o.bx.toFixed(1)); o.path.style.opacity = op.toFixed(2); o.dot.setAttribute('cx', x.toFixed(1)); o.dot.setAttribute('cy', y.toFixed(1)); o.dot.style.opacity = op.toFixed(2);
    }
  }
  let hw = 1, hh = 1, scrubW = 1;
  function resize() {
    if (!renderer) return; hw = host.clientWidth || 1; hh = host.clientHeight || 1; scrubW = scrub.clientWidth || 1; renderer.setPixelRatio(dpr); renderer.setSize(hw, hh, false); camera.aspect = hw / hh; camera.setViewOffset(hw, hh, -hw * 0.075, hh * 0.015, hw, hh); camera.updateProjectionMatrix(); uni.uRes.value.set(hw * dpr, hh * dpr); uni.uPx.value = dpr * (hh / 888); leaders.setAttribute('viewBox', '0 0 ' + hw + ' ' + hh); for (const o of leadLines) o.bx = 0;
  }
  const kick = () => { if (!raf && visible && ready && !reducedMotion()) raf = requestAnimationFrame(frame); };
  function frameOnce() { if (!ready || !visible) return; draw(1, true); if (leadLines.length) { focusK = 1; draw(0.016, true); } }

  async function init() {
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.setClearColor(BG);
      dpr = Math.min(window.devicePixelRatio || 1, 2); scene = new THREE.Scene(); scene.fog = new THREE.Fog(BG, 70, 170); camera = new THREE.PerspectiveCamera(30, 1.8, 1, 400);
      buildModel(); resize(); cameraWant(); camPos.copy(wantPos); camTgt.copy(wantTgt); camera.position.copy(camPos); camera.lookAt(camTgt); renderer.render(scene, camera);
      run = await finishedRun(ctx); buildEvidence(); ready = true; resize(); cameraWant(); camPos.copy(wantPos); camTgt.copy(wantTgt);
      if (!run.live) tagRow.lastChild.textContent = 'Simulated exercise, complete run'; else tagRow.lastChild.textContent = 'Simulated exercise, your run';
      start(0); if (reducedMotion()) hold(tour[0]);
    } catch (e) { console.warn('[graph hero]', e); failed = true; host.classList.add('is-failed'); sub.textContent = 'This view needs WebGL. Switch to Advanced for the link chart.'; }
  }

  // ---------- hands ----------
  let px = 0, py = 0;
  canvas.addEventListener('pointerdown', (e) => { dragging = true; px = e.clientX; py = e.clientY; try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic */ } tip.hidden = true; });
  canvas.addEventListener('pointermove', (e) => {
    if (dragging) { yawUser -= (e.clientX - px) * 0.005; pitchUser = clamp(pitchUser + (e.clientY - py) * 0.004, -0.4, 0.75); px = e.clientX; py = e.clientY; if (!raf) frameOnce(); return; }
    if (!ready) return; const b = host.getBoundingClientRect(), mx = e.clientX - b.left, my = e.clientY - b.top; let best = null, bd = 18; for (const r of readings) { if (r.s.t > now) continue; tmp.copy(r.p).project(camera); const d = Math.hypot((tmp.x * 0.5 + 0.5) * hw - mx, (-tmp.y * 0.5 + 0.5) * hh - my); if (d < bd) { bd = d; best = r; } }
    tip.hidden = !best; canvas.style.cursor = best ? 'pointer' : 'grab'; if (best) { tip.replaceChildren(h('b', null, (SENSOR_INFO[best.s.sensor] || {}).name || best.s.sensor), h('span.num', null, clock(best.s.t) + '  ×' + best.s.lr.toFixed(2)), h('span', null, best.s.note || best.s.word)); tip.style.transform = 'translate(' + Math.min(hw - 280, mx + 16) + 'px,' + Math.max(8, my - 20) + 'px)'; tip.dataset.li = best.L.li; }
  });
  const up = () => { dragging = false; }; canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); canvas.addEventListener('pointerleave', () => { tip.hidden = true; });
  canvas.addEventListener('click', () => { if (!tip.hidden) { auto = false; hold(+tip.dataset.li); } });
  const invWarp = (t) => { let lo = 0, hi = 1; for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (warp(m) < t) lo = m; else hi = m; } return lo; };
  function scrubTo(t) { if (!ready) return; if (mode !== 'play') start(0); clockT = invWarp(clamp(t, 0, end)) * PLAY; scrub.setAttribute('aria-valuenow', String(Math.round(t))); scrub.setAttribute('aria-valuetext', clock(t)); }
  const scrubEv = (e) => { const b = scrub.getBoundingClientRect(); scrubTo(clamp((e.clientX - b.left) / b.width) * end); };
  scrub.addEventListener('pointerdown', (e) => { scrubbing = true; try { scrub.setPointerCapture(e.pointerId); } catch { /* synthetic */ } scrubEv(e); }); scrub.addEventListener('pointermove', (e) => { if (scrubbing) scrubEv(e); }); for (const n of ['pointerup', 'pointercancel']) scrub.addEventListener(n, () => { scrubbing = false; });
  scrub.addEventListener('keydown', (e) => { const d = { ArrowRight: 10, ArrowLeft: -10, PageUp: 60, PageDown: -60 }[e.key]; if (d) { e.preventDefault(); scrubTo(now + d); } else if (e.key === 'Home') scrubTo(0); else if (e.key === 'End') hold(tour[0]); });
  new ResizeObserver(() => { if (host.clientWidth) { resize(); if (!raf) frameOnce(); } }).observe(host);

  let begun = false;
  return {
    show() { visible = true; if (!begun) { begun = true; init(); } else if (ready) { last = performance.now(); resize(); reducedMotion() ? frameOnce() : kick(); } },
    hide() { visible = false; if (raf) cancelAnimationFrame(raf); raf = 0; tip.hidden = true; },
    get state() { return { mode, now, focus, ready, failed, dpr }; }, jump(x) { start(x); }, hold,
  };
}
