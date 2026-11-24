// The Demo film of the Drone imagery workspace: three acts on one WebGL canvas, with a thin drawn overlay.
//   1 Find     a strip of frames; the detector's own (recorded or live) boxes and the live colour test
//   2 Place    the simulated site mosaic draped over the site model; leads land on map positions
//   3 Compare  two drawn flights of the same ground, aligned and compared live; drag the divider
// Nothing here makes up a result: boxes come from data/aerial/recorded.json or a live run, heat from the RX worker,
// changes from the change worker. Frames of act 1 are AI-generated illustrations and say so on screen.
import { tileGrid, colourName, nms } from './shared.js';

const STRIP = ['G-01', 'G-03', 'G-02', 'G-05'], FW = 1254, STEP = 1104, SW = FW, SH = FW + 3 * STEP, LAP = FW - STEP;
const oy = (k) => (STRIP.length - 1 - k) * STEP;   // the frames are stacked; the drone flies up the stack, so frame 0 is at the bottom
const FOV1 = 42, RELIEF = 72, M_PER_PX = 0.045, LEAD = 640, AIM = 440, FOV = 30, TAN = Math.tan((FOV / 2) * Math.PI / 180);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => { t = clamp(t); return t * t * t * (t * (t * 6 - 15) + 10); };   // quintic: no jump in speed or acceleration
const out = (t) => 1 - Math.pow(1 - clamp(t), 4);
const DUR = [44, 22, 26], T_END = 33.2;

function noiseCanvas(size, seed, oct = 5) {   // tileable soft noise, baked once
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'), im = g.createImageData(size, size);
  const hash = (x, y, p) => { let n = Math.imul((x % p + p) % p, 374761393) ^ Math.imul((y % p + p) % p, 668265263) ^ (seed * 7919 + p); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0, a = 0.5, p = 4;
    for (let o = 0; o < oct; o++) { const fx = x / size * p, fy = y / size * p, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty); v += a * lerp(lerp(hash(ix, iy, p), hash(ix + 1, iy, p), sx), lerp(hash(ix, iy + 1, p), hash(ix + 1, iy + 1, p), sx), sy); a *= 0.5; p *= 2; }
    const i = (y * size + x) * 4, k = Math.round(clamp(v) * 255); im.data[i] = im.data[i + 1] = im.data[i + 2] = k; im.data[i + 3] = 255;
  }
  g.putImageData(im, 0, 0); return c;
}

export async function createHero(host, o) {
  const THREE = await import('three');
  const { h, css, world, reduced, loadBitmap, recorded, rpc, siteSpec, outdoorLeads, onState, sendLead } = o;
  const gl = h('canvas.ah-gl', { 'aria-hidden': 'true' }), ov = h('canvas.ah-ov', { tabindex: 0, role: 'img', 'aria-label': 'Aerial film. Drag to move the view.' });
  host.append(gl, h('div.ah-scrim', { 'aria-hidden': 'true' }), ov);
  const renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x06080a, 1); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.7;   // act 2 only: acts 1 and 3 grade in their own shaders
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
  const g = ov.getContext('2d');
  const aniso = renderer.capabilities.getMaxAnisotropy();
  let W = 1, H = 1, dpr = 1, ratio = 1;
  const cam = new THREE.PerspectiveCamera(FOV, 1, 1, 12000);
  const C = {}; const readColours = () => { for (const k of ['person', 'warn', 'text', 'text-2', 'accent', 'ok', 'sim', 'bg-0']) C[k] = css('--' + k); C.font = css('--font'); C.display = css('--font-display'); C.mono = css('--mono'); };
  readColours();

  const noise = new THREE.CanvasTexture(noiseCanvas(256, 5)); noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
  const heatRamp = /* glsl */'vec3 ramp(float t){ vec3 a=vec3(.17,.25,.42),b=vec3(.48,.25,.56),c=vec3(.85,.31,.30),d=vec3(1.,.70,.29),e=vec3(1.,.95,.77); return t<.25?mix(a,b,t*4.):t<.5?mix(b,c,(t-.25)*4.):t<.75?mix(c,d,(t-.5)*4.):mix(d,e,(t-.75)*4.); }';

  // ---------------------------------------------------------------- act 1: the strip
  const BINS = 230, strip = { ready: false, end: T_END, prof: null, low: [], boxes: [], regions: [], tiles: [], live: null };
  const s1 = new THREE.Scene(); s1.background = new THREE.Color(0x06080a);
  const photo = document.createElement('canvas'); photo.width = SW; photo.height = SH;
  const heatC = document.createElement('canvas'); heatC.width = SW / 2; heatC.height = SH / 2;
  const photoTex = new THREE.CanvasTexture(photo); photoTex.colorSpace = THREE.NoColorSpace; photoTex.anisotropy = aniso; photoTex.wrapT = THREE.MirroredRepeatWrapping; photoTex.wrapS = THREE.MirroredRepeatWrapping;
  const heatTex = new THREE.CanvasTexture(heatC); heatTex.colorSpace = THREE.NoColorSpace;
  const u1 = { uMap: { value: photoTex }, uHeat: { value: heatTex }, uNoise: { value: noise }, uFront: { value: -200 }, uTime: { value: 0 }, uLift: { value: 0 }, uHeatK: { value: 1 }, uCam: { value: new THREE.Vector3() }, uFog: { value: 0 }, uSize: { value: new THREE.Vector2(SW, SH) }, uHgt: { value: null }, uStrip: { value: 1 } };
  const sheetMat = new THREE.ShaderMaterial({ uniforms: u1, vertexShader: /* glsl */`
    uniform sampler2D uHeat,uHgt; uniform float uLift,uTime,uFront; uniform vec2 uSize; varying vec2 vUv; varying vec3 vW; varying float vH;
    void main(){ vec3 p=position; vec2 uv=p.xy/uSize+.5; vUv=uv; float in_=step(0.,uv.x)*step(uv.x,1.); p.z+=(texture2D(uHgt,uv).r-.5)*${RELIEF.toFixed(1)};
      float hgt=(textureLod(uHeat,uv,4.5).a*.6+textureLod(uHeat,uv,3.).a*.4)*in_; hgt=pow(hgt,.8);
      float wave=.94+.06*sin(uTime*1.7+p.x*.01); vH=hgt; p.z+=hgt*uLift*300.*wave; vW=p; gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D uMap,uHeat,uNoise; uniform float uFront,uTime,uLift,uHeatK,uFog,uStrip; uniform vec3 uCam; uniform vec2 uSize; varying vec2 vUv; varying vec3 vW; varying float vH;
    ${heatRamp}
    void main(){
      float off=max(max(-vUv.x,vUv.x-1.)*uSize.x,max(-vUv.y,vUv.y-1.)*uSize.y);   // units outside the swath the drone photographed
      vec3 c=texture2D(uMap,vUv,clamp(off*.02,0.,4.)).rgb; float l=dot(c,vec3(.3,.59,.11));
      float px=vUv.y*uSize.y; float n=texture2D(uNoise,vUv*vec2(2.5,9.)).r, grain=texture2D(uNoise,vUv*vec2(31.,113.)).r;
      c*=.94+.12*grain;                                                     // keeps the close view from looking soft
      float seen=smoothstep(60.,-60.,px-uFront+(n-.5)*50.);
      vec3 cold=mix(vec3(l),c,.18)*vec3(.50,.57,.66);                       // not read yet: graphite
      vec3 warm=mix(vec3(l),c,1.12); warm=mix(warm,warm*warm*(3.-2.*warm),.35)*vec3(1.0,.985,.96);
      vec3 col=mix(cold,warm,seen);
      // the false-colour strip that trails the scan bar: the same frame, warm colours hot, shade cold
      vec3 f=texture2D(uMap,vUv,1.2).rgb; float fl=dot(f,vec3(.3,.59,.11)); float ft=clamp(.10+fl*.78+(f.r-f.b)*1.35,0.,1.);
      vec3 iron=ft<.3?mix(vec3(.015,.012,.06),vec3(.30,.04,.42),ft/.3):ft<.6?mix(vec3(.30,.04,.42),vec3(.86,.22,.22),(ft-.3)/.3):ft<.85?mix(vec3(.86,.22,.22),vec3(1.,.72,.20),(ft-.6)/.25):mix(vec3(1.,.72,.20),vec3(1.,.98,.86),(ft-.85)/.15);
      float back=uFront-px; float band=smoothstep(-2.,3.,back)*(1.-smoothstep(50.,185.,back));
      col=mix(col,iron*(.80+.30*grain),band*.92*step(off,0.)*uStrip);
      float cloud=texture2D(uNoise,vW.xy*.00022+vec2(uTime*.006,uTime*.004)).r; col*=mix(1.22,.92,smoothstep(.44,.62,cloud)*(1.-uFog)); col=min(col,1.);
      float inside=step(off,0.);
      float hv=texture2D(uHeat,vUv).a*inside;
      float breathe=.62+.38*sin(uTime*2.1+px*.004);
      float hs=smoothstep(.05,.9,hv);
      vec3 glow=ramp(clamp(hv*.45+.36,0.,.78));
      col=mix(col,glow*(.28+l*1.5),hs*seen*uHeatK*(.16+.26*breathe));
      float halo=textureLod(uHeat,vUv,5.).a*inside; col+=vec3(1.,.48,.2)*halo*halo*seen*uHeatK*(.10+.14*breathe);
      if(uLift>.01){ float f=abs(fract(vH*14.-.5)-.5)/fwidth(vH*14.); float line=(1.-clamp(f,0.,1.))*smoothstep(.02,.12,vH); col=mix(col,vec3(1.,.80,.52),line*.75*uLift); col+=glow*smoothstep(.05,.9,vH)*.25*uLift; }
      float edge=exp(-pow((px-uFront)/1.8,2.))*1.1+.16*exp(-pow((px-uFront)/26.,2.));
      col+=vec3(.42,.70,1.)*edge*.5*inside;
      float swath=exp(-pow(min(abs(vUv.x),abs(1.-vUv.x))*uSize.x/1.6,2.)); col+=vec3(.42,.70,1.)*swath*.16*step(-40.,uFront-px)*(1.-uFog);
      col=mix(col,vec3(dot(col,vec3(.3,.59,.11)))*vec3(.30,.34,.40),smoothstep(0.,150.,off)); col*=mix(1.,.45,smoothstep(0.,420.,off));
      float d=distance(vW,uCam); float fog=uFog*(1.-exp(-pow(max(d-1400.,0.)/2700.,1.6))); fog=clamp(fog*1.06+(n-.5)*.16*fog*(1.-fog),0.,1.);
      col=mix(col,vec3(.098,.114,.130),fog);
      gl_FragColor=vec4(col,1.); }` });
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(SW * 4.2, SH * 1.45, 500, 640), sheetMat); s1.add(sheet); sheet.frustumCulled = false;
  // air: a thin haze sheet and dust, both far nearer than the ground, so the flight reads as height
  const uA = { uNoise: { value: noise }, uCam: u1.uCam, uTime: u1.uTime, uFog: u1.uFog };
  const haze = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.ShaderMaterial({ uniforms: uA, transparent: true, depthWrite: false, vertexShader: 'varying vec3 vW; void main(){ vW=(modelMatrix*vec4(position,1.)).xyz; gl_Position=projectionMatrix*viewMatrix*vec4(vW,1.); }', fragmentShader: 'uniform sampler2D uNoise; uniform float uTime,uFog; uniform vec3 uCam; varying vec3 vW; void main(){ float a=texture2D(uNoise,vW.xy*.00042+vec2(uTime*.011,0.)).r, b=texture2D(uNoise,vW.xy*.0013-vec2(0.,uTime*.017)).r; float k=smoothstep(.50,.82,a*.7+b*.4); gl_FragColor=vec4(.66,.72,.78,k*.20*(1.-uFog)*smoothstep(0.,260.,uCam.z-vW.z)); }' })); haze.frustumCulled = false; haze.renderOrder = 2; s1.add(haze);
  const dustGeo = new THREE.BufferGeometry(); { const n = 240, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const q = (k) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); }; a[i * 3] = q(1) * 1800; a[i * 3 + 1] = q(2) * 1800; a[i * 3 + 2] = 90 + q(3) * 640; } dustGeo.setAttribute('position', new THREE.BufferAttribute(a, 3)); }
  const dust = new THREE.Points(dustGeo, new THREE.ShaderMaterial({ uniforms: { uCam: u1.uCam, uTime: u1.uTime, uFog: u1.uFog, uPx: { value: 900 } }, transparent: true, depthWrite: false, vertexShader: 'uniform vec3 uCam; uniform float uTime,uFog,uPx; varying float vA; void main(){ vec3 p=position; p.xy+=vec2(uTime*22.,-uTime*9.); p.xy=uCam.xy+vec2(0.,500.)+mod(p.xy-uCam.xy,1800.)-900.; vec4 m=viewMatrix*vec4(p,1.); gl_Position=projectionMatrix*m; gl_PointSize=clamp(uPx*2.6/max(-m.z,1.),1.5,9.); vA=.30*smoothstep(60.,240.,-m.z)*(1.-uFog); }', fragmentShader: 'varying float vA; void main(){ float d=length(gl_PointCoord-.5); gl_FragColor=vec4(.92,.90,.84,vA*smoothstep(.5,.08,d)); }' })); dust.frustumCulled = false; dust.renderOrder = 4; s1.add(dust);
  // the tiles the detector read: one instanced quad each, lit at its own moment
  let tileMesh = null, uT = { uT: { value: 0 }, uA: { value: 1 } };
  function buildTiles() {
    strip.tiles = [];
    STRIP.forEach((id, k) => { const r = recorded?.frames[id]; const T = r?.tile || 320; tileGrid(FW, FW, T, 0.4).forEach((t, i) => strip.tiles.push({ id, k, i, x: t.x, fy: t.y, y: t.y + oy(k), w: t.w, at: 0 })); });
    const geo = new THREE.PlaneGeometry(1, 1), at = new Float32Array(strip.tiles.length), m = new THREE.Matrix4();
    const mat = new THREE.ShaderMaterial({ uniforms: uT, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, vertexShader: 'attribute float aAt; uniform float uT; varying vec2 vUv; varying float vA; void main(){ vUv=uv; vA=uT-aAt; gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.); }',
      fragmentShader: 'uniform float uA; varying vec2 vUv; varying float vA; void main(){ if(vA<0.) discard; vec2 q=min(vUv,1.-vUv); float e=min(q.x,q.y); float w=fwidth(e); float line=1.-smoothstep(w*.6,w*1.6,e); float c=step(min(max(q.x,q.y),1.),.09); float k=exp(-vA*2.4); float rest=.018; float scan=exp(-pow((1.-vUv.y-vA*2.2)*18.,2.))*step(vA,.5); gl_FragColor=vec4(vec3(.42,.70,1.),(line*(k*.26+c*.06+rest)+k*.045+scan*.16)*uA); }' });
    tileMesh = new THREE.InstancedMesh(geo, mat, strip.tiles.length); tileMesh.frustumCulled = false; tileMesh.renderOrder = 3;
    strip.tiles.forEach((t, i) => { m.makeScale(t.w, t.w, 1); m.setPosition(t.x + t.w / 2 - SW / 2, SH / 2 - t.y - t.w / 2, 4 + hz(t.x + t.w / 2, t.y + t.w / 2)); tileMesh.setMatrixAt(i, m); });
    geo.setAttribute('aAt', new THREE.InstancedBufferAttribute(at, 1)); s1.add(tileMesh); schedule();
  }
  // ---- the flight plan. S: the point under the drone, in units along the stack. At each stop the drone comes down on
  // the find, holds for two seconds, and climbs away.
  let stops = [], legs = [];
  function plan() {
    const f = strip.boxes.map((b) => ({ x: (b.x0 + b.x1) / 2, a: SH - (b.y0 + b.y1) / 2 }));
    f.sort((p, q) => Math.abs(p.a - q.a) < 220 ? p.x - q.x : p.a - q.a);
    stops = []; legs = []; let T = 0.4, S = -260, first = true;
    for (let i = 0; i < f.length; i++) {
      if (i && Math.abs(f[i].a - f[i - 1].a) < 220) { const p = stops[stops.length - 1]; p.to = f[i]; p.slide = p.t1; p.t1 += 1.4 + 1.8; continue; }   // a second find beside the first: slide across
      const S1 = f[i].a - AIM, d = first ? 4.6 : Math.max(4.4, (S1 - S) / 235); if (!first) T = stops[stops.length - 1].t1 + 0.6; legs.push({ t0: T, t1: T + d, a: S, b: S1 }); T += d; S = S1; first = false;
      stops.push({ ...f[i], t0: T + 0.05, t1: T + 0.05 + 1.35 + 2.0 });
    }
    { const last = stops.length ? stops[stops.length - 1].t1 + 0.6 : 0.4, to = SH - AIM - 520, d = Math.max(5, (to - S) / 235); if (to > S + 200) { legs.push({ t0: last, t1: last + d, a: S, b: to }); strip.end = last + d + 0.3; } else strip.end = last; }   // on over the last frame DUR[0] = strip.end + 11;
  }
  const baseS = (t) => { let v = legs.length ? legs[0].a : -260; for (const l of legs) { if (t < l.t0) break; v = lerp(l.a, l.b, ease((t - l.t0) / (l.t1 - l.t0))); } return v; };
  const pushAt = (t) => { for (const q of stops) if (t > q.t0 && t < q.t1 + 1.6) return [q, ease((t - q.t0) / 1.35) * (1 - ease((t - q.t1) / 1.6))]; return [null, 0]; };
  const Q = {};
  function poseAt(t, r) {   // position, pitch from straight down, heading: everything on screen follows from this
    const S = baseS(t) + t * 1.5, [q, p] = pushAt(t), e = ease((t - strip.end) / 5.6);
    let x = SW / 2 + 70 * Math.sin(S * 0.0017 + 0.6), z = 930, th = 0.452, a = S;
    if (q) { const k = q.to ? ease((t - q.slide) / 1.4) : 0, tx = lerp(q.x, q.to ? q.to.x : 0, k), ta = lerp(q.a, q.to ? q.to.a : 0, k), zz = 520, tt = 0.33; x = lerp(x, tx, p); z = lerp(z, zz, p); th = lerp(th, tt, p); a = lerp(a, ta - zz * Math.tan(tt) * 0.80, p); }
    if (e > 0) { x = lerp(x, SW / 2, e); a = lerp(a, -420 + (t - strip.end - 5) * 16, e); z = lerp(z, 880, e) + Math.sin(e * Math.PI) * 240; th = lerp(th, 1.10, e); }
    r.x = x; r.a = a; r.z = z; r.th = th; return r;
  }
  const front = (t) => { const S = baseS(t) + LEAD; return t > strip.end ? lerp(S, SH + 300, ease((t - strip.end) / 2.2)) : lerp(-200, S, ease((t + 0.2) / 4.4)); };
  function timeOfFront(x) { let a = 0, b = strip.end + 3; for (let i = 0; i < 26; i++) { const m = (a + b) / 2; if (front(m) < x) a = m; else b = m; } return b; }
  function schedule() {
    if (!tileMesh) return; const at = tileMesh.geometry.attributes.aAt;
    strip.tiles.forEach((t, i) => { t.at = strip.live ? (t.done ?? 1e6) : timeOfFront(SH - t.y - t.w * 0.5) + (t.x / SW) * 0.42; at.array[i] = t.at; }); at.needsUpdate = true;
    for (const b of strip.boxes) if (!strip.live) b.at = timeOfFront(SH - (b.y0 + b.y1) / 2 + 120) + 0.35 + (b.x0 / SW) * 0.5;
    for (const r of strip.regions) r.at = timeOfFront(SH - r.y0 + 40) + 0.2;
  }
  function setBoxes(rec) {
    strip.boxes = []; strip.low = [];
    STRIP.forEach((id, k) => { for (const b of rec?.frames[id]?.boxes || []) (b[0] >= o.minScore ? strip.boxes : strip.low).push({ id, score: b[0], x0: b[1], y0: b[2] + oy(k), x1: b[3], y1: b[4] + oy(k), at: 0 }); });
    if (!legs.length) plan(); schedule();
  }
  // the height map: light slabs rise, shade sinks, over a slow roll of the ground. Made from the picture by hand-set rules; it is not a measurement
  const HW = 314, HH = 1142; let hd = null;
  const hz = (x, y) => hd ? (hd[clamp(Math.round(y / SH * HH), 0, HH - 1) * HW + clamp(Math.round(x / SW * HW), 0, HW - 1)] / 255 - 0.5) * RELIEF : 0;
  function buildHeight(nz) {
    const c = document.createElement('canvas'); c.width = HW; c.height = HH; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(photo, 0, 0, HW, HH); const im = x.getImageData(0, 0, HW, HH), d = im.data, n = HW * HH;
    let L = new Float32Array(n); for (let i = 0; i < n; i++) L[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255;
    const blur = (src, r) => { let a = src; for (const horiz of [1, 0, 1, 0]) { const b = new Float32Array(n), U = horiz ? HW : HH, N2 = horiz ? HH : HW, su = horiz ? 1 : HW, sv = horiz ? HW : 1; for (let v2 = 0; v2 < N2; v2++) { let s = 0; const at = (u) => a[v2 * sv + clamp(u, 0, U - 1) * su]; for (let u = -r; u <= r; u++) s += at(u); for (let u = 0; u < U; u++) { b[v2 * sv + u * su] = s / (2 * r + 1); s += at(u + r + 1) - at(u - r); } } a = b; } return a; };
    const A1 = blur(L, 3), A2 = blur(L, 26); hd = new Uint8ClampedArray(n);
    for (let i = 0; i < n; i++) { const px = i % HW, py = (i / HW) | 0; hd[i] = 255 * clamp(0.5 + (A1[i] - A2[i]) * 1.9 + (nz[((py >> 1) & 255) * 256 + (px >> 1 & 255) << 2] / 255 - 0.5) * 0.5); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = hd[i]; d[i * 4 + 3] = 255; }
    x.putImageData(im, 0, 0); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; u1.uHgt.value = t;
  }
  // a worker job that survives the workspace being hidden: the worker is released then, and the job starts again on return
  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  async function job(fn) { for (;;) { while (!shown && !dead) await nap(400); if (dead) throw new Error('released'); try { return await fn(); } catch (e) { if (dead || e.message !== 'released') throw e; } } }
  const breathe = async () => { await nap(30); while (!shown && !dead) await nap(400); if (dead) throw new Error('released'); };
  async function buildStrip() {
    const pc = photo.getContext('2d');
    const bmps = await Promise.all(STRIP.map(loadBitmap));
    // frames overlap; the seam follows a noise edge, the way an orthomosaic is stitched
    const seam = document.createElement('canvas'); seam.width = FW; seam.height = LAP; const sg = seam.getContext('2d', { willReadFrequently: true });
    const nz = noise.image.getContext('2d').getImageData(0, 0, 256, 256).data;
    bmps.forEach((b, k) => {
      const y0 = oy(k); if (k === 0) { pc.drawImage(b, 0, y0); return; }
      pc.drawImage(b, 0, 0, FW, FW - LAP, 0, y0, FW, FW - LAP);
      sg.globalCompositeOperation = 'source-over'; sg.drawImage(b, 0, FW - LAP, FW, LAP, 0, 0, FW, LAP); const im = sg.getImageData(0, 0, FW, LAP), d = im.data;
      for (let y = 0; y < LAP; y++) for (let x = 0; x < FW; x++) { const q = (nz[((x + k * 91) & 255) * 256 + (y & 255) << 2] / 255 - 0.5) * 1.1 + (nz[(((x >> 2) + k * 37) & 255) * 256 + ((y >> 2) & 255) << 2] / 255 - 0.5) * 0.9; d[(y * FW + x) * 4 + 3] = 255 * clamp((0.5 - y / LAP + q * 0.55) * 4 + 0.5); }
      sg.putImageData(im, 0, 0); pc.drawImage(seam, 0, y0 + FW - LAP);
    });
    buildHeight(nz); photoTex.needsUpdate = true; strip.bmps = bmps; strip.ready = true;
    if (!tileMesh) buildTiles(); setBoxes(recorded);
    onState({ kind: 'stripReady' });
    // the colour test, live, one frame at a time in its own worker
    const hg = heatC.getContext('2d', { willReadFrequently: true });
    for (let k = 0; k < STRIP.length; k++) {
      const c = new OffscreenCanvas(FW, FW), cg = c.getContext('2d', { willReadFrequently: true }); cg.drawImage(bmps[k], 0, 0); const id = cg.getImageData(0, 0, FW, FW);
      try {
        const r = await job(async () => { const buf = id.data.slice().buffer; await rpc()('put', { key: 'H' + k, rgba: buf, w: FW, h: FW }, [buf]); await rpc()('rx', { key: 'H' + k, mode: 'global', rects: null, outer: 36, guard: 12 }); return rpc()('rxRegions', { key: 'H' + k, mode: 'global', thr: o.rxThr, minArea: 60 }); });
        const t = new OffscreenCanvas(r.w, r.h); t.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.overlay), r.w, r.h), 0, 0);
        hg.save(); hg.beginPath(); hg.rect(0, oy(k) / 2, FW / 2, (k ? FW - LAP / 2 : FW) / 2); hg.clip(); hg.clearRect(0, 0, SW, SH); hg.drawImage(t, 0, oy(k) / 2, FW / 2, FW / 2); hg.restore(); heatTex.needsUpdate = true;
        for (const q of r.regions) if (q.bbox[3] < FW - LAP * 0.6 || k === 0) { const n = { k, x0: q.bbox[0], y0: q.bbox[1] + oy(k), x1: q.bbox[2], y1: q.bbox[3] + oy(k), area: q.area, peak: q.peak, rgb: q.rgb, name: colourName(q.rgb) }; const m = strip.regions.find((e) => e.k === k && n.x0 < e.x1 + 22 && n.x1 > e.x0 - 22 && n.y0 < e.y1 + 22 && n.y1 > e.y0 - 22); if (m) { m.x0 = Math.min(m.x0, n.x0); m.y0 = Math.min(m.y0, n.y0); m.x1 = Math.max(m.x1, n.x1); m.y1 = Math.max(m.y1, n.y1); if (n.area > m.area) m.name = n.name; m.area += n.area; } else strip.regions.push(n); }   // pieces of one object count once
        schedule();
      } catch (e) { o.warn('The colour test could not run: ' + (e.message || e)); return; }
    }
    { const d = hg.getImageData(0, 0, heatC.width, heatC.height).data, w = heatC.width, hh = heatC.height; strip.prof = Array.from({ length: BINS }, (_, i) => { let m = 0, c = 0; const y1 = Math.floor(hh * (1 - i / BINS)), y0 = Math.floor(hh * (1 - (i + 1) / BINS)); for (let y = y0; y < y1; y += 2) for (let x = 0; x < w; x += 2) { const a = d[(y * w + x) * 4 + 3]; m += a; c++; } return Math.min(1, Math.sqrt(m / 255 / Math.max(1, c) / 0.16)); }); }
    strip.rx = true;
  }

  // ---------------------------------------------------------------- act 2: the site in relief
  const site = { ready: false, building: false, pins: [] };
  const s2 = new THREE.Scene(); s2.background = new THREE.Color(0x191e23); s2.fog = new THREE.Fog(0x191e23, 50, 118);
  const cam2 = new THREE.PerspectiveCamera(FOV, 1, 1, 900);
  const V = (x, y, z = 0) => new THREE.Vector3(x, z, -y);
  const u2 = { uHeat: { value: null }, uHeatK: { value: 0 }, uTime: { value: 0 } };
  let sliceT = 0; const slice = async () => { if (performance.now() - sliceT > 6) { await nap(0); if (shown) await new Promise((r) => requestAnimationFrame(r)); else await breathe(); sliceT = performance.now(); } };   // long loops give the frame back
  async function buildSite() {
    if (site.building) return; site.building = true;
    const PPM = 24, spec = { ...siteSpec(), pxPerM: PPM };
    const { r, q } = await job(async () => { const r = await rpc()('scene', { key: 'HS', spec, noiseSeed: 7 }); await rpc()('rx', { key: 'HS', mode: 'global', rects: null, outer: 42, guard: 13 }); return { r, q: await rpc()('rxRegions', { key: 'HS', mode: 'global', thr: o.rxThr, minArea: 40 }) }; });   // the scene, and the same live colour test on it
    site.leads = spec.leads; site.ppm = PPM; s2.clear(); const rel = site.rel = new THREE.Group(); s2.add(rel);   // rel: everything that rises out of the flat photo
    const cnv = document.createElement('canvas'); cnv.width = r.w; cnv.height = r.h; cnv.getContext('2d', { willReadFrequently: true }).drawImage(r.bitmap, 0, 0); r.bitmap.close?.();
    const smp = document.createElement('canvas'); smp.width = 480; smp.height = 360; const sc = smp.getContext('2d', { willReadFrequently: true }); sc.drawImage(cnv, 0, 0, 480, 360); const sd = sc.getImageData(0, 0, 480, 360).data;
    const at = (x, y) => { const i = (clamp(Math.floor((90 - y) * 4), 0, 359) * 480 + clamp(Math.floor(x * 4), 0, 479)) * 4; return [sd[i] / 255, sd[i + 1] / 255, sd[i + 2] / 255]; };
    const tex = new THREE.CanvasTexture(cnv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = aniso; site.tex = tex;
    const hc = document.createElement('canvas'); hc.width = r.w / 2; hc.height = r.h / 2; const t = new OffscreenCanvas(q.w, q.h); t.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(q.overlay), q.w, q.h), 0, 0); hc.getContext('2d').drawImage(t, 0, 0, hc.width, hc.height);
    const ht = new THREE.CanvasTexture(hc); u2.uHeat.value = ht;
    const loadTex = (n) => new THREE.TextureLoader().loadAsync(new URL('../../../assets/img/gen/' + n, import.meta.url).href).then((x) => { x.wrapS = x.wrapT = THREE.MirroredRepeatWrapping; x.colorSpace = THREE.SRGBColorSpace; x.anisotropy = aniso; return x; }).catch(() => noise);   // surface detail only
    const [mud, rub, conc] = await Promise.all(['tex-mud.jpg', 'tex-rubble.jpg', 'tex-concrete.jpg'].map(loadTex)); Object.assign(u2, { uMud: { value: mud }, uRub: { value: rub } });
    const polys = world.OBSTACLES.filter((b) => b.kind === 'rubble');
    const inPoly = (p, x, y) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const a = p[i], b = p[j]; if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
    const nz = noise.image.getContext('2d').getImageData(0, 0, 256, 256).data, N = (x, y) => nz[((Math.floor(y * 8) & 255) * 256 + (Math.floor(x * 8) & 255)) * 4] / 255;
    const edgeD = (p, x, y) => { let m = 1e9; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const a = p[j], b = p[i], dx = b[0] - a[0], dy = b[1] - a[1], k = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)); m = Math.min(m, Math.hypot(x - a[0] - dx * k, y - a[1] - dy * k)); } return m; };
    const heap = (x, y) => { let z = 0; for (const b of polys) if (b.id !== 'rubble-corridor' && inPoly(b.poly, x, y)) z = Math.max(z, b.h * clamp(edgeD(b.poly, x, y) / 3.2) * (0.55 + 0.9 * N(x * 0.6, y * 0.6))); return z; };
    const hgt = (x, y) => (N(x * 0.16, y * 0.16) - 0.5) * 0.9 + (N(x * 0.5, y * 0.5) - 0.5) * 0.3 + heap(x, y) - 0.1;
    site.hgt = hgt;
    const addHeat = (m) => { m.onBeforeCompile = (s) => { Object.assign(s.uniforms, u2); s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vSite; attribute float aHeap; varying float vHeap;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvSite=vec2(position.x/120.,-position.z/90.); vHeap=aHeap;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vSite; varying float vHeap; uniform sampler2D uHeat,uMud,uRub; uniform float uHeatK,uTime; ' + heatRamp).replace('#include <map_fragment>', '#include <map_fragment>\n { vec2 q=vSite*vec2(120.,90.); vec3 m1=texture2D(uMud,q/9.).rgb, m2=texture2D(uMud,q.yx/31.+.37).rgb; float l1=dot(m1,vec3(.333)), l2=dot(m2,vec3(.333)); vec3 d0=diffuseColor.rgb; float sat=max(d0.r,max(d0.g,d0.b))-min(d0.r,min(d0.g,d0.b)); float keep=smoothstep(.10,.22,sat); d0=mix(vec3(dot(d0,vec3(.333))),d0,mix(.75,1.,keep)); vec3 d1=d0*(.35+l1*4.2)*(.6+l2*2.2); d1=mix(d1,texture2D(uRub,q/7.).rgb*1.25,smoothstep(.05,.5,vHeap)*.85); diffuseColor.rgb=mix(d1*.72,d0,keep); }').replace('#include <dithering_fragment>', '#include <dithering_fragment>\n float hv=texture2D(uHeat,vSite).a; float br=.6+.4*sin(uTime*2.1); float lu=dot(gl_FragColor.rgb,vec3(.333)); gl_FragColor.rgb=mix(gl_FragColor.rgb,ramp(clamp(hv*.45+.36,0.,.78))*(.25+lu*1.6),smoothstep(.05,.9,hv)*uHeatK*(.12+.22*br)); float halo=textureLod(uHeat,vSite,4.).a; gl_FragColor.rgb+=vec3(1.,.45,.2)*halo*halo*uHeatK*.16*br;\n float ex=min(min(vSite.x,1.-vSite.x)*120.,min(vSite.y,1.-vSite.y)*90.); gl_FragColor.a=smoothstep(.3,8.,ex+(sin(vSite.x*61.)+sin(vSite.y*47.+vSite.x*23.))*1.1);'); }; return m; };
    // ground
    await breathe();
    const gg = new THREE.PlaneGeometry(120, 90, 300, 225); gg.rotateX(-Math.PI / 2); gg.translate(60, 0, -45);
    const p = gg.attributes.position; await breathe(); for (let i = 0; i < p.count; i++) { p.setY(i, hgt(p.getX(i), -p.getZ(i))); if (!(i % 1000)) await slice(); } { const ah = new Float32Array(p.count); for (let i = 0; i < p.count; i++) { ah[i] = heap(p.getX(i), -p.getZ(i)); if (!(i % 1000)) await slice(); } gg.setAttribute('aHeap', new THREE.BufferAttribute(ah, 1)); } await breathe(); gg.computeVertexNormals(); await breathe();
    const ground = new THREE.Mesh(gg, addHeat(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0, bumpMap: tex, bumpScale: 2.2, transparent: true }))); ground.renderOrder = 1; rel.add(ground);
    // the land around it, climbing into the valley sides (not surveyed: drawn)
    const landT = rub.clone(); landT.repeat.set(62, 62); landT.needsUpdate = true;
    const lg0 = new THREE.PlaneGeometry(760, 760, 190, 190); lg0.rotateX(-Math.PI / 2); lg0.translate(60, 0, -45); const lp = lg0.attributes.position, lc = new Float32Array(lp.count * 3);
    for (let i = 0; i < lp.count; i++) { const x = lp.getX(i), y = -lp.getZ(i), d = Math.hypot(Math.max(0, -x, x - 120), Math.max(0, -y, y - 90)), in_ = x > 1 && x < 119 && y > 1 && y < 89; lp.setY(i, in_ ? -2.5 : hgt(x, y) * 0.8 - 0.35 + Math.pow(Math.max(0, d - 14) / 60, 1.7) * 16 * (0.5 + N(x * 0.035 + 7, y * 0.035 + 3)) + Math.min(d / 8, 3) * (N(x * 0.11, y * 0.11) - 0.5) * 2.2); const s = 0.72 + 0.5 * N(x * 0.09 + 2, y * 0.09); lc[i * 3] = s; lc[i * 3 + 1] = s * (0.98 + 0.1 * N(x * 0.05, y * 0.05 + 4)); lc[i * 3 + 2] = s * 0.96; if (!(i % 1000)) await slice(); }
    lg0.setAttribute('color', new THREE.BufferAttribute(lc, 3)); await breathe(); lg0.computeVertexNormals(); rel.add(new THREE.Mesh(lg0, new THREE.MeshStandardMaterial({ map: landT, roughness: 1, vertexColors: true, color: 0x55514b })));
    // light: low overcast sun from the south-east, cool sky
    const sun = new THREE.DirectionalLight(0xfff0dc, 4.4); sun.target.position.set(93, 0, -62); sun.position.set(93 + 46, 40, -62 + 34); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 10, far: 130 }); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04; s2.add(sun, sun.target); s2.add(new THREE.HemisphereLight(0x9fb6d2, 0x241f1a, 1.15)); ground.receiveShadow = true;
    // walls
    const wallTex = (len, ht2, seed) => { const k = 40, c = document.createElement('canvas'); c.width = Math.max(64, Math.round(len * k)); c.height = Math.round(ht2 * k); const w = c.getContext('2d'); let a = seed; const R = () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; };
      w.fillStyle = '#8b867d'; w.fillRect(0, 0, c.width, c.height);
      for (let i = 0; i < len * 130; i++) { w.fillStyle = R() < 0.5 ? 'rgba(40,36,30,' + (R() * 0.12) + ')' : 'rgba(210,205,195,' + (R() * 0.10) + ')'; const s = 2 + R() * 16; w.fillRect(R() * c.width, R() * c.height, s, s * (0.3 + R())); }
      const bay = 3.1, n = Math.max(1, Math.floor(len / bay)), off = (len - n * bay) / 2;
      for (let b = 0; b < n; b++) for (let f = 0; f < Math.max(1, Math.round(ht2 / 3.3)); f++) { const x = (off + b * bay + 0.85) * k, y = c.height - (f * 3.2 + 2.35) * k; if (y < 4) continue; w.fillStyle = '#1b1c1d'; w.fillRect(x, y, 1.35 * k, 1.2 * k); w.fillStyle = 'rgba(120,140,155,.25)'; if (R() < 0.6) w.fillRect(x + 3, y + 3, 0.6 * k, 1.1 * k); w.strokeStyle = '#6d6a64'; w.lineWidth = 3; w.strokeRect(x, y, 1.35 * k, 1.2 * k); w.beginPath(); w.moveTo(x + 0.67 * k, y); w.lineTo(x + 0.67 * k, y + 1.2 * k); w.stroke(); w.fillStyle = '#a39d92'; w.fillRect(x - 4, y + 1.2 * k, 1.35 * k + 8, 6); const gr = w.createLinearGradient(0, y + 1.2 * k, 0, y + 2.1 * k); gr.addColorStop(0, 'rgba(30,26,20,.35)'); gr.addColorStop(1, 'rgba(30,26,20,0)'); w.fillStyle = gr; w.fillRect(x, y + 1.2 * k + 6, 1.35 * k, 0.9 * k); }
      for (let i = 0; i < len * 1.2; i++) { const x = R() * c.width, gr = w.createLinearGradient(0, 0, 0, c.height * (0.3 + R() * 0.6)); gr.addColorStop(0, 'rgba(26,24,21,' + (0.15 + R() * 0.25) + ')'); gr.addColorStop(1, 'rgba(26,24,21,0)'); w.fillStyle = gr; w.fillRect(x, 0, 2 + R() * 22, c.height); }
      const mud = w.createLinearGradient(0, c.height, 0, c.height - 1.5 * k); mud.addColorStop(0, 'rgba(74,60,44,.95)'); mud.addColorStop(0.55, 'rgba(84,70,52,.7)'); mud.addColorStop(1, 'rgba(84,70,52,0)'); w.fillStyle = mud; w.beginPath(); w.moveTo(0, c.height); for (let x = 0; x <= c.width; x += 12) w.lineTo(x, c.height - (0.75 + 0.5 * N(x / 160 + seed, seed)) * k); w.lineTo(c.width, c.height); w.fill();
      const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = aniso; return tx; };
    const roofMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide, bumpMap: tex, bumpScale: 1.5 });
    const uvw = (x, y) => [x / 120, y / 90];
    const quad = (pts, mat, uv) => { const ge = new THREE.BufferGeometry(); ge.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap((q2) => [q2[0], q2[2], -q2[1]]), 3)); ge.setAttribute('uv', new THREE.Float32BufferAttribute(uv.flat(), 2)); ge.setIndex([0, 1, 2, 0, 2, 3]); ge.computeVertexNormals(); const m = new THREE.Mesh(ge, mat); rel.add(m); return m; };
    const roofRect = (x0, y0, x1, y1, z00, z10, z11, z01) => quad([[x0, y0, z00], [x1, y0, z10], [x1, y1, z11], [x0, y1, z01]], roofMat, [uvw(x0, y0), uvw(x1, y0), uvw(x1, y1), uvw(x0, y1)]);
    const wall = (a, b, z, seed, top) => { const len = Math.hypot(b[0] - a[0], b[1] - a[1]); quad([[a[0], a[1], -0.6], [b[0], b[1], -0.6], [b[0], b[1], z], [a[0], a[1], z]], new THREE.MeshStandardMaterial({ map: wallTex(len, z, seed), roughness: 0.95, side: THREE.DoubleSide }), [[0, 0], [1, 0], [1, 1], [0, 1]]); if (top) { const ge = new THREE.BufferGeometry(); const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2; ge.setAttribute('position', new THREE.Float32BufferAttribute([a[0], z, -a[1], b[0], z, -b[1], mx, z + top, -my], 3)); ge.computeVertexNormals(); rel.add(new THREE.Mesh(ge, new THREE.MeshStandardMaterial({ color: 0x77736b, roughness: 0.95, side: THREE.DoubleSide }))); } };
    const gableX = (x0, y0, x1, y1, z, r2, ridge, seed) => { roofRect(x0, y0, ridge, y1, z, z + r2, z + r2, z); roofRect(ridge, y0, x1, y1, z + r2, z, z, z + r2); wall([x0, y0], [x1, y0], z, seed, r2); wall([x1, y1], [x0, y1], z, seed + 1, r2); wall([x1, y0], [x1, y1], z, seed + 2); wall([x0, y1], [x0, y0], z, seed + 3); };
    const gableY = (x0, y0, x1, y1, z, r2, ridge, seed) => { roofRect(x0, y0, x1, ridge, z, z, z + r2, z + r2); roofRect(x0, ridge, x1, y1, z + r2, z + r2, z, z); };
    await breathe(); gableX(8, 40, 24, 70, 6, 1.3, 16, 11); await breathe(); gableY(24, 47, 34, 63, 4.6, 0.8, 55, 31); wall([24, 47], [34, 47], 4.6, 41); wall([34, 47], [34, 63], 4.6, 42, 0.8); wall([34, 63], [24, 63], 4.6, 43);
    gableY(44, 30, 84, 44, 3.4, 1, 37, 51); gableY(44, 44, 78.3, 58, 3.4, 1, 51, 61); roofRect(78.3, 44, 84, 51, 3.4, 3.4, 4.2, 4.4);
    await breathe(); wall([44, 30], [84, 30], 3.4, 71); await breathe(); wall([84, 30], [84, 44], 3.4, 72, 1); wall([84, 44], [84, 50], 3.4, 73); wall([78, 58], [44, 58], 3.4, 74); wall([44, 58], [44, 44], 3.4, 75, 1); wall([44, 44], [44, 30], 3.4, 76, 1);
    await breathe(); gableX(92, 20, 112, 46, 5.4, 1.2, 102, 91);
    await breathe();
    // loose stones and timber on the heaps, coloured by the mosaic under them
    let seed = 9; const R = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const rock = new THREE.DodecahedronGeometry(1, 0), rp = rock.attributes.position; for (let i = 0; i < rp.count; i++) { const k = 0.5 + 1.0 * N(Math.round(rp.getX(i) * 9) / 3 + 3, Math.round(rp.getY(i) * 9) / 3 + Math.round(rp.getZ(i) * 9) / 5); rp.setXYZ(i, rp.getX(i) * k * 1.2, rp.getY(i) * k * 0.7, rp.getZ(i) * k); } rock.computeVertexNormals();
    const spots = []; for (const b of polys) { if (b.id === 'rubble-corridor') continue; const xs = b.poly.map((q2) => q2[0]), ys = b.poly.map((q2) => q2[1]), n = b.id === 'rubble-field' ? 620 : 260; for (let i = 0; i < n * 2 && spots.length < 1400; i++) { const x = lerp(Math.min(...xs), Math.max(...xs), R()), y = lerp(Math.min(...ys), Math.max(...ys), R()); const sc0 = at(x, y); if (inPoly(b.poly, x, y) && Math.max(...sc0) - Math.min(...sc0) < 0.22 && !site.leads.some((l) => Math.hypot(l.pos[0] - x, l.pos[1] - y) < 1.6)) spots.push([x, y]); } }
    const bushes = []; for (let y = 1; y < 89; y += 0.55) for (let x = 1; x < 119; x += 0.55) { const c = at(x, y), l = (c[0] + c[1] + c[2]) / 3; if (c[1] > c[0] * 1.06 && c[1] > c[2] * 1.15 && l < 0.27 && R() < 0.8) for (let k = 0; k < 7; k++) bushes.push([x + R() - 0.3, y + R() - 0.3, c]); }
    const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), eu = new THREE.Euler(), col = new THREE.Color();
    const inst = (geo, mat, list, f) => { const m = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((s, i) => { f(s, i); m.setMatrixAt(i, m4); m.setColorAt(i, col); }); m.castShadow = m.receiveShadow = true; rel.add(m); m.frustumCulled = false; };
    const grey = (c, k) => { const l = (c[0] + c[1] + c[2]) / 3; col.setRGB(lerp(l, c[0], 0.6) * k, lerp(l, c[1], 0.6) * k, lerp(l, c[2], 0.6) * k, THREE.SRGBColorSpace); };
    inst(new THREE.BoxGeometry(1.5, 0.2, 1), new THREE.MeshStandardMaterial({ roughness: 0.95, map: conc, bumpMap: conc, bumpScale: 2 }), spots.filter((_, i) => i % 6 === 1), ([x, y]) => { const s = 0.45 + R() * R() * 1.5; eu.set((R() - 0.5) * 1.1, R() * 6, (R() - 0.5) * 1.1); m4.compose(V(x, y, hgt(x, y) + s * 0.12), qt.setFromEuler(eu), new THREE.Vector3(s, 1, s)); const l = 0.7 + R() * 0.5; col.setRGB(l, l * 0.98, l * 0.95); });
    inst(rock, new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), spots, ([x, y]) => { const s = 0.07 + Math.pow(R(), 4) * 0.55, c = at(x, y); eu.set(R() * 6, R() * 6, R() * 6); m4.compose(V(x, y, hgt(x, y) + s * 0.2), qt.setFromEuler(eu), new THREE.Vector3(s, s, s)); grey(c, 0.85 + R() * 0.35); });
    inst(new THREE.BoxGeometry(1, 0.1, 0.16), new THREE.MeshStandardMaterial({ roughness: 0.95 }), spots.filter((_, i) => i % 11 === 0), ([x, y]) => { eu.set((R() - 0.5) * 0.5, R() * 6, (R() - 0.5) * 0.7); m4.compose(V(x, y, hgt(x, y) + 0.22), qt.setFromEuler(eu), new THREE.Vector3(1.2 + R() * 2.6, 1, 1)); col.setRGB(0.42 + R() * 0.12, 0.34 + R() * 0.08, 0.25, THREE.SRGBColorSpace); });
    await breathe();
    const puff = new THREE.IcosahedronGeometry(1, 1), pp = puff.attributes.position; for (let i = 0; i < pp.count; i++) { const k = 0.7 + 0.65 * N(pp.getX(i) * 5 + 9, pp.getY(i) * 5 + pp.getZ(i) * 4); pp.setXYZ(i, pp.getX(i) * k, pp.getY(i) * k, pp.getZ(i) * k); } puff.computeVertexNormals();
    inst(puff, new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), bushes.slice(0, 9000), ([x, y, c]) => { const s = 0.05 + R() * R() * 0.24; eu.set(R() * 3, R() * 6, R() * 3); m4.compose(V(x, y, hgt(x, y) + 0.1 + R() * 0.7), qt.setFromEuler(eu), new THREE.Vector3(s, s * 0.7, s * 1.15)); const q2 = 0.55 + R() * 0.5; col.setRGB(c[0] * q2, c[1] * q2, c[2] * q2 * 0.9, THREE.SRGBColorSpace); });
    await breathe();
    // haze drifting between the camera and the ground
    site.mist = []; const mt = new THREE.CanvasTexture((() => { const c = document.createElement('canvas'); c.width = c.height = 256; const q2 = c.getContext('2d'), im = q2.createImageData(256, 256); for (let i = 0; i < 65536; i++) { const x = (i & 255) / 127.5 - 1, y = (i >> 8) / 127.5 - 1, f = clamp(1 - Math.hypot(x, y)); im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = 255; im.data[i * 4 + 3] = 255 * clamp((nz[i * 4] / 255 - 0.34) * 2.4) * f * f; } q2.putImageData(im, 0, 0); return c; })());
    for (let i = 0; i < 9; i++) { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: mt, transparent: true, depthWrite: false, opacity: 0.10, color: 0xa7b6c4, fog: false, rotation: i })); m.scale.set(70 + i * 7, 22 + i * 2, 1); m.position.copy(V(20 + i * 17, 96 + (i % 3) * 22, 6 + (i % 4) * 3)); m.userData.x = m.position.x; site.mist.push(m); rel.add(m); }
    // pins
    const leads = site.leads, toM = (x, y) => [x / PPM, 90 - y / PPM];
    const regs = q.regions.map((c) => ({ pos: toM((c.bbox[0] + c.bbox[2]) / 2, (c.bbox[1] + c.bbox[3]) / 2), name: colourName(c.rgb), peak: c.peak, bbox: c.bbox })).filter((c) => c.pos[0] > 4 && c.pos[0] < 116 && c.pos[1] > 4 && c.pos[1] < 86 && !(spec.team || []).some((q2) => Math.hypot(q2[0] - c.pos[0], q2[1] - c.pos[1]) < 4)).sort((a, b) => b.peak - a.peak);
    const pins = [];
    for (const l of leads) { const m = regs.find((c) => Math.hypot(c.pos[0] - l.pos[0], c.pos[1] - l.pos[1]) < 3); pins.push({ id: l.id, pos: l.pos, main: true, match: m }); }
    for (const c of regs) { if (pins.length >= 5) break; if (pins.some((q2) => Math.hypot(q2.pos[0] - c.pos[0], q2.pos[1] - c.pos[1]) < 5)) continue; pins.push({ id: '', pos: c.pos, name: c.name, peak: c.peak }); }
    const lg = new THREE.CylinderGeometry(0.045, 0.045, 1, 6); lg.translate(0, 0.5, 0);
    for (const n of pins) { n.h = n.main ? 11 : 5.5; n.z = hgt(n.pos[0], n.pos[1]); n.col = new THREE.Color(n.main ? C.person : C.warn); n.mesh = new THREE.Mesh(lg, new THREE.MeshBasicMaterial({ color: n.col, fog: false, transparent: true, toneMapped: false, opacity: n.main ? 1 : 0.75 })); n.mesh.scale.set(n.main ? 1.3 : 0.8, 0.001, n.main ? 1.3 : 0.8); n.mesh.position.copy(V(n.pos[0], n.pos[1], n.z)); s2.add(n.mesh);
      n.ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 64), new THREE.MeshBasicMaterial({ color: n.col, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, fog: false, toneMapped: false })); n.ring.rotation.x = -Math.PI / 2; n.ring.position.copy(V(n.pos[0], n.pos[1], n.z + 0.4)); n.ring.renderOrder = 4; s2.add(n.ring); }
    site.pins = pins; site.focus = (pins.find((n) => n.main) || pins[0] || { pos: [96, 70] }).pos;
    await breathe(); renderer.initTexture(tex); await breathe(); site.rel.scale.y = 0.02; await renderer.compileAsync(s2, cam2);
    site.ready = true; onState({ kind: 'siteReady' });
  }

  // ---------------------------------------------------------------- act 3: before / after
  const cmp = { ready: false, building: false, wipe: 0.5, regions: [], grabbed: false };
  const s3 = new THREE.Scene(), CW = 2080, CH = 1170, PPM3 = 26;
  const u3 = { uA: { value: null }, uB: { value: null }, uD: { value: null }, uWipe: { value: 0.5 }, uTime: { value: 0 } };
  async function buildCmp() {
    if (cmp.building) return; cmp.building = true;
    const spec = { seed: 305, w: CW, h: CH, pxPerM: PPM3, theme: 'roofs', figures: 0 }, light = { gain: 0.86, tint: [1.04, 1, 0.97] }, shift = [17, -11];
    const { a, b, r, z } = await job(async () => { const a = await rpc()('scene', { key: 'HA', spec, noiseSeed: 5 }), b = await rpc()('scene', { key: 'HB', spec: { ...spec, mutate: 306 }, noiseSeed: 9, light, shift }); const r = await rpc()('change', { before: 'HA', after: 'HB', rects: null }); return { a, b, r, z: await rpc()('changeRegions', { thr: o.chgThr, method: 'robust', minArea: Math.round(PPM3 * PPM3) }) }; });
    await breathe();
    b.bitmap.close?.();
    const al = document.createElement('canvas'); al.width = r.w; al.height = r.h; const ag = al.getContext('2d'); ag.putImageData(new ImageData(new Uint8ClampedArray(r.aligned), r.w, r.h), 0, 0);
    const dc = document.createElement('canvas'); dc.width = z.w; dc.height = z.h; dc.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(z.overlay), z.w, z.h), 0, 0);
    const mk = (src) => { const t = new THREE.CanvasTexture(src); t.colorSpace = THREE.NoColorSpace; t.anisotropy = aniso; return t; };
    const ac = document.createElement('canvas'); ac.width = a.w; ac.height = a.h; ac.getContext('2d').drawImage(a.bitmap, 0, 0); a.bitmap.close?.();
    u3.uA.value = mk(ac); u3.uB.value = mk(al); u3.uD.value = mk(dc);
    const truth = b.truth.changes || []; cmp.truth = truth.length;
    const over = (p, q) => p[0] < q[2] && p[2] > q[0] && p[1] < q[3] && p[3] > q[1];
    cmp.found = truth.filter((t) => z.regions.some((x) => over(t.bbox, x.bbox))).length;
    cmp.regions = z.regions.slice(0, 9).map((x) => ({ b: x.bbox, m2: x.area / (PPM3 * PPM3), hit: truth.find((t) => over(t.bbox, x.bbox)) })); cmp.count = z.count; cmp.shift = r.shift;
    cmp.mesh = new THREE.Mesh(new THREE.PlaneGeometry(CW, CH), new THREE.ShaderMaterial({ uniforms: u3, vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }', fragmentShader: /* glsl */`
      uniform sampler2D uA,uB,uD; uniform float uWipe,uTime; varying vec2 vUv;
      void main(){ vec3 a=texture2D(uA,vUv).rgb; vec4 b4=texture2D(uB,vUv); vec3 b=mix(a,b4.rgb,b4.a); float s=smoothstep(uWipe-.0004,uWipe+.0004,vUv.x);
        float l=dot(b,vec3(.3,.59,.11)); float dd=textureLod(uD,vUv,1.6).a; float ha=textureLod(uD,vUv,4.).a; float br=.6+.4*sin(uTime*1.9);
        float q=smoothstep(.1,.9,dd), gx=1.-clamp(abs(dd-.32)/max(fwidth(dd)*1.3,.012),0.,1.); b=mix(b,b*b*(3.-2.*b),.5);
        vec3 bb=mix(mix(vec3(l),b,.7)*.82,vec3(1.,.50,.22)*(.10+1.55*l),q*(.46+.20*br)); bb+=vec3(1.,.55,.25)*(ha*.10*br+gx*.75);
        vec3 aa=mix(a,a*a*(3.-2.*a),.5)*1.16; vec3 c=mix(aa,bb,s); float d=(vUv.x-uWipe); c+=vec3(.75,.88,1.)*exp(-pow(d*260.,2.))*.35; c*=1.-.35*exp(-pow(d*60.,2.))*step(0.,d);
        gl_FragColor=vec4(c,1.); }` })); s3.add(cmp.mesh);
    renderer.initTexture(u3.uA.value); renderer.initTexture(u3.uB.value); cmp.ready = true; onState({ kind: 'cmpReady' });
  }

  // ---------------------------------------------------------------- the overlay: brackets, loupes, labels
  const v = new THREE.Vector3(), P = [0, 0];
  const proj = (c, x, y, z) => { v.set(x, y, z).project(c); P[0] = (v.x * 0.5 + 0.5) * W; P[1] = (-v.y * 0.5 + 0.5) * H; return v.z < 1; };
  const P1 = (x, y, z = 0) => proj(cam, x - SW / 2, SH / 2 - y, z);
  function corners(x0, y0, x1, y1, L) { g.beginPath(); g.moveTo(x0, y0 + L); g.lineTo(x0, y0); g.lineTo(x0 + L, y0); g.moveTo(x1 - L, y0); g.lineTo(x1, y0); g.lineTo(x1, y0 + L); g.moveTo(x1, y1 - L); g.lineTo(x1, y1); g.lineTo(x1 - L, y1); g.moveTo(x0 + L, y1); g.lineTo(x0, y1); g.lineTo(x0, y1 - L); g.stroke(); }
  function text(s, x, y, col, f, al = 'left') {   // always on a quiet dark plate
    g.font = f; g.textAlign = al; g.textBaseline = 'alphabetic'; const w = g.measureText(s).width, x0 = al === 'right' ? x - w : al === 'center' ? x - w / 2 : x, a = g.globalAlpha;
    g.globalAlpha = a * 0.78; g.fillStyle = '#06080a'; g.fillRect(x0 - 7, y - 14, w + 14, 20); g.globalAlpha = a; g.fillStyle = col; g.fillText(s, x, y);
  }
  const nth = (b) => 1 + strip.boxes.filter((o) => o.at < b.at || (o.at === b.at && o.x0 < b.x0)).length;   // marks are numbered in the order they were found
  function duo(a, b, x, y, col, al = 'left') {   // two lines on one plate
    g.font = fB(); let w = g.measureText(a).width; g.font = fS(); w = Math.max(w, g.measureText(b).width); const k = g.globalAlpha; g.globalAlpha = k * 0.78; g.fillStyle = '#06080a'; g.fillRect((al === 'right' ? x - w : x) - 10, y - 19, w + 20, 47); g.globalAlpha = k; bare(a, x, y, C.text, fB(), al); bare(b, x, y + 18, col, fS(), al);
  }
  function bare(s, x, y, col, f, al = 'left') { g.font = f; g.textAlign = al; g.textBaseline = 'alphabetic'; g.fillStyle = col; g.fillText(s, x, y); }
  const clear = (x, y) => 1 - clamp((x - (W - Math.min(470, W * 0.33) - 110)) / 70) * clamp((y - (H - 470)) / 60);   // 0 over the graph
  const RB = [0, 0, 0, 0];
  function rectOf(b) { const z = hz((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2); RB[0] = RB[1] = 1e9; RB[2] = RB[3] = -1e9; for (let i = 0; i < 4; i++) { P1(i & 1 ? b.x1 : b.x0, i & 2 ? b.y1 : b.y0, z); RB[0] = Math.min(RB[0], P[0]); RB[2] = Math.max(RB[2], P[0]); RB[1] = Math.min(RB[1], P[1]); RB[3] = Math.max(RB[3], P[1]); } return RB; }  const fB = () => '600 14px ' + C.font, fS = () => '400 12.5px ' + C.font, fM = () => '500 12.5px ' + C.mono;

  function drawAct1(t, dt) {
    const tilt = strip.live ? 0 : ease((t - strip.end - 0.4) / 4.2), T = strip.live ? strip.live.t : t;
    // colour regions: a fine tick under the heat, named, only the strongest
    if (!tilt) for (const r of strip.regions) {
      const a = T - r.at; if (a < 0 || strip.live && !strip.live.over || r.area < 320) continue; if (strip.boxes.some((b) => b.x0 < r.x1 + 10 && b.x1 > r.x0 - 10 && b.y0 < r.y1 + 10 && b.y1 > r.y0 - 10)) continue;
      const [x0, y0, x1, y1] = rectOf(r); if (x1 < -50 || x0 > W + 50 || y0 > H + 20 || y1 < -20) continue;
      const vis = clear(x1, y1); if (vis <= 0.01) continue; g.globalAlpha = clamp(a * 2) * 0.9 * vis; g.strokeStyle = C.warn; g.lineWidth = 1; corners(x0 - 5, y0 - 5, x1 + 5, y1 + 5, 6);
      if (r.area > 900 && x1 - x0 < W * 0.4) { text('Unusual colour: ' + r.name, x0 + 11, y1 + 26, C.text, fS()); g.fillStyle = C.warn; g.fillRect(x0 - 1, y1 + 16, 6, 6); }
    }
    // people: brackets close in, a square loupe at twice the size
    for (const b of strip.boxes) {
      const a = T - b.at; if (a < 0) continue; const k = out(a / 0.6);
      if (tilt > 0.02) {   // the pin
        if (!P1((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2)) continue; const bx = P[0], by = P[1]; P1((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, 300 * tilt + 40); const tx = P[0], ty = P[1];
        const vis = Math.min(clear(bx, by), clear(tx + 60, ty)); if (vis <= 0.01) continue; g.globalAlpha = tilt * vis; g.strokeStyle = C.person; g.lineWidth = 1.5; g.beginPath(); g.moveTo(bx, by); g.lineTo(tx, ty); g.stroke(); g.fillStyle = C.person; g.fillRect(tx - 3, ty - 3, 6, 6);
        const l = strip.boxes.indexOf(b) % 2 ? -1 : 1, al = l < 0 ? 'right' : 'left'; text('Possible person ' + nth(b), tx + 14 * l, ty + 5, C.text, fB(), al); continue;
      }
      const [x0, y0, x1, y1] = rectOf(b); if (x1 < -60 || x0 > W + 60 || y0 > H + 60 || y1 < -60) continue;
      const pad = lerp(90, 9, k); const vis = clear(x1, y1); if (vis <= 0.01) continue; g.globalAlpha = k * vis; g.strokeStyle = C.person; g.lineWidth = 1.75; corners(x0 - pad, y0 - pad, x1 + pad, y1 + pad, 13);
      const lk = out((a - 0.35) / 0.5); if (lk <= 0) continue; g.globalAlpha = lk * vis; const right = x1 + 210 < W && clear(x1 + 150, y0 + 30) > 0.5;
      duo('Possible person', 'mark ' + nth(b), right ? x1 + pad + 14 : x0 - pad - 14, y0 + 10, C.person, right ? 'left' : 'right');
    }
    // loupe under the pointer
    if (ptr.in && !ptr.down && !tilt && ptr.y < H * 0.62 && !strip.boxes.some((b) => { P1((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2); return T > b.at && Math.hypot(P[0] - ptr.x, P[1] - ptr.y) < 150; })) pointerLoupe(photo, cam, SW, SH);
    g.globalAlpha = 1; instruments(T, tilt, dt);
  }

  // ---------------------------------------------------------------- the instruments. Every reading is worked out from the film's own camera:
  // height above the sheet, speed along the path, bank and nose angle from the path's acceleration. Scale assumed 0.045 m per pixel. Simulated.
  const I = { alt: 0, spd: 0, roll: 0, pitch: 0, hdg: 0, on: 0 };
  const hair = (a) => 'rgba(236,238,241,' + a + ')';
  function ln(x0, y0, x1, y1) { g.moveTo(Math.round(x0) + 0.5, Math.round(y0) + 0.5); g.lineTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5); }
  function vtape(x, y0, y1, val, unit, label, step, px, side) {   // a slim moving scale: ticks slide past a fixed line
    const mid = (y0 + y1) / 2, n = Math.ceil((y1 - y0) / 2 / px / step) + 1, base = Math.round(val / step) * step;
    for (let i = -n * 5; i <= n * 5; i++) {
      const v2 = base + i * step / 5, y = mid - (v2 - val) * px, k = 1 - Math.abs(y - mid) / ((y1 - y0) / 2); if (k <= 0 || v2 < -1e-6) continue; const major = i % 5 === 0;
      g.globalAlpha = I.on * Math.min(1, k * 1.8) * (major ? 0.9 : 0.42); g.strokeStyle = hair(1); g.lineWidth = 1; g.beginPath(); ln(x, y, x + side * (major ? 13 : 7), y); g.stroke();
      if (major && Math.abs(y - mid) > 24) bare(String(Math.round(v2)), x + side * 21, y + 4, C['text-2'], '400 11.5px ' + C.mono, side > 0 ? 'left' : 'right');
    }
    g.globalAlpha = I.on; g.strokeStyle = C.text; g.lineWidth = 1; g.beginPath(); ln(x - side * 7, mid, x + side * 20, mid); g.stroke();
    bare(val.toFixed(unit === 'm' ? 0 : 1), x + side * 28, mid + 9, C.text, '400 30px ' + C.display, side > 0 ? 'left' : 'right'); const w = g.measureText(val.toFixed(unit === 'm' ? 0 : 1)).width; bare(unit, x + side * (34 + w), mid + 8, C['text-2'], fS(), side > 0 ? 'left' : 'right');
    bare(label, x, y0 - 8, C['text-2'], fS(), side > 0 ? 'left' : 'right');
  }
  function instruments(T, tilt, dt) {
    const live = !!strip.live; I.on += (((live || t < 0.6) ? 0 : 1 - tilt) - I.on) * Math.min(1, dt * 3); const on = I.on;
    if (on > 0.01) {
      // heading tape and horizon, top centre
      const cx = W / 2, hy = 30, half = Math.min(250, W * 0.18), ppd = 5.2;
      const b0 = Math.round(I.hdg / 5) * 5;
      for (let i = -11; i <= 11; i++) { const d = b0 + i * 5, x = cx + (d - I.hdg) * ppd, k = 1 - Math.abs(x - cx) / half; if (k <= 0) continue; const dd = ((d % 360) + 360) % 360, major = dd % 15 === 0; g.globalAlpha = on * Math.min(1, k * 1.6) * (major ? 0.9 : 0.45); g.strokeStyle = hair(1); g.lineWidth = 1; g.beginPath(); ln(x, hy, x, hy + (major ? 11 : 6)); g.stroke(); if (major && Math.abs(x - cx) > 26) bare({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[dd] || String(dd).padStart(3, '0'), x, hy - 7, C['text-2'], '400 11.5px ' + C.mono, 'center'); }
      g.globalAlpha = on; bare(String(Math.round(((I.hdg % 360) + 360) % 360)).padStart(3, '0') + '°', cx + 3, hy - 5, C.text, '400 22px ' + C.display, 'center'); g.strokeStyle = C.text; g.beginPath(); ln(cx, hy, cx, hy + 17); g.stroke();
      g.save(); g.beginPath(); g.rect(cx - half, hy + 22, half * 2, 112); g.clip(); g.translate(cx, hy + 76); g.rotate(-I.roll); g.lineWidth = 1; const pd = 7.5;
      for (let d = -10; d <= 10; d += 5) { const y = (I.pitch * 57.3 + d) * -pd * -1, w = d === 0 ? half * 0.8 : d % 10 === 0 ? 34 : 20, gap = d === 0 ? 46 : 14; if (Math.abs(y) > 58) continue; const k = 1 - Math.abs(y) / 62; g.globalAlpha = on * k * (d === 0 ? 0.95 : 0.5); g.strokeStyle = hair(1); g.beginPath(); g.moveTo(-w, y); g.lineTo(-gap, y); g.moveTo(gap, y); g.lineTo(w, y); g.stroke(); if (d !== 0 && d % 10 === 0) bare(String(Math.abs(d)), w + 8, y + 4, C['text-2'], '400 10.5px ' + C.mono); }
      g.restore(); g.globalAlpha = on; g.strokeStyle = C.text; g.lineWidth = 1.5; g.beginPath(); g.moveTo(cx - 30, hy + 76); g.lineTo(cx - 11, hy + 76); g.lineTo(cx, hy + 83); g.lineTo(cx + 11, hy + 76); g.lineTo(cx + 30, hy + 76); g.stroke();
      const y0 = H * 0.15, y1 = H * 0.15 + Math.min(250, H * 0.31); vtape(40, y0, y1, I.alt, 'm', 'Height', 10, 5.2, 1); vtape(W - 40, y0, y1, I.spd, 'm/s', 'Speed', 5, 10, -1);
      // the false-colour strip carries its own caption, riding the bar
      P1(40, SH - u1.uFront.value + 70, 0); const sy = P[1]; if (sy > 50 && sy < H * 0.5 && t < strip.end) { g.globalAlpha = on * clamp((sy - 50) / 40) * clamp((H * 0.5 - sy) / 40); text('False colour of the same frame', Math.max(P[0], 196), sy + 12, C.text, fS()); }
    }
    ridge(T, live ? 1 : clamp((t - 1) / 1.2));
  }
  // the score along the flight: person-likeness above the line, colour below it, mirrored
  function ridge(T, k) {
    if (k <= 0) return; const gw = Math.min(470, W * 0.33), x0 = W - 40 - gw, base = H - 186, up = 108, dn = 26, F = u1.uFront.value, X = (a) => x0 + clamp(a / SH) * gw, fx = X(F);
    const pts = [...strip.boxes.filter((b) => b.at <= T), ...strip.low.filter((b) => SH - b.y1 < F && !(strip.isLive && strip.isLive.k === STRIP.indexOf(b.id)))];
    const val = (a) => { let m = 0; for (const b of pts) { const d = (a - (SH - (b.y0 + b.y1) / 2)) / 84; if (d > -4 && d < 4) { const age = b.at ? out((T - b.at) / 0.9) : 1; m = Math.max(m, b.score * age * Math.exp(-d * d)); } } return m; };
    g.globalAlpha = k; const n = 235, vs = []; for (let i = 0; i <= n; i++) { const a = i / n * SH; vs.push(a <= F ? val(a) : 0); }
    const path = (close) => { g.beginPath(); for (let i = 0; i <= n; i++) { const x = x0 + i / n * gw; if (x > fx) break; const y = base - vs[i] / 0.6 * up; i ? g.lineTo(x, y) : g.moveTo(x, y); } if (close) { g.lineTo(Math.min(fx, x0 + gw), base); g.lineTo(x0, base); g.closePath(); } };
    if (strip.prof) { g.beginPath(); g.moveTo(x0, base + 2); for (let i = 0; i < BINS; i++) { const x = x0 + (i + 0.5) / BINS * gw; if (x > fx) break; g.lineTo(x, base + 2 + strip.prof[i] * dn); } g.lineTo(Math.min(fx, x0 + gw), base + 2); g.closePath(); const q = g.createLinearGradient(0, base, 0, base + dn); q.addColorStop(0, 'rgba(255,179,71,.10)'); q.addColorStop(1, 'rgba(255,179,71,.75)'); g.fillStyle = q; g.fill(); }
    const fill = g.createLinearGradient(0, base - up, 0, base); fill.addColorStop(0, 'rgba(255,122,80,.62)'); fill.addColorStop(1, 'rgba(255,122,80,.02)'); path(true); g.fillStyle = fill; g.fill();
    g.globalCompositeOperation = 'lighter'; g.lineJoin = 'round'; path(); g.strokeStyle = 'rgba(255,122,80,.10)'; g.lineWidth = 11; g.stroke(); g.strokeStyle = 'rgba(255,122,80,.20)'; g.lineWidth = 5; g.stroke(); g.globalCompositeOperation = 'source-over'; g.strokeStyle = '#ffd9c8'; g.lineWidth = 1.5; g.stroke();
    g.strokeStyle = hair(0.35); g.lineWidth = 1; g.beginPath(); ln(x0, base, x0 + gw, base); g.stroke(); g.setLineDash([2, 4]); g.strokeStyle = hair(0.3); g.beginPath(); ln(x0, base - o.minScore / 0.6 * up, x0 + gw, base - o.minScore / 0.6 * up); g.stroke(); g.setLineDash([]);
    bare('detection level', x0 + gw, base - o.minScore / 0.6 * up - 6, C['text-2'], fS(), 'right');
    if (fx < x0 + gw - 2) { const q = g.createLinearGradient(0, base - up, 0, base + dn); q.addColorStop(0, 'rgba(107,178,255,0)'); q.addColorStop(0.6, 'rgba(107,178,255,.95)'); q.addColorStop(1, 'rgba(107,178,255,.1)'); g.strokeStyle = q; g.beginPath(); ln(fx, base - up - 8, fx, base + dn + 4); g.stroke(); }
    // thumbnails: the picture that made each peak, kept from colliding
    const TH = 46, marks = strip.boxes.filter((b) => b.at <= T).map((b) => ({ b, x: X(SH - (b.y0 + b.y1) / 2), at: b.at })); marks.sort((p, q) => p.x - q.x || p.b.x0 - q.b.x0); let lastR = x0 - 10; for (const m of marks) { m.l = Math.max(m.x - TH / 2, lastR + 8); lastR = m.l + TH; } let lim = x0 + gw; for (let i = marks.length - 1; i >= 0; i--) { marks[i].l = Math.min(marks[i].l, lim - TH); lim = marks[i].l - 8; }
    for (const m of marks) {
      const e = out((T - m.at - 0.2) / 0.7); if (e <= 0) continue; const top = base - up - TH - 22 + (1 - e) * 10, py = base - m.b.score / 0.6 * up; g.globalAlpha = k * e;
      g.strokeStyle = 'rgba(255,122,80,.85)'; g.lineWidth = 1; g.beginPath(); g.moveTo(m.l + TH / 2, top + TH); g.lineTo(m.l + TH / 2, top + TH + 8); g.lineTo(m.x, top + TH + 18); g.lineTo(m.x, py - 4); g.stroke();
      const src = Math.max(m.b.x1 - m.b.x0, m.b.y1 - m.b.y0) * 1.35, mx = (m.b.x0 + m.b.x1) / 2, my = (m.b.y0 + m.b.y1) / 2; g.drawImage(photo, mx - src / 2, my - src / 2, src, src, m.l, top, TH, TH); g.strokeRect(m.l - 0.5, top - 0.5, TH + 1, TH + 1);
      bare(nth(m.b), m.l + TH / 2, top - 8, C.text, '400 18px ' + C.display, 'center');
    }
    g.globalAlpha = k; bare('Detection score along the flight', x0, base - up - TH - 60, C.text, fB()); bare('colour test', x0, base + dn + 12, C['text-2'], fS());
    g.globalAlpha = 1;
  }
  const inFrame = (list, id) => list.filter((b) => (b.id ?? STRIP[b.k]) === id && (b.area === undefined || b.area >= 320)).length;
  const ray = new THREE.Raycaster(), nd = new THREE.Vector2(), pl = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit = new THREE.Vector3();
  function pointerLoupe(src, c, w, hh) {
    nd.set(ptr.x / W * 2 - 1, 1 - ptr.y / H * 2); ray.setFromCamera(nd, c); if (!ray.ray.intersectPlane(pl, hit)) return;
    const ix = hit.x + w / 2, iy = hh / 2 - hit.y; if (ix < 0 || iy < 0 || ix > w || iy > hh) return;
    const L = 150, s = L * 0.42, lx = clamp(ptr.x + 22, 8, W - L - 8), ly = clamp(ptr.y - L - 22, 8, H - L - 8);
    g.globalAlpha = 1; g.fillStyle = '#06080a'; g.fillRect(lx - 1, ly - 1, L + 2, L + 2); g.drawImage(src, ix - s / 2, iy - s / 2, s, s, lx, ly, L, L); g.strokeStyle = 'rgba(236,238,241,.55)'; g.lineWidth = 1; g.strokeRect(lx - 0.5, ly - 0.5, L + 1, L + 1);
    g.beginPath(); g.moveTo(lx + L / 2 - 7, ly + L / 2); g.lineTo(lx + L / 2 + 7, ly + L / 2); g.moveTo(lx + L / 2, ly + L / 2 - 7); g.lineTo(lx + L / 2, ly + L / 2 + 7); g.stroke();
  }
  function drawAct2(t) {
    for (const n of site.pins) {
      const k = out((t - n.t0) / 0.9); if (k <= 0) continue;
      if (!proj(cam2, n.pos[0], n.z + n.h * k, -n.pos[1])) continue; const x = P[0], y = P[1]; const la = clamp((t - n.t0 - 0.5) * 2); if (la <= 0) continue;
      g.globalAlpha = la; g.fillStyle = n.main ? C.person : C.warn; const s = n.main ? 5 : 3; g.fillRect(x - s, y - s, s * 2, s * 2);
      if (n.main) { text(n.id + '  possible person', x + 16, y - 6, C.text, '600 18px ' + C.font); text(n.pos[0].toFixed(1) + ' m E   ' + n.pos[1].toFixed(1) + ' m N', x + 16, y + 15, C.person, '500 14px ' + C.mono); if (n.match) text('colour test also marks it: ' + n.match.name, x + 16, y + 34, C['text-2'], fS()); }
      else text(n.name, x + 9, y + 4, C.warn, fS());
    }
    g.globalAlpha = 1;
  }
  function drawAct3(t) {
    const px = (x, y) => proj(cam, x - CW / 2, CH / 2 - y, 0);
    cmp.regions.forEach((r, i) => {
      const b = r.b, vis = (b[0] + b[2]) / 2 > cmp.wipe * CW; r.k = clamp((r.k || 0) + (vis ? 0.05 : -0.08)); if (r.k <= 0) return;
      px(b[0], b[1]); const x0 = P[0], y0 = P[1]; px(b[2], b[3]); const x1 = P[0], y1 = P[1], pad = lerp(26, 5, out(r.k));
      if (i > 6 || y1 < 110 || x0 > W - 40) return;
      g.globalAlpha = r.k; g.strokeStyle = C.text; g.lineWidth = 1.25; corners(x0 - pad, y0 - pad, x1 + pad, y1 + pad, 10);
      if (i < 6) { text(r.m2.toFixed(0) + ' m²', x0 - pad, y0 - pad - 7, C.text, fM()); if (r.hit && cmp.regions.findIndex((q) => q.hit === r.hit) === i) text(r.hit.label, x0 - pad, y1 + pad + 18, C.text, fS()); }
    });
    g.globalAlpha = 1; px(cmp.wipe * CW, CH / 2); const x = P[0];
    g.strokeStyle = 'rgba(236,238,241,.95)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, x > W - 470 ? H - 206 : H); g.stroke();
    const hy = H * 0.42; g.fillStyle = C.text; g.fillRect(x - 13, hy - 22, 26, 44); g.strokeStyle = '#06080a'; g.lineWidth = 1.75; g.beginPath(); g.moveTo(x - 3, hy - 6); g.lineTo(x - 8, hy); g.lineTo(x - 3, hy + 6); g.moveTo(x + 3, hy - 6); g.lineTo(x + 8, hy); g.lineTo(x + 3, hy + 6); g.stroke();
    if (x > 130) text('First flight', x - 20, 38, C.text, fB(), 'right'); if (x < W - 180) text('Second flight, aligned', x + 20, 38, C.text, fB());
  }

  // ---------------------------------------------------------------- pointer
  const ptr = { in: false, down: false, x: 0, y: 0, ox: 0, oy: 0, vx: 0, vy: 0 };
  ov.addEventListener('pointermove', (e) => { const r = ov.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; ptr.in = true; if (ptr.down) { const dx = x - ptr.x, dy = y - ptr.y; if (act === 2) { cmp.grabbed = true; setWipe(x); } else { ptr.vx += dx; ptr.vy += dy; } } ptr.x = x; ptr.y = y; once(); });
  ov.addEventListener('pointerdown', (e) => { ov.setPointerCapture(e.pointerId); const r = ov.getBoundingClientRect(); ptr.down = true; ptr.x = e.clientX - r.left; ptr.y = e.clientY - r.top; if (act === 2) { cmp.grabbed = true; setWipe(ptr.x); } ov.classList.add('is-down'); once(); });
  const up = () => { ptr.down = false; ov.classList.remove('is-down'); };
  ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', up); ov.addEventListener('pointerleave', () => { ptr.in = false; once(); });
  ov.addEventListener('keydown', (e) => { const d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0; if (!d) return; e.preventDefault(); if (act === 2) { cmp.grabbed = true; cmp.wipe = clamp(cmp.wipe + d * 0.03, 0.02, 0.98); } else ptr.vx -= d * 60; once(); });
  const setWipe = (x) => { nd.set(x / W * 2 - 1, 0); ray.setFromCamera(nd, cam); if (ray.ray.intersectPlane(pl, hit)) cmp.wipe = clamp((hit.x + CW / 2) / CW, 0.02, 0.98); };

  // ---------------------------------------------------------------- the clock
  let act = 0, t = 0, raf = 0, last = 0, running = false, shown = false, dead = false, time = 0, slow = 0, good = 0, switching = 0, held = false;
  const up1 = new THREE.Vector3(0, 1, 0);
  const A = { p: new THREE.Vector3(), l: new THREE.Vector3(), u: new THREE.Vector3() }, B = { p: new THREE.Vector3(), l: new THREE.Vector3(), u: new THREE.Vector3() };
  const R0 = {}, R1 = {}, R2 = {}, D = new THREE.Vector3(), Z = new THREE.Vector3();
  function setFov(f) { if (cam.fov !== f) { cam.fov = f; cam.updateProjectionMatrix(); } }
  function aim(x, a, z, th, psi, roll) {   // strip units to world; psi turns the heading, roll banks
    const st = Math.sin(th), ct = Math.cos(th), sp = Math.sin(psi), cp = Math.cos(psi); D.set(sp * st, cp * st, -ct); cam.up.set(sp * ct, cp * ct, st).applyAxisAngle(D, roll); cam.position.set(x - SW / 2, a - SH / 2, z); Z.copy(cam.position).add(D); cam.lookAt(Z);
  }
  function pose1(dt) {
    setFov(FOV1);
    if (strip.live) { const L = strip.live; L.p = clamp((L.p || 0) + dt / 2.2); const e = ease(L.p), f = L.from; aim(lerp(f.x, SW / 2, e), lerp(f.a, L.mid - 70, e), lerp(f.z, 1254 * 1.02 / 2 / Math.tan(FOV1 * Math.PI / 360), e), lerp(f.th, 0, e), 0, 0); return; }
    const E = 0.12; poseAt(t, R0); poseAt(t + E, R1); poseAt(Math.max(0, t - E), R2);
    const vx = (R1.x - R2.x) / (2 * E), va = (R1.a - R2.a) / (2 * E), vz = (R1.z - R2.z) / (2 * E), ax = (R1.x - 2 * R0.x + R2.x) / (E * E), aa = (R1.a - 2 * R0.a + R2.a) / (E * E);
    const calm = reduced ? 0 : 1, wob = calm * (Math.sin(time * 0.83) * 0.011 + Math.sin(time * 0.37 + 2) * 0.016), k = Math.min(1, dt * 4), fin = ease((t - strip.end) / 4);
    I.roll += (clamp(ax * 0.00055 + vx * 0.0003, -0.14, 0.14) + wob - I.roll) * k; I.pitch += (clamp(-aa * 0.00042, -0.15, 0.15) + wob * 0.5 - I.pitch) * k;
    const psi = calm * (clamp(vx * 0.0004, -0.08, 0.08) + Math.sin(time * 0.23) * 0.022) * (1 - fin);
    I.alt += (R0.z * M_PER_PX - I.alt) * Math.min(1, dt * 12); I.spd += (Math.hypot(vx, va, vz) * M_PER_PX - I.spd) * Math.min(1, dt * 6); I.hdg = 47 + psi * 57.3;
    aim(R0.x + ptr.ox * -0.9 + calm * Math.sin(time * 0.31) * 7, R0.a + ptr.oy * 0.9, R0.z + calm * Math.sin(time * 0.47) * 5, R0.th - I.pitch * 0.25 * (1 - fin), psi, I.roll * (1 - fin));
  }
  function pose2() {
    const f = site.focus, k = ease((t - 2.2) / 6.2), az = 0.10 + (t - 8) * 0.021 + ptr.ox * -0.004, el = lerp(1.5699, 0.56, k) + ptr.oy * 0.0016 * k, dist = lerp(150, 47, k);
    site.rel.scale.y = lerp(0.02, 1, ease((t - 2.6) / 4.6)); for (const m of site.mist) m.position.x = m.userData.x + Math.sin(time * 0.05 + m.userData.x) * 12;
    const cx = lerp(60, f[0] - 5, k), cy = lerp(45, f[1] - 5, k), e = clamp(el, 0.2, 1.5699), a = lerp(0, az, k) - Math.PI / 2;
    cam2.position.set(cx + Math.cos(a) * Math.cos(e) * dist, Math.sin(e) * dist + 1, -cy - Math.sin(a) * Math.cos(e) * dist); cam2.up.set(0, 1, 0); if (k < 0.001) cam2.up.set(0, 0, -1); cam2.lookAt(cx, lerp(0, 4, k), -cy); s2.fog.near = Math.max(50, dist * 1.1); s2.fog.far = Math.max(118, dist * 2.2); if (t < 9) renderer.shadowMap.needsUpdate = true;   // the haze stays behind the subject, also from high up
    u2.uHeatK.value = clamp((t - 1) / 1.5); u2.uTime.value = time;
    site.pins.forEach((n, i) => { n.t0 ??= n.main ? 8.4 : 5.2 + i * 0.45; const q = out((t - n.t0) / 0.9); n.mesh.scale.y = Math.max(0.001, n.h * q); n.mesh.position.y = n.z + (1 - q) * 14; n.mesh.material.opacity = q; const c = n.main ? ((time * 0.55) % 1) : 1; const rr = n.main ? 1.2 + c * 5.5 : 1.1; n.ring.scale.setScalar(rr); n.ring.material.opacity = q * (n.main ? (1 - c) * 0.9 : 0.6); });
  }
  function pose3() {
    setFov(FOV);
    const d = Math.min(CH / 2 / TAN, CW / 2 / (TAN * W / H)) * (0.925 - 0.015 * Math.sin(time * 0.16)); cam.up.copy(up1); const dx = Math.sin(time * 0.21) * 14, dy = Math.cos(time * 0.17) * 8; cam.position.set(dx, dy, d); cam.lookAt(dx, dy, 0);
    if (!cmp.grabbed) cmp.wipe = reduced ? 0.45 : 0.5 + 0.36 * Math.cos(t * 0.5 + 0.1) * (1 - 0.0 * t);
    u3.uWipe.value = cmp.wipe; u3.uTime.value = time;
  }
  function render(dt) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    ptr.ox += (ptr.vx - ptr.ox) * Math.min(1, dt * 7); ptr.oy += (ptr.vy - ptr.oy) * Math.min(1, dt * 7); if (!ptr.down) { const b = Math.exp(-dt * 0.5); ptr.vx *= b; ptr.vy *= b; }
    if (act === 0) {
      if (!strip.ready) { renderer.clear(); return; }
      pose1(dt); const live = strip.live, T = live ? live.t : t, tilt = live ? 0 : ease((t - strip.end - 0.4) / 4.6);
      u1.uFront.value = live ? live.front : front(t); u1.uTime.value = time; u1.uLift.value = tilt; u1.uFog.value = tilt; u1.uCam.value.copy(cam.position); u1.uStrip.value += ((live ? 0 : 1) - u1.uStrip.value) * Math.min(1, dt * 2); haze.position.set(cam.position.x, cam.position.y + 600, 300); haze.visible = dust.visible = tilt < 0.98; dust.material.uniforms.uPx.value = H * ratio;
      u1.uHeatK.value = live && !live.over ? 0.0 : 1; uT.uT.value = T; uT.uA.value = 1 - tilt * 0.75;
      s1.background.setRGB(lerp(0.0018, 0.0098, tilt) , lerp(0.0024, 0.0123, tilt), lerp(0.003, 0.0153, tilt)); renderer.render(s1, cam); drawAct1(t, dt);
    } else if (act === 1) { if (!site.ready) { renderer.render(s2, cam2); return; } pose2(); renderer.render(s2, cam2); drawAct2(t); }
    else { if (!cmp.ready) { renderer.render(s3, cam); return; } pose3(); renderer.render(s3, cam); drawAct3(t); }
  }
  const ready = () => (act === 0 ? strip.ready : act === 1 ? site.ready : cmp.ready);
  function frame(ts) {
    raf = 0; if (!running) return; const raw = last ? (ts - last) / 1000 : 0.016, dt = Math.min(0.05, raw); last = ts; time += dt;
    if (ready() && !(act === 0 && strip.live)) t += dt; if (strip.live) { strip.live.t += dt; if (strip.live.frontTo) strip.live.front += (strip.live.frontTo - strip.live.front) * Math.min(1, dt * 2.5); }
    // adaptive resolution: drop a step after a run of slow frames, never below 1:1 of CSS pixels times 0.8
    if (raw > 0.021) { if (++slow > 45 && ratio > 0.85) { ratio = Math.max(0.85, ratio * 0.85); slow = 0; renderer.setPixelRatio(ratio); } } else if (slow > 0) slow -= 0.5;
    render(dt); caption();
    if (act === 0 && (t > 9 && outdoorLeads().length || t > 20) && !site.building) buildSite().catch((e) => { site.failed = String(e.message || e); o.warn('The site mosaic could not be drawn: ' + site.failed); });
    if ((act === 1 && t > 4 || act === 2) && !cmp.building) buildCmp().catch((e) => { cmp.failed = String(e.message || e); });
    if (act === 1 && site.ready && !site.leads.length && outdoorLeads().length) { site.ready = site.building = false; t = 0; onState({ kind: 'act', act }); }
    if (act === 1 && !site.building) buildSite().catch((e) => { site.failed = String(e.message || e); });
    if (t > DUR[act] - 0.55 && !switching && !held && !strip.live && !(act === 1 && o.surveying())) { if (act === 2 && cmp.grabbed) t = DUR[2] - 4; else go((act + 1) % 3, true); }
    if (!freed && strip.rx && site.ready && cmp.ready) { freed = true; o.release(); } else if (freed && !site.ready) freed = false;
    raf = requestAnimationFrame(frame);
  }
  let freed = false;
  function once() { if (!running && W > 1) { render(0.016); } else if (reduced && !raf) raf = requestAnimationFrame((ts) => { raf = 0; render(0.016); }); }
  const fade = h('div.ah-fade'); host.append(fade);
  function go(n, auto) {
    if (switching || (n === act && auto)) return; switching = 1; fade.classList.add('is-on');
    setTimeout(() => { act = n; t = 0; cmp.grabbed = false; ptr.vx = ptr.vy = ptr.ox = ptr.oy = 0; if (n === 1 && site.ready && !site.leads.length && outdoorLeads().length) { site.ready = site.building = false; } if (n === 1) buildSite().catch((e) => { site.failed = String(e.message || e); }); if (n === 2) buildCmp().catch((e) => { cmp.failed = String(e.message || e); }); onState({ kind: 'act', act }); if (reduced) settle(); fade.classList.remove('is-on'); switching = 0; }, reduced ? 0 : 420);
  }
  function settle() { t = [(stops[0]?.t1 ?? 8) - 0.3, 14, 5][act]; I.on = 1; const w = () => { if (ready()) render(0.016); else setTimeout(w, 250); }; w(); caption(); }
  let lastCap = '';
  function caption() {
    let s = '', n = [];
    if (act === 0) {
      const T = strip.live ? strip.live.t : t, seen = strip.tiles.filter ? countTiles(T) : 0, ppl = countPeople(T), col = countCol(T);
      n = [[seen + '/' + strip.tiles.length, 'tiles read'], [String(ppl), 'person-like'], [strip.rx ? String(col) : '…', 'unusual colours']];
      const a = baseS(t) + AIM, [q, pk] = pushAt(t);
      if (strip.live) s = strip.live.msg; else s = t > strip.end ? 'Height is how unusual the colour is.' : q && pk > 0.2 ? (q.to ? 'Two person-like shapes. Down for a closer look.' : 'A tarp and a coat. Only the coat is person-like.') : a < 1500 ? 'The network reads the frame tile by tile.' : a < 2450 ? (inFrame(strip.boxes, 'G-03') === 0 && inFrame(strip.regions, 'G-03') ? 'Bright objects. Colour marks each one for a look.' : 'Every unusual colour is kept.') : 'Colour and shape, side by side.';
    } else if (act === 1) { s = site.failed ? 'The mosaic could not be drawn.' : !site.ready ? 'Drawing the site mosaic.' : t < 2.4 ? 'The survey mosaic, seen straight down.' : t < 8 ? 'Draped over the site model.' : site.pins.some((p) => p.main) ? 'The drone’s possible person, on the plan.' : 'Colour leads, on the plan.'; const m = site.pins.filter((p) => !p.main).length; if (o.surveying()) s = 'The simulated drone is flying the survey.'; n = site.ready ? [[String(site.pins.length), 'places to check']] : []; }
    else { s = cmp.failed ? 'The comparison could not run.' : !cmp.ready ? 'Lining the two flights up.' : 'Drag the line.'; n = cmp.ready ? [[cmp.found + '/' + cmp.truth, 'known changes found'], [String(cmp.count), 'areas flagged'], [Math.hypot(cmp.shift[0], cmp.shift[1]).toFixed(0) + ' px', 'camera shift removed']] : []; }
    const key = s + n.join(); if (key !== lastCap) { lastCap = key; onState({ kind: 'caption', text: s, figures: n }); }
    onState.progress?.(act, clamp(t / DUR[act]));
  }
  const countTiles = (T) => { let k = 0; for (const x of strip.tiles) if (x.at <= T) k++; return k; };
  const countPeople = (T) => { let k = 0; for (const b of strip.boxes) if (b.at <= T) k++; return k; };
  const countCol = (T) => { let k = 0; for (const r of strip.regions) if (r.at <= T && r.area >= 320) k++; return k; };

  const ro = new ResizeObserver(() => { const r = host.getBoundingClientRect(); if (!r.width || !r.height) return; W = r.width; H = r.height; dpr = Math.min(2, devicePixelRatio || 1); ratio = Math.min(dpr, ratio === 1 ? dpr : Math.max(ratio, 1)); renderer.setPixelRatio(ratio); renderer.setSize(W, H, false); ov.width = Math.round(W * dpr); ov.height = Math.round(H * dpr); cam.aspect = cam2.aspect = W / H; cam.updateProjectionMatrix(); cam2.updateProjectionMatrix(); schedule(); once(); });
  ro.observe(host);
  buildStrip().catch((e) => { o.warn('The frames could not be loaded: ' + (e.message || e)); go(2); });

  return {
    start() { shown = true; if (running) return; if (reduced) { settle(); return; } running = true; last = 0; raf = requestAnimationFrame(frame); },
    stop() { shown = false; running = false; if (raf) cancelAnimationFrame(raf); raf = 0; },
    go: (n) => { held = false; if (strip.live?.cancel) strip.live.cancel(); strip.live = null; schedule(); go(n); }, get act() { return act; }, get t() { return t; }, seek(x) { t = x; },
    recolour: readColours, site, cmp, strip,
    mainLead: () => site.pins.find((n) => n.main) || null,
    leadPx: () => { const n = site.pins.find((m) => m.main); return n ? n.pos : null; },
    // the real thing: run the network on the strip's frames here and now
    async live(detectTile, load) {
      if (act !== 0) { go(0); await new Promise((r) => setTimeout(r, 600)); }
      let stop = false; const K = clamp(Math.round((baseS(t) + AIM - FW / 2) / STEP), 0, STRIP.length - 1), mine = strip.tiles.filter((q) => q.k === K).reverse();   // one frame: the one under the camera
      const L = strip.live = { t: 0, from: poseAt(t, {}), mid: K * STEP + FW / 2, front: -300, msg: 'Loading the detector…', cancel: () => { stop = true; }, over: 0 };
      L.front = K * STEP - 60; const keep = strip.boxes; strip.boxes = keep.filter((b) => b.id !== STRIP[K]); for (const b of strip.boxes) b.at = SH - b.y0 < K * STEP ? -9 : 1e9; for (const x of strip.tiles) x.done = x.k < K ? -9 : undefined; schedule(); onState({ kind: 'live' });
      const at = () => tileMesh.geometry.attributes.aAt;
      try {
        await load((m) => { L.msg = m; }); if (stop) return false;
        let sum = 0, n = 0; let all = [];
        for (let i = 0; i < mine.length; i++) {
          const q = mine[i], idx = strip.tiles.indexOf(q), src = strip.bmps[q.k], r = await detectTile(src, q); if (stop) { return false; }
          sum += r.ms; n++; q.done = q.at = L.t; at().array[idx] = L.t; at().needsUpdate = true; L.frontTo = K * STEP + FW * (i + 1) / mine.length;
          const tx = q.x;
          for (const p of r.people) { const b = p.box; if (p.score < o.minScore || (tx > 0 && b[0] < tx + 4) || (q.fy > 0 && b[1] < q.fy + 4) || (tx + q.w < FW && b[2] > tx + q.w - 4) || (q.fy + q.w < FW && b[3] > q.fy + q.w - 4)) continue; all.push({ score: p.score, box: b, at: L.t }); }
          all = nms(all); strip.boxes = [...strip.boxes.filter((b) => b.id !== STRIP[K]), ...all.map((z) => ({ id: STRIP[K], score: z.score, x0: z.box[0], y0: z.box[1] + oy(K), x1: z.box[2], y1: z.box[3] + oy(K), at: z.at }))];
          L.msg = 'Live: tile ' + (i + 1) + ' of ' + mine.length + ', ' + (sum / n / 1000).toFixed(2) + ' s each, on this computer';
        }
        L.over = L.t; L.front = Math.max(L.front, K * STEP + FW); strip.isLive = { k: K, n, ms: sum / n }; L.msg = 'Done: ' + n + ' tiles, ' + (sum / n / 1000).toFixed(2) + ' s each, on this computer.'; await new Promise((r) => setTimeout(r, 3200)); return true;
      } catch (e) { strip.boxes = keep; if (stop) return false; throw e; }
      finally { if (stop) strip.boxes = keep; strip.live = null; for (const x of strip.tiles) delete x.done; schedule(); }
    },
    dispose() {
      dead = true; strip.live?.cancel?.(); this.stop(); ro.disconnect();
      for (const sc of [s1, s2, s3]) { sc.traverse((m) => { m.geometry?.dispose(); for (const q of [].concat(m.material || [])) { for (const u of Object.values(q.uniforms || {})) u.value?.isTexture && u.value.dispose(); q.map?.dispose(); q.dispose(); } m.isInstancedMesh && m.dispose(); }); sc.clear(); }
      for (const b of strip.bmps || []) b.close?.(); renderer.dispose(); renderer.forceContextLoss(); gl.remove(); ov.remove(); fade.remove();
    },
  };
}
