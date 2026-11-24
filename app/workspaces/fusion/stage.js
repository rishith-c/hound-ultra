// The Demo set for Fusion: block B at night, cut open, with one shaft of light standing on the lead that is being judged.
// The building, its furniture, the rover and the image pipeline are the twin's own modules (read only). What is made
// here is the evidence: the sensor fields, the probability shaft, and a cloud of points of which exactly the fused
// probability has condensed into a figure. Nothing here reads world.TRUTH; every number comes from hero.js.
import * as THREE from 'three';
import * as U from '../../twin/util.js';
import { createTextures } from '../../twin/textures.js';
import { createMaterials } from '../../twin/materials.js';
import { loadPhotos, photoTri } from '../../twin/photos.js';
import { createPost, makeGlow } from '../../twin/post.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const H = 7;                       // metres of shaft for a probability of 1
const N = 13000, pause = () => new Promise((r) => setTimeout(r));
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const NOISE = 'float h1(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float n1(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h1(i),h1(i+vec2(1,0)),f.x),mix(h1(i+vec2(0,1)),h1(i+vec2(1,1)),f.x),f.y);}';

// ---- a person as a surface of points: capsules, sampled by area, keeping only the outer skin ----
function figure(n) {
  const C = [[0, 1.6, 0.01, 0, 1.67, 0.01, 0.098], [0, 1.45, 0, 0, 1.55, 0, 0.056], [-0.09, 1.3, 0, 0.09, 1.3, 0, 0.145], [-0.13, 1.38, 0, 0.13, 1.38, 0, 0.095], [0, 1.06, 0, 0, 1.2, 0, 0.14], [-0.065, 0.95, 0, 0.065, 0.95, 0, 0.135]];
  for (const s of [-1, 1]) C.push([s * 0.2, 1.38, 0, s * 0.27, 1.1, -0.02, 0.054], [s * 0.27, 1.1, -0.02, s * 0.29, 0.86, 0.06, 0.043], [s * 0.29, 0.83, 0.07, s * 0.29, 0.75, 0.09, 0.042], [s * 0.095, 0.92, 0, s * 0.115, 0.5, 0.02, 0.083], [s * 0.115, 0.5, 0.02, s * 0.125, 0.09, -0.02, 0.057], [s * 0.125, 0.05, -0.03, s * 0.14, 0.04, 0.15, 0.046]);
  const A = C.map((c) => { const l = Math.hypot(c[3] - c[0], c[4] - c[1], c[5] - c[2]); return 2 * Math.PI * c[6] * (l + 2 * c[6]); }), tot = A.reduce((a, b) => a + b, 0);
  let seed = 77; const R = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const sd = (x, y, z, c) => { const ax = c[3] - c[0], ay = c[4] - c[1], az = c[5] - c[2], bx = x - c[0], by = y - c[1], bz = z - c[2], t = clamp((ax * bx + ay * by + az * bz) / (ax * ax + ay * ay + az * az)); return Math.hypot(bx - ax * t, by - ay * t, bz - az * t) - c[6]; };
  const P = new Float32Array(n * 3), M = new Float32Array(n * 3);
  for (let i = 0, g = 0; i < n && g < n * 30; g++) {
    let u = R() * tot, k = 0; while (u > A[k] && k < C.length - 1) u -= A[k++];
    const c = C[k], z = R() * 2 - 1, f = R() * 6.2832, s = Math.sqrt(1 - z * z), nx = s * Math.cos(f), ny = z, nz = s * Math.sin(f), t = R();
    const x = c[0] + (c[3] - c[0]) * t + nx * c[6], y = c[1] + (c[4] - c[1]) * t + ny * c[6], zz = c[2] + (c[5] - c[2]) * t + nz * c[6];
    let inside = false; for (let q = 0; q < C.length && !inside; q++) if (q !== k && sd(x, y, zz, C[q]) < -0.006) inside = true; if (sd(x, y, zz, c) < -0.004) inside = true;
    if (inside) continue; P.set([x, y, zz], i * 3); M.set([nx, ny, nz], i * 3); i++;
  }
  return { P, M, R };
}

export async function createStage(host, ctx, { reduced }) {
  const world = ctx.world, probe = document.createElement('canvas'); if (!probe.getContext('webgl2')) throw new Error('WebGL is not available');
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.18;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.autoClear = false; renderer.shadowMap.autoUpdate = false; renderer.setPixelRatio(1);
  const dom = renderer.domElement; dom.tabIndex = 0; dom.setAttribute('role', 'img'); dom.setAttribute('aria-label', 'Block B at night. A shaft of light stands on the lead; its height is the fused probability that a person is there. Drag or use the arrow keys to look around.');
  host.append(dom);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1.9, 0.5, 900), v = new THREE.Vector3(), m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), s3 = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const at = (p, h = 0, out = new THREE.Vector3()) => out.set(p[0], h, -p[1]);

  // ---- light: one cold key from the left, a little sky, and the evidence itself ----
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.13; pm.dispose();
  const key = new THREE.DirectionalLight('#b9cdea', 1.75); key.position.set(64 - 70, 44, -44 + 18); key.target.position.set(64, 0, -44); key.castShadow = true; key.shadow.mapSize.set(4096, 4096);
  Object.assign(key.shadow.camera, { left: -34, right: 34, top: 30, bottom: -30, near: 10, far: 150 }); key.shadow.bias = -0.0003; key.shadow.normalBias = 0.04; key.shadow.radius = 2.2;
  const rim = new THREE.DirectionalLight('#5f86bd', 0.5); rim.position.set(110, 22, -110); rim.target.position.set(64, 0, -44);
  const hemi = new THREE.HemisphereLight('#7f97b8', '#15120f', 0.16);
  const warm = new THREE.PointLight('#ff6a45', 0, 17, 1.7), cool = new THREE.PointLight('#bfe0ff', 0, 10, 1.6);
  scene.add(key, key.target, rim, rim.target, hemi, warm, cool);

  const t = { THREE, scene, camera, renderer, ctx, world, quality: 'high', reduced: false, v3: U.v3, groundY: 0, pickable: (o) => o, unpickable() {}, label: () => stub, glow: (o, s = 1) => makeGlow(o, s), addUpdate: () => () => {} };
  const stub = { el: document.createElement('span'), setPosition() {}, setText() {}, setSub() {}, setTone() {}, setVisible() {}, remove() {} };
  const tex = createTextures(world, 8), photos = await loadPhotos('high', 4); await pause();
  const mats = createMaterials(tex, photos), env = { ...t, t, tex, mats, photos, U, rng: U.rng, layer: () => false };

  // ground: wet mud, photographed, with standing water that mirrors the light
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(520, 520).rotateX(-Math.PI / 2), photoTri(new THREE.MeshStandardMaterial({ color: 0x4b453d, roughness: 0.9 }), photos.wet, { scale: 5.2, k: 0.95, bump: 1.2, sat: 0.5, key: 'fus-ground',
    extra: ' float gN = sin(vPW.x * 0.21 + sin(vPW.z * 0.17) * 2.0) * sin(vPW.z * 0.24 + sin(vPW.x * 0.13) * 2.0) + (pC.g - 1.0) * 0.3; float gW = smoothstep(0.28, 0.46, gN); diffuseColor.rgb *= mix(1.0, 0.3, gW);', rough: ' roughnessFactor = mix(roughnessFactor, 0.05, gW);', wet: 'gW' }));
  ground.position.set(64, -0.02, -44); ground.receiveShadow = true; scene.add(ground);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, vertexShader: 'varying vec3 d;void main(){d=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}', fragmentShader: 'varying vec3 d;void main(){float y=normalize(d).y;gl_FragColor=vec4(mix(vec3(.030,.040,.055),vec3(.004,.006,.010),smoothstep(-.02,.4,y)),1.);}' })); sky.renderOrder = -10; sky.position.copy(ground.position); scene.add(sky);

  const parts = {};
  for (const name of ['building', 'rubble', 'interior', 'debris']) { try { const p = (await import('../../twin/' + name + '.js')).build(env); if (p?.group && !p.group.parent) scene.add(p.group); parts[name] = p; p?.setLayer?.('roof', false); } catch (e) { console.info('[fusion] demo set: "' + name + '" left out (' + e.message + ')'); } await pause(); }
  let rover = null; const rs = { units: { 'HOUND-01': { id: 'HOUND-01', pos: [57.6, 44], heading: 0, mode: 'listen', odo: 1 } }, sensors: { listen: null }, hold: false, faults: {}, phase: 'search' };
  try { rover = (await import('../../twin/actors/rover.js')).default.create(t); } catch (e) { console.info('[fusion] demo set: rover left out (' + e.message + ')'); }
  // A light that is switched off stays compiled in, at zero, so that nothing recompiles mid-shot.
  scene.traverse((l) => { if (!l.isLight) return; let vis = l.visible, k = l.intensity; Object.defineProperty(l, 'visible', { configurable: true, get: () => true, set: (x) => { vis = x; } }); Object.defineProperty(l, 'intensity', { configurable: true, get: () => (vis ? k : 0), set: (x) => { k = x; } }); });
  await pause();

  // ---- evidence materials: light only; alpha is left alone because the image pipeline keeps wetness there ----
  const G = { uT: { value: 0 }, uPerson: { value: new THREE.Color() }, uCool: { value: new THREE.Color('#8fc4ff') }, uWarn: { value: new THREE.Color() }, uOk: { value: new THREE.Color() } };
  const light = (uniforms, vs, fs, o = {}) => new THREE.ShaderMaterial({ uniforms: { ...G, ...uniforms }, vertexShader: vs, fragmentShader: fs, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, ...o });
  const W = 'varying vec3 vW;varying vec2 vUv;void main(){vUv=uv;vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}';
  function readTokens() { const cs = getComputedStyle(document.documentElement), g = (k, d) => { const x = cs.getPropertyValue(k).trim(); return /^#[0-9a-f]{6}$/i.test(x) ? x : d; }; G.uPerson.value.set(g('--person', '#ff6a45')); G.uWarn.value.set(g('--warn', '#ffb224')); G.uOk.value.set(g('--ok', '#41d6a0')); warm.color.copy(G.uPerson.value); }
  readTokens();

  // ---- the shaft ----
  const lead = new THREE.Group(); scene.add(lead);
  const uP = { value: 0.1 }, uK = { value: 0 }, uHot = { value: new THREE.Color() }, uLock = { value: 0 }, uFall = { value: 0 }, uImp = { value: 0 };
  const shaftMat = light({ uP, uK, uHot, uImp }, 'varying vec3 vN,vV;varying float vY,vA;void main(){vY=position.y;vA=atan(position.z,position.x);vec4 mv=modelViewMatrix*vec4(position,1.);vV=normalize(-mv.xyz);vN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*mv;}',
    'uniform float uT,uP,uK,uImp;uniform vec3 uHot;varying vec3 vN,vV;varying float vY,vA;' + NOISE + 'void main(){float top=uP*' + H + '.,y=vY;if(y>top)discard;float f=abs(dot(normalize(vN),normalize(vV)));float body=pow(f,2.2),edge=pow(1.-f,3.);float a=vA*2.5465;float fl=n1(vec2(a*3.,y*.9-uT*1.1))*.6+n1(vec2(a*9.,y*2.4-uT*2.0))*.4;float cap=exp(-(top-y)*5.),base=exp(-y*1.3);gl_FragColor=vec4(uHot*(body*(.055+.15*fl*fl+.5*uImp*fl)+edge*.10+cap*(.5*body+.25)+base*.12)*uK,1.);}');
  const tube = (r) => new THREE.CylinderGeometry(r, r, H, 64, 1, true).translate(0, H / 2, 0);
  const shaft = new THREE.Mesh(tube(0.58), shaftMat), core = new THREE.Mesh(tube(0.16), shaftMat); shaft.renderOrder = core.renderOrder = 12; lead.add(shaft, core);
  const discGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), ringFs = (body) => 'uniform float uT,uK,uP,uLock,uFall,uA;uniform vec3 uHot,uOk,uWarn;varying vec2 vUv;varying vec3 vW;void main(){vec2 q=vUv*2.-1.;float r=length(q),a=atan(q.y,q.x),w=fwidth(r)*1.2;' + body + '}';
  const line = 'smoothstep(w*1.6,0.,abs(r-R))';
  const cap = new THREE.Mesh(discGeo, light({ uP, uK, uHot, uLock, uFall, uA: { value: 0 } }, W, ringFs('float R=.93;float l=' + line + ';gl_FragColor=vec4(uHot*(l*2.6+exp(-r*r*5.)*.9+smoothstep(1.,.5,r)*.12)*uK,1.);'))); cap.scale.setScalar(0.64); cap.renderOrder = 13; lead.add(cap);
  // the two decision rings and the rings left behind by earlier answers
  const gate = (y, hot) => { const m = new THREE.Mesh(discGeo, light({ uP, uK, uHot, uLock, uFall, uA: { value: y } }, W, ringFs('float R=.5;float on=step(uA,uP);float lk=uLock*step(.5,uA);float l=smoothstep(w*1.4,0.,abs(r-R));float d=step(.42,fract(a*3.8197));float R2=mix(.97,.56,lk);float br=smoothstep(w*2.2,0.,abs(r-R2))*step(.5,fract(a*.63662+.25+lk*.5))*lk;vec3 c=mix(vec3(.62,.70,.80)*.55,' + hot + '*1.5,on);gl_FragColor=vec4((c*l*mix(d,1.,on)+' + hot + '*br*2.2+' + hot + '*lk*exp(-abs(r-R)*9.)*.35)*uK,1.);'))); m.position.y = y * H; m.scale.setScalar(1.5); m.renderOrder = 13; lead.add(m); return m; };
  gate(0.85, 'uHot'); gate(0.15, 'vec3(.75,.80,.88)');
  const past = new THREE.InstancedMesh(discGeo, light({ uP, uK, uHot, uLock, uFall, uA: { value: 0 } }, 'varying vec2 vUv;varying vec3 vW;void main(){vUv=uv;vec4 w=modelMatrix*instanceMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}', ringFs('float R=.95;gl_FragColor=vec4(vec3(.7,.78,.88)*' + line + '*.5*uK,1.);')), 12); past.frustumCulled = false; past.renderOrder = 12; lead.add(past);
  // a scale beside the shaft, always facing the camera
  const scale = new THREE.Group(); lead.add(scale);
  { const pts = [0, 0, 0, 0, H, 0]; for (let i = 0; i <= 100; i += 5) { const y = i / 100 * H; pts.push(0, y, 0, i % 50 === 0 ? 0.34 : i % 10 === 0 ? 0.2 : 0.1, y, 0); } const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); const l = new THREE.LineSegments(g, light({ uK, uP }, 'varying float y;void main(){y=position.y;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}', 'uniform float uK,uP;varying float y;void main(){gl_FragColor=vec4(vec3(.6,.7,.8)*(y<uP*' + H + '.?.62:.2)*uK,1.);}')); l.position.x = 1.02; l.renderOrder = 13; scale.add(l); }

  // ---- the cloud: every point has a threshold in 0..1; the share that has condensed is the probability ----
  const fig = figure(N), pg = new THREE.BufferGeometry(), aC = new Float32Array(N * 3), aS = new Float32Array(N * 4), lie = new Float32Array(N * 3), lieN = new Float32Array(N * 3), gs = () => { let x = 0; for (let k = 0; k < 6; k++) x += fig.R(); return (x - 3) / 0.7071; };
  for (let i = 0; i < N; i++) { const a = fig.R() * 6.2832, rr = Math.abs(gs()) * 1.25; aC.set([Math.cos(a) * rr, Math.abs(gs()) * 0.75 + 0.05, Math.sin(a) * rr], i * 3); aS.set([(i + 0.5) / N, fig.R(), fig.R(), fig.R()], i * 4); const x = fig.P[i * 3], y = fig.P[i * 3 + 1], z = fig.P[i * 3 + 2]; lie.set([x * 1.04, Math.max(0.03, 0.18 + z), 0.87 - y], i * 3); lieN.set([fig.M[i * 3], fig.M[i * 3 + 2], -fig.M[i * 3 + 1]], i * 3); }
  for (let i = N - 1; i > 0; i--) { const j = (fig.R() * (i + 1)) | 0, a = aS[i * 4]; aS[i * 4] = aS[j * 4]; aS[j * 4] = a; }
  pg.setAttribute('position', new THREE.BufferAttribute(fig.P, 3)); pg.setAttribute('normal', new THREE.BufferAttribute(fig.M, 3)); pg.setAttribute('aL', new THREE.BufferAttribute(lie, 3)); pg.setAttribute('aLN', new THREE.BufferAttribute(lieN, 3)); pg.setAttribute('aC', new THREE.BufferAttribute(aC, 3)); pg.setAttribute('aS', new THREE.BufferAttribute(aS, 4));
  const uLie = { value: 0 }, uTurn = { value: 0 }, uPx = { value: 900 };
  const cloud = new THREE.Points(pg, light({ uP, uK, uHot, uFall, uLie, uTurn, uPx, uLock }, 'attribute vec3 aC,aL,aLN;attribute vec4 aS;uniform float uT,uP,uK,uFall,uLie,uTurn,uPx,uLock;varying vec4 vC;uniform vec3 uHot;void main(){float k=smoothstep(aS.x-.05,aS.x+.012,uP);k=k*k*(3.-2.*k);k*=1.-uFall;vec3 f=mix(position,aL,uLie),n=mix(normal,aLN,uLie);float c=cos(uTurn),s=sin(uTurn);f.xz=mat2(c,s,-s,c)*f.xz;n.xz=mat2(c,s,-s,c)*n.xz;float br=sin(uT*1.5+aS.y*.6)*.006*step(.9,f.y+uLie);f+=n*br;vec3 q=aC;float a=uT*(.10+.16*aS.z)+aS.w*6.28;q.xz=mat2(cos(a),sin(a),-sin(a),cos(a))*q.xz;q.y+=sin(uT*.5+aS.y*40.)*.18;q.y=max(.04,q.y*(1.-uFall*aS.w*1.0));q.y=mix(q.y,.03,smoothstep(aS.y*.6,aS.y*.6+.4,uFall));vec3 p=mix(q,f,k);p.xz+=vec2(cos(a*3.),sin(a*3.))*k*(1.-k)*1.6;vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;vec3 nv=normalize(normalMatrix*n);float rim=pow(1.-abs(nv.z),1.6);gl_PointSize=uPx*mix(.020,.017+.006*aS.z,k)/-mv.z;vec3 dust=vec3(.42,.55,.70)*(.10+.22*aS.z*aS.z)*(1.-.8*uFall);vC=vec4(mix(dust,uHot*(.16+.95*rim)*(1.+.5*uLock),k)*uK,1.);}',
    'varying vec4 vC;void main(){vec2 q=gl_PointCoord-.5;float d=dot(q,q);if(d>.25)discard;gl_FragColor=vec4(vC.rgb*smoothstep(.25,.02,d),1.);}')); cloud.frustumCulled = false; cloud.renderOrder = 11; lead.add(cloud);
  // sparks that climb inside the shaft
  const MN = 700, mg = new THREE.BufferGeometry(), mp = new Float32Array(MN * 3), ms = new Float32Array(MN * 2); for (let i = 0; i < MN; i++) { const a = fig.R() * 6.2832, r = Math.sqrt(fig.R()) * 0.52; mp.set([Math.cos(a) * r, fig.R(), Math.sin(a) * r], i * 3); ms.set([0.4 + fig.R(), fig.R()], i * 2); }
  mg.setAttribute('position', new THREE.BufferAttribute(mp, 3)); mg.setAttribute('aS', new THREE.BufferAttribute(ms, 2));
  const motes = new THREE.Points(mg, light({ uP, uK, uHot, uPx, uImp }, 'attribute vec2 aS;uniform float uT,uP,uK,uPx,uImp;varying float vB;void main(){float y=fract(position.y+uT*.07*aS.x)*' + H + '.,top=uP*' + H + '.;vB=uK*step(y,top)*smoothstep(0.,.5,y)*(.35+1.8*exp(-(top-y)*2.))*(.4+aS.y)*(1.+uImp*2.);vec4 mv=modelViewMatrix*vec4(position.x,y,position.z,1.);gl_Position=projectionMatrix*mv;gl_PointSize=uPx*(.012+.016*aS.y)/-mv.z;}', 'uniform vec3 uHot;varying float vB;void main(){vec2 q=gl_PointCoord-.5;float d=dot(q,q);if(d>.25||vB<.01)discard;gl_FragColor=vec4(uHot*vB*smoothstep(.25,0.,d),1.);}')); motes.frustumCulled = false; motes.renderOrder = 13; lead.add(motes);
  // dust in the air
  const DN = 1400, dg = new THREE.BufferGeometry(), dp = new Float32Array(DN * 3); for (let i = 0; i < DN; i++) dp.set([38 + fig.R() * 54, fig.R() * 11, -(24 + fig.R() * 40)], i * 3); dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const dust = new THREE.Points(dg, light({ uPx }, 'uniform float uT,uPx;varying float a;void main(){vec3 p=position;p.x+=sin(uT*.07+position.z)*1.2;p.y+=sin(uT*.09+position.x*2.)*.5;p.z+=cos(uT*.06+position.x)*1.;vec4 mv=viewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=max(1.,uPx*.011/-mv.z);a=.05+.05*sin(position.x*90.);}', 'varying float a;void main(){vec2 q=gl_PointCoord-.5;gl_FragColor=vec4(vec3(.6,.72,.9)*a*smoothstep(.25,0.,dot(q,q)),1.);}')); dust.frustumCulled = false; scene.add(dust);

  // ---- every room's own shaft ----
  const rooms = world.ROOMS.filter((r) => !r.corridor), lvl = new THREE.InstancedBufferAttribute(new Float32Array(rooms.length * 2), 2).setUsage(THREE.DynamicDrawUsage), rg = tube(0.4); rg.setAttribute('aV', lvl);
  const uRooms = { value: 0 }, roomShafts = new THREE.InstancedMesh(rg, light({ uRooms }, 'attribute vec2 aV;varying vec3 vN,vV;varying float vY;varying vec2 vA;void main(){vA=aV;vY=position.y;vec4 mv=viewMatrix*modelMatrix*instanceMatrix*vec4(position,1.);vV=normalize(-mv.xyz);vN=normalize(mat3(viewMatrix)*normal);gl_Position=projectionMatrix*mv;}', 'uniform float uRooms;uniform vec3 uCool,uPerson;varying vec3 vN,vV;varying float vY;varying vec2 vA;void main(){float top=vA.x*' + H + '.;if(vY>top||vA.x<=0.)discard;float f=abs(dot(normalize(vN),normalize(vV)));vec3 c=mix(uCool*.75,uPerson,vA.y);gl_FragColor=vec4(c*(pow(f,2.)*.26+pow(1.-f,3.)*.2+exp(-(top-vY)*14.)*(.9+.6*vA.y))*uRooms,1.);}'), rooms.length); roomShafts.frustumCulled = false; roomShafts.renderOrder = 10; scene.add(roomShafts);
  rooms.forEach((r, i) => { const c = [(r.rect[0] + r.rect[2]) / 2, (r.rect[1] + r.rect[3]) / 2]; roomShafts.setMatrixAt(i, m4.makeTranslation(c[0], 0.02, -c[1])); });
  const roomC = rooms.map((r) => [(r.rect[0] + r.rect[2]) / 2, (r.rect[1] + r.rect[3]) / 2]);

  // ---- sensor fields ----
  const uSrc = { value: new THREE.Vector3() }, uTgt = { value: new THREE.Vector3() }, uAng = { value: 0 }, uRange = { value: 5 }, uFx = { value: 0 }, uRes = { value: 0 }, uU = { value: 0 };
  // Wi-Fi: curved sheets of 52 lines (one per subcarrier) that cross the walls; on a hit they come back from the target
  const sg = new THREE.CylinderGeometry(1, 1, 1, 160, 1, true).translate(0, 0.5, 0), sIn = new THREE.InstancedBufferGeometry(); sIn.index = sg.index; sIn.setAttribute('position', sg.attributes.position); sIn.setAttribute('uv', sg.attributes.uv); sIn.setAttribute('aI', new THREE.InstancedBufferAttribute(new Float32Array([0, 1, 2, 3, 4, 5]), 1)); sIn.instanceCount = 6;
  const wifi = new THREE.Mesh(sIn, light({ uSrc, uTgt, uAng, uRange, uFx, uRes, uU, uHot }, 'attribute float aI;uniform vec3 uSrc,uTgt;uniform float uT,uRange,uRes,uU;varying float vY,vF,vB;varying vec3 vP;varying vec2 vD;void main(){float back=step(4.,aI)*step(.5,uRes);float u=back>.5?clamp((uU-.42-(aI-4.)*.1)*2.1,0.,1.):fract(uT*.30+aI/4.);float R=(uRange+3.5)*u+.15;if(aI>3.5&&uRes<.5)R=0.;vec3 o=back>.5?vec3(uTgt.x,uSrc.y,uTgt.z):uSrc;vec3 p=vec3(position.x*R,position.y*2.7,position.z*R)+vec3(o.x,0.05,o.z);vP=p;vY=position.y;vF=(1.-u)*smoothstep(0.,.08,u);vB=back;vD=position.xz;gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);}',
    'uniform float uAng,uFx,uT,uRes;uniform vec3 uCool,uTgt,uHot;varying float vY,vF,vB;varying vec3 vP;varying vec2 vD;void main(){float d=dot(normalize(vD),vec2(cos(uAng),-sin(uAng)))*(vB>.5?-1.:1.);float sec=smoothstep(.52,.86,d);float l=.5+.5*cos(vY*326.7);float w=fwidth(vY*52.);l=mix(pow(l,3.),.31,smoothstep(.25,.7,w));float near=exp(-dot(vP.xz-uTgt.xz,vP.xz-uTgt.xz)*.35);float v=smoothstep(0.,.1,vY)*smoothstep(1.,.35,vY);vec3 c=mix(uCool,uHot,max(vB,near*uRes));gl_FragColor=vec4(c*sec*v*vF*(l*.85+.07)*(1.+near*1.4*uRes+vB*1.2)*uFx,1.);}')); wifi.frustumCulled = false; wifi.renderOrder = 9; wifi.visible = false; scene.add(wifi);
  // Radar: a 120 degree fan with range gates of 0.75 m and a sweep
  const fan = new THREE.Mesh(discGeo, light({ uSrc, uTgt, uAng, uRange, uFx, uRes, uU, uHot, uMicro: { value: 0 } }, W, 'uniform vec3 uSrc,uTgt,uCool,uHot;uniform float uAng,uRange,uFx,uRes,uT,uMicro;varying vec3 vW;void main(){vec2 q=vW.xz-uSrc.xz;float r=length(q);if(r>6.02)discard;float a=atan(-q.y,q.x)-uAng;a=atan(sin(a),cos(a));float sec=smoothstep(1.06,1.03,abs(a));float g=r/.75,w=fwidth(g)*1.3;float rings=smoothstep(w,0.,abs(fract(g+.5)-.5));float edge=smoothstep(.035/max(r,.3),0.,abs(abs(a)-1.04));float sw=sin(uT*2.2)*1.04,dir=sign(cos(uT*2.2));float beh=(sw-a)*dir;float trail=smoothstep(.75,0.,beh)*step(0.,beh);float head=smoothstep(.03,0.,abs(beh));float fade=smoothstep(6.,4.6,r)*smoothstep(.25,.7,r);float pulse=uMicro>.5?.5+.5*sin(uT*3.1):1.;float gateR=uMicro>.5?(floor(uRange/.75+.5)*.75):uRange;float hit=exp(-pow((r-gateR)*(uMicro>.5?4.5:6.),2.))*exp(-pow(a*(uMicro>.5?2.4:5.),2.))*uRes*pulse;float tick=smoothstep(.02,0.,abs(fract(a*5.73)-.5)/9.)*step(5.8,r);vec3 c=uCool*(rings*.16+edge*.35+trail*.17+head*.6+.02+tick*.2)*fade*sec+uHot*hit*2.1*sec;gl_FragColor=vec4(c*uFx,1.);}')); fan.scale.setScalar(6.1); fan.renderOrder = 9; fan.visible = false; scene.add(fan);
  // Motion pattern: strictly even rings, the signature of a machine
  const pulse = new THREE.Mesh(discGeo, light({ uFx, uU }, W, 'uniform float uT,uFx;varying vec2 vUv;void main(){float r=length(vUv*2.-1.);float g=r*6.-floor(uT*2.5)-smoothstep(.0,.35,fract(uT*2.5));float w=fwidth(r*6.)*1.4;float l=smoothstep(w,0.,abs(fract(g+.5)-.5));gl_FragColor=vec4(vec3(.72,.70,.95)*l*smoothstep(1.,.2,r)*uFx*.9,1.);}')); pulse.scale.setScalar(4.2); pulse.renderOrder = 9; pulse.visible = false; scene.add(pulse);
  // Thermal: the camera's true 32 by 24 pixels, standing in the air at the target's distance
  const tp = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), light({ uFx, uRes, uU, uHot, uBlob: { value: new THREE.Vector4(0.5, 0.36, 0.03, 0.07) } }, W, 'uniform float uT,uFx,uRes,uU;uniform vec4 uBlob;uniform vec3 uCool;varying vec2 vUv;' + NOISE + 'vec3 ramp(float x){return x<.33?mix(vec3(.02,.03,.09),vec3(.22,.08,.36),x*3.):x<.66?mix(vec3(.22,.08,.36),vec3(.95,.28,.16),(x-.33)*3.):mix(vec3(.95,.28,.16),vec3(1.5,1.25,.7),(x-.66)*3.);}void main(){vec2 n=vec2(32.,24.),c=floor(vUv*n),f=fract(vUv*n);vec2 u=(c+.5)/n;vec2 d=(u-uBlob.xy)/uBlob.zw;float nz=h1(c+floor(uT*4.))*.12+.06;float heat=clamp(nz+exp(-dot(d,d))*uRes,0.,1.);float wipe=step(c.y/24.,uU*3.);vec2 e=abs(f-.5);float cell=smoothstep(.5,.44,max(e.x,e.y));vec2 fr=abs(vUv-.5)*2.;float vig=smoothstep(.62,.1,length((u-vec2(uBlob.x,.42))*vec2(1.25,1.15)));gl_FragColor=vec4((ramp(heat)*(.35+1.5*heat)*vig+uCool*.05*vig*(1.-heat))*cell*wipe*uFx,1.);}')); tp.renderOrder = 9; tp.visible = false; scene.add(tp);
  const cone = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(24), 3).setUsage(THREE.DynamicDrawUsage)), light({ uFx }, 'varying float d;void main(){d=float(gl_VertexID&1);gl_Position=projectionMatrix*viewMatrix*vec4(position,1.);}', 'uniform float uFx;varying float d;void main(){gl_FragColor=vec4(vec3(1.,.55,.35)*.5*(1.-d)*uFx,1.);}')); cone.frustumCulled = false; cone.renderOrder = 9; cone.visible = false; scene.add(cone);

  // ---- image ----
  const post = createPost(renderer, scene, camera, { quality: 'high' }); post.bloom.strength = 0.46; post.bloom.threshold = 1.0;
  post.setFog({ color: new THREE.Color(0.020, 0.028, 0.040), sun: new THREE.Color(0.02, 0.025, 0.03), dir: new THREE.Vector3(-0.8, 0.5, 0.2), a: 0.006, h: 0.012, b: 0.09, base: 0 });
  let w0 = 0, h0 = 0, pr = Math.min(1.5, window.devicePixelRatio || 1), prW = 0, slow = 0, ms = 16, frames = 0;
  function resize() { const w = host.clientWidth, h = host.clientHeight; if (w < 2 || h < 2 || (w === w0 && h === h0 && pr === prW)) return; w0 = w; h0 = h; prW = pr; renderer.setSize(Math.round(w * pr), Math.round(h * pr), false); post.setSize(w, h, pr); camera.aspect = w / h; camera.setViewOffset(w, h, -w * 0.045, h * 0.015, w, h); camera.updateProjectionMatrix(); uPx.value = h * pr / (2 * Math.tan(camera.fov * Math.PI / 360)); }

  // ---- look around ----
  const orb = { a: 0, e: 0, ta: 0, te: 0 }; let drag = null;
  dom.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, a: orb.ta, e: orb.te }; dom.setPointerCapture(e.pointerId); });
  dom.addEventListener('pointermove', (e) => { if (!drag) return; orb.ta = drag.a - (e.clientX - drag.x) * 0.004; orb.te = clamp(drag.e + (e.clientY - drag.y) * 0.003, -0.35, 0.5); onLook?.(); });
  const drop = () => { drag = null; }; dom.addEventListener('pointerup', drop); dom.addEventListener('pointercancel', drop);
  dom.addEventListener('keydown', (e) => { const k = { ArrowLeft: [-0.12, 0], ArrowRight: [0.12, 0], ArrowUp: [0, 0.08], ArrowDown: [0, -0.08] }[e.key]; if (!k) return; e.preventDefault(); e.stopPropagation(); orb.ta += k[0]; orb.te = clamp(orb.te + k[1], -0.35, 0.5); onLook?.(); });
  let onLook = null;

  const tgtV = new THREE.Vector3(), prevRover = [0, 0, 0], prj = new THREE.Vector3(), glass = { x: 0, z: 0, r: 0 }, cams = { glass }, cold = new THREE.Color('#9fb8d6'), col = new THREE.Color();
  let pastN = -1, roomsKey = '';

  // P: { p, pk, lead:[x,y], rover:[x,y,h], moving, fx:{kind,k,u,res,range,blob}, hot 0..1, lock, fall, imp, glassR, lie, turn, rooms, cam:{x,y,h,dist,az,el} }
  function pose(P, dt, time) {
    G.uT.value = time;
    at(P.lead, 0.02, lead.position); uP.value = P.p; uK.value = P.pk; uLock.value = P.lock; uFall.value = P.fall; uImp.value = P.imp; uLie.value = P.lie; uTurn.value = P.turn;
    uHot.value.copy(cold).lerp(G.uPerson.value, P.hot); cap.position.y = P.p * H; uRooms.value = P.rooms;
    warm.position.set(P.lead[0], 0.7 + P.p * 1.6, -P.lead[1]); warm.color.copy(uHot.value); warm.intensity = P.pk * (1.5 + 46 * P.p * P.p) * (1 - 0.8 * P.fall) * (1 + 0.8 * P.lock);
    // rover
    const u = rs.units['HOUND-01']; u.pos[0] = P.rover[0]; u.pos[1] = P.rover[1]; u.heading = P.rover[2]; u.mode = P.moving ? 'drive' : 'listen';
    const jump = Math.hypot(P.rover[0] - prevRover[0], P.rover[1] - prevRover[1]) > 2;
    if (P.moving || jump) renderer.shadowMap.needsUpdate = true;
    prevRover[0] = P.rover[0]; prevRover[1] = P.rover[1];
    rover?.update(jump ? { ...rs } : rs, dt, time);
    glass.x = P.glass[0]; glass.z = -P.glass[1]; glass.r = P.glassR; parts.building?.update?.(dt, time, null, cams);
    // fields
    const f = P.fx, k = f ? f.k : 0; uFx.value = k; cool.intensity = k * 5; cool.position.set(P.rover[0], 1.1, -P.rover[1]);
    const csi = !!f && f.kind === 'csi', rad = !!f && (f.kind === 'radar' || f.kind === 'micro'), th = !!f && (f.kind === 'thermal' || f.kind === 'temperature'), mac = !!f && f.kind === 'signature';
    wifi.visible = csi && k > 0.005; fan.visible = rad && k > 0.005; tp.visible = cone.visible = th && k > 0.005; pulse.visible = mac && k > 0.005;
    if (f) {
      const dx = P.lead[0] - P.rover[0], dy = P.lead[1] - P.rover[1], d = Math.hypot(dx, dy); uSrc.value.set(P.rover[0], 0.6, -P.rover[1]); uTgt.value.set(P.lead[0], 0.6, -P.lead[1]); uAng.value = Math.atan2(dy, dx); uRange.value = d; uRes.value = f.res; uU.value = f.u;
      if (rad) { fan.position.set(P.rover[0], 0.62, -P.rover[1]); fan.material.uniforms.uMicro.value = f.kind === 'micro' ? 1 : 0; }
      if (mac) pulse.position.set(P.lead[0], 0.5, -P.lead[1]);
      if (th) {
        const W2 = 2 * d * 1.428, H2 = 2 * d * 0.767, base = 0.62; tp.position.set(P.lead[0] + dx / d * 0.35, base, -(P.lead[1] + dy / d * 0.35)); tp.scale.set(W2, H2, 1); tp.lookAt(P.rover[0], base, -P.rover[1]);
        const b = tp.material.uniforms.uBlob.value, hh = f.lie ? 0.3 : 1.0, ww = f.lie ? 1.1 : 0.42; b.set(0.5, 0.5 + ((f.lie ? 0.3 : 0.9) - base) / H2, ww / W2, hh / H2); if (f.faint) { b.z *= 0.45; b.w *= 0.6; b.x += 0.02; }
        const a = cone.geometry.attributes.position.array, ux = -dy / d, uy = dx / d; let n = 0; for (const sx of [-0.28, 0.28]) for (const sy of [-0.28, 0.28]) { a[n++] = P.rover[0]; a[n++] = 0.45; a[n++] = -P.rover[1]; a[n++] = P.lead[0] + ux * W2 * sx; a[n++] = Math.max(0.1, base + H2 * sy); a[n++] = -(P.lead[1] + uy * W2 * sx); } cone.geometry.attributes.position.needsUpdate = true; cone.geometry.setDrawRange(0, 8);
      }
    }
    // earlier answers
    if (P.past.length !== pastN || P.pastKey !== past.userData.key) { pastN = P.past.length; past.userData.key = P.pastKey; for (let i = 0; i < 12; i++) { const on = i < pastN; m4.compose(v.set(0, on ? P.past[i] * H : 0, 0), q4.identity(), s3.setScalar(on ? 0.61 : 0)); past.setMatrixAt(i, m4); } past.instanceMatrix.needsUpdate = true; }
    if (P.roomsKey !== roomsKey) { roomsKey = P.roomsKey; rooms.forEach((r, i) => { const L = P.levels[r.id]; lvl.setXY(i, L ? L.p : 0.1, L && L.hot ? 1 : 0); roomShafts.setMatrixAt(i, m4.makeTranslation(L && L.pos ? L.pos[0] : roomC[i][0], 0.02, -(L && L.pos ? L.pos[1] : roomC[i][1]))); }); lvl.needsUpdate = true; roomShafts.instanceMatrix.needsUpdate = true; }
    // camera
    if (!drag) { const back = Math.exp(-0.25 * dt); orb.ta *= back; orb.te *= back; } const e = 1 - Math.exp(-7 * dt); orb.a += (orb.ta - orb.a) * e; orb.e += (orb.te - orb.e) * e;
    const c = P.cam, az = c.az + orb.a, el = clamp(c.el + orb.e, 0.14, 1.3); tgtV.set(c.x, c.h, -c.y); camera.position.set(c.x + Math.sin(az) * Math.cos(el) * c.dist, c.h + Math.sin(el) * c.dist, -c.y + Math.cos(az) * Math.cos(el) * c.dist); camera.lookAt(tgtV); camera.updateMatrixWorld();
    scale.rotation.y = Math.atan2(camera.position.x - lead.position.x, camera.position.z - lead.position.z);
    post.setFocus(camera.position.distanceTo(v.set(P.lead[0], 1.4, -P.lead[1])), P.dof, dt);
  }
  function render(dt, time) {
    resize(); frames++; if (dt > 0) { ms += (dt * 1000 - ms) * 0.05; if (ms > 19 && frames > 90) { if (++slow > 50 && pr > 0.8) { pr = Math.max(0.8, pr - 0.125); slow = 0; } } else slow = Math.max(0, slow - 2); }
    if (frames < 4) renderer.shadowMap.needsUpdate = true;
    post.render(time);
  }
  // screen position of a point above the lead (dx: metres to the camera's right)
  function project(p, h, dx, out) { prj.set(p[0], h, -p[1]); if (dx) { v.setFromMatrixColumn(camera.matrixWorld, 0); prj.addScaledVector(v, dx); } prj.project(camera); out.x = (prj.x * 0.5 + 0.5) * w0; out.y = (-prj.y * 0.5 + 0.5) * h0; return out; }
  let lost = false; dom.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; }); dom.addEventListener('webglcontextrestored', () => { lost = false; frames = 0; });
  return { dom, pose, render, resize, project, rooms, roomC, readTokens, get lost() { return lost; }, get pr() { return pr; }, set onLook(f) { onLook = f; }, shadow() { renderer.shadowMap.needsUpdate = true; } };
}
