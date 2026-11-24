// The Demo film of the Drone imagery workspace: three acts on one WebGL canvas, with a thin drawn overlay.
//   1 Find     a strip of frames; the detector's own (recorded or live) boxes and the live colour test
//   2 Place    the simulated site mosaic draped over the site model; leads land on map positions
//   3 Compare  two drawn flights of the same ground, aligned and compared live; drag the divider
// Nothing here makes up a result: boxes come from data/aerial/recorded.json or a live run, heat from the RX worker,
// changes from the change worker. Frames of act 1 are AI-generated illustrations and say so on screen.
import { tileGrid, colourName, nms } from './shared.js';

const STRIP = ['G-01', 'G-03', 'G-02', 'G-05'], FW = 1254, STEP = 1104, SW = FW + 3 * STEP, SH = FW, LAP = FW - STEP;
const VIEW_H = 985, FOV = 30, TAN = Math.tan((FOV / 2) * Math.PI / 180);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => { t = clamp(t); return t * t * t * (t * (t * 6 - 15) + 10); };   // quintic: no jump in speed or acceleration
const out = (t) => 1 - Math.pow(1 - clamp(t), 4);
const DUR = [34, 22, 26];

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
  host.append(gl, ov);
  const renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x06080a, 1); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.7;   // act 2 only: acts 1 and 3 grade in their own shaders
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
  const g = ov.getContext('2d');
  const aniso = renderer.capabilities.getMaxAnisotropy();
  let W = 1, H = 1, dpr = 1, ratio = 1;
  const cam = new THREE.PerspectiveCamera(FOV, 1, 1, 12000);
  const C = {}; const readColours = () => { for (const k of ['person', 'warn', 'text', 'text-2', 'accent', 'ok', 'sim', 'bg-0']) C[k] = css('--' + k); C.font = css('--font'); C.mono = css('--mono'); };
  readColours();

  const noise = new THREE.CanvasTexture(noiseCanvas(256, 5)); noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
  const heatRamp = /* glsl */'vec3 ramp(float t){ vec3 a=vec3(.17,.25,.42),b=vec3(.48,.25,.56),c=vec3(.85,.31,.30),d=vec3(1.,.70,.29),e=vec3(1.,.95,.77); return t<.25?mix(a,b,t*4.):t<.5?mix(b,c,(t-.25)*4.):t<.75?mix(c,d,(t-.5)*4.):mix(d,e,(t-.75)*4.); }';

  // ---------------------------------------------------------------- act 1: the strip
  const strip = { ready: false, boxes: [], regions: [], tiles: [], live: null };
  const s1 = new THREE.Scene(); s1.background = new THREE.Color(0x06080a);
  const photo = document.createElement('canvas'); photo.width = SW; photo.height = SH;
  const heatC = document.createElement('canvas'); heatC.width = SW / 2; heatC.height = SH / 2;
  const photoTex = new THREE.CanvasTexture(photo); photoTex.colorSpace = THREE.NoColorSpace; photoTex.anisotropy = aniso; photoTex.wrapT = THREE.MirroredRepeatWrapping; photoTex.wrapS = THREE.MirroredRepeatWrapping;
  const heatTex = new THREE.CanvasTexture(heatC); heatTex.colorSpace = THREE.NoColorSpace;
  const u1 = { uMap: { value: photoTex }, uHeat: { value: heatTex }, uNoise: { value: noise }, uFront: { value: -200 }, uTime: { value: 0 }, uLift: { value: 0 }, uHeatK: { value: 1 }, uCam: { value: new THREE.Vector3() }, uFog: { value: 0 }, uSize: { value: new THREE.Vector2(SW, SH) }, uDrone: { value: new THREE.Vector2() } };
  const sheetMat = new THREE.ShaderMaterial({ uniforms: u1, vertexShader: /* glsl */`
    uniform sampler2D uHeat; uniform float uLift,uTime,uFront; uniform vec2 uSize; varying vec2 vUv; varying vec3 vW; varying float vH;
    void main(){ vec3 p=position; vec2 uv=p.xy/uSize+.5; vUv=uv; float in_=step(0.,uv.y)*step(uv.y,1.);
      float hgt=(textureLod(uHeat,uv,4.5).a*.6+textureLod(uHeat,uv,3.).a*.4)*in_; hgt=pow(hgt,.8);
      float wave=.94+.06*sin(uTime*1.7+p.x*.01); vH=hgt; p.z+=hgt*uLift*300.*wave; vW=p; gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D uMap,uHeat,uNoise; uniform float uFront,uTime,uLift,uHeatK,uFog; uniform vec3 uCam; uniform vec2 uSize,uDrone; varying vec2 vUv; varying vec3 vW; varying float vH;
    ${heatRamp}
    void main(){
      vec3 c=texture2D(uMap,vUv).rgb; float l=dot(c,vec3(.3,.59,.11));
      float px=vUv.x*uSize.x; float n=texture2D(uNoise,vUv*vec2(9.,2.5)).r;
      float seen=smoothstep(60.,-60.,px-uFront+(n-.5)*90.);
      vec3 cold=mix(vec3(l),c,.18)*vec3(.40,.46,.54);                       // not read yet: graphite
      vec3 warm=mix(vec3(l),c,1.12); warm=mix(warm,warm*warm*(3.-2.*warm),.35)*vec3(1.0,.985,.96);
      vec3 col=mix(cold,warm,seen);
      float inside=step(0.,vUv.y)*step(vUv.y,1.);
      float hv=texture2D(uHeat,vUv).a*inside;
      float breathe=.62+.38*sin(uTime*2.1+px*.004);
      float hs=smoothstep(.05,.9,hv);
      vec3 glow=ramp(clamp(hv*.45+.36,0.,.78));
      col=mix(col,glow*(.28+l*1.5),hs*seen*uHeatK*(.16+.26*breathe));
      float halo=textureLod(uHeat,vUv,5.).a*inside; col+=vec3(1.,.48,.2)*halo*halo*seen*uHeatK*(.10+.14*breathe);
      if(uLift>.01){ float f=abs(fract(vH*14.-.5)-.5)/fwidth(vH*14.); float line=(1.-clamp(f,0.,1.))*smoothstep(.02,.12,vH); col=mix(col,vec3(1.,.80,.52),line*.75*uLift); col+=glow*smoothstep(.05,.9,vH)*.25*uLift; }
      float edge=exp(-pow((px-uFront)/2.2,2.))*.75+.22*exp(-pow(max(uFront-px,0.)/110.,2.))*step(px,uFront);
      col+=vec3(.42,.70,1.)*edge*.5*inside;
      float sh=smoothstep(130.,20.,length((vW.xy-uDrone)*vec2(1.,1.25)));
      col*=1.-.34*sh*(1.-uLift);
      float off=max(-vUv.y,vUv.y-1.); col*=mix(1.,.42,smoothstep(-.16,.30,off)); 
      col*=mix(smoothstep(-.02,.03,vUv.x)*smoothstep(1.02,.985,vUv.x),1.,uFog);
      float d=distance(vW,uCam); float fog=uFog*(1.-exp(-pow(max(d-1000.,0.)/1900.,1.5))); fog=clamp(fog*1.06+(n-.5)*.16*fog*(1.-fog),0.,1.);
      col=mix(col,vec3(.098,.114,.130),fog);
      gl_FragColor=vec4(col,1.); }` });
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(SW * 1.3, SH * 5, 560, 620), sheetMat); s1.add(sheet); sheet.frustumCulled = false;
  // the tiles the detector read: one instanced quad each, lit at its own moment
  let tileMesh = null, uT = { uT: { value: 0 }, uA: { value: 1 } };
  function buildTiles() {
    strip.tiles = [];
    STRIP.forEach((id, k) => { const r = recorded?.frames[id]; const T = r?.tile || 320; tileGrid(FW, FW, T, 0.4).forEach((t, i) => strip.tiles.push({ id, k, i, x: t.x + k * STEP, y: t.y, w: t.w, at: 0 })); });
    const geo = new THREE.PlaneGeometry(1, 1), at = new Float32Array(strip.tiles.length), m = new THREE.Matrix4();
    const mat = new THREE.ShaderMaterial({ uniforms: uT, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, vertexShader: 'attribute float aAt; uniform float uT; varying vec2 vUv; varying float vA; void main(){ vUv=uv; vA=uT-aAt; gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.); }',
      fragmentShader: 'uniform float uA; varying vec2 vUv; varying float vA; void main(){ if(vA<0.) discard; vec2 q=min(vUv,1.-vUv); float e=min(q.x,q.y); float w=fwidth(e); float line=1.-smoothstep(w*.6,w*1.6,e); float c=step(min(max(q.x,q.y),1.),.09); float k=exp(-vA*2.4); float rest=.07; float scan=exp(-pow((1.-vUv.y-vA*2.2)*18.,2.))*step(vA,.5); gl_FragColor=vec4(vec3(.42,.70,1.),(line*(rest+k*.8+c*.16)+k*.085+scan*.25)*uA); }' });
    tileMesh = new THREE.InstancedMesh(geo, mat, strip.tiles.length); tileMesh.frustumCulled = false; tileMesh.renderOrder = 3;
    strip.tiles.forEach((t, i) => { m.makeScale(t.w, t.w, 1); m.setPosition(t.x + t.w / 2 - SW / 2, SH / 2 - t.y - t.w / 2, 1.5); tileMesh.setMatrixAt(i, m); });
    geo.setAttribute('aAt', new THREE.InstancedBufferAttribute(at, 1)); s1.add(tileMesh); schedule();
  }
  // story time -> camera x and detector front
  const halfW = () => VIEW_H * W / H / 2;
  const camX = (t) => lerp(Math.max(halfW() - 20, 820), SW - Math.max(halfW() - 20, 820), clamp((t - 1) / 21) * 0.3 + ease((t - 1) / 21) * 0.7);
  const front = (t) => { const a = lerp(-160, camX(3) + halfW() * 0.5, ease((t + 0.6) / 3.8)); return Math.max(a, Math.min(camX(t) + halfW() * (0.5 + 0.02 * t), SW + 200)) * (t > 3.2 ? 1 : 1); };
  function timeOfFront(x) { let a = 0, b = 26; for (let i = 0; i < 26; i++) { const m = (a + b) / 2; if (front(m) < x) a = m; else b = m; } return b; }
  function schedule() {
    if (!tileMesh) return; const at = tileMesh.geometry.attributes.aAt;
    strip.tiles.forEach((t, i) => { t.at = strip.live ? (t.done ?? 1e6) : timeOfFront(t.x + t.w * 0.5) + (t.y / SH) * 0.42; at.array[i] = t.at; }); at.needsUpdate = true;
    for (const b of strip.boxes) if (!strip.live) b.at = timeOfFront((b.x0 + b.x1) / 2 + 60) + 0.35 + (b.y0 / SH) * 0.4;
    for (const r of strip.regions) r.at = timeOfFront(r.x1) + 0.2;
  }
  function setBoxes(rec) {
    strip.boxes = [];
    STRIP.forEach((id, k) => { for (const b of rec?.frames[id]?.boxes || []) if (b[0] >= o.minScore) strip.boxes.push({ id, score: b[0], x0: b[1] + k * STEP, y0: b[2], x1: b[3] + k * STEP, y1: b[4], at: 0 }); });
    schedule();
  }
  async function buildStrip() {
    const pc = photo.getContext('2d');
    const bmps = await Promise.all(STRIP.map(loadBitmap));
    // frames overlap; the seam follows a noise edge, the way an orthomosaic is stitched
    const seam = document.createElement('canvas'); seam.width = LAP; seam.height = FW; const sg = seam.getContext('2d', { willReadFrequently: true });
    const nz = noise.image.getContext('2d').getImageData(0, 0, 256, 256).data;
    bmps.forEach((b, k) => {
      if (k === 0) { pc.drawImage(b, 0, 0); return; }
      const x = k * STEP; pc.drawImage(b, LAP, 0, FW - LAP, FW, x + LAP, 0, FW - LAP, FW);
      sg.globalCompositeOperation = 'source-over'; sg.drawImage(b, 0, 0, LAP, FW, 0, 0, LAP, FW); const im = sg.getImageData(0, 0, LAP, FW), d = im.data;
      for (let y = 0; y < FW; y++) for (let xx = 0; xx < LAP; xx++) { const q = (nz[(((y + k * 91) & 255) * 256 + (xx & 255)) * 4] / 255 - 0.5) * 1.1 + (nz[((((y >> 2) + k * 37) & 255) * 256 + ((xx >> 2) & 255)) * 4] / 255 - 0.5) * 0.9; d[(y * LAP + xx) * 4 + 3] = 255 * clamp((xx / LAP - 0.5 + q * 0.55) * 4 + 0.5); }
      sg.putImageData(im, 0, 0); pc.drawImage(seam, x, 0);
    });
    photoTex.needsUpdate = true; strip.bmps = bmps; strip.ready = true;
    if (!tileMesh) buildTiles(); setBoxes(recorded);
    onState({ kind: 'stripReady' });
    // the colour test, live, one frame at a time in its own worker
    const hg = heatC.getContext('2d');
    for (let k = 0; k < STRIP.length; k++) {
      const c = new OffscreenCanvas(FW, FW), cg = c.getContext('2d', { willReadFrequently: true }); cg.drawImage(bmps[k], 0, 0); const id = cg.getImageData(0, 0, FW, FW);
      try {
        await rpc()('put', { key: 'H' + k, rgba: id.data.buffer, w: FW, h: FW }, [id.data.buffer]);
        await rpc()('rx', { key: 'H' + k, mode: 'global', rects: null, outer: 36, guard: 12 });
        const r = await rpc()('rxRegions', { key: 'H' + k, mode: 'global', thr: o.rxThr, minArea: 60 });
        const t = new OffscreenCanvas(r.w, r.h); t.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.overlay), r.w, r.h), 0, 0);
        hg.save(); hg.beginPath(); hg.rect((k ? k * STEP + LAP / 2 : 0) / 2, 0, (k ? STEP : STEP + LAP / 2) / 2, FW / 2); hg.clip(); hg.drawImage(t, k * STEP / 2, 0, FW / 2, FW / 2); hg.restore(); heatTex.needsUpdate = true;
        for (const q of r.regions) if (q.bbox[0] > LAP * 0.6 || k === 0) { const n = { k, x0: q.bbox[0] + k * STEP, y0: q.bbox[1], x1: q.bbox[2] + k * STEP, y1: q.bbox[3], area: q.area, peak: q.peak, rgb: q.rgb, name: colourName(q.rgb) }; const m = strip.regions.find((e) => e.k === k && n.x0 < e.x1 + 22 && n.x1 > e.x0 - 22 && n.y0 < e.y1 + 22 && n.y1 > e.y0 - 22); if (m) { m.x0 = Math.min(m.x0, n.x0); m.y0 = Math.min(m.y0, n.y0); m.x1 = Math.max(m.x1, n.x1); m.y1 = Math.max(m.y1, n.y1); if (n.area > m.area) m.name = n.name; m.area += n.area; } else strip.regions.push(n); }   // pieces of one object count once
        schedule();
      } catch (e) { o.warn('The colour test could not run: ' + (e.message || e)); return; }
    }
    strip.rx = true;
  }

  // ---------------------------------------------------------------- act 2: the site in relief
  const site = { ready: false, building: false, pins: [] };
  const s2 = new THREE.Scene(); s2.background = new THREE.Color(0x191e23); s2.fog = new THREE.Fog(0x191e23, 50, 118);
  const cam2 = new THREE.PerspectiveCamera(FOV, 1, 1, 900);
  const V = (x, y, z = 0) => new THREE.Vector3(x, z, -y);
  const u2 = { uHeat: { value: null }, uHeatK: { value: 0 }, uTime: { value: 0 } };
  async function buildSite() {
    if (site.building) return; site.building = true;
    const PPM = 24, spec = { ...siteSpec(), pxPerM: PPM };
    const r = await rpc()('scene', { key: 'HS', spec, noiseSeed: 7 });
    site.leads = spec.leads; site.ppm = PPM; s2.clear(); const rel = site.rel = new THREE.Group(); s2.add(rel);   // rel: everything that rises out of the flat photo
    const cnv = document.createElement('canvas'); cnv.width = r.w; cnv.height = r.h; cnv.getContext('2d', { willReadFrequently: true }).drawImage(r.bitmap, 0, 0); r.bitmap.close?.();
    const smp = document.createElement('canvas'); smp.width = 480; smp.height = 360; const sc = smp.getContext('2d', { willReadFrequently: true }); sc.drawImage(cnv, 0, 0, 480, 360); const sd = sc.getImageData(0, 0, 480, 360).data;
    const at = (x, y) => { const i = (clamp(Math.floor((90 - y) * 4), 0, 359) * 480 + clamp(Math.floor(x * 4), 0, 479)) * 4; return [sd[i] / 255, sd[i + 1] / 255, sd[i + 2] / 255]; };
    const tex = new THREE.CanvasTexture(cnv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = aniso; site.tex = tex;
    // the same live colour test, on the mosaic
    await rpc()('rx', { key: 'HS', mode: 'global', rects: null, outer: 42, guard: 13 });
    const q = await rpc()('rxRegions', { key: 'HS', mode: 'global', thr: o.rxThr, minArea: 40 });
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
    const gg = new THREE.PlaneGeometry(120, 90, 360, 270); gg.rotateX(-Math.PI / 2); gg.translate(60, 0, -45);
    const p = gg.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, hgt(p.getX(i), -p.getZ(i))); { const ah = new Float32Array(p.count); for (let i = 0; i < p.count; i++) ah[i] = heap(p.getX(i), -p.getZ(i)); gg.setAttribute('aHeap', new THREE.BufferAttribute(ah, 1)); } gg.computeVertexNormals();
    const ground = new THREE.Mesh(gg, addHeat(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0, bumpMap: tex, bumpScale: 2.2, transparent: true }))); ground.renderOrder = 1; rel.add(ground);
    // the land around it, climbing into the valley sides (not surveyed: drawn)
    const landT = rub.clone(); landT.repeat.set(62, 62); landT.needsUpdate = true;
    const lg0 = new THREE.PlaneGeometry(760, 760, 190, 190); lg0.rotateX(-Math.PI / 2); lg0.translate(60, 0, -45); const lp = lg0.attributes.position, lc = new Float32Array(lp.count * 3);
    for (let i = 0; i < lp.count; i++) { const x = lp.getX(i), y = -lp.getZ(i), d = Math.hypot(Math.max(0, -x, x - 120), Math.max(0, -y, y - 90)), in_ = x > 1 && x < 119 && y > 1 && y < 89; lp.setY(i, in_ ? -2.5 : hgt(x, y) * 0.8 - 0.35 + Math.pow(Math.max(0, d - 14) / 60, 1.7) * 16 * (0.5 + N(x * 0.035 + 7, y * 0.035 + 3)) + Math.min(d / 8, 3) * (N(x * 0.11, y * 0.11) - 0.5) * 2.2); const s = 0.72 + 0.5 * N(x * 0.09 + 2, y * 0.09); lc[i * 3] = s; lc[i * 3 + 1] = s * (0.98 + 0.1 * N(x * 0.05, y * 0.05 + 4)); lc[i * 3 + 2] = s * 0.96; }
    lg0.setAttribute('color', new THREE.BufferAttribute(lc, 3)); lg0.computeVertexNormals(); rel.add(new THREE.Mesh(lg0, new THREE.MeshStandardMaterial({ map: landT, roughness: 1, vertexColors: true, color: 0x55514b })));
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
    gableX(8, 40, 24, 70, 6, 1.3, 16, 11); gableY(24, 47, 34, 63, 4.6, 0.8, 55, 31); wall([24, 47], [34, 47], 4.6, 41); wall([34, 47], [34, 63], 4.6, 42, 0.8); wall([34, 63], [24, 63], 4.6, 43);
    gableY(44, 30, 84, 44, 3.4, 1, 37, 51); gableY(44, 44, 78.3, 58, 3.4, 1, 51, 61); roofRect(78.3, 44, 84, 51, 3.4, 3.4, 4.2, 4.4);
    wall([44, 30], [84, 30], 3.4, 71); wall([84, 30], [84, 44], 3.4, 72, 1); wall([84, 44], [84, 50], 3.4, 73); wall([78, 58], [44, 58], 3.4, 74); wall([44, 58], [44, 44], 3.4, 75, 1); wall([44, 44], [44, 30], 3.4, 76, 1);
    gableX(92, 20, 112, 46, 5.4, 1.2, 102, 91);
    // loose stones and timber on the heaps, coloured by the mosaic under them
    let seed = 9; const R = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const rock = new THREE.DodecahedronGeometry(1, 0), rp = rock.attributes.position; for (let i = 0; i < rp.count; i++) { const k = 0.5 + 1.0 * N(Math.round(rp.getX(i) * 9) / 3 + 3, Math.round(rp.getY(i) * 9) / 3 + Math.round(rp.getZ(i) * 9) / 5); rp.setXYZ(i, rp.getX(i) * k * 1.2, rp.getY(i) * k * 0.7, rp.getZ(i) * k); } rock.computeVertexNormals();
    const spots = []; for (const b of polys) { if (b.id === 'rubble-corridor') continue; const xs = b.poly.map((q2) => q2[0]), ys = b.poly.map((q2) => q2[1]), n = b.id === 'rubble-field' ? 620 : 260; for (let i = 0; i < n * 2 && spots.length < 1400; i++) { const x = lerp(Math.min(...xs), Math.max(...xs), R()), y = lerp(Math.min(...ys), Math.max(...ys), R()); const sc0 = at(x, y); if (inPoly(b.poly, x, y) && Math.max(...sc0) - Math.min(...sc0) < 0.22 && !site.leads.some((l) => Math.hypot(l.pos[0] - x, l.pos[1] - y) < 1.6)) spots.push([x, y]); } }
    const bushes = []; for (let y = 1; y < 89; y += 0.55) for (let x = 1; x < 119; x += 0.55) { const c = at(x, y), l = (c[0] + c[1] + c[2]) / 3; if (c[1] > c[0] * 1.06 && c[1] > c[2] * 1.15 && l < 0.27 && R() < 0.8) for (let k = 0; k < 7; k++) bushes.push([x + R() - 0.3, y + R() - 0.3, c]); }
    const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), eu = new THREE.Euler(), col = new THREE.Color();
    const inst = (geo, mat, list, f) => { const m = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((s, i) => { f(s, i); m.setMatrixAt(i, m4); m.setColorAt(i, col); }); m.castShadow = m.receiveShadow = true; rel.add(m); m.frustumCulled = false; };
    const grey = (c, k) => { const l = (c[0] + c[1] + c[2]) / 3; col.setRGB(lerp(l, c[0], 0.6) * k, lerp(l, c[1], 0.6) * k, lerp(l, c[2], 0.6) * k, THREE.SRGBColorSpace); };
    inst(new THREE.BoxGeometry(1.5, 0.2, 1), new THREE.MeshStandardMaterial({ roughness: 0.95, map: conc, bumpMap: conc, bumpScale: 2 }), spots.filter((_, i) => i % 6 === 1), ([x, y]) => { const s = 0.45 + R() * R() * 1.5; eu.set((R() - 0.5) * 1.1, R() * 6, (R() - 0.5) * 1.1); m4.compose(V(x, y, hgt(x, y) + s * 0.12), qt.setFromEuler(eu), new THREE.Vector3(s, 1, s)); const l = 1.1 + R() * 0.7; col.setRGB(l, l * 0.98, l * 0.94); });
    inst(rock, new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), spots, ([x, y]) => { const s = 0.07 + Math.pow(R(), 4) * 0.55, c = at(x, y); eu.set(R() * 6, R() * 6, R() * 6); m4.compose(V(x, y, hgt(x, y) + s * 0.2), qt.setFromEuler(eu), new THREE.Vector3(s, s, s)); grey(c, 0.85 + R() * 0.35); });
    inst(new THREE.BoxGeometry(1, 0.1, 0.16), new THREE.MeshStandardMaterial({ roughness: 0.95 }), spots.filter((_, i) => i % 11 === 0), ([x, y]) => { eu.set((R() - 0.5) * 0.5, R() * 6, (R() - 0.5) * 0.7); m4.compose(V(x, y, hgt(x, y) + 0.22), qt.setFromEuler(eu), new THREE.Vector3(1.2 + R() * 2.6, 1, 1)); col.setRGB(0.42 + R() * 0.12, 0.34 + R() * 0.08, 0.25, THREE.SRGBColorSpace); });
    const puff = new THREE.IcosahedronGeometry(1, 1), pp = puff.attributes.position; for (let i = 0; i < pp.count; i++) { const k = 0.7 + 0.65 * N(pp.getX(i) * 5 + 9, pp.getY(i) * 5 + pp.getZ(i) * 4); pp.setXYZ(i, pp.getX(i) * k, pp.getY(i) * k, pp.getZ(i) * k); } puff.computeVertexNormals();
    inst(puff, new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), bushes.slice(0, 9000), ([x, y, c]) => { const s = 0.05 + R() * R() * 0.24; eu.set(R() * 3, R() * 6, R() * 3); m4.compose(V(x, y, hgt(x, y) + 0.1 + R() * 0.7), qt.setFromEuler(eu), new THREE.Vector3(s, s * 0.7, s * 1.15)); const q2 = 0.55 + R() * 0.5; col.setRGB(c[0] * q2, c[1] * q2, c[2] * q2 * 0.9, THREE.SRGBColorSpace); });
    // haze drifting between the camera and the ground
    site.mist = []; const mt = new THREE.CanvasTexture((() => { const c = document.createElement('canvas'); c.width = c.height = 256; const q2 = c.getContext('2d'), im = q2.createImageData(256, 256); for (let i = 0; i < 65536; i++) { const x = (i & 255) / 127.5 - 1, y = (i >> 8) / 127.5 - 1, f = clamp(1 - Math.hypot(x, y)); im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = 255; im.data[i * 4 + 3] = 255 * clamp((nz[i * 4] / 255 - 0.34) * 2.4) * f * f; } q2.putImageData(im, 0, 0); return c; })());
    for (let i = 0; i < 9; i++) { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: mt, transparent: true, depthWrite: false, opacity: 0.20, color: 0xa7b6c4, fog: false, rotation: i })); m.scale.set(70 + i * 7, 22 + i * 2, 1); m.position.copy(V(20 + i * 17, 96 + (i % 3) * 22, 6 + (i % 4) * 3)); m.userData.x = m.position.x; site.mist.push(m); rel.add(m); }
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
    renderer.initTexture(tex); site.rel.scale.y = 0.02; renderer.compile(s2, cam2);
    site.ready = true; onState({ kind: 'siteReady' });
  }

  // ---------------------------------------------------------------- act 3: before / after
  const cmp = { ready: false, building: false, wipe: 0.5, regions: [], grabbed: false };
  const s3 = new THREE.Scene(), CW = 2080, CH = 1170, PPM3 = 26;
  const u3 = { uA: { value: null }, uB: { value: null }, uD: { value: null }, uWipe: { value: 0.5 }, uTime: { value: 0 } };
  async function buildCmp() {
    if (cmp.building) return; cmp.building = true;
    const spec = { seed: 305, w: CW, h: CH, pxPerM: PPM3, theme: 'roofs', figures: 0 }, light = { gain: 0.86, tint: [1.04, 1, 0.97] }, shift = [17, -11];
    const a = await rpc()('scene', { key: 'HA', spec, noiseSeed: 5 }), b = await rpc()('scene', { key: 'HB', spec: { ...spec, mutate: 306 }, noiseSeed: 9, light, shift });
    const r = await rpc()('change', { before: 'HA', after: 'HB', rects: null }), z = await rpc()('changeRegions', { thr: o.chgThr, method: 'robust', minArea: Math.round(PPM3 * PPM3) });
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
  function text(s, x, y, col, f, al = 'left') { g.font = f; g.textAlign = al; g.textBaseline = 'alphabetic'; g.lineWidth = 2.5; g.strokeStyle = 'rgba(6,8,10,.62)'; g.lineJoin = 'round'; g.strokeText(s, x, y); g.fillStyle = col; g.fillText(s, x, y); }
  const fB = () => '600 14px ' + C.font, fS = () => '400 12.5px ' + C.font, fM = () => '500 12.5px ' + C.mono;

  function drawAct1(t, dt) {
    const tilt = strip.live ? 0 : ease((t - 24.6) / 4.2), T = strip.live ? strip.live.t : t;
    // colour regions: a fine tick under the heat, named, only the strongest
    if (!tilt) for (const r of strip.regions) {
      const a = T - r.at; if (a < 0 || strip.live && !strip.live.over || r.area < 320) continue; if (strip.boxes.some((b) => b.x0 < r.x1 + 10 && b.x1 > r.x0 - 10 && b.y0 < r.y1 + 10 && b.y1 > r.y0 - 10)) continue;
      P1(r.x0, r.y0); const x0 = P[0], y0 = P[1]; P1(r.x1, r.y1); const x1 = P[0], y1 = P[1]; if (x1 < -50 || x0 > W + 50) continue;
      g.globalAlpha = clamp(a * 2) * 0.9; g.strokeStyle = C.warn; g.lineWidth = 1; corners(x0 - 5, y0 - 5, x1 + 5, y1 + 5, 6);
      if (r.area > 900) text('Unusual colour: ' + r.name, x0 - 5, y1 + 22, C.warn, fS());
    }
    // people: brackets close in, a square loupe at twice the size
    for (const b of strip.boxes) {
      const a = T - b.at; if (a < 0) continue; const k = out(a / 0.6);
      if (tilt > 0.02) {   // the pin
        if (!P1((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2)) continue; const bx = P[0], by = P[1]; P1((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, 300 * tilt); const tx = P[0], ty = P[1];
        g.globalAlpha = tilt; g.strokeStyle = C.person; g.lineWidth = 1.5; g.beginPath(); g.moveTo(bx, by); g.lineTo(tx, ty); g.stroke(); g.fillStyle = C.person; g.fillRect(tx - 3, ty - 3, 6, 6);
        const l = strip.boxes.indexOf(b) % 2 ? -1 : 1, al = l < 0 ? 'right' : 'left'; text('Person-like', tx + 12 * l, ty + 1, C.text, fB(), al); text(Math.round(b.score * 100) + ' %', tx + 12 * l, ty + 18, C.person, fM(), al); continue;
      }
      P1(b.x0, b.y0); let x0 = P[0], y0 = P[1]; P1(b.x1, b.y1); let x1 = P[0], y1 = P[1]; if (x1 < -260 || x0 > W + 260) continue;
      const pad = lerp(70, 7, k); g.globalAlpha = k; g.strokeStyle = C.person; g.lineWidth = 1.75; corners(x0 - pad, y0 - pad, x1 + pad, y1 + pad, 11);
      // loupe
      const L = 172 * clamp(H / 888, 0.84, 1), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, lk = out((a - 0.25) / 0.7); if (lk <= 0) continue;
      const side = cx > W * 0.60 ? -1 : 1, lx = cx + side * 118 + (side < 0 ? -L : 0), ly = clamp(cy - L - 24, 18, H - L - 18), src = Math.max((b.y1 - b.y0) * 1.22, (L / ((x1 - x0) / (b.x1 - b.x0))) / 2.1), gone = clamp((cx - 10) / 90) * clamp((W - 10 - cx) / 90);
      g.globalAlpha = lk * gone; if (gone <= 0) continue; g.strokeStyle = C.person; g.lineWidth = 1; g.beginPath(); g.moveTo(side > 0 ? x1 + pad : x0 - pad, y0 - pad); g.lineTo(side > 0 ? lx : lx + L, ly + L); g.stroke();
      g.fillStyle = '#06080a'; g.fillRect(lx - 1, ly - 1, L + 2, L + 2); g.imageSmoothingQuality = 'high';
      const sx = (b.x0 + b.x1) / 2 - src / 2, sy = (b.y0 + b.y1) / 2 - src / 2; g.drawImage(photo, sx, sy, src, src, lx, ly, L, L);
      g.strokeStyle = 'rgba(236,238,241,.7)'; g.strokeRect(lx - 0.5, ly - 0.5, L + 1, L + 1); g.strokeStyle = C.person; g.lineWidth = 1.5; corners(lx - 4, ly - 4, lx + L + 4, ly + L + 4, 10);
      text('Person-like', side > 0 ? lx + L + 14 : lx - 14, ly + 14, C.text, fB(), side > 0 ? 'left' : 'right'); text(Math.round(b.score * 100) + ' %', side > 0 ? lx + L + 14 : lx - 14, ly + 33, C.person, fM(), side > 0 ? 'left' : 'right');
    }
    // the one nobody found (marked by eye on the illustration)
    const ms = o.missed, mt = ms ? (strip.live ? (strip.live.over ? T - strip.live.over : -1) : T - timeOfFront(ms.x + 3 * STEP) - 1.6) : -1;
    if (ms && mt > 0 && missedByBoth()) {
      const k = out(mt / 0.8); P1(ms.x + 3 * STEP, ms.y); const cx = P[0], cy = P[1]; P1(ms.x + 3 * STEP + ms.r, ms.y); const r = Math.max(26, P[0] - cx) * lerp(1.5, 1, k);
      g.globalAlpha = k * (tilt > 0 ? 1 - tilt : 1); g.setLineDash([4, 4]); g.strokeStyle = C.text; g.lineWidth = 1.25; g.strokeRect(cx - r, cy - r, r * 2, r * 2); g.setLineDash([]);
      text('Missed by both', cx + r + 12, cy - 2, C.text, fB()); text('mud hides colour and shape', cx + r + 12, cy + 16, C['text-2'], fS());
    }
    // loupe under the pointer
    if (ptr.in && !ptr.down && !tilt && !strip.boxes.some((b) => { P1((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2); return T > b.at && Math.hypot(P[0] - ptr.x, P[1] - ptr.y) < 150; })) pointerLoupe(photo, cam, SW, SH);
    g.globalAlpha = 1;
  }
  const missedByBoth = () => { const m = o.missed; return m && strip.rx && strip.boxes.length && ![...strip.boxes, ...strip.regions].some((b) => b.x0 < m.x + 3 * STEP + m.r && b.x1 > m.x + 3 * STEP - m.r && b.y0 < m.y + m.r && b.y1 > m.y - m.r); };
  const inFrame = (list, id) => list.filter((b) => (b.id ?? STRIP[b.k]) === id && (b.area === undefined || b.area >= 320)).length;
  const ray = new THREE.Raycaster(), nd = new THREE.Vector2(), pl = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit = new THREE.Vector3();
  function pointerLoupe(src, c, w, hh) {
    nd.set(ptr.x / W * 2 - 1, 1 - ptr.y / H * 2); ray.setFromCamera(nd, c); if (!ray.ray.intersectPlane(pl, hit)) return;
    const ix = hit.x + w / 2, iy = hh / 2 - hit.y; if (ix < 0 || iy < 0 || ix > w || iy > hh) return;
    const L = 150, k = H / VIEW_H, s = L / k / 2, lx = clamp(ptr.x + 22, 8, W - L - 8), ly = clamp(ptr.y - L - 22, 8, H - L - 8);
    g.globalAlpha = 1; g.fillStyle = '#06080a'; g.fillRect(lx - 1, ly - 1, L + 2, L + 2); g.drawImage(src, ix - s / 2, iy - s / 2, s, s, lx, ly, L, L); g.strokeStyle = 'rgba(236,238,241,.55)'; g.lineWidth = 1; g.strokeRect(lx - 0.5, ly - 0.5, L + 1, L + 1);
    g.beginPath(); g.moveTo(lx + L / 2 - 7, ly + L / 2); g.lineTo(lx + L / 2 + 7, ly + L / 2); g.moveTo(lx + L / 2, ly + L / 2 - 7); g.lineTo(lx + L / 2, ly + L / 2 + 7); g.stroke();
  }
  function drawAct2(t) {
    for (const n of site.pins) {
      const k = out((t - n.t0) / 0.9); if (k <= 0) continue;
      if (!proj(cam2, n.pos[0], n.z + n.h * k, -n.pos[1])) continue; const x = P[0], y = P[1]; const la = clamp((t - n.t0 - 0.5) * 2); if (la <= 0) continue;
      g.globalAlpha = la; g.fillStyle = n.main ? C.person : C.warn; const s = n.main ? 5 : 3; g.fillRect(x - s, y - s, s * 2, s * 2);
      if (n.main) { text(n.id + '  possible person', x + 16, y - 6, C.text, '600 18px ' + C.font); text(n.pos[0].toFixed(1) + ' m E   ' + n.pos[1].toFixed(1) + ' m N', x + 16, y + 15, C.person, '500 14px ' + C.mono); if (n.match) text('colour test agrees: ' + n.match.name, x + 16, y + 34, C['text-2'], fS()); }
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
    g.strokeStyle = 'rgba(236,238,241,.95)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
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
  let act = 0, t = 0, raf = 0, last = 0, running = false, time = 0, slow = 0, good = 0, switching = 0, held = false;
  const up1 = new THREE.Vector3(0, 1, 0);
  const nadirD = () => VIEW_H / 2 / TAN;
  const A = { p: new THREE.Vector3(), l: new THREE.Vector3(), u: new THREE.Vector3() }, B = { p: new THREE.Vector3(), l: new THREE.Vector3(), u: new THREE.Vector3() };
  function pose1() {
    const sway = reduced ? 0 : Math.sin(time * 0.31) * 10, d = nadirD();
    if (strip.live) { const k = strip.live.k = clamp(strip.live.k + 0.016 / 2.2); const e = ease(k), fx = lerp(strip.live.x0, strip.live.x, e); A.p.set(fx - SW / 2, 0, d * lerp(1, 1.24, e)); cam.up.set(0, 1, 0); cam.position.copy(A.p); cam.lookAt(fx - SW / 2, 0, 0); return; }
    const x = camX(t) - SW / 2 + ptr.ox * -1.1, y = sway * 0.6 + ptr.oy * 1.1, k = ease((t - 24.4) / 5.2);
    A.p.set(x, clamp(y, -120, 120), d); A.l.set(x + sway, clamp(y, -120, 120), 0); A.u.set(0, 1, 0);
    if (k > 0) { const slowx = (t - 29) * 10; B.p.set(SW / 2 - 130 - slowx, -170 + ptr.ox * 0.6, 720); B.l.set(SW / 2 - 1560 - slowx, 60, 235); B.u.set(0, 0, 1); A.p.lerp(B.p, k); A.p.z += Math.sin(k * Math.PI) * 160; A.l.lerp(B.l, k); A.u.set(-0.0 - k * 0.0, 1 - k, k).normalize(); if (k > 0 && k < 1) { A.u.set(-Math.sin(k * Math.PI / 2) * (1 - k) - 0.0001, (1 - k) * (1 - k), k).normalize(); } }
    cam.up.copy(A.u); cam.position.copy(A.p); cam.lookAt(A.l);
  }
  function pose2() {
    const f = site.focus, k = ease((t - 2.2) / 6.2), az = 0.10 + (t - 8) * 0.021 + ptr.ox * -0.004, el = lerp(1.5699, 0.40, k) + ptr.oy * 0.0016 * k, dist = lerp(150, 52, k);
    site.rel.scale.y = lerp(0.02, 1, ease((t - 2.6) / 4.6)); for (const m of site.mist) m.position.x = m.userData.x + Math.sin(time * 0.05 + m.userData.x) * 12;
    const cx = lerp(60, f[0] - 5, k), cy = lerp(45, f[1] - 5, k), e = clamp(el, 0.2, 1.5699), a = lerp(0, az, k) - Math.PI / 2;
    cam2.position.set(cx + Math.cos(a) * Math.cos(e) * dist, Math.sin(e) * dist + 1, -cy - Math.sin(a) * Math.cos(e) * dist); cam2.up.set(0, 1, 0); if (k < 0.001) cam2.up.set(0, 0, -1); cam2.lookAt(cx, lerp(0, 4, k), -cy); if (t < 9) renderer.shadowMap.needsUpdate = true;
    u2.uHeatK.value = clamp((t - 1) / 1.5); u2.uTime.value = time;
    site.pins.forEach((n, i) => { n.t0 ??= n.main ? 8.4 : 5.2 + i * 0.45; const q = out((t - n.t0) / 0.9); n.mesh.scale.y = Math.max(0.001, n.h * q); n.mesh.position.y = n.z + (1 - q) * 14; n.mesh.material.opacity = q; const c = n.main ? ((time * 0.55) % 1) : 1; const rr = n.main ? 1.2 + c * 5.5 : 1.1; n.ring.scale.setScalar(rr); n.ring.material.opacity = q * (n.main ? (1 - c) * 0.9 : 0.6); });
  }
  function pose3() {
    const d = Math.min(CH / 2 / TAN, CW / 2 / (TAN * W / H)) * (0.925 - 0.015 * Math.sin(time * 0.16)); cam.up.copy(up1); const dx = Math.sin(time * 0.21) * 14, dy = Math.cos(time * 0.17) * 8; cam.position.set(dx, dy, d); cam.lookAt(dx, dy, 0);
    if (!cmp.grabbed) cmp.wipe = reduced ? 0.45 : 0.5 + 0.36 * Math.cos(t * 0.5 + 0.1) * (1 - 0.0 * t);
    u3.uWipe.value = cmp.wipe; u3.uTime.value = time;
  }
  function render(dt) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    ptr.ox += (ptr.vx - ptr.ox) * Math.min(1, dt * 7); ptr.oy += (ptr.vy - ptr.oy) * Math.min(1, dt * 7); if (!ptr.down) { const b = Math.exp(-dt * 0.5); ptr.vx *= b; ptr.vy *= b; }
    if (act === 0) {
      if (!strip.ready) { renderer.clear(); return; }
      pose1(); const live = strip.live, T = live ? live.t : t, tilt = live ? 0 : ease((t - 24.6) / 4.6);
      u1.uFront.value = live ? live.front : t > 24 ? SW + 300 : front(t); u1.uTime.value = time; u1.uLift.value = tilt; u1.uFog.value = tilt; u1.uCam.value.copy(cam.position); u1.uDrone.value.set(cam.position.x - 250, cam.position.y - 60);
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
    if (act === 1 && !site.building) buildSite().catch((e) => { site.failed = String(e.message || e); });
    if (t > DUR[act] - 0.55 && !switching && !held && !strip.live) { if (act === 2 && cmp.grabbed) t = DUR[2] - 4; else go((act + 1) % 3, true); }
    raf = requestAnimationFrame(frame);
  }
  function once() { if (!running && W > 1) { render(0.016); } else if (reduced && !raf) raf = requestAnimationFrame((ts) => { raf = 0; render(0.016); }); }
  const fade = h('div.ah-fade'); host.append(fade);
  function go(n, auto) {
    if (switching || (n === act && auto)) return; switching = 1; fade.classList.add('is-on');
    setTimeout(() => { act = n; t = 0; cmp.grabbed = false; ptr.vx = ptr.vy = ptr.ox = ptr.oy = 0; if (n === 1 && site.ready && !site.leads.length && outdoorLeads().length) { site.ready = site.building = false; } if (n === 1) buildSite().catch((e) => { site.failed = String(e.message || e); }); if (n === 2) buildCmp().catch((e) => { cmp.failed = String(e.message || e); }); onState({ kind: 'act', act }); if (reduced) settle(); fade.classList.remove('is-on'); switching = 0; }, reduced ? 0 : 420);
  }
  function settle() { t = [23, 14, 5][act]; const w = () => { if (ready()) render(0.016); else setTimeout(w, 250); }; w(); caption(); }
  let lastCap = '';
  function caption() {
    let s = '', n = [];
    if (act === 0) {
      const T = strip.live ? strip.live.t : t, seen = strip.tiles.filter ? countTiles(T) : 0, ppl = countPeople(T), col = countCol(T);
      n = [[seen + '/' + strip.tiles.length, 'tiles read'], [String(ppl), 'person-like'], [strip.rx ? String(col) : '…', 'unusual colours']];
      if (strip.live) s = strip.live.msg; else s = t < 3.4 ? 'The network reads the frame tile by tile.' : t < 7.5 ? inFrame(strip.boxes, 'G-01') + ' person-like shapes, locked.' : t < 13.5 ? (inFrame(strip.boxes, 'G-03') === 0 && inFrame(strip.regions, 'G-03') ? 'Decoys. Colour flags them; the network does not.' : 'Every unusual colour is kept.') : t < 19 ? (inFrame(strip.boxes, 'G-02') === 1 ? 'A tarp and a coat. Only the coat is person-like.' : 'Colour and shape, side by side.') : t < 24.6 ? (missedByBoth() ? 'Someone in mud-brown clothing: missed by both.' : 'The last frame.') : 'Height is how unusual the colour is.';
    } else if (act === 1) { s = site.failed ? 'The mosaic could not be drawn.' : !site.ready ? 'Drawing the site mosaic.' : t < 2.4 ? 'The survey mosaic, seen straight down.' : t < 8 ? 'Draped over the site model.' : site.pins.some((p) => p.main) ? 'The drone’s possible person, on the plan.' : 'Colour leads, on the plan.'; const m = site.pins.filter((p) => !p.main).length; n = site.ready ? [[String(site.pins.length), 'places to check'], ['2 of 2', 'methods agree']] : []; if (!site.pins.some((p) => p.match)) n = n.slice(0, 1); }
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
    start() { if (running) return; if (reduced) { settle(); return; } running = true; last = 0; raf = requestAnimationFrame(frame); },
    stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; },
    go: (n) => { held = false; if (strip.live?.cancel) strip.live.cancel(); strip.live = null; schedule(); go(n); }, get act() { return act; }, get t() { return t; }, seek(x) { t = x; },
    recolour: readColours, site, cmp, strip,
    mainLead: () => site.pins.find((n) => n.main) || null,
    leadPx: () => { const n = site.pins.find((m) => m.main); return n ? n.pos : null; },
    // the real thing: run the network on the strip's frames here and now
    async live(detectTile, load) {
      if (act !== 0) { go(0); await new Promise((r) => setTimeout(r, 600)); }
      let stop = false; const K = clamp(Math.round((camX(t) - FW / 2) / STEP), 0, STRIP.length - 1), mine = strip.tiles.filter((q) => q.k === K);   // one frame: the one under the camera
      const L = strip.live = { t: 0, k: 0, x0: camX(t), x: K * STEP + FW / 2, front: -300, msg: 'Loading the detector…', cancel: () => { stop = true; }, over: 0 };
      L.x = clamp(L.x, halfW() * 1.24 - 40, SW - halfW() * 1.24 + 40); L.front = K * STEP - 60; const keep = strip.boxes; strip.boxes = keep.filter((b) => b.id !== STRIP[K]); for (const b of strip.boxes) b.at = b.x1 < K * STEP ? -9 : 1e9; for (const x of strip.tiles) x.done = x.k < K ? -9 : undefined; schedule(); onState({ kind: 'live' });
      const at = () => tileMesh.geometry.attributes.aAt;
      try {
        await load((m) => { L.msg = m; }); if (stop) return false;
        let sum = 0, n = 0; let all = [];
        for (let i = 0; i < mine.length; i++) {
          const q = mine[i], idx = strip.tiles.indexOf(q), src = strip.bmps[q.k], r = await detectTile(src, q); if (stop) { return false; }
          sum += r.ms; n++; q.done = q.at = L.t; at().array[idx] = L.t; at().needsUpdate = true; L.frontTo = K * STEP + FW * (i + 1) / mine.length;
          const tx = q.x - q.k * STEP;
          for (const p of r.people) { const b = p.box; if (p.score < o.minScore || (tx > 0 && b[0] < tx + 4) || (q.y > 0 && b[1] < q.y + 4) || (tx + q.w < FW && b[2] > tx + q.w - 4) || (q.y + q.w < FW && b[3] > q.y + q.w - 4)) continue; all.push({ score: p.score, box: b, at: L.t }); }
          all = nms(all); strip.boxes = [...strip.boxes.filter((b) => b.id !== STRIP[K]), ...all.map((z) => ({ id: STRIP[K], score: z.score, x0: z.box[0] + K * STEP, y0: z.box[1], x1: z.box[2] + K * STEP, y1: z.box[3], at: z.at }))];
          L.msg = 'Live: tile ' + (i + 1) + ' of ' + mine.length + ', ' + (sum / n / 1000).toFixed(2) + ' s each, on this computer';
        }
        L.over = L.t; L.front = Math.max(L.front, K * STEP + FW); strip.isLive = { n, ms: sum / n }; L.msg = 'Done: ' + n + ' tiles, ' + (sum / n / 1000).toFixed(2) + ' s each, on this computer.'; await new Promise((r) => setTimeout(r, 3200)); return true;
      } catch (e) { strip.boxes = keep; throw e; }
      finally { if (stop) strip.boxes = keep; strip.live = null; for (const x of strip.tiles) delete x.done; schedule(); }
    },
    dispose() { this.stop(); ro.disconnect(); renderer.dispose(); },
  };
}
