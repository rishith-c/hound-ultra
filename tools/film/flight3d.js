// Film page: the site's own drone scene (app/workspaces/aerial/drone.js) flown on the film's clock and seen from the film's own camera.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
const q = new URLSearchParams(location.search), S = q.get('s') || 'over', host = document.getElementById('s'), root = new URL('../../', import.meta.url).href, aer = root + 'app/workspaces/aerial/';
const cl = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x)), ss = (a, b, x) => { x = cl((x - a) / (b - a)); return x * x * (3 - 2 * x); }, mix = (a, b, t) => a + (b - a) * t;
let t0 = 0, run = false, E = null; const now = () => run ? (performance.now() - t0) / 1000 : 0, v = new THREE.Vector3();
const PASS = 6.26, ZC = -47, XC = Math.sin(ZC * .11) * 1.5;      // over: the drone reaches the camera at PASS
const FILM = window.__FILM = {
  mode: 0, pitch: -.10, speed: 6,
  z() { const t = now(); if (S === 'over') { const u = Math.max(0, t - .9) / (PASS - .9); return ZC + 21 * (1 - Math.pow(u, 1.5)); } return -6 - 7.2 * t; },
  dy() { const t = now(); return S === 'over' ? -4.9 * (1 - ss(.15, 2.1, t)) : 0; },
  beam() { const t = now(); return S === 'over' ? ss(1.55, 1.75, t) * (.34 + .5 * Math.exp(-Math.max(0, t - 1.7) * 3)) * (1 - ss(PASS - 1.3, PASS - .55, t)) : .5; },
  init(T, scene, renderer, U, sheet) {
    U.uFog.value.set(0x0d1218);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(240, 48, 32), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: { uT: U.uT, uF: U.uFog }, vertexShader: 'varying vec3 vD; void main(){ vD=normalize(position); vec4 p=projectionMatrix*vec4(mat3(viewMatrix)*position,1.); gl_Position=p.xyww; }', fragmentShader: `varying vec3 vD; uniform float uT; uniform vec3 uF;
      float h(vec2 p){ vec3 q=fract(vec3(p.xyx)*.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); } float n(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); } float fb(vec2 p){ float a=.5,s=0.; for(int i=0;i<6;i++){ s+=a*n(p); p=p*2.03+vec2(17.,9.); a*=.5; } return s; }
      void main(){ float e=vD.y; vec2 p=vD.xz/max(e+.16,.04); float c=fb(p*1.3+vec2(uT*.012,0.)); c=smoothstep(.36,.82,c); float glow=exp(-max(e,0.)*5.2); float side=.5+.5*dot(normalize(vD.xz+1e-4),vec2(-.25,.97)); vec3 hz=uF*1.35+vec3(.115,.138,.165)*glow*(.25+.95*pow(side,3.)); vec3 up=vec3(.010,.013,.018)+vec3(.052,.060,.072)*c*exp(-max(e-.02,0.)*1.5)*(.4+.8*side); vec3 k=mix(hz,up,smoothstep(-.02,.42,e)); k+=vec3(.06,.066,.072)*c*glow*side; gl_FragColor=vec4(k,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }` })); sky.frustumCulled = false; sky.renderOrder = -10; scene.add(sky);
    renderer.setClearColor(0x05070a, 1);
  },
  cam(cam, eye, look, bird, U) {
    const t = now(), b = bird.position, sh = (f, a) => Math.sin(t * f) * a + Math.sin(t * f * 2.3 + 1.1) * a * .5;
    if (S === 'over') {
      U.uM.value.x *= Math.min(1, this.beam() * 2.4);
      // low in the rubble, looking back up the valley; it comes straight at us and goes over
      eye.set(XC - 1.9 + sh(.9, .03) + t * .16, 3.2 + sh(1.2, .025) + t * .20, ZC - .9 + .16 * t); const near = ss(PASS - .9, PASS + .25, t);
      look.set(b.x, Math.max(b.y, 2.2) - .35 + near * .2, b.z); cam.up.set(Math.sin(.02 + t * .006), 1, 0); cam.fov = mix(30, 44, ss(1.5, PASS, t));
    } else {
      const k = ss(0, 4, t), A = mix(-.5, .42, k) + sh(.4, .03), R = mix(9.5, 7.4, k), H = mix(5.2, 2.6, k);
      eye.set(b.x * .55 + Math.sin(A) * R, b.y + H, b.z + Math.cos(A) * R); look.set(b.x * .8, b.y - 2.3, b.z - 1.6); cam.up.set(-sh(.5, .03) - A * .06, 1, 0); cam.fov = 42;
    }
    cam.position.copy(eye); cam.lookAt(look); cam.updateProjectionMatrix(); this.b = b;
  },
  render(r, scene, cam, W, H, ratio) {
    if (!E) { const rt = new THREE.WebGLRenderTarget(W * ratio, H * ratio, { type: THREE.HalfFloatType, samples: 4 }); E = new EffectComposer(r, rt); E.setPixelRatio(ratio); E.setSize(W, H); E.addPass(new RenderPass(scene, cam)); const bl = new UnrealBloomPass(new THREE.Vector2(W * ratio / 2, H * ratio / 2), .26, .55, .95); E.addPass(bl); E.addPass(new OutputPass()); }
    E.render();
  },
};
let s = await (await fetch(aer + 'drone.js')).text(); const sub = (a, b) => { if (!s.includes(a)) console.error('flight3d: not found', a.slice(0, 60)); s = s.split(a).join(b); };
s = s.replace(/from '(\.[^']+)'/g, (m, p) => `from '${new URL(p, aer + 'drone.js').href}'`);
sub('cam = new THREE.PerspectiveCamera(44, 1, 0.2, 160)', 'cam = new THREE.PerspectiveCamera(44, 1, 0.06, 320)');
sub('Math.min(window.devicePixelRatio || 1, 1.5)', 'window.devicePixelRatio');
sub('sheet.frustumCulled = false; scene.add(sheet);', 'sheet.frustumCulled = false; scene.add(sheet); __FILM.init(THREE, scene, renderer, U, sheet);');
sub('setMode(Math.floor(T / MODE_S));', 'setMode(__FILM.mode);');
sub('z -= SPEED * dt; if (z < -GL + 6) { z = Z0; fade = 1; people.forEach((p) => { p.found = -1; }); U.uScan.value.x = Z0; }', 'z = __FILM.z();');
sub('pitch = damp(pitch, -0.10, 2, dt);', 'pitch = damp(pitch, __FILM.pitch, 2, dt);');
sub('cam.position.copy(eye); cam.lookAt(look);', '__FILM.cam(cam, eye, look, bird, U);');
sub('renderer.render(scene, cam); overlay();', '__FILM.render(renderer, scene, cam, W, Hh, ratio);');
sub('if (slow > 45 && ratio > 0.7)', 'if (false)');
sub('bird.position.set(x + Math.sin(t * 0.9) * 0.05, ALT +', 'bird.position.set(x + Math.sin(t * 0.9) * 0.05, ALT + __FILM.dy() +');
sub('m.material.uniforms.uA.value = w[i]; m.visible', 'm.material.uniforms.uA.value = w[i] * __FILM.beam(); m.visible');
sub('col=mix(col,uFog*(1.+.35*smoothstep(0.,40.,dist)),1.-exp(-pow(max(dist-8.,0.)/17.,1.35))); col*=exp(-off*.05);', 'col*=exp(-off*.05); float sd=.5+.5*dot(normalize(vW.xz-uCam.xz+1e-4),vec2(-.25,.97)); vec3 fg=uFog*1.1+vec3(.10,.122,.148)*(.18+.85*sd*sd*sd); col=mix(col*.92,fg,1.-exp(-pow(max(dist-7.,0.)/34.,1.25)));');
sub('new THREE.DirectionalLight(0xffdcb8, 6.5)', 'new THREE.DirectionalLight(0xffe6cc, 3.0)'); sub('new THREE.DirectionalLight(0xa8cdff, 7)', 'new THREE.DirectionalLight(0xbcd4f2, 4.2)'); sub('scene.environmentIntensity = 1.0', 'scene.environmentIntensity = .42');
const M = await import(URL.createObjectURL(new Blob([s], { type: 'text/javascript' })));
const list = (await (await fetch(root + 'data/aerial/frames.json')).json()).generated, rec = await (await fetch(root + 'data/aerial/recorded.json')).json();
const h = (tag, at = {}, ...k) => { const [n, ...c] = tag.split('.'), e = document.createElement(n); e.className = c.join(' '); e.append(...k); return e; }, css = (n) => ({ '--person': '#ffb352', '--accent': '#7fb2ff', '--text': '#eceef1', '--text-2': '#a8b0b9', '--font': 'sans-serif' })[n] || '#fff';
const api = await M.createDrone(host, { h, css, reduced: false, recorded: rec, minScore: .5, shift: 0, loadBitmap: async (id) => createImageBitmap(await (await fetch(root + list[+id.slice(3) - 1].src)).blob()) });
window.PARTS = { start() { t0 = performance.now(); run = true; return 1; } };
api.start(); window.READY = 1;
