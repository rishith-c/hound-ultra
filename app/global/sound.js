// Interface sound. OFF by default; turned on from the command palette ("Interface sound"). Three sounds, all
// synthesised with WebAudio at the moment they play (no audio files):
//   click   a soft mechanical click when the operator commits something (approve, plan, stop, investigate…)
//   person  one calm tone when a person is confirmed
//   fault   a low double tone when a fault starts
// Nothing plays during a seek or a reset (the simulator is silent while it replays).
const KEY = 'hound.sound';
let ac = null, master = null, on = false, lastPerson = 0;
const stored = () => { try { return localStorage.getItem(KEY) === 'on'; } catch { return false; } };

function context() {
  if (!ac) {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain(); master.gain.value = 0.5;
    const limit = ac.createDynamicsCompressor(); limit.threshold.value = -18; limit.ratio.value = 6;
    master.connect(limit).connect(ac.destination);
  }
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  return ac;
}
function tone({ f, t0 = 0, dur, peak, type = 'sine', attack = 0.008, lowpass }) {
  const a = context(), at = a.currentTime + t0, o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f, at);
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + attack); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  let node = o; if (lowpass) { const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = lowpass; o.connect(lp); node = lp; }
  node.connect(g).connect(master); o.start(at); o.stop(at + dur + 0.02);
}
const SOUNDS = {
  // A relay-like tick: 4 ms of band-passed noise for the contact, a 90 Hz thump under it for the body.
  click() {
    const a = context(), len = Math.floor(a.sampleRate * 0.012), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (a.sampleRate * 0.0016));
    const src = a.createBufferSource(), bp = a.createBiquadFilter(), g = a.createGain();
    src.buffer = buf; bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 1.1; g.gain.value = 0.22;
    src.connect(bp).connect(g).connect(master); src.start();
    tone({ f: 92, dur: 0.05, peak: 0.16, attack: 0.002 });
  },
  // One note, soft attack, long decay: a fundamental with a quiet octave and fifth above it. Calm, not an alarm.
  person() { tone({ f: 523.25, dur: 1.5, peak: 0.2, attack: 0.03 }); tone({ f: 1046.5, dur: 1.0, peak: 0.05, attack: 0.03 }); tone({ f: 784, t0: 0.02, dur: 1.2, peak: 0.035, attack: 0.05 }); },
  // Two low pulses, the second a little lower. Says "look at this" without startling.
  fault() { tone({ f: 174.6, dur: 0.2, peak: 0.26, type: 'triangle', lowpass: 700 }); tone({ f: 155.6, t0: 0.27, dur: 0.28, peak: 0.26, type: 'triangle', lowpass: 700 }); },
};
export const SOUND_INFO = { click: 'A soft click when you commit an action.', person: 'One calm tone when a person is confirmed.', fault: 'A low double tone when a fault starts.' };
export function isOn() { return on; }
export function play(name, { force = false } = {}) { if ((!on && !force) || !SOUNDS[name]) return false; try { SOUNDS[name](); return true; } catch (e) { console.warn('[sound]', e); return false; } }
export function setOn(v) { on = !!v; try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* private mode */ } if (on) { context(); play('click'); } return on; }

const COMMITS = new Set(['start', 'allStop', 'resume', 'investigate', 'dismiss', 'finishAssess', 'planRoute', 'approveRoute', 'rejectRoute', 'swapBattery', 'injectFault', 'clearFault', 'newHazard']);
export function init(ctx) {
  on = stored();
  ctx.sound = { isOn, setOn(v) { const r = setOn(v); ctx.bus.emit('sound', r); return r; }, play, info: SOUND_INFO };
  // Browsers only allow sound after a user gesture; if sound was left on, wake the audio context on the first one.
  if (on) window.addEventListener('pointerdown', () => { if (on) context(); }, { once: true });
  ctx.bus.on('command', ({ name, args }) => { if (!COMMITS.has(name)) return; if (name === 'injectFault') return; play('click'); });
  ctx.bus.on('fault', ({ on: active }) => { if (active) play('fault'); });
  ctx.bus.on('survivor', (sv) => { if (sv.status !== 'located') return; const now = performance.now(); if (now - lastPerson < 400) return; lastPerson = now; play('person'); });
}
