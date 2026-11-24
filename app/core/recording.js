// When a computer cannot draw a chapter (no WebGL 2, a software renderer, a lost graphics context, a file that will not load, or a
// frame rate too low to watch), Demo shows the same chapter as a recording of the live console. Advanced always runs live.
// The recordings are made by tools/film.py and tools/clips.py. ?film=1 shows them everywhere, ?live=1 never.
const CLIPS = new Set(['area', 'radio', 'forge', 'sense', 'rover', 'mission', 'fusion', 'report', 'status', 'aerial', 'scan', 'swarm', 'structure', 'horizon']);
const q = new URLSearchParams(location.search);
const url = (id, ext) => new URL('../../film/' + id + ext, import.meta.url).href;
export const has = (id) => CLIPS.has(id) && q.get('live') !== '1';

let verdict;
export function cannotDraw() {
  if (q.get('film') === '1') return 'asked for';
  if (verdict !== undefined) return verdict;
  verdict = '';
  try { if (sessionStorage.getItem('hound.film') === '1') return verdict = 'too slow'; } catch { /* no storage */ }
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return verdict = 'no WebGL 2';
  const ext = gl.getExtension('WEBGL_debug_renderer_info'), name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(name)) verdict = 'software graphics';
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return verdict;
}
export function rememberSlow() { verdict = 'too slow'; try { sessionStorage.setItem('hound.film', '1'); } catch { /* no storage */ } }

export function show(root, m, ctx, live) {
  const { h } = ctx.kit;
  const v = h('video.rec-film', { src: url(m.id, '.mp4'), poster: url(m.id, '.jpg'), loop: true, preload: 'auto', 'aria-label': m.title + ', recorded from the live console' });
  v.muted = true; v.playsInline = true;
  const back = h('img.rec-back', { src: url(m.id, '.jpg'), alt: '' });
  root.replaceChildren(h('div.rec-stage', null, back, v, h('div.rec-note', null, h('span', null, 'Recorded from the live console'), cannotDraw() === 'no WebGL 2' ? null : h('button.btn.btn-sm.btn-ghost', { onclick: live }, 'Run it live'))));
  const play = () => v.play().catch(() => { v.controls = true; });
  return { onShow: play, onHide() { v.pause(); v.currentTime = 0; }, seconds: () => (isFinite(v.duration) ? v.duration : 0), dispose() { v.pause(); v.removeAttribute('src'); v.load(); } };
}
