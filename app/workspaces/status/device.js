// What this computer and browser offer, what in the console depends on it, and what happens without it. Nothing here asks
// for a permission: it only looks at what is available.
export async function deviceReport() {
  const out = [], add = (name, state, value, uses, without) => out.push({ name, state, value, uses, without }); // state: yes | no | ask
  let gl = null, glName = ''; try { const c = document.createElement('canvas'); gl = c.getContext('webgl2'); if (gl) { const x = gl.getExtension('WEBGL_debug_renderer_info'); glName = x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); gl.getExtension('WEBGL_lose_context')?.loseContext(); } } catch { /* no WebGL */ }
  add('WebGL 2', gl ? 'yes' : 'no', gl ? glName.replace(/^ANGLE \((.*)\)$/, '$1').slice(0, 64) : 'Not available', 'The 3-D twin, the valley, the scan, the globe, this proof wall', 'A flat map and tables take their place; the mission still runs.');
  let gpu = null; try { gpu = await Promise.race([navigator.gpu?.requestAdapter(), new Promise((r) => setTimeout(r, 1500))]); } catch { /* none */ }
  add('WebGPU', gpu ? 'yes' : 'no', gpu ? [gpu.info?.vendor, gpu.info?.architecture].filter(Boolean).join(' ') || 'Available' : 'Not available', 'The copilot’s language model, the fast path of the vision models', 'The copilot answers with rules; vision models run on the processor, slower.');
  const perm = async (n) => { try { return (await navigator.permissions.query({ name: n })).state; } catch { return null; } };
  const media = !!navigator.mediaDevices?.getUserMedia, mic = media ? await perm('microphone') : null, cam = media ? await perm('camera') : null, say = { granted: 'Allowed', denied: 'Blocked in this browser', prompt: 'Asks first' };
  add('Microphone', !media || mic === 'denied' ? 'no' : mic === 'granted' ? 'yes' : 'ask', media ? say[mic] || 'Asks first' : 'Not available', 'Tap detector, voice commands, voice lab', 'A generated knock can be played instead; commands can be typed.');
  add('Camera', !media || cam === 'denied' ? 'no' : cam === 'granted' ? 'yes' : 'ask', media ? say[cam] || 'Asks first' : 'Not available', 'Pulse from pixels', 'A generated clip is used.');
  add('Bluetooth', navigator.bluetooth ? 'ask' : 'no', navigator.bluetooth ? 'Asks first' : 'Not in this browser', 'The link to a real rover', 'The console stays a simulation. The rover’s firmware has no Bluetooth yet either way.');
  const voices = window.speechSynthesis?.getVoices?.().length || 0;
  add('Speech out', window.speechSynthesis ? 'yes' : 'no', window.speechSynthesis ? (voices ? voices + ' voices' : 'Available') : 'Not available', 'Spoken alerts, the reassurance message', 'Alerts stay on screen and reach screen readers.');
  add('Speech in', window.SpeechRecognition || window.webkitSpeechRecognition ? 'ask' : 'no', window.SpeechRecognition || window.webkitSpeechRecognition ? 'Asks first' : 'Not in this browser', 'Talking to the copilot', 'Type instead.');
  let store = false; try { localStorage.setItem('hound.t', '1'); localStorage.removeItem('hound.t'); store = true; } catch { /* blocked */ }
  let est = null; try { est = await navigator.storage?.estimate?.(); } catch { /* none */ }
  add('Storage', store ? 'yes' : 'no', store ? (est?.quota ? (est.usage / 1e6).toFixed(0) + ' MB used of ' + (est.quota / 1e9).toFixed(0) + ' GB' : 'Available') : 'Blocked', 'Preferences, training progress, the offline copy', 'Nothing is remembered between visits.');
  add('Module workers', typeof Worker === 'function' ? 'yes' : 'no', (navigator.hardwareConcurrency || 1) + ' processor threads', 'Self-tests, Monte-Carlo missions, timelines, the scan', 'Some of these run on the page and it may stutter.');
  add('Service worker', 'serviceWorker' in navigator ? 'yes' : 'no', 'serviceWorker' in navigator ? 'Available' : 'Not available', 'Opening the console with no network', 'A network is needed to open it.');
  add('Display', 'yes', screen.width + ' × ' + screen.height + ' at ' + (window.devicePixelRatio || 1) + '×', 'Sharpness of every canvas', 'Resolution is lowered by itself before frames are dropped.');
  return out;
}
