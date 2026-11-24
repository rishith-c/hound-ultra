// The proof wall: one strip of light per self-test, one lamp per check, and the 30 Wi-Fi windows of the parity test as
// thirty panes of glass. Nothing on it is decoration: every lamp is one check that ran on this computer, at the moment
// it was reported (tests finish faster than an eye can follow, so each strip fills over a second or two).
// A concrete wall, a wet floor and the rover in front of it, lit only by the lamps.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { SUITE, GROUPS } from './suite.js';

const W = 24, H = 7.4, XL0 = 11.35, XL1 = 23.1, PITCH = 0.166, GAP = 0.3, TOP = 6.72;
const TX0 = 0.95, TY0 = 0.62, TW = 2.02, TH = 0.615, CELLS = 1024;
const ORDER = GROUPS.flatMap((g) => SUITE.filter((t) => t.group === g.id)), ROWS = ORDER.length;
export const rowOf = (id) => ORDER.findIndex((t) => t.id === id);
const groups = []; { let y = TOP, start = 0; for (const g of GROUPS) { const n = SUITE.filter((t) => t.group === g.id).length; groups.push({ y, n, start, title: g.title }); y -= n * PITCH + GAP; start += n; } }
const lin = (hex) => new THREE.Color(hex);
const ease = (t) => t * t * t * (t * (t * 6 - 15) + 10);

const COMMON = [
  '#define ROWS ' + ROWS, 'precision highp float;',
  'uniform sampler2D tState, tTiles; uniform float uT; uniform float uCount[ROWS]; uniform float uRun[ROWS]; uniform vec4 uGroup[4]; uniform vec3 cOk, cBad, cLim;',
  'const float XL0=' + XL0.toFixed(3) + ', XL1=' + XL1.toFixed(3) + ', PITCH=' + PITCH.toFixed(4) + ', TX0=' + TX0 + ', TY0=' + TY0 + ', TW=' + TW + ', TH=' + TH + ';',
  'vec3 lampColour(float s){ return s<1.5?cOk:(s<2.5?cBad:cLim); }',
  // strips of lamps
  'vec3 strips(vec2 p, float px){',
  '  if(p.x<XL0||p.x>XL1) return vec3(0.); float fy=9.; int r=-1;',
  '  for(int g=0;g<4;g++){ float q=(uGroup[g].x-p.y)/PITCH; if(q>=0.&&q<uGroup[g].y){ float k=floor(q); r=int(uGroup[g].z+k); fy=(q-k-.5)*PITCH; } }',
  '  if(r<0) return vec3(0.);',
  '  float hw=.019, cov=clamp((hw-abs(fy))/px+.5,0.,1.); if(cov<=0.) return vec3(0.);',
  '  float u=(p.x-XL0)/(XL1-XL0), n=uCount[r]; vec3 glass=vec3(.0035,.0045,.005);',
  '  if(n<.5){ float run=uRun[r]; if(run<.0001) return glass*cov; float ph=fract((uT-run)*.55)*1.3-.15; float d=u-ph; return cov*(glass+vec3(.5,.72,1.)*(exp(-max(-d,0.)*18.)*step(d,0.)*.9+exp(-abs(d)*220.)*2.2)); }',
  '  float un=u*n, i=floor(un), f=fract(un), cell=(XL1-XL0)/n; float gap=min(cell*.24,.034); float e=min(f,1.-f)*cell; float seg=mix(clamp((e-gap*.5)/px+.5,0.,1.),1.-gap/cell,smoothstep(.35,1.,px/cell));',
  '  vec2 s=texelFetch(tState,ivec2(int(min(i,1023.)),r),0).rg; float age=uT-s.g; if(s.r<.5||age<0.) return glass*cov*seg;',
  '  vec3 c=lampColour(s.r); float fl=exp(-age*4.2); vec3 on=mix(c,vec3(1.),.16)*(s.r>1.5?1.75:.92); return cov*seg*(on+mix(c,vec3(1.),.75)*fl*3.6);',
  '}',
  // thirty panes: the Wi-Fi windows themselves, 52 rows by 200 samples each
  'vec3 panes(vec2 p, float px){',
  '  vec2 q=(p-vec2(TX0,TY0))/vec2(TW,TH); if(q.x<0.||q.y<0.||q.x>=3.||q.y>=10.) return vec3(0.); vec2 id=floor(q), f=q-id; float k=(9.-id.y)*3.+id.x;',
  '  vec2 m=vec2(f.x*TW,f.y*TH), sz=vec2(TW,TH); vec2 d=min(m-.045,sz-.045-m); float e=min(d.x,d.y); float inside=clamp(e/px+.5,0.,1.); if(inside<=0.) return vec3(0.);',
  '  vec2 uv=clamp((m-.045)/(sz-.09),0.,1.); vec2 s=texelFetch(tState,ivec2(int(k),0),0).rg; float n=uCount[0], age=(n>.5)?uT-s.g:-1.;',
  '  vec3 off=vec3(.0028,.0036,.0042); if(age<0.) return off*inside;',
  '  float wipe=age*1.15; float rev=smoothstep(wipe,wipe-.06,uv.x); float v=textureGrad(tTiles,vec2((id.x+uv.x)/3.,1.-((9.-id.y)+1.-uv.y)/10.),vec2(px/TW/3.,0.),vec2(0.,px/TH/10.)).r;',
  '  float x=smoothstep(.28,.82,v); vec3 ramp=mix(vec3(.006,.012,.02),vec3(.07,.17,.26),smoothstep(0.,.55,x)); ramp=mix(ramp,vec3(.55,.86,1.),smoothstep(.55,1.,x));',
  '  float settle=smoothstep(1.,2.2,age); vec3 c=lampColour(s.r); vec3 col=ramp*mix(1.5,1.,settle); col=mix(col,ramp*(c*1.7+.25),settle*.5);',
  '  float frame=1.-smoothstep(.012,.012+px,e); col=mix(col,c*1.15*smoothstep(.5,1.4,age)+vec3(.02),frame*.85);',
  '  float head=exp(-abs(uv.x-wipe)*60.)*step(wipe,1.1); return inside*(mix(off,col,max(rev,frame))+vec3(.75,.9,1.)*head*2.6);',
  '}',
  'vec3 emitAt(vec2 p,float px){ return strips(p,px)+panes(p,px); }',
].join('\n');

const NOISE = 'float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);} float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);} float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*vn(p);p=p*2.03+7.1;a*=.5;}return s;}';

export async function createWall(host, { nn, ctx, css, reduced = () => false, onFps }) {
  const canvas = document.createElement('canvas'); canvas.className = 'status-wall-canvas'; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'The proof wall: one strip of light for each self-test, one lamp for each check, and thirty Wi-Fi windows compared with Python.'); host.append(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.NoToneMapping; renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.shadowMap.enabled = false;
  RectAreaLightUniformsLib.init();
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x010203);
  const camera = new THREE.PerspectiveCamera(30, 1.8, 0.1, 200);

  // ---------- data textures ----------
  const state = new Float32Array(CELLS * ROWS * 2), tState = new THREE.DataTexture(state, CELLS, ROWS, THREE.RGFormat, THREE.FloatType); tState.needsUpdate = true;
  const tiles = new Uint8Array(600 * 520);
  nn.samples.forEach((s, k) => { const cx = (k % 3) * 200, cy = (9 - Math.floor(k / 3)) * 52; for (let r = 0; r < 52; r++) for (let c = 0; c < 200; c++) tiles[(cy + r) * 600 + cx + c] = Math.max(0, Math.min(255, 128 + s.x[51 - r][c] * 52)); });
  const tTiles = new THREE.DataTexture(tiles, 600, 520, THREE.RedFormat, THREE.UnsignedByteType); tTiles.magFilter = THREE.LinearFilter; tTiles.minFilter = THREE.LinearMipmapLinearFilter; tTiles.generateMipmaps = true; tTiles.anisotropy = 8; tTiles.needsUpdate = true;
  const label = document.createElement('canvas'); label.width = 2048; label.height = 2048; const tLabel = new THREE.CanvasTexture(label); tLabel.anisotropy = 16; tLabel.colorSpace = THREE.NoColorSpace; tLabel.generateMipmaps = true; tLabel.minFilter = THREE.LinearMipmapLinearFilter;
  const LX0 = 7.35, LX1 = 11.25; // the label field, in wall metres; the texture covers it from floor to TOP + 0.5
  function drawLabels(done) {
    const c = label.getContext('2d'), sx = 2048 / (LX1 - LX0), sy = 2048 / H; c.fillStyle = '#000'; c.fillRect(0, 0, 2048, 2048); c.textAlign = 'right'; c.textBaseline = 'middle';
    for (const g of groups) { c.save(); c.translate(2048, (H - g.y - 0.0) * sy - 0.11 * sy); c.scale(sx / sy, 1); c.fillStyle = '#fff'; c.font = '400 46px ' + css('--font-display'); c.fillText(g.title, -0.06 * sy, 0); c.restore(); }
    ORDER.forEach((t, r) => { const g = groups.find((q) => r >= q.start && r < q.start + q.n), y = g.y - (r - g.start + 0.5) * PITCH, d = done?.get(t.id); c.save(); c.translate(2048, (H - y) * sy); c.scale(sx / sy, 1); c.fillStyle = d ? (d.state === 'fail' ? 'rgb(255,0,0)' : 'rgb(150,150,150)') : 'rgb(78,78,78)'; c.font = '500 31px ' + css('--font'); c.fillText(t.title, -0.09 * sy, 1); c.restore(); });
    tLabel.needsUpdate = true;
  }
  drawLabels();
  const tex = new THREE.TextureLoader(), conc = tex.load(new URL('../../../assets/img/gen/tex-concrete.jpg', import.meta.url).href); conc.wrapS = conc.wrapT = THREE.MirroredRepeatWrapping; conc.anisotropy = 16;

  const U = { tState: { value: tState }, tTiles: { value: tTiles }, tLabel: { value: tLabel }, tConc: { value: conc }, tEmit: { value: null }, uT: { value: 0 }, uCount: { value: new Array(ROWS).fill(0) }, uRun: { value: new Array(ROWS).fill(0) }, uGroup: { value: groups.map((g) => new THREE.Vector4(g.y, g.n, g.start, 0)) }, cOk: { value: lin('#41d6a0') }, cBad: { value: lin('#ff4d5e') }, cLim: { value: lin('#ffb224') }, uCam: { value: new THREE.Vector3() }, uRover: { value: new THREE.Vector3() }, uLift: { value: 0 } };
  const colours = () => { for (const [u, v] of [['cOk', '--ok'], ['cBad', '--danger'], ['cLim', '--warn']]) { const x = css(v); if (/^#[0-9a-f]{6}$/i.test(x)) U[u].value.set(x); } };
  colours();

  // ---------- the lamps, seen square on: what lights the concrete, the floor and the air ----------
  const EX0 = -4, EX1 = 28, EY0 = -2, EY1 = 10, emitRT = new THREE.WebGLRenderTarget(1024, 384, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, depthBuffer: false });
  const emitMat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: U, vertexShader: 'out vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }', fragmentShader: COMMON + '\nin vec2 vUv; out vec4 o; void main(){ vec2 p=vec2(mix(' + EX0.toFixed(1) + ',' + EX1.toFixed(1) + ',vUv.x),mix(' + EY0.toFixed(1) + ',' + EY1.toFixed(1) + ',vUv.y)); o=vec4(emitAt(p,.034),1.); }' });
  const emitScene = new THREE.Scene(), emitCam = new THREE.Camera(); emitScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), emitMat)); U.tEmit.value = emitRT.texture;
  const LIGHT = 'uniform sampler2D tEmit; vec2 euv(vec2 p){ return (p-vec2(' + EX0.toFixed(1) + ',' + EY0.toFixed(1) + '))/vec2(' + (EX1 - EX0).toFixed(1) + ',' + (EY1 - EY0).toFixed(1) + '); }\n'
    + 'vec3 blur(vec2 p,float l){ vec2 u=euv(p), s=exp2(l)/vec2(1024.,384.)*.75; vec3 c=textureLod(tEmit,u,l).rgb*.28; for(int i=0;i<6;i++){ float a=float(i)*1.0472+.4; c+=textureLod(tEmit,u+s*vec2(cos(a),sin(a)),l).rgb*.12; } return c; }';

  const wallMat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: U,
    vertexShader: 'out vec2 vP; void main(){ vP=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: COMMON + '\n' + LIGHT + '\n' + NOISE + '\nuniform sampler2D tConc,tLabel; uniform vec3 uCam; uniform float uLift; in vec2 vP; out vec4 o;\n'
      + 'void main(){ vec2 p=vP; float px=max(fwidth(p.x),fwidth(p.y))*.8;'
      + 'vec2 pn=vec2(4.,2.4667), q=p/pn, cell=floor(q), f=(q-cell)*pn; vec2 jd=min(f,pn-f); float jit=h21(cell+3.7);'
      + 'vec2 cuv=p*.17+cell*vec2(.37,.61); vec3 tx=texture(tConc,cuv).rgb; float lum=dot(tx,vec3(.3,.59,.11));'
      + 'vec2 dt=vec2(.0035,0.); float lx=dot(texture(tConc,cuv+dt.xy).rgb,vec3(.333))-dot(texture(tConc,cuv-dt.xy).rgb,vec3(.333)), ly=dot(texture(tConc,cuv+dt.yx).rgb,vec3(.333))-dot(texture(tConc,cuv-dt.yx).rgb,vec3(.333)); vec2 bump=-vec2(lx,ly)*3.2;'
      + 'float joint=min(jd.x,jd.y); float groove=smoothstep(.022,.008,joint); bump+=(jd.x<jd.y?vec2(sign(f.x-pn.x*.5),0.):vec2(0.,sign(f.y-pn.y*.5)))*smoothstep(.045,.018,joint)*(1.-groove)*.9;'
      + 'vec2 hp=abs(f-pn*.5)-pn*.5+.32; float hd=length(hp); float hole=smoothstep(.062,.05,hd); bump+=normalize(hp+1e-4)*smoothstep(.085,.062,hd)*(1.-hole)*-sign(f-pn*.5)*.8;'
      + 'float stain=fbm(vec2(p.x*1.6,p.y*.22)+9.)*.6+fbm(p*.45)*.6; vec3 alb=mix(vec3(lum),tx,.4)*mix(.78,1.12,jit)*mix(.62,1.12,stain); alb=pow(alb,vec3(1.5))*.95; alb*=1.-groove*.85; alb*=1.-hole*.9;'
      // the slot each strip sits in, and the pane frames
      + 'float slot=0.,lip=0.; if(p.x>XL0-.06&&p.x<XL1+.06) for(int g=0;g<4;g++){ float y=(uGroup[g].x-p.y)/PITCH; if(y>=0.&&y<uGroup[g].y){ float d=abs(fract(y)-.5)*PITCH; slot=smoothstep(.041+px,.041-px,d); lip=smoothstep(.06,.043,d)*(1.-slot);} }'
      + 'vec2 tq=(p-vec2(TX0,TY0)); if(tq.x>-.05&&tq.y>-.05&&tq.x<3.*TW+.05&&tq.y<10.*TH+.05){ vec2 m=mod(max(tq,0.),vec2(TW,TH)); vec2 dd=min(m,vec2(TW,TH)-m); float e=min(dd.x,dd.y); float fr=smoothstep(.052,.04,e); slot=max(slot,step(.04,e)*.96); alb=mix(alb,vec3(.018,.02,.022),fr); lip=max(lip,fr*.35); }'
      + 'alb*=1.-slot*.965;'
      + 'vec3 e1=blur(p,1.6),e2=blur(p,2.8),e3=blur(p,4.),e4=blur(p,5.2),e5=blur(p,6.4); vec3 E=e1*.55+e2*.9+e3*1.25+e4*1.5+e5*1.6;'
      + 'float d=.22; vec3 gx=blur(p+vec2(d,0.),3.2)-blur(p-vec2(d,0.),3.2), gy=blur(p+vec2(0.,d),3.2)-blur(p-vec2(0.,d),3.2); vec3 rel=gx*bump.x+gy*bump.y;'
      + 'vec3 col=alb*(E*1.25+rel*2.4); col+=alb*lip*(e1*3.5+e2*1.2);'
      + 'float up=exp(-max(7.4-p.y,0.)*.55); float graze=1.+bump.y*1.4; vec3 wash=vec3(.36,.5,.66)*(up*.2+.014+uLift*.012)*graze; col+=alb*wash;'
      + 'col*=mix(.35,1.,smoothstep(0.,.5,p.y)); col+=alb*smoothstep(.36,.3,p.y)*smoothstep(.0,.06,p.y)*.0;'
      + 'vec2 lu=vec2((p.x-' + LX0 + ')/' + (LX1 - LX0).toFixed(3) + ',p.y/' + H.toFixed(2) + '); if(lu.x>0.&&lu.x<1.&&lu.y<1.){ vec4 t=texture(tLabel,lu); float red=step(t.g+.08,t.r); vec3 ink=mix(vec3(t.r),vec3(1.,.14,.16)*t.r,red); col+=ink*(vec3(.21,.23,.25)+E*.08); }'
      + 'col+=emitAt(p,px)*1.55; col+=e5*.035+e4*.02; o=vec4(col,1.); }' });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(W + 60, H).translate(W / 2, H / 2, 0), wallMat); scene.add(wall);

  // ---------- floor: wet, polished, reflecting the wall ----------
  const floorMat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: U, transparent: true, depthWrite: false,
    vertexShader: 'out vec3 vP; void main(){ vec4 w=modelMatrix*vec4(position,1.); vP=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }',
    fragmentShader: COMMON + '\n' + LIGHT + '\n' + NOISE + '\nuniform sampler2D tConc; uniform vec3 uCam,uRover; uniform float uLift; in vec3 vP; out vec4 o;\n'
      + 'void main(){ vec3 V=normalize(vP-uCam); vec2 g=vP.xz; float wet=smoothstep(.42,.68,fbm(g*.33+2.)+.12*fbm(g*2.1)); float ft=dot(texture(tConc,g*.13).rgb,vec3(.333));'
      + 'vec2 slab=abs(fract(g/vec2(6.,5.))-.5)*vec2(6.,5.); float jn=smoothstep(2.984,2.992,slab.x)+smoothstep(2.484,2.492,slab.y); jn=clamp(jn,0.,1.);'
      + 'vec2 nz=(vec2(vn(g*9.),vn(g*9.+31.))-.5)*mix(.05,.008,wet)+(vec2(fbm(g*2.3),fbm(g*2.3+17.))-.5)*.02; vec3 N=normalize(vec3(nz.x,1.,nz.y)); vec3 R=reflect(V,N);'
      + 'float t=-vP.z/min(R.z,-.02); vec3 hit=vP+R*t; float rough=mix(.5,.12,wet)+ft*.16; float lod=clamp(log2(1.+t*rough*7.),.4,6.2); float onw=smoothstep(8.6,7.2,hit.y);'
      + 'vec3 refl=(blur(hit.xy,lod)*1.75+blur(vec2(hit.x,hit.y*.9),min(lod+1.7,6.5))*.75+blur(hit.xy,6.2)*.12)*onw; refl+=vec3(.36,.5,.66)*.012*exp(-max(7.4-hit.y,0.)*.55)*onw;'
      + 'float fr=.045+.955*pow(1.-max(dot(-V,N),0.),5.); float k=mix(fr*1.5+.05,fr*3.+.16,wet); vec3 near=blur(vec2(vP.x,1.2),6.); vec3 alb=vec3(pow(ft,1.6))*.5*mix(1.,.45,wet); vec3 col=alb*(near*1.5/(1.+vP.z*.22)+vec3(.36,.5,.66)*(.006+uLift*.006)); col+=refl*k; col*=1.-jn*.75;'
      + 'vec2 rd=(g-uRover.xy)/vec2(1.55,1.2); float occ=exp(-dot(rd,rd)*1.15); col*=1.-occ*.9; col*=mix(.4,1.,smoothstep(0.,.6,vP.z));'
      + 'float far=smoothstep(34.,14.,vP.z); o=vec4(col*far,mix(.985,.8,clamp(wet*.8+fr,0.,1.))); }' });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W + 60, 40).rotateX(-Math.PI / 2).translate(W / 2, 0, 20), floorMat); floor.renderOrder = 2; scene.add(floor);
  const under = new THREE.Mesh(new THREE.PlaneGeometry(W + 60, H).translate(W / 2, -H / 2, -0.01), new THREE.MeshBasicMaterial({ color: 0x000000 })); scene.add(under);

  // ---------- the rover, from the twin ----------
  const POS = new THREE.Vector3(19.4, 0, 5.6), roverRoot = new THREE.Group(), mirror = new THREE.Group(); roverRoot.position.copy(POS); roverRoot.scale.setScalar(2.35); mirror.position.copy(POS); mirror.scale.set(2.35, -2.35, 2.35); scene.add(roverRoot, mirror); U.uRover.value.set(POS.x, POS.z, 0);
  const fake = { hold: false, faults: {}, phase: 'search', units: { 'HOUND-01': { id: 'HOUND-01', pos: [0, 0], heading: 2.42, mode: 'idle', v: 0, odo: 0, battery: 1, link: 1 } } }, actors = [];
  import('../../twin/actors/rover.js').then((m) => {
    for (const g of [roverRoot, mirror]) {
      const none = () => {}, lab = new Proxy({}, { get: () => none });
      const a = m.default.create({ THREE, scene: g, camera, renderer, ctx, world: ctx.world, quality: g === mirror ? 'low' : 'high', reduced: true, v3: (p, h = 0) => new THREE.Vector3(p[0], h, -p[1]), pickable: none, label: () => lab, glow: none, groundY: 0, addUpdate: none });
      try { a.update(fake, 0, 0); } catch { /* the drawing is optional */ }
      for (const c of g.children) if (c.name !== 'HOUND-01') c.visible = false;
      actors.push(a);
    }
    g0();
  }).catch(() => { U.uRover.value.set(-99, -99, 0); });
  const g0 = () => scene.traverse((o) => { if (o.isSpotLight) o.visible = false; });
  const areas = [[TX0 + TW * 1.5, 3.7, TW * 3, 6], [XL0 + 3, 3.7, 6, 6], [XL0 + 8.9, 3.7, 6, 6]].map(([x, y, w, h]) => { const l = new THREE.RectAreaLight(0xffffff, 0, w, h); l.position.set(x, y, 0.02); l.lookAt(x, y, 10); scene.add(l); return l; });
  const sky = new THREE.RectAreaLight(0xbcd4ea, 1.6, 9, 1.2); sky.position.set(21, 8.4, 9.5); sky.lookAt(19.4, 0.4, 5.6); scene.add(sky, new THREE.AmbientLight(0x8fa6bd, 0.05));

  // ---------- dust in the light ----------
  const ND = 420, dp = new Float32Array(ND * 3), ds = new Float32Array(ND); for (let i = 0; i < ND; i++) { dp[i * 3] = -3 + Math.random() * 30; dp[i * 3 + 1] = Math.random() * 7; dp[i * 3 + 2] = 0.4 + Math.random() * 11; ds[i] = Math.random(); }
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dp, 3)); dg.setAttribute('seed', new THREE.BufferAttribute(ds, 1));
  const dustMat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: { ...U, uPx: { value: 1000 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: LIGHT + '\nin float seed; uniform float uT,uPx; out vec3 vC; void main(){ vec3 p=position; p.y=mod(p.y+uT*(.02+.05*seed),7.); p.x+=sin(uT*.21+seed*40.)*.35; p.z+=cos(uT*.17+seed*70.)*.3; vC=textureLod(tEmit,euv(p.xy),5.).rgb*1.6/(1.+p.z*.35)+vec3(.004,.006,.008); vec4 m=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*m; gl_PointSize=uPx*(.006+.014*seed*seed)/-m.z; }',
    fragmentShader: 'precision highp float; in vec3 vC; out vec4 o; void main(){ float d=length(gl_PointCoord-.5); o=vec4(vC*smoothstep(.5,.05,d)*.55,1.); }' });
  const dust = new THREE.Points(dg, dustMat); dust.frustumCulled = false; dust.renderOrder = 4; scene.add(dust);

  // ---------- film ----------
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 }), composer = new EffectComposer(renderer, rt); composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.42, 0.62, 0.55); composer.addPass(bloom);
  const film = new ShaderPass(new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, uT: { value: 0 }, uExp: { value: 1.22 } }, vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }',
    fragmentShader: 'varying vec2 vUv; uniform sampler2D tDiffuse; uniform float uT,uExp; float h(vec2 p){ p=fract(p*vec2(443.897,441.423)); p+=dot(p,p.yx+19.19); return fract((p.x+p.y)*p.x); }'
      + 'vec3 aces(vec3 v){ v=mat3(.59719,.076,.0284,.35458,.90834,.13383,.04823,.01566,.83777)*v; vec3 a=v*(v+.0245786)-.000090537, b=v*(.983729*v+.432951)+.238081; return clamp(mat3(1.60475,-.10208,-.00327,-.53108,1.10813,-.07276,-.07367,-.00605,1.07602)*(a/b),0.,1.); }'
      + 'void main(){ vec2 d=vUv-.5; float r=dot(d,d); vec2 ca=d*r*.0035; vec3 c=vec3(texture2D(tDiffuse,vUv+ca).r,texture2D(tDiffuse,vUv).g,texture2D(tDiffuse,vUv-ca).b); c*=1.-r*.75; c=aces(c*uExp); c=mix(c*12.92,1.055*pow(max(c,1e-5),vec3(1./2.4))-.055,step(.0031308,c)); c+=(h(vUv*vec2(1731.,977.)+fract(uT)*17.)-.5)*.018*(1.-.5*dot(c,vec3(.333))); gl_FragColor=vec4(c,1.); }' })); composer.addPass(film);

  // ---------- story ----------
  // Camera keys: [seconds, x, y, z, look x, look y, fov]. It reads the panes, travels along the strips, then steps back.
  const KEYS = [[0, 3.3, 2.5, 9.2, 4.5, 3.2, 30], [5.5, 5.4, 2.3, 9.6, 6.8, 3.15, 30], [13, 13.6, 1.75, 10.4, 15.6, 3.05, 31], [20, 13.4, 1.5, 19.6, 12.6, 2.9, 31], [60, 11.2, 1.55, 20.6, 12.2, 2.95, 31]];
  const still = KEYS[3], cur = { x: 0, y: 0, z: 0, lx: 0, ly: 0, f: 30 };
  function pose(t) {
    if (t > KEYS[4][0]) { const u = (t - 60) / 40; t = 40 + 20 * Math.cos(u * Math.PI); }   // then drift, back and forth
    let i = 0; while (i < KEYS.length - 2 && t > KEYS[i + 1][0]) i++;
    const a = KEYS[i], b = KEYS[i + 1], prev = KEYS[Math.max(0, i - 1)], next = KEYS[Math.min(KEYS.length - 1, i + 2)], u = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0]))), s = i === KEYS.length - 2 ? ease(u) : u;
    for (let k = 1; k < 7; k++) { // monotone-in-time cubic through the keys
      const m0 = i === 0 ? 0 : ((b[k] - prev[k]) / (b[0] - prev[0])) * (b[0] - a[0]), m1 = i >= KEYS.length - 3 ? 0 : ((next[k] - a[k]) / (next[0] - a[0])) * (b[0] - a[0]), s2 = s * s, s3 = s2 * s;
      const v = i === KEYS.length - 2 ? a[k] + (b[k] - a[k]) * s : (2 * s3 - 3 * s2 + 1) * a[k] + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * b[k] + (s3 - s2) * m1;
      cur['xyz'[k - 1] || ['lx', 'ly', 'f'][k - 4]] = v;
    }
  }
  let T = 0, story = 0, raf = 0, last = 0, on = false, pr = Math.min(1.5, window.devicePixelRatio || 1), slow = 0, fast = 0, stopAt = Infinity, ox = 0, oy = 0, tx = 0, ty = 0, w = 1, h = 1, nextFree = 0, labelDirty = 0;
  const done = new Map(), tmp = new THREE.Color(), ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function size() { const r = host.getBoundingClientRect(); w = Math.max(2, Math.round(r.width)); h = Math.max(2, Math.round(r.height)); renderer.setPixelRatio(pr); renderer.setSize(w, h, false); composer.setPixelRatio(pr); composer.setSize(w, h); bloom.setSize(w * pr * 0.5, h * pr * 0.5); camera.aspect = w / h; camera.updateProjectionMatrix(); dustMat.uniforms.uPx.value = h * pr * 2; }
  const ro = new ResizeObserver(() => { size(); if (!on) draw(); }); ro.observe(host); size();
  const onMove = (e) => { const r = host.getBoundingClientRect(); tx = ((e.clientX - r.left) / r.width - 0.5) * 2; ty = ((e.clientY - r.top) / r.height - 0.5) * 2; };
  host.addEventListener('pointermove', onMove);

  function lampsLit() { // how much of each third of the wall is lit, for the light that falls on the rover
    const z = [0, 0, 0]; let n = 0, bad = 0, lim = 0, all = 0;
    for (const [id, r] of done) { const k = rowOf(id), c = U.uCount.value[k], t0 = r.t0, f = Math.min(1, Math.max(0, (T - t0) / r.dur)); z[1] += f; z[2] += Math.max(0, f * 2 - 1); n += f; if (f >= 1) { bad += r.failed; lim += r.limits; all += c; } }
    const par = done.get('nn-parity'); z[0] = par ? Math.min(1, Math.max(0, (T - par.t0 - 0.4) / par.dur)) * 14 : 0; z[1] /= ROWS; z[2] /= ROWS; z[0] /= 14; return z;
  }
  function draw() {
    U.uT.value = T; film.uniforms.uT.value = reduced() ? 0 : T;
    if (reduced()) { [, cur.x, cur.y, cur.z, cur.lx, cur.ly, cur.f] = still; } else pose(story);
    const asp = Math.min(1, (w / h) / 1.86); camera.position.set(cur.x + ox * 0.35, cur.y - oy * 0.12, cur.z / Math.max(0.72, asp)); camera.fov = cur.f; camera.updateProjectionMatrix(); camera.lookAt(cur.lx + ox * 0.15, cur.ly, 0); U.uCam.value.copy(camera.position);
    const z = lampsLit(); for (let i = 0; i < 3; i++) { areas[i].color.copy(i === 0 ? tmp.set(0x9fd8ee).lerp(U.cOk.value, 0.5) : U.cOk.value); areas[i].intensity = z[i] * (i === 0 ? 1.1 : 2.3); }
    U.uLift.value = 1 - Math.min(1, story / 4);
    renderer.setRenderTarget(emitRT); renderer.render(emitScene, emitCam); renderer.setRenderTarget(null);
    composer.render();
  }
  function frame(ts) {
    if (!on) return; raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (ts - last) / 1000 || 0.016), real = ts - last; last = ts; T += dt; story += dt; ox += (tx - ox) * Math.min(1, dt * 2); oy += (ty - oy) * Math.min(1, dt * 2);
    if (labelDirty && T > labelDirty) { labelDirty = 0; drawLabels(done); }
    draw();
    // keep 60 frames a second: give up resolution, never smoothness
    if (real > 20) { slow++; fast = 0; } else { fast++; if (fast > 30) slow = 0; } if (slow > 14 && pr > 0.7) { pr = Math.max(0.7, pr * 0.82); slow = -30; size(); }
    if (T > stopAt) { on = false; cancelAnimationFrame(raf); }
  }
  return {
    canvas, rows: ROWS,
    begin(id) { U.uRun.value[rowOf(id)] = Math.max(0.001, T); },
    // A finished test: light its strip, one lamp per check, in the order the checks ran. Amber and red keep their place.
    finish(id, checks, result, { instant = false } = {}) {
      const r = rowOf(id); if (r < 0) return; const n = Math.min(CELLS, checks.length), dur = instant || reduced() ? 0.001 : Math.min(2.8, 0.7 + n * 0.004), t0 = instant || reduced() ? T - 20 : Math.max(T, nextFree); nextFree = instant ? nextFree : Math.max(nextFree, T) + 0.16;
      const span = id === 'nn-parity' && dur > 0.01 ? 3.4 : dur;
      for (let i = 0; i < n; i++) { state[(r * CELLS + i) * 2] = checks[Math.floor((i / n) * checks.length)][0]; state[(r * CELLS + i) * 2 + 1] = t0 + (i / n) * span; }
      U.uCount.value[r] = n; tState.needsUpdate = true; done.set(id, { state: result.state, t0, dur: span, failed: result.failed, limits: result.limits }); labelDirty = t0 + span;
      return t0 + span - T;
    },
    reset() { state.fill(0); tState.needsUpdate = true; U.uCount.value.fill(0); U.uRun.value.fill(0); done.clear(); nextFree = 0; story = 0; drawLabels(); },
    lit() { let n = 0; for (const [id, r] of done) n += Math.round(U.uCount.value[rowOf(id)] * Math.min(1, Math.max(0, (T - r.t0) / r.dur))); return n; },
    settled() { for (const [, r] of done) if (T < r.t0 + r.dur + 0.4) return false; return true; },
    // What is under the pointer: { test } for a strip, { window } for one of the thirty panes, or null.
    pick(cx, cy) {
      const r = canvas.getBoundingClientRect(); ndc.set(((cx - r.left) / r.width) * 2 - 1, 1 - ((cy - r.top) / r.height) * 2); ray.setFromCamera(ndc, camera); const o = ray.ray.origin, d = ray.ray.direction; if (d.z >= -1e-4) return null;
      const s = -o.z / d.z, x = o.x + d.x * s, y = o.y + d.y * s; if (y < 0) return null;
      const u = (x - TX0) / TW, v = (y - TY0) / TH; if (u >= 0 && u < 3 && v >= 0 && v < 10) return { window: (9 - Math.floor(v)) * 3 + Math.floor(u) };
      if (x > LX0 && x < XL1) for (const g of groups) { const q = (g.y - y) / PITCH; if (q >= 0 && q < g.n) return { test: ORDER[g.start + Math.floor(q)].id }; }
      return null;
    },
    get time() { return story; }, toEnd() { story = Math.max(story, 20); },
    start() { if (on) return; on = true; stopAt = Infinity; last = performance.now(); if (reduced()) { on = false; T += 30; size(); draw(); return; } raf = requestAnimationFrame(frame); },
    stop() { on = false; cancelAnimationFrame(raf); }, redraw: () => { if (!on) { T += 30; drawLabels(done); draw(); } },
    colours() { colours(); drawLabels(done); if (!on) draw(); }, get pixelRatio() { return pr; },
    dispose() { on = false; cancelAnimationFrame(raf); ro.disconnect(); host.removeEventListener('pointermove', onMove); for (const a of actors) try { a.dispose?.(); } catch { /* already gone */ } scene.traverse((o) => { o.geometry?.dispose?.(); if (o.material) for (const m of [].concat(o.material)) m.dispose?.(); }); for (const x of [tState, tTiles, tLabel, conc, emitRT, rt, emitMat]) x.dispose(); composer.dispose(); renderer.dispose(); renderer.forceContextLoss(); canvas.remove(); },
  };
}
