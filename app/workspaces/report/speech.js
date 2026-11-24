// Reassurance message: a short, calm message the rover's speaker could play to people who are trapped.
// Concept for the rover (it has no speaker today). The speech itself is real: it uses this device's voices.
const MESSAGES = [
  { lang: 'ne', bcp: 'ne-NP', name: 'Nepali', own: 'नेपाली', dir: 'ltr',
    text: 'यो उद्धार रोबोट हो। मद्दत आउँदैछ। सक्नुहुन्छ भने तीन पटक ढकढक गर्नुहोस् वा कराउनुहोस्। जहाँ हुनुहुन्छ त्यहीँ बस्नुहोस्। आफ्नो शक्ति जोगाउनुहोस्।',
    roman: 'Yo uddhar robot ho. Maddat aundaichha. Saknuhunchha bhane tin patak dhakdhak garnuhos wa karaunuhos. Jahan hunuhunchha tyahin basnuhos. Aphno shakti jogaunuhos.' },
  { lang: 'hi', bcp: 'hi-IN', name: 'Hindi', own: 'हिन्दी', dir: 'ltr',
    text: 'यह एक बचाव रोबोट है। मदद आ रही है। अगर हो सके तो तीन बार खटखटाएँ या आवाज़ दें। जहाँ हैं वहीं रहें। अपनी ताक़त बचाकर रखें।',
    roman: 'Yah ek bachaav robot hai. Madad aa rahi hai. Agar ho sake to teen baar khatkhataen ya aavaaz den. Jahan hain vahin rahen. Apni taaqat bachaakar rakhen.' },
  { lang: 'en', bcp: 'en-GB', name: 'English', own: 'English', dir: 'ltr',
    text: 'This is a rescue robot. Help is coming. If you can, knock three times or call out. Stay where you are. Save your strength.', roman: '' },
  { lang: 'bn', bcp: 'bn-IN', name: 'Bengali', own: 'বাংলা', dir: 'ltr',
    text: 'এটি একটি উদ্ধারকারী রোবট। সাহায্য আসছে। সম্ভব হলে তিনবার টোকা দিন অথবা ডাক দিন। যেখানে আছেন সেখানেই থাকুন। শক্তি সঞ্চয় করুন।',
    roman: 'Eti ekti uddharkari robot. Sahajyo asche. Sombhob hole tinbar toka din othoba dak din. Jekhane achen sekhanei thakun. Shokti sonchoy korun.' },
  { lang: 'zh', bcp: 'zh-CN', name: 'Mandarin Chinese', own: '普通话', dir: 'ltr',
    text: '这是救援机器人。救援人员正在赶来。如果可以，请敲三下或大声呼喊。请留在原地。请保存体力。',
    roman: 'Zhè shì jiùyuán jīqìrén. Jiùyuán rényuán zhèngzài gǎnlái. Rúguǒ kěyǐ, qǐng qiāo sān xià huò dàshēng hūhǎn. Qǐng liú zài yuándì. Qǐng bǎocún tǐlì.' },
  { lang: 'ur', bcp: 'ur-PK', name: 'Urdu', own: 'اردو', dir: 'rtl',
    text: 'یہ ایک امدادی روبوٹ ہے۔ مدد آ رہی ہے۔ اگر ہو سکے تو تین بار دستک دیں یا آواز دیں۔ جہاں ہیں وہیں رہیں۔ اپنی طاقت بچا کر رکھیں۔',
    roman: 'Yeh ek imdadi robot hai. Madad aa rahi hai. Agar ho sake to teen baar dastak den ya aawaz den. Jahan hain wahin rahen. Apni taaqat bacha kar rakhen.' },
];
const ENGLISH = MESSAGES[2].text;
const REPEAT_S = 30;

export function createReassurance(ctx) {
  const { h, icon, realityTag } = ctx.kit;
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  let cur = 0, voices = [], speaking = false, repeat = false, timer = 0, tick = 0, nextAt = 0, token = 0;

  const voiceFor = (m) => {
    const exact = voices.filter((v) => v.lang && v.lang.toLowerCase().replace('_', '-').startsWith(m.lang));
    return exact.find((v) => v.lang.toLowerCase().replace('_', '-') === m.bcp.toLowerCase()) || exact.find((v) => v.localService) || exact[0] || null;
  };

  const tabs = h('div.seg.report-lang-tabs', { role: 'tablist', 'aria-label': 'Message language' },
    ...MESSAGES.map((m, i) => h('button', { type: 'button', role: 'tab', id: 'report-lang-' + m.lang, 'aria-selected': String(i === 0), 'aria-controls': 'report-msg', onclick: () => { stop(); cur = i; draw(); } }, m.name === 'Mandarin Chinese' ? 'Mandarin' : m.name)));
  const own = h('p.report-msg-own'), roman = h('p.report-msg-roman'), meaning = h('p.report-msg-en');
  const voiceLine = h('p.report-voice', { role: 'status' });
  const playBtn = h('button.btn', { type: 'button', onclick: () => play() }, icon('play'), h('span', null, 'Play'));
  const stopBtn = h('button.btn', { type: 'button', onclick: () => stop() }, icon('stop'), h('span', null, 'Stop'));
  const repeatBox = h('input', { type: 'checkbox', onchange: (e) => { repeat = e.target.checked; if (!repeat) { clearTimeout(timer); clearInterval(tick); nextAt = 0; } draw(); } });
  const state = h('span.report-speak-state', { 'aria-live': 'polite' });
  const body = h('div.report-msg', { id: 'report-msg', role: 'tabpanel' }, own, roman, meaning);

  function draw() {
    const m = MESSAGES[cur], v = synth ? voiceFor(m) : null;
    [...tabs.children].forEach((b, i) => { b.setAttribute('aria-selected', String(i === cur)); b.tabIndex = i === cur ? 0 : -1; });
    body.setAttribute('aria-labelledby', 'report-lang-' + m.lang);
    own.textContent = m.text; own.lang = m.lang; own.dir = m.dir;
    roman.textContent = m.roman; roman.hidden = !m.roman;
    meaning.textContent = m.lang === 'en' ? 'Five short sentences, as rescuers say them. Nothing here promises a time.' : 'Meaning: ' + ENGLISH;
    if (!synth) voiceLine.textContent = 'This browser cannot speak text. The text can still be shown on the rover\'s screen.';
    else if (v) voiceLine.replaceChildren('System voice: ', h('b', null, v.name), ' (' + v.lang + (v.localService ? ', on this device' : ', needs a network') + '), at 0.85 speed.');
    else voiceLine.textContent = 'No ' + m.name + ' voice is installed on this device. The text can still be shown on the rover\'s screen.';
    voiceLine.classList.toggle('report-voice-none', !v);
    playBtn.disabled = !v || speaking; playBtn.setAttribute('aria-label', 'Play the message in ' + m.name);
    stopBtn.disabled = !speaking && !nextAt; stopBtn.setAttribute('aria-label', 'Stop speaking');
    repeatBox.disabled = !v;
    if (speaking) state.textContent = 'Speaking in ' + m.name + '…';
    else if (nextAt) state.textContent = 'Repeats in ' + Math.max(0, Math.ceil((nextAt - Date.now()) / 1000)) + ' s';
    else state.textContent = '';
    state.classList.toggle('report-speaking', speaking);
  }

  function play() {
    if (!synth) return;
    const m = MESSAGES[cur], v = voiceFor(m); if (!v) return;
    clearTimeout(timer); clearInterval(tick); nextAt = 0;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(m.text), mine = ++token;
    u.voice = v; u.lang = v.lang; u.rate = 0.85; u.pitch = 1;
    const done = () => {
      if (mine !== token) return;
      speaking = false;
      if (repeat) { nextAt = Date.now() + REPEAT_S * 1000; timer = setTimeout(play, REPEAT_S * 1000); tick = setInterval(draw, 1000); }
      draw();
    };
    u.onend = done; u.onerror = done;
    speaking = true; draw();
    synth.speak(u);
  }
  function stop() {
    token++; clearTimeout(timer); clearInterval(tick); nextAt = 0; speaking = false;
    if (synth) synth.cancel();
    draw();
  }
  function loadVoices() { voices = synth ? synth.getVoices() : []; draw(); }
  if (synth) { synth.addEventListener?.('voiceschanged', loadVoices); }
  loadVoices();
  tabs.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault(); stop(); cur = (cur + (e.key === 'ArrowRight' ? 1 : MESSAGES.length - 1)) % MESSAGES.length; draw(); tabs.children[cur].focus();
  });

  const el = ctx.kit.panel('Reassurance message', { tag: realityTag('concept') },
    h('p.report-side-lead', null, 'A short, calm message the rover\'s speaker could play to people who are trapped. The rover has no speaker today; the voice you hear is this computer\'s. ', h('span.tag.tag-ok', { title: ctx.kit.REALITY.device.means }, 'Your device')),
    tabs, body, voiceLine,
    h('div.row.wrap.report-speak-row', null, playBtn, stopBtn, h('label.check.switch', null, repeatBox, h('span', null, 'Repeat every ' + REPEAT_S + ' s')), state),
    h('div.note.warn', null, icon('alert'), h('span', null, 'Translations are drafts written by the student team with machine help. A native speaker must check them before any real use.')));
  el.classList.add('report-reassure');
  return { el, stop, messages: MESSAGES, state: () => ({ cur: MESSAGES[cur].lang, speaking, repeat, voice: synth ? voiceFor(MESSAGES[cur])?.name || null : null, voices: voices.length }) };
}
