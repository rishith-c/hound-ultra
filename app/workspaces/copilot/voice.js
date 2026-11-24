// Voice, both directions, both optional and off by default. Uses this device's microphone and speakers.
// Honest note shown in the UI: in Chrome the standard speech recogniser sends the audio to the browser vendor's
// cloud service. Where the browser offers on-device recognition we ask for it and say which one is in use.
const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
export const canListen = () => !!SR;
export const canSpeak = () => typeof speechSynthesis !== 'undefined';

// 'device' when the browser confirms on-device recognition for English, otherwise 'cloud' (assume the worst).
export async function recognitionPath() {
  if (!SR) return 'none';
  try { if (typeof SR.available === 'function') { const a = await SR.available({ langs: ['en-US'], processLocally: true }); if (a === 'available') return 'device'; } } catch { /* older browsers */ }
  return 'cloud';
}
let rec = null;
// Push-to-talk: start on press, stop on release. onInterim(text), onFinal(text), onEnd(errorOrNull).
export async function listen({ onInterim, onFinal, onEnd }) {
  if (!SR) { onEnd?.('This browser has no speech recognition. Type instead.'); return; }
  stopListening();
  const r = new SR(); rec = r;
  r.lang = 'en-US'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
  if ('processLocally' in r && (await recognitionPath()) === 'device') r.processLocally = true;
  let final = '', err = null;
  r.onresult = (e) => { let interim = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) final += t; else interim += t; } onInterim?.((final + ' ' + interim).trim()); };
  r.onerror = (e) => { err = e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Microphone permission was refused.' : e.error === 'network' ? 'Speech recognition needs the network in this browser, and it is not reachable. Type instead.' : e.error === 'no-speech' ? 'No speech heard.' : e.error === 'aborted' ? null : 'Speech recognition failed (' + e.error + ').'; };
  r.onend = () => { if (rec === r) rec = null; if (final.trim()) onFinal?.(final.trim()); onEnd?.(final.trim() ? null : err); };
  try { r.start(); } catch (e) { rec = null; onEnd?.('The microphone could not start: ' + (e.message || e)); }
}
export function stopListening() { if (rec) { try { rec.stop(); } catch { /* not started */ } } }
export function speak(text) {
  if (!canSpeak()) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(String(text).replace(/\s*\n\s*/g, '. ').slice(0, 600));
  u.rate = 1.05; u.pitch = 1; u.lang = 'en-US';
  speechSynthesis.speak(u);
}
export const hush = () => { if (canSpeak()) speechSynthesis.cancel(); };
