// Photographic ground materials. The three tiling illustrations in assets/img/gen (mud, rubble, concrete) become
// full materials here: colour, plus a normal map and a height field derived from brightness with a Sobel filter.
// Height sits in the alpha channel of the normal texture. If a picture is missing, a plain stand-in is used.
import * as THREE from 'three';

const DIR = new URL('../../assets/img/gen/', import.meta.url);
function image(name) { return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = new URL(name, DIR).href; }); }

function derive(px, N, strength) {
  const h = new Float32Array(N * N), b = new Float32Array(N * N);
  for (let i = 0, p = 0; i < h.length; i++, p += 4) h[i] = (px[p] * 0.3 + px[p + 1] * 0.59 + px[p + 2] * 0.11) / 255;
  // take out the broad light and dark patches so that only relief is left
  const R = 24; for (let pass = 0; pass < 2; pass++) { const s = pass ? b : h; const o = pass ? new Float32Array(N * N) : b; for (let y = 0; y < N; y++) { let sum = 0; const at = (k) => (pass ? s[((k + N) % N) * N + y] : s[y * N + ((k + N) % N)]); for (let k = -R; k <= R; k++) sum += at(k); for (let x = 0; x < N; x++) { if (pass) o[x * N + y] = sum / (2 * R + 1); else o[y * N + x] = sum / (2 * R + 1); sum += at(x + R + 1) - at(x - R); } } if (pass) b.set(o); }
  for (let i = 0; i < h.length; i++) h[i] = Math.min(1, Math.max(0, 0.5 + (h[i] - b[i]) * 2.4));
  const out = new Uint8Array(N * N * 4), at = (x, y) => h[((y + N) % N) * N + ((x + N) % N)];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const gx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) * strength;
    const gy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) * strength;
    const l = 1 / Math.hypot(gx, gy, 1), i = (y * N + x) * 4;
    out[i] = (-gx * l * 0.5 + 0.5) * 255; out[i + 1] = (-gy * l * 0.5 + 0.5) * 255; out[i + 2] = (l * 0.5 + 0.5) * 255; out[i + 3] = h[y * N + x] * 255;
  }
  return out;
}

export async function loadPhotos(quality, aniso = 8) {
  const N = quality === 'high' ? 1024 : 512, out = {};
  await Promise.all([['mud', 1.1], ['rubble', 1.3], ['concrete', 0.8]].map(async ([k, strength]) => {
    const img = await image('tex-' + k + '.jpg'), c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d', { willReadFrequently: true });
    if (img) x.drawImage(img, 0, 0, N, N); else { x.fillStyle = '#5a5148'; x.fillRect(0, 0, N, N); }
    const px = x.getImageData(0, 0, N, N).data; let r = 0, g = 0, b = 0; for (let i = 0; i < px.length; i += 64) { r += px[i]; g += px[i + 1]; b += px[i + 2]; }
    const m = px.length / 64, avg = new THREE.Color(r / m / 255, g / m / 255, b / m / 255).convertSRGBToLinear();
    const wrap = (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t; };
    const map = new THREE.CanvasTexture(c); map.flipY = false; map.colorSpace = THREE.SRGBColorSpace; wrap(map);
    out[k] = { map, avg, normalMap: wrap(new THREE.DataTexture(derive(px, N, strength * 2.2), N, N, THREE.RGBAFormat)) };
  }));
  out.dispose = () => { for (const v of Object.values(out)) { v.map?.dispose(); v.normalMap?.dispose(); } };
  return out;
}
