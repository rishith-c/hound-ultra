// Streams real map tiles into GPU textures for the valley film.
//   mosaic()   a block of Esri World Imagery tiles at one zoom, uploaded tile by tile as they arrive. A tile that has not
//              arrived (or does not exist) stays transparent, so the shader falls back to the coarser level under it.
//   farDem()   the mountains round the valley: 6 x 6 elevation tiles at zoom 12 (Mapzen terrain tiles on AWS).
import * as THREE from 'three';

const IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/';
const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/';

export function createStreamer(renderer, { onFail = () => {} } = {}) {
  const gl = renderer.getContext(), aniso = renderer.capabilities.getMaxAnisotropy(), ext = gl.getExtension('EXT_texture_filter_anisotropic');
  const queue = [], ready = [], touched = new Set();
  let active = 0, ok = 0, bad = 0, dead = false, lastMip = 0;

  function mosaic(z, x0, y0, n, priority, inRange = () => true) {
    const size = n * 256, glTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, glTex);
    gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(size)) + 1, gl.SRGB8_ALPHA8, size, size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, aniso));
    const tex = new THREE.Texture(); tex.flipY = false;
    const props = renderer.properties.get(tex); props.__webglTexture = glTex; props.__webglInit = true;
    const m = { tex, glTex, n, z, x0, y0, left: 0, canvas: null };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (inRange(i, j)) { m.left++; queue.push({ m, i, j, p: priority(i, j), url: IMAGERY + z + '/' + (y0 + j) + '/' + (x0 + i) + '?blankTile=false' }); }
    renderer.resetState();
    return m;
  }
  function pump() {
    while (!dead && active < 14 && queue.length) {
      const job = queue.shift(); active++;
      fetch(job.url, { mode: 'cors' }).then((r) => (r.ok ? r.blob() : Promise.reject(new Error('HTTP ' + r.status)))).then((b) => createImageBitmap(b, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))
        .then((bmp) => { ok++; job.bmp = bmp; ready.push(job); }, () => { bad++; job.m.left--; if (ok === 0 && bad === 12) onFail(); })
        .finally(() => { active--; pump(); });
    }
  }
  return {
    mosaic,
    start() { queue.sort((a, b) => a.p - b.p); pump(); setTimeout(() => { if (!dead && ok === 0 && bad < 12) onFail(); }, 9000); },
    // Called once a frame: a few tiles at a time, so streaming never shows as a stutter.
    upload(now, budget = 4) {
      if (!ready.length && !touched.size) return;
      for (let q = 0; q < budget && ready.length; q++) {
        const job = ready.shift(), m = job.m;
        gl.bindTexture(gl.TEXTURE_2D, m.glTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, job.i * 256, job.j * 256, gl.RGBA, gl.UNSIGNED_BYTE, job.bmp);
        if (m.onTile) m.onTile(job); job.bmp.close(); m.left--; touched.add(m);
      }
      if (now - lastMip > 260 || (!ready.length && !active)) {
        lastMip = now;
        for (const m of touched) { gl.bindTexture(gl.TEXTURE_2D, m.glTex); gl.generateMipmap(gl.TEXTURE_2D); touched.delete(m); break; }
      }
      renderer.resetState();
    },
    stats: () => ({ ok, bad, waiting: queue.length + active + ready.length }),
    get idle() { return !queue.length && !active && !ready.length && !touched.size; },
    destroy() { dead = true; queue.length = 0; ready.length = 0; },
  };
}

export async function farDem(x0, y0, n) {
  const size = n * 256, cv = document.createElement('canvas'); cv.width = cv.height = size;
  const c = cv.getContext('2d', { willReadFrequently: true });
  const jobs = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) jobs.push(fetch(TERRARIUM + '12/' + (x0 + i) + '/' + (y0 + j) + '.png', { mode: 'cors' }).then((r) => (r.ok ? r.blob() : Promise.reject(new Error('HTTP ' + r.status)))).then((b) => createImageBitmap(b, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })).then((b) => { c.drawImage(b, i * 256, j * 256); b.close(); }));
  await Promise.all(jobs);
  const px = c.getImageData(0, 0, size, size).data, out = new Float32Array(size * size);
  for (let k = 0, p = 0; k < out.length; k++, p += 4) out[k] = px[p] * 256 + px[p + 1] + px[p + 2] / 256 - 32768;
  return out;
}
