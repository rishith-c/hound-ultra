// The scout drone over the rubble, with everything it carries switched on in turn: colour camera, heat camera, lidar, Wi-Fi.
// The airframe is the mission twin's own model (a concept unit, drawn larger than life). The ground is four AI-generated frames.
// The boxes are the detector's recorded output on those frames. Heat, lidar and Wi-Fi are drawn readings: simulated, and tagged so.
import { buildAirframe, frameMaterial, bladeGeometry, PROP_R, PROP_Y, ARM_Y } from '../../twin/actors/drone.js';

const STRIP = ['G-01', 'G-02', 'G-05', 'G-03'], FW = 1254, STEP = 1104, SW = FW, SH = FW + 3 * STEP, LAP = FW - STEP, M = 0.0175, GW = SW * M, GL = SH * M, REL = 2.3;
const ALT = 5.5, SCALE = 4.3, SPEED = 2.6, Z0 = -1, MODE_S = 6.4, N = 4, HALF = [5.6, 3.7];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v)), lerp = (a, b, t) => a + (b - a) * t, ss = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const damp = (c, t, l, dt) => c + (t - c) * (1 - Math.exp(-l * dt));
const HASH = 'float h1(vec2 p){ vec3 q=fract(vec3(p.xyx)*.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }';
// where the camera stands for each sensor: azimuth and elevation in degrees, distance in metres
const POSE = [[-30, 24, 9.0], [28, 31, 9.6], [-58, 20, 11.4], [38, 21, 11.8]];
export const SENSORS = [
  { id: 'camera', name: 'Colour camera', line: 'A neural network reads every frame for people.' },
  { id: 'heat', name: 'Heat camera', line: 'A warm body stands out from cold concrete.' },
  { id: 'lidar', name: 'Lidar', line: 'Laser light measures the rubble, point by point.' },
  { id: 'wifi', name: 'Wi-Fi radio', line: 'Radio goes into the rubble. Movement changes it.' },
];

export async function createDrone(host, o) {
  const THREE = await import('three');
  const { h, css, reduced, loadBitmap, recorded, minScore, onMode, onRead, onEnd } = o;
  const gl = h('canvas.ad-gl', { 'aria-hidden': 'true' }), ov = h('canvas.ad-ov', { tabindex: 0, role: 'img', 'aria-label': 'A scout drone over rubble. Drag to look around it.' });
  host.append(gl, ov);
  const renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12; renderer.setClearColor(0x0d1217, 1);
  const g = ov.getContext('2d'), scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(44, 1, 0.2, 160);
  const FOG = new THREE.Color(0x0f141a);
  const col = (n) => css('--' + n); let C = {}; const recolour = () => { C = { person: col('person'), accent: col('accent'), text: col('text'), dim: col('text-2'), font: col('font') }; }; recolour();

  // ── the ground: four frames laid end to end, with a relief made from their own light and shade
  const bmps = await Promise.all(STRIP.map(loadBitmap));
  const photo = document.createElement('canvas'); photo.width = SW; photo.height = SH; const px = photo.getContext('2d');
  for (let k = 0; k < N; k++) {
    const y = (N - 1 - k) * STEP, t = document.createElement('canvas'); t.width = t.height = FW; const x = t.getContext('2d'); x.drawImage(bmps[k], 0, 0, FW, FW);
    if (k) { x.globalCompositeOperation = 'destination-in'; const gr = x.createLinearGradient(0, FW, 0, FW - LAP); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, '#000'); x.fillStyle = gr; x.fillRect(0, 0, FW, FW); }
    px.drawImage(t, 0, y);
  }
  bmps.forEach((b) => b.close?.());
  const HW = 314, HH = 1142, hc = document.createElement('canvas'); hc.width = HW; hc.height = HH; const hx = hc.getContext('2d', { willReadFrequently: true });
  hx.filter = 'blur(1.6px)'; hx.drawImage(photo, 0, 0, HW, HH); hx.filter = 'none'; const im = hx.getImageData(0, 0, HW, HH), bl = document.createElement('canvas'); bl.width = HW; bl.height = HH;
  { const b = bl.getContext('2d', { willReadFrequently: true }); b.filter = 'blur(22px)'; b.drawImage(photo, 0, 0, HW, HH); const lo = b.getImageData(0, 0, HW, HH).data, d = im.data; for (let i = 0; i < HW * HH; i++) { const j = i * 4, L = (d[j] * 0.3 + d[j + 1] * 0.59 + d[j + 2] * 0.11) / 255, B = (lo[j] * 0.3 + lo[j + 1] * 0.59 + lo[j + 2] * 0.11) / 255, r = i % HW, q = (i / HW) | 0, sw = Math.sin(r * 0.031 + q * 0.011) * 0.06 + Math.sin(q * 0.027 - r * 0.017) * 0.05; d[j] = d[j + 1] = d[j + 2] = 255 * clamp(0.5 + (L - B) * 1.5 + sw); d[j + 3] = 255; } hx.putImageData(im, 0, 0); }
  const H8 = im.data, at = (u, v) => H8[(clamp(Math.round((1 - v) * HH), 0, HH - 1) * HW + clamp(Math.round(u * HW), 0, HW - 1)) * 4] / 255;
  const ground = (x, z) => (at(clamp(x / GW + 0.5), clamp(-z / GL)) - 0.5) * REL;
  const tex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; };
  const photoT = tex(photo), hgtT = tex(hc);
  const people = []; STRIP.forEach((id, k) => { for (const b of recorded?.frames[id]?.boxes || []) if (b[0] >= minScore) { const cx = (b[1] + b[3]) / 2, cy = (b[2] + b[4]) / 2 + (N - 1 - k) * STEP, x = (cx - SW / 2) * M, z = -(SH - cy) * M; people.push({ x, z, w: (b[3] - b[1]) * M / 2 + 0.12, d: (b[4] - b[2]) * M / 2 + 0.12, score: b[0], found: -1 }); } });
  const BURIED = { x: 1.9, z: -(FW / 2 + 3 * STEP) * M + 7 };
  const U = { uMap: { value: photoT }, uHgt: { value: hgtT }, uCam: { value: new THREE.Vector3() }, uD: { value: new THREE.Vector3() }, uM: { value: new THREE.Vector4() }, uT: { value: 0 }, uFog: { value: FOG }, uP: { value: Array.from({ length: 6 }, (_, i) => new THREE.Vector3(people[i]?.x ?? 99, people[i]?.z ?? 99, people[i] ? 1 : 0)) }, uB: { value: new THREE.Vector2(BURIED.x, BURIED.z) }, uPx: { value: 900 }, uScan: { value: new THREE.Vector2(0, 0) } };
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(GW * 3.4, GL + 60, 380, 620).rotateX(-Math.PI / 2).translate(0, 0, -GL / 2), new THREE.ShaderMaterial({ uniforms: U, vertexShader: /* glsl */`
    uniform sampler2D uHgt; varying vec2 vUv; varying vec3 vW;
    void main(){ vec3 p=position; vUv=vec2(p.x/${GW.toFixed(3)}+.5,-p.z/${GL.toFixed(3)}); p.y=(textureLod(uHgt,vUv,0.).r-.5)*${REL.toFixed(2)}; vW=p; gl_Position=projectionMatrix*viewMatrix*vec4(p,1.); }`, fragmentShader: /* glsl */`
    uniform sampler2D uMap,uHgt; uniform vec3 uCam,uD,uFog,uP[6]; uniform vec4 uM; uniform vec2 uB; uniform float uT; varying vec2 vUv; varying vec3 vW; ${HASH}
    vec3 iron(float t){ t=clamp(t,0.,1.); return t<.3?mix(vec3(.012,.012,.07),vec3(.17,.04,.36),t/.3):t<.6?mix(vec3(.17,.04,.36),vec3(.82,.18,.20),(t-.3)/.3):t<.85?mix(vec3(.82,.18,.20),vec3(1.,.68,.16),(t-.6)/.25):mix(vec3(1.,.68,.16),vec3(1.,.98,.88),(t-.85)/.15); }
    vec3 ironL(float t){ return pow(iron(t),vec3(2.1)); }
    void main(){
      vec2 e=vec2(1./${HW}.,1./${HH}.); float hxp=texture2D(uHgt,vUv+vec2(e.x,0.)).r-texture2D(uHgt,vUv-vec2(e.x,0.)).r, hzp=texture2D(uHgt,vUv+vec2(0.,e.y)).r-texture2D(uHgt,vUv-vec2(0.,e.y)).r;
      vec3 Nn=normalize(vec3(-hxp*${(REL / (2 * GW / HW)).toFixed(3)},1.,hzp*${(REL / (2 * GL / HH)).toFixed(3)}));
      vec3 c=texture2D(uMap,vUv).rgb; c=pow(c,vec3(2.05)); float l=dot(c,vec3(.25,.6,.15));
      float sun=clamp(dot(Nn,normalize(vec3(-.75,.42,-.5))),0.,1.), sky=.5+.5*Nn.y;
      vec3 cold=mix(vec3(l),c,.35)*vec3(.50,.62,.82)*(.30*sky+.95*sun)*1.25;
      vec3 warm=mix(vec3(l),c,1.12)*(.34*sky+1.15*sun);
      float off=max(abs(vUv.x-.5)-.5,0.)*${GW.toFixed(1)}+max(max(-vUv.y,vUv.y-1.),0.)*${GL.toFixed(1)};
      float seen=smoothstep(-.6,2.4,vW.z-uD.z)*exp(-off*.6);
      vec3 base=mix(cold*.8,mix(cold,warm,.62),seen);
      vec2 d2=vW.xz-uD.xz, q=d2/vec2(${HALF[0]},${HALF[1]}); float m=max(abs(q.x),abs(q.y)), mw=fwidth(m)*1.2, inr=1.-smoothstep(1.-mw,1.,m), soft=exp(-max(m-1.,0.)*2.2);
      vec3 col=base;
      // colour camera: the frame it is reading, lit, tiled the way the network reads it
      vec3 lit=warm*1.5+c*.12; float tile=0.; { vec2 f=abs(fract(q*vec2(2.,1.5)+.5)-.5), w=fwidth(q*vec2(2.,1.5)); tile=max(1.-smoothstep(0.,w.x*1.4,f.x),1.-smoothstep(0.,w.y*1.4,f.y)); }
      float bar=q.y-(fract(uT*.42)*2.4-1.2); float scan=exp(-bar*bar*900.)+smoothstep(.5,0.,-bar)*step(bar,0.)*0.+exp(-max(bar,0.)*7.)*step(0.,bar)*.10;
      vec3 camc=lit+vec3(.36,.62,1.)*(tile*.10+scan*.5);
      col=mix(col,camc,uM.x*inr); col+=lit*soft*uM.x*.10*(1.-inr); col+=vec3(.50,.74,1.)*uM.x*exp(-pow((m-1.)/.012,2.))*1.1;
      // heat camera
      float body=0.; for(int i=0;i<6;i++){ vec2 r=(vW.xz-uP[i].xy); body+=uP[i].z*exp(-dot(r,r)*2.4)*(.35+.9*smoothstep(.05,.5,abs(c.r-c.b)*2.+abs(c.g-c.b))); }
      float ls=dot(texture2D(uMap,vUv).rgb,vec3(.25,.6,.15)); float ht=.02+smoothstep(.02,.9,ls)*.62*(.55+.6*sun)+(h1(floor(vW.xz*36.))-.5)*.025; ht=min(ht,.60)+body*.95; vec3 hot=ironL(ht);
      float rr=smoothstep(1.06,.92,m); col=mix(col,hot*1.5+hot*body*1.1,uM.y*rr); col+=vec3(1.,.36,.12)*uM.y*(exp(-pow((m-.99)/.012,2.))*.8+soft*.05);
      // lidar: the ground goes dark under its own points
      float done=smoothstep(.2,1.2,vW.z-uD.z); col=mix(col,base*vec3(.10,.15,.21),uM.z*max(done*.9,.35)); col+=vec3(.55,.85,1.)*uM.z*(exp(-pow(d2.y/.035,2.))*2.2+exp(-pow(d2.y/.5,2.))*.22)*smoothstep(1.35,.7,abs(d2.x)/6.4);
      // Wi-Fi: rings go out, and something under the rubble answers
      float dd=length(vec3(d2.x,vW.y-uD.y,d2.y))-${ALT.toFixed(1)}*.9; float ring=pow(.5+.5*sin(dd*4.2-uT*7.),9.)*exp(-max(dd,0.)*.13); col=mix(col,base*vec3(.46,.58,.78),uM.w*.8); col+=vec3(.36,.66,1.)*ring*uM.w*(.30+.5*sun);
      vec2 bd=vW.xz-uB; float b=length(bd), ech=pow(.5+.5*sin(b*7.-uT*6.),7.)*exp(-b*.62)*smoothstep(.0,.4,b); col+=vec3(1.,.36,.20)*uM.w*smoothstep(9.,4.,length(uD.xz-uB))*(ech*1.1+exp(-b*b*2.6)*(.55+.45*sin(uT*5.2)));
      float sh=exp(-dot(d2,d2)*.9); col*=1.-.38*sh*(1.-uM.y*.6);
      float dist=distance(vW,uCam); col=mix(col,uFog*(1.+.35*smoothstep(0.,40.,dist)),1.-exp(-pow(max(dist-8.,0.)/17.,1.35))); col*=exp(-off*.05);
      gl_FragColor=vec4(col,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }` }));
  sheet.frustumCulled = false; scene.add(sheet);

  // ── the airframe
  const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js'); const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.03).texture; pm.dispose(); scene.environmentIntensity = 1.0;
  const key = new THREE.DirectionalLight(0xffdcb8, 6.5); key.position.set(-5, 4.2, -3.5); const rim = new THREE.DirectionalLight(0xa8cdff, 7); rim.position.set(4, 1.6, 5); const under = new THREE.PointLight(0x9cc8ff, 5, 7, 1.6); scene.add(key, rim, under, key.target, rim.target);
  const bird = new THREE.Group(); bird.scale.setScalar(SCALE); bird.rotation.order = 'YZX'; const parts = buildAirframe(THREE, false), fm = frameMaterial(THREE); fm.envMapIntensity = 1.5;
  const gimbal = new THREE.Group(); gimbal.position.set(0.07, 0.07, 0); gimbal.add(new THREE.Mesh(parts.head, fm)); bird.add(new THREE.Mesh(parts.body, fm), gimbal); scene.add(bird);
  const discU = { uPh: { value: 0 } }, discG = new THREE.CircleGeometry(PROP_R, 64).rotateX(-Math.PI / 2), discM = new THREE.ShaderMaterial({ uniforms: discU, transparent: true, depthWrite: false, side: THREE.DoubleSide, vertexShader: 'varying vec2 vP; void main(){ vP=position.xz/' + PROP_R + '; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }', fragmentShader: 'uniform float uPh; varying vec2 vP; void main(){ float r=length(vP), a=atan(vP.y,vP.x); float b=pow(abs(cos(a+uPh)),14.); float p=smoothstep(.04,.2,r)*(1.-smoothstep(.9,1.,r)); float k=p*(.10+.34*b)+.20*smoothstep(.93,.97,r)*(1.-smoothstep(.975,1.,r)); gl_FragColor=vec4(mix(vec3(.02),vec3(.34,.37,.42),b*r+.25*smoothstep(.9,1.,r)),k); }' });
  const blur = parts.tips.map(([x, z], i) => { const m = new THREE.Mesh(discG, discM); m.position.set(x, PROP_Y + 0.002, z); m.renderOrder = 6; bird.add(m); const b = new THREE.Mesh(i ? parts.blade : (parts.blade = bladeGeometry(THREE)), parts.bm || (parts.bm = new THREE.MeshStandardMaterial({ color: 0x0d0f11, roughness: 0.35, side: THREE.DoubleSide, transparent: true, opacity: 0.28 }))); b.position.set(x, PROP_Y, z); bird.add(b); return b; });
  const glow = (c, s, p) => { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: c, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); m.scale.setScalar(s); m.position.set(...p); bird.add(m); return m; };
  const dc = document.createElement('canvas'); dc.width = dc.height = 64; { const x = dc.getContext('2d'), r = x.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, '#fff'); r.addColorStop(0.18, 'rgba(255,255,255,.75)'); r.addColorStop(0.5, 'rgba(255,255,255,.12)'); r.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = r; x.fillRect(0, 0, 64, 64); }
  const dot = new THREE.CanvasTexture(dc);
  parts.tips.forEach(([x, z]) => glow(z < 0 ? 0xff3b30 : 0x30d987, 0.075, [x, ARM_Y - 0.016, z])); const strobe = glow(0xffffff, 0.3, [-0.1, 0.096, 0]), lens = glow(0x9cc8ff, 0.16, [0.078, 0.036, 0]);

  // ── what comes out of it. Every beam starts at the gimbal and ends on the relief.
  const add = (geo, frag, extra = {}, vert) => { const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: { uT: U.uT, uA: { value: 0 }, uCol: { value: new THREE.Color() }, ...extra }, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, vertexShader: vert || 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }', fragmentShader: HASH + frag })); m.frustumCulled = false; m.renderOrder = 8; scene.add(m); return m; };
  const pyr = new THREE.BufferGeometry(); { const a = [], c = [[-1, -1], [1, -1], [1, 1], [-1, 1]]; for (let i = 0; i < 4; i++) { const p = c[i], q = c[(i + 1) % 4]; a.push(0, 0, 0, p[0], -1, p[1], q[0], -1, q[1]); } pyr.setAttribute('position', new THREE.Float32BufferAttribute(a, 3)); }
  const PYR = `uniform float uT,uA; uniform vec3 uCol; varying vec3 vP; void main(){ float t=clamp(-vP.y,0.,1.); vec2 k=vP.xz/max(t,.002); float other=min(abs(k.x),abs(k.y)), s=abs(k.x)>abs(k.y)?k.y:k.x; float w=fwidth(other)*1.5; float edge=smoothstep(1.-w,1.-w*.3,other); float dash=smoothstep(.35,.5,abs(fract(t*9.-uT*1.1)-.5)*2.); float streak=h1(vec2(floor(s*26.),floor(uT*9.))); float body=(.035+.13*pow(1.-t,2.2))*(.75+.5*streak); float a=body*smoothstep(0.,.05,t)+edge*(.16+.5*dash)*(1.-t*.35); gl_FragColor=vec4(uCol*a*uA,1.); }`;
  const camB = add(pyr, PYR), heatB = add(pyr, PYR); camB.material.uniforms.uCol.value.set(0.42, 0.68, 1); heatB.material.uniforms.uCol.value.set(1, 0.34, 0.13);
  const fanG = new THREE.BufferGeometry(); { const a = [], n = 60; for (let i = 0; i < n; i++) a.push(0, 0, 0, (i / n) * 2 - 1, -1, 0, ((i + 1) / n) * 2 - 1, -1, 0); fanG.setAttribute('position', new THREE.Float32BufferAttribute(a, 3)); }
  const fan = add(fanG, `uniform float uT,uA; uniform vec3 uCol; varying vec3 vP; void main(){ float t=clamp(-vP.y,0.,1.), s=vP.x/max(t,.002); float n=s*84., id=floor(n), f=abs(fract(n)-.5)*2., w=max(fwidth(n)*1.3,.14); float tick=floor(uT*24.); float ray=1.-smoothstep(w*.4,w,f), on=smoothstep(.62,.95,h1(vec2(id,tick))); float pulse=.45+.55*smoothstep(.2,0.,abs(fract(t-h1(vec2(id,tick+5.)))-.5)); float ends=1.-smoothstep(.86,1.,abs(s)); gl_FragColor=vec4(uCol*uA*ends*smoothstep(0.,.1,t)*(.03+.05*t+.55*ray*on*pulse),1.); }`); fan.material.uniforms.uCol.value.set(0.5, 0.83, 1);
  const shellG = new THREE.SphereGeometry(1, 64, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), shells = Array.from({ length: 5 }, (_, i) => { const m = add(shellG, 'uniform float uT,uA,uK; uniform vec3 uCol; varying vec3 vN,vV,vP; void main(){ float f=1.-abs(dot(normalize(vN),normalize(vV))); float lat=abs(fract(vP.y*16.)-.5)*2.; float line=1.-smoothstep(0.,fwidth(vP.y*16.)*2.4,1.-lat); gl_FragColor=vec4(uCol*uA*(pow(f,3.)*.75+line*.10+.02),1.); }', { uK: { value: i } }, 'varying vec3 vN,vV,vP; void main(){ vP=position; vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalMatrix*normal; vV=-mv.xyz; gl_Position=projectionMatrix*mv; }'); m.material.uniforms.uCol.value.set(0.32, 0.62, 1); return m; });
  const PN = 230000, pp = new Float32Array(PN * 3), pr = new Float32Array(PN); { let s = 7; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; for (let i = 0; i < PN; i++) { const x = (rnd() - 0.5) * 12.6, z = -rnd() * GL; pp[i * 3] = x; pp[i * 3 + 1] = ground(x, z) + 0.035; pp[i * 3 + 2] = z; pr[i] = rnd(); } }
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pp, 3)); pg.setAttribute('aR', new THREE.BufferAttribute(pr, 1));
  const cloud = new THREE.Points(pg, new THREE.ShaderMaterial({ uniforms: { uD: U.uD, uM: U.uM, uPx: U.uPx, uScan: U.uScan, uT: U.uT }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexShader: 'attribute float aR; uniform vec3 uD; uniform vec4 uM; uniform vec2 uScan; uniform float uPx,uT; varying vec3 vC; void main(){ vec4 mv=viewMatrix*vec4(position,1.); float back=position.z-uD.z; float vis=smoothstep(0.,.08,back)*step(position.z,uScan.x); float fl=exp(-max(back,0.)*1.15); float k=clamp(position.y/1.7+.5,0.,1.); vec3 c=mix(vec3(.05,.16,.46),mix(vec3(.12,.56,.86),vec3(.86,.97,1.),smoothstep(.5,.95,k)),smoothstep(.1,.6,k)); vC=(c*(1.9+1.5*aR)+vec3(.8,.95,1.)*fl*1.2)*vis*uM.z*exp(-max(back-16.,0.)*.12); gl_Position=projectionMatrix*mv; gl_PointSize=clamp(uPx*(.026+.018*fl)/-mv.z,1.3,5.); if(vis*uM.z<.004) gl_Position=vec4(2.,2.,2.,1.); }', fragmentShader: 'varying vec3 vC; void main(){ float d=length(gl_PointCoord-.5); gl_FragColor=vec4(vC*smoothstep(.5,.2,d),1.); }' })); cloud.frustumCulled = false; cloud.renderOrder = 5; scene.add(cloud);
  const DN = 260, dp = new Float32Array(DN * 3); for (let i = 0; i < DN * 3; i++) { const v = Math.sin(i * 91.7) * 43758.5; dp[i] = v - Math.floor(v); } const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const dust = new THREE.Points(dg, new THREE.ShaderMaterial({ uniforms: { uD: U.uD, uT: U.uT, uPx: U.uPx, uM: U.uM }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexShader: 'uniform vec3 uD; uniform float uT,uPx; varying float vA; void main(){ vec3 b=vec3(16.,9.,22.); vec3 p=mod(position*b+vec3(uT*.22,-uT*.1,0.)-vec3(uD.x,0.,uD.z),b)-b*.5+uD-vec3(0.,1.6,0.); vec4 mv=viewMatrix*vec4(p,1.); vA=smoothstep(.6,3.,-mv.z)*smoothstep(15.,6.,-mv.z); gl_Position=projectionMatrix*mv; gl_PointSize=clamp(uPx*.014/-mv.z,1.,3.2); }', fragmentShader: 'varying float vA; void main(){ float d=length(gl_PointCoord-.5); gl_FragColor=vec4(vec3(.55,.66,.8)*vA*.34*smoothstep(.5,.1,d),1.); }' })); dust.frustumCulled = false; dust.renderOrder = 9; scene.add(dust);

  // ── motion
  let W = 1, Hh = 1, dpr = 1, ratio = 0, T = 0, z = Z0, mode = -1, running = false, raf = 0, last = 0, dead = false, az = POSE[0][0], el = POSE[0][1], dist = POSE[0][2] + 3.5, ua = 0, ue = 0, ta = 0, te = 0, uz = 1, grab = null, idle = 9, bank = 0, pitch = 0, slow = 0, fade = 1, ended = false, readAt = -1; const w = [0, 0, 0, 0], V = new THREE.Vector3(), look = new THREE.Vector3(), eye = new THREE.Vector3();
  function size() { const r = host.getBoundingClientRect(); if (r.width < 8) return; W = r.width; Hh = r.height; dpr = Math.min(window.devicePixelRatio || 1, 1.5); ratio = ratio || dpr; renderer.setPixelRatio(ratio); renderer.setSize(W, Hh, false); ov.width = W * dpr; ov.height = Hh * dpr; cam.aspect = W / Hh; cam.setViewOffset(W, Hh, o.shift ? -W * o.shift : 0, Hh * 0.02, W, Hh); cam.updateProjectionMatrix(); U.uPx.value = Hh * ratio; }
  const ro = new ResizeObserver(() => { size(); if (!running) render(0); }); ro.observe(host);
  function setMode(i, user) { i = (i + 4) % 4; if (user) T = i * MODE_S; if (i === mode) return; mode = i; if (i === 2) U.uScan.value.x = z + 13; onMode?.(i); }
  function reading() { const n = people.filter((p) => p.found >= 0).length, warm = people.some((p) => Math.abs(p.z - z) < HALF[1] && Math.abs(p.x - bird.position.x) < HALF[0]); return [n ? n + (n === 1 ? ' possible person' : ' possible people') : 'Reading', mode === 1 ? (warm ? 'Warm body' : 'Cold ground') : w[1] > 0.1 ? 'Cold ground' : 'Ready', mode === 2 ? Math.round(clamp((U.uScan.value.x - z) / GL) * PN).toLocaleString('en-US') + ' points' : U.uScan.value.x ? 'Mapped' : 'Ready', mode === 3 ? (Math.hypot(bird.position.x - BURIED.x, z - BURIED.z) < 6.5 ? 'Something moves' : 'Listening') : 'Ready']; }
  function step(dt) {
    T += dt; U.uT.value += dt; const span = MODE_S * 4; if (T >= span) { if (onEnd && !ended) { ended = true; onEnd(); } T -= span; }
    setMode(Math.floor(T / MODE_S));
    const k = (T % MODE_S) / MODE_S; onMode?.progress?.(mode, k);
    z -= SPEED * dt; if (z < -GL + 6) { z = Z0; fade = 1; people.forEach((p) => { p.found = -1; }); U.uScan.value.x = Z0; }
    fade = damp(fade, z < -GL + 7.5 ? 1 : 0, 3, dt);
    const x = Math.sin(z * 0.11) * 1.5, vx = Math.cos(z * 0.11) * 0.11 * 1.5 * -SPEED;
    bank = damp(bank, -vx * 0.16, 2, dt); pitch = damp(pitch, -0.10, 2, dt);
    const t = U.uT.value; bird.position.set(x + Math.sin(t * 0.9) * 0.05, ALT + Math.sin(t * 1.5) * 0.05 + Math.sin(t * 2.7) * 0.02, z); bird.rotation.set(bank + Math.sin(t * 2.1) * 0.012, Math.PI / 2 + vx * 0.05, pitch + Math.sin(t * 1.7) * 0.012);
    for (let i = 0; i < 4; i++) w[i] = damp(w[i], i === mode ? 1 : 0, 3.2, dt); U.uM.value.set(...w);
    discU.uPh.value += dt * 11; blur.forEach((b, i) => { b.rotation.y += (i % 2 ? -1 : 1) * dt * 47; });
    const p = t % 1.5; strobe.material.opacity = Math.max(0.04, 1 - Math.abs(p - 0.08) / 0.08, 1 - Math.abs(p - 0.3) / 0.08);
    for (const q of people) if (q.found < 0 && mode <= 1 && q.z - z > -HALF[1] * 0.8 && q.z - z < 1 && Math.abs(q.x - x) < HALF[0] + 0.3) q.found = t;
    idle += dt; if (!grab) { if (idle > 3.5) { ta = damp(ta, 0, 0.9, dt); te = damp(te, 0, 0.9, dt); } } ua = damp(ua, ta, 7, dt); ue = damp(ue, te, 7, dt);
    const P = POSE[mode]; az = damp(az, P[0] + Math.sin(t * 0.17) * 5 + k * 10 * (mode % 2 ? -1 : 1), 0.95, dt); el = damp(el, P[1], 0.95, dt); dist = damp(dist, P[2], 0.9, dt);
  }
  function render(dt) {
    if (W < 8) return; const A = (az + ua) * Math.PI / 180, E = clamp(el + ue, 4, 70) * Math.PI / 180;
    eye.set(bird.position.x + Math.sin(A) * Math.cos(E) * dist * uz, ALT + Math.sin(E) * dist * uz, z + Math.cos(A) * Math.cos(E) * dist * uz); look.set(bird.position.x * 0.8, ALT - 2.35, z - 0.4); cam.position.copy(eye); cam.lookAt(look); U.uCam.value.copy(eye);
    bird.updateMatrixWorld(); gimbal.getWorldPosition(V); V.y -= 0.1 * SCALE * 0.3; const gx = V.x, gy = V.y, gz = V.z; U.uD.value.set(gx, gy, gz);
    for (const [m, i] of [[camB, 0], [heatB, 1]]) { m.position.set(gx, gy, gz); m.scale.set(HALF[0] * (gy + 1.2) / gy, gy + 1.2, HALF[1] * (gy + 1.2) / gy); m.material.uniforms.uA.value = w[i]; m.visible = w[i] > 0.01; }
    fan.position.set(gx, gy, gz); fan.scale.set(6.6 * (gy + 1.2) / gy, gy + 1.2, 1); fan.material.uniforms.uA.value = w[2]; fan.visible = w[2] > 0.01;
    shells.forEach((m, i) => { const r = (U.uT.value * 0.2 + i / 5) % 1; m.position.set(gx, gy, gz); m.scale.setScalar(0.5 + r * 9.4); m.material.uniforms.uA.value = w[3] * Math.pow(1 - r, 1.1) * ss(0, 0.06, r); m.visible = w[3] > 0.01; });
    lens.material.color.setRGB(lerp(0.6, 1, w[1]), lerp(0.8, 0.45, w[1]), lerp(1, 0.25, w[1])); under.color.copy(lens.material.color); under.position.set(gx, gy - 0.5, gz); key.target.position.copy(bird.position); key.position.set(bird.position.x - 5, ALT + 4.2, z - 3.5); rim.target.position.copy(bird.position); rim.position.set(bird.position.x + 4, ALT + 1.6, z + 5);
    renderer.render(scene, cam); overlay();
  }
  const pt = (x, y, zz) => { V.set(x, y, zz).project(cam); return [(V.x * 0.5 + 0.5) * W, (-V.y * 0.5 + 0.5) * Hh, V.z < 1]; };
  function overlay() {
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, Hh); const t = U.uT.value;
    g.lineWidth = 1.5; g.lineJoin = 'miter';
    for (const q of people) { if (q.found < 0) continue; const a = ss(0, 0.35, t - q.found) * ss(13, 7, z - q.z > 0 ? 0 : q.z - z) * (1 - w[3]); if (a < 0.02) continue; const y = ground(q.x, q.z) + 0.12, c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => pt(q.x + i * q.w, y, q.z + j * q.d)); if (!c.every((v) => v[2])) continue;
      g.globalAlpha = a; g.strokeStyle = C.person; g.beginPath(); for (let i = 0; i < 4; i++) { const p0 = c[i], p1 = c[(i + 1) % 4], p2 = c[(i + 3) % 4]; g.moveTo(lerp(p0[0], p2[0], 0.28), lerp(p0[1], p2[1], 0.28)); g.lineTo(p0[0], p0[1]); g.lineTo(lerp(p0[0], p1[0], 0.28), lerp(p0[1], p1[1], 0.28)); } g.stroke();
      const top = pt(q.x, y + 1.5, q.z), ft = pt(q.x, y, q.z); g.globalAlpha = a * 0.7; g.beginPath(); g.moveTo(ft[0], ft[1]); g.lineTo(top[0], top[1]); g.stroke(); g.globalAlpha = a; g.font = '600 13px ' + C.font; const s = 'Possible person', tw = g.measureText(s).width; g.fillStyle = 'rgba(6,8,10,.82)'; g.fillRect(top[0] - tw / 2 - 9, top[1] - 24, tw + 18, 24); g.fillStyle = C.person; g.fillRect(top[0] - tw / 2 - 9, top[1] - 24, 2, 24); g.fillStyle = C.text; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, top[0], top[1] - 11.5); }
    const near = ss(7, 4, Math.hypot(bird.position.x - BURIED.x, z - BURIED.z)) * w[3]; if (near > 0.02) { const p = pt(BURIED.x, ground(BURIED.x, BURIED.z) + 0.1, BURIED.z), q = pt(BURIED.x, ground(BURIED.x, BURIED.z) + 1.7, BURIED.z); if (p[2]) { g.globalAlpha = near; g.strokeStyle = C.person; g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke(); g.font = '600 13px ' + C.font; const s = 'Something moves under here', tw = g.measureText(s).width; g.fillStyle = 'rgba(6,8,10,.82)'; g.fillRect(q[0] - tw / 2 - 9, q[1] - 24, tw + 18, 24); g.fillStyle = C.person; g.fillRect(q[0] - tw / 2 - 9, q[1] - 24, 2, 24); g.fillStyle = C.text; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, q[0], q[1] - 11.5); } }
    // one leader line: the sensor that is working
    const spot = [[0.078, 0.04, 0], [0.078, 0.06, 0.02], [0, 0.15, 0.02], [-0.148, 0.222, 0.05]]; for (let i = 0; i < 4; i++) if (w[i] > 0.05) { V.set(...spot[i]).applyMatrix4(bird.matrixWorld).project(cam); const x = (V.x * 0.5 + 0.5) * W, y = (-V.y * 0.5 + 0.5) * Hh, dir = POSE[i][0] < 0 ? 1 : -1, ex = x + dir * 250, ey = Math.max(34, y - 88); g.globalAlpha = w[i] * ss(0.3, 0.9, T % MODE_S + (i === mode ? 0 : 1)); g.strokeStyle = 'rgba(236,238,241,.55)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + dir * 120, ey); g.lineTo(ex, ey); g.stroke(); g.fillStyle = C.text; g.beginPath(); g.arc(x, y, 2.6, 0, 7); g.fill(); g.font = '500 15px ' + C.font; g.textAlign = dir > 0 ? 'left' : 'right'; g.textBaseline = 'middle'; g.fillText(SENSORS[i].name, ex + dir * 10, ey); }
    if (fade > 0.01) { g.globalAlpha = clamp(fade); g.fillStyle = '#06080a'; g.fillRect(0, 0, W, Hh); } g.globalAlpha = 1;
    if (Math.abs(t - readAt) > 0.2) { readAt = t; onRead?.(reading()); }
  }
  function frame(now) { if (!running) return; raf = requestAnimationFrame(frame); const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now; step(dt); render(dt); slow = dt > 0.024 ? slow + 1 : Math.max(0, slow - 0.5); if (slow > 45 && ratio > 0.7) { ratio = Math.max(0.7, ratio * 0.8); slow = 0; size(); } }
  ov.addEventListener('pointerdown', (e) => { if (e.button) return; ov.setPointerCapture(e.pointerId); grab = { x: e.clientX, y: e.clientY, a: ta, e: te }; });
  ov.addEventListener('pointermove', (e) => { if (!grab) return; idle = 0; ta = grab.a - (e.clientX - grab.x) * 0.28; te = clamp(grab.e + (e.clientY - grab.y) * 0.2, -14, 44); }); const drop = () => { grab = null; idle = 0; }; ov.addEventListener('pointerup', drop); ov.addEventListener('pointercancel', drop);
  size(); step(0.016);
  return {
    start() { if (running || dead) return; if (reduced) { z = -9; mode = -1; setMode(0); w[0] = 1; U.uM.value.set(1, 0, 0, 0); for (let i = 0; i < 90; i++) step(0.016); fade = 0; size(); render(0); return; } running = true; last = 0; raf = requestAnimationFrame(frame); },
    stop() { running = false; cancelAnimationFrame(raf); }, restart() { T = 0; z = Z0; mode = -1; ended = false; fade = 1; dist = POSE[0][2] + 3.5; people.forEach((p) => { p.found = -1; }); },
    go: (i) => setMode(i, true), get mode() { return mode; }, recolour, seek(x) { z = Z0 - SPEED * x; T = x % (MODE_S * 4); },
    dispose() { dead = true; running = false; cancelAnimationFrame(raf); ro.disconnect(); scene.traverse((m) => { m.geometry?.dispose?.(); m.material?.dispose?.(); }); photoT.dispose(); hgtT.dispose(); dot.dispose(); scene.environment?.dispose?.(); renderer.dispose(); renderer.forceContextLoss(); gl.remove(); ov.remove(); },
  };
}
