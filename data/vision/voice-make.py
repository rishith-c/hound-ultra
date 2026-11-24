#!/usr/bin/env python3
"""Makes the bundled sound stems for Vision lab exhibit 07, "Hear a voice".

Everything here is synthetic. Speech comes from the macOS text-to-speech voices (the say command); knocks, the cough
and the three noises are procedural (numpy, seeded). Nothing is a recording of a person. The page mixes these stems
at a stated signal-to-noise ratio, so the mixing is not done here.

Run:  /usr/local/bin/python3 data/vision/voice-make.py     (needs macOS say and afconvert, numpy, scipy)
Output: data/vision/voice-*.wav (16 kHz, mono, 16-bit) and data/vision/voice-stems.json (durations, active spans, levels).
"""
import json, os, subprocess, tempfile, wave
import numpy as np
from scipy import signal

FS = 16000
OUT = os.path.dirname(os.path.abspath(__file__))
AFCONVERT = '/usr/bin/afconvert'
rs = np.random.RandomState(20261123)

SPEECH = [
    # id, language code (Whisper), language name, voice, text, English meaning
    ('en', 'en', 'English', 'Samantha', 'Help. I am under the stairs. My leg is stuck.', 'Help. I am under the stairs. My leg is stuck.'),
    ('es', 'es', 'Spanish', 'Mónica', 'Ayuda. Estoy debajo de la escalera. Tengo la pierna atrapada.', 'Help. I am under the stairs. My leg is trapped.'),
    ('fr', 'fr', 'French', 'Thomas', "Au secours. Je suis sous l'escalier. Ma jambe est coincée.", 'Help. I am under the stairs. My leg is stuck.'),
    ('de', 'de', 'German', 'Anna', 'Hilfe. Ich bin unter der Treppe. Mein Bein ist eingeklemmt.', 'Help. I am under the stairs. My leg is trapped.'),
    ('hi', 'hi', 'Hindi', 'Lekha', 'मदद करो। मैं सीढ़ियों के नीचे हूँ। मेरा पैर फँस गया है।', 'Help. I am under the stairs. My leg is stuck.'),
    ('ja', 'ja', 'Japanese', 'Kyoko', '助けてください。階段の下にいます。足が挟まれて動けません。', 'Please help. I am under the stairs. My leg is caught and I cannot move.'),
    ('zh', 'zh', 'Chinese', 'Tingting', '救命。我在楼梯下面。我的腿被卡住了。', 'Help. I am under the stairs. My leg is stuck.'),
]

def save(name, x):
    x = np.asarray(x, dtype=np.float64)
    pcm = np.clip(np.round(x * 32767), -32768, 32767).astype('<i2')
    with wave.open(os.path.join(OUT, name), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(FS); w.writeframes(pcm.tobytes())

def rms(x): return float(np.sqrt(np.mean(np.square(x)) + 1e-20))

def active_spans(x, frame=0.02, floor_db=-35, join=0.25, pad=0.03):
    """Spans where the short-time level is within floor_db of the loudest frame; gaps shorter than join are bridged."""
    n = int(frame * FS); k = len(x) // n
    e = np.sqrt(np.mean(np.square(x[:k * n].reshape(k, n)), axis=1) + 1e-20)
    on = 20 * np.log10(e / e.max()) > floor_db
    spans = []; i = 0
    while i < k:
        if on[i]:
            j = i
            while j + 1 < k and on[j + 1]: j += 1
            spans.append([i * frame, (j + 1) * frame]); i = j + 1
        else: i += 1
    merged = []
    for s in spans:
        if merged and s[0] - merged[-1][1] < join: merged[-1][1] = s[1]
        else: merged.append(s)
    return [[round(max(0, a - pad), 3), round(min(len(x) / FS, b + pad), 3)] for a, b in merged if b - a >= 0.04]

def active_rms(x, spans):
    m = np.zeros(len(x), bool)
    for a, b in spans: m[int(a * FS):int(b * FS)] = True
    return rms(x[m]) if m.any() else rms(x)

def say(voice, text):
    with tempfile.TemporaryDirectory() as d:
        aiff, wav = os.path.join(d, 'a.aiff'), os.path.join(d, 'a.wav')
        subprocess.run(['say', '-v', voice, '-o', aiff, text], check=True)
        subprocess.run([AFCONVERT, '-f', 'WAVE', '-d', 'LEI16@%d' % FS, '-c', '1', aiff, wav], check=True)
        with wave.open(wav, 'rb') as w: x = np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').astype(np.float64) / 32768
        assert w.getframerate() == FS and w.getnchannels() == 1
    idx = np.where(np.abs(x) > 0.004)[0]
    x = x[max(0, idx[0] - int(0.05 * FS)):idx[-1] + int(0.12 * FS)]
    return x / np.max(np.abs(x)) * 0.7

def room(x, t60=0.18, wet=0.22, seed=1):
    """A short, dense tail: decaying noise as the impulse response of a small cavity."""
    r = np.random.RandomState(seed); n = int(t60 * 1.6 * FS)
    ir = r.randn(n) * np.exp(-6.9 * np.arange(n) / (t60 * FS)); ir[0] = 0; ir /= np.sqrt(np.sum(ir ** 2))
    return x + wet * signal.fftconvolve(x, ir)[:len(x)]

def knock(seed, hard=1.0):
    """One knuckle or stone strike on a slab: a 4 ms contact click plus a handful of damped plate modes."""
    r = np.random.RandomState(seed); n = int(0.22 * FS); t = np.arange(n) / FS
    y = np.zeros(n)
    for f, d, a in [(172, 0.045, 1.0), (305, 0.032, 0.7), (540, 0.022, 0.55), (910, 0.014, 0.4), (1650, 0.008, 0.28), (2900, 0.005, 0.16)]:
        f *= 1 + 0.04 * r.randn(); y += a * np.exp(-t / d) * np.sin(2 * np.pi * f * t + r.rand() * 0.6)
    click = r.randn(n) * np.exp(-t / 0.0018); b, a_ = signal.butter(2, [900 / (FS / 2), 6000 / (FS / 2)], 'band')
    y += 0.5 * signal.lfilter(b, a_, click)
    y *= np.minimum(1, t / 0.0006)
    return hard * y

def knocks():
    """Three knocks, a pause, three knocks: the pattern rescuers ask a trapped person to make."""
    x = np.zeros(int(4.0 * FS)); times = [0.20, 0.52, 0.84, 2.10, 2.42, 2.74]
    for i, t0 in enumerate(times):
        t0 += 0.012 * rs.randn(); k = knock(100 + i, 0.8 + 0.3 * rs.rand()); a = int(t0 * FS); x[a:a + len(k)] += k
    x = room(x, 0.16, 0.25, 7)
    return x / np.max(np.abs(x)) * 0.8, [[0.18, 1.08], [2.08, 2.98]]

def cough_one(seed, f0=165.0):
    """A procedural cough: an explosive burst of turbulent noise through three vocal-tract resonances, a breathy
    middle, and a short voiced tail. This is a rough physical sketch, not a recording, and it is tested as such."""
    r = np.random.RandomState(seed); n = int(0.42 * FS); t = np.arange(n) / FS
    env = np.where(t < 0.012, t / 0.012, 0) + np.where((t >= 0.012) & (t < 0.07), 1.0 - 0.45 * (t - 0.012) / 0.058, 0) \
        + np.where((t >= 0.07) & (t < 0.26), 0.55 * np.exp(-(t - 0.07) / 0.09), 0) + np.where(t >= 0.26, 0.55 * np.exp(-0.19 / 0.09) * np.exp(-(t - 0.26) / 0.05), 0)
    src = r.randn(n)
    voiced = np.clip((t - 0.2) / 0.04, 0, 1) * np.clip((0.4 - t) / 0.08, 0, 1)
    ph = 2 * np.pi * np.cumsum(f0 * (1 - 0.25 * t / 0.42)) / FS
    glottal = np.maximum(0, np.sin(ph)) ** 3
    src = src * (1 - 0.55 * voiced) + 2.2 * voiced * (glottal - glottal.mean())
    y = np.zeros(n)
    for f, bw, g in [(620, 220, 1.0), (1350, 300, 0.8), (2550, 420, 0.5), (3600, 700, 0.25)]:
        b, a = signal.iirpeak(f / (FS / 2), f / bw); y += g * signal.lfilter(b, a, src)
    b, a = signal.butter(1, 5200 / (FS / 2)); y = signal.lfilter(b, a, y + 0.15 * src)
    return y * env

def cough():
    x = np.zeros(int(2.4 * FS))
    for i, (t0, g, f0) in enumerate([(0.15, 1.0, 170), (0.72, 0.8, 158), (1.55, 0.9, 176)]):
        c = cough_one(300 + i, f0); a = int(t0 * FS); x[a:a + len(c)] += g * c
    x = room(x, 0.12, 0.12, 9)
    return x / np.max(np.abs(x)) * 0.8, [[0.13, 1.14], [1.53, 1.97]]

def rain(n):
    """Rain on debris: hiss with a spectral tilt, plus thousands of small drop ticks at random times."""
    r = np.random.RandomState(11); w = r.randn(n)
    b, a = signal.butter(2, [700 / (FS / 2), 7000 / (FS / 2)], 'band'); hiss = signal.lfilter(b, a, w)
    hiss *= 1 + 0.15 * signal.lfilter(*signal.butter(1, 0.6 / (FS / 2)), r.randn(n)) * 30
    drops = np.zeros(n)
    for t0 in r.randint(0, n - 400, int(n / FS * 260)):
        f = r.uniform(1800, 5200); d = r.uniform(0.0012, 0.004); m = 320; tt = np.arange(m) / FS
        drops[t0:t0 + m] += r.uniform(0.2, 1.0) * np.exp(-tt / d) * np.sin(2 * np.pi * f * tt)
    low = signal.lfilter(*signal.butter(2, 220 / (FS / 2)), r.randn(n)) * 0.6
    return hiss / rms(hiss) + 0.9 * drops / rms(drops) + low / rms(low) * 0.35

def generator(n):
    """A small petrol generator: a 3000 rev/min single-cylinder engine, firing 25 times a second, with harmonics, cycle-to-cycle variation and mechanical hiss."""
    r = np.random.RandomState(12); t = np.arange(n) / FS
    f0 = 25.0 * (1 + 0.006 * signal.lfilter(*signal.butter(1, 1.5 / (FS / 2)), r.randn(n)) * 40)
    ph = 2 * np.pi * np.cumsum(f0) / FS; y = np.zeros(n)
    for k in range(1, 41):
        y += (1.0 / k ** 0.75) * (1 + 0.5 * np.cos(k * 0.9)) * np.sin(k * ph + r.rand() * 6.28)
    cyc = (ph / (2 * np.pi)) % 1.0; pulse = np.exp(-cyc / 0.12)
    mech = signal.lfilter(*signal.butter(2, [400 / (FS / 2), 3800 / (FS / 2)], 'band'), r.randn(n)) * (0.4 + pulse)
    return y / rms(y) + 0.55 * mech / rms(mech)

def wind(n):
    """Wind across a gap: brown-ish noise whose loudness and brightness wander over seconds, with a faint whistle."""
    r = np.random.RandomState(13); w = r.randn(n)
    gust = signal.lfilter(*signal.butter(2, 0.35 / (FS / 2)), r.randn(n)); gust = (gust - gust.min()) / (gust.max() - gust.min())
    lowb = signal.lfilter(*signal.butter(2, 180 / (FS / 2)), w); midb = signal.lfilter(*signal.butter(2, [180 / (FS / 2), 1100 / (FS / 2)], 'band'), w)
    t = np.arange(n) / FS; fw = 640 + 160 * gust; whistle = np.sin(2 * np.pi * np.cumsum(fw) / FS) * signal.lfilter(*signal.butter(1, 8 / (FS / 2)), np.abs(r.randn(n)))
    y = lowb / rms(lowb) * (0.5 + gust) + midb / rms(midb) * (0.15 + 0.9 * gust ** 2) + 0.18 * whistle / rms(whistle) * gust ** 2
    return y

def loopable(x, fade=0.25):
    """Cross-fades the tail into the head so the page can loop the noise without a click."""
    m = int(fade * FS); k = np.linspace(0, 1, m); y = x[:-m].copy(); y[:m] = x[:m] * k + x[-m:] * (1 - k); return y

manifest = {'fs': FS, 'made_with': 'macOS say (text-to-speech) + numpy/scipy procedural synthesis; see voice-make.py', 'speech': [], 'events': [], 'noise': []}
for sid, code, lang, voice, text, meaning in SPEECH:
    x = say(voice, text); spans = active_spans(x); name = 'voice-speech-%s.wav' % sid; save(name, x)
    manifest['speech'].append({'id': sid, 'file': name, 'lang': code, 'language': lang, 'tts_voice': voice, 'text': text, 'meaning': meaning,
                               'dur': round(len(x) / FS, 3), 'spans': spans, 'active_rms': round(active_rms(x, spans), 5)})
    print(name, round(len(x) / FS, 2), 's', spans)
for name, (x, spans), label in [('voice-knock.wav', knocks(), 'knock'), ('voice-cough.wav', cough(), 'cough')]:
    save(name, x)
    manifest['events'].append({'id': label, 'file': name, 'dur': round(len(x) / FS, 3), 'spans': spans, 'active_rms': round(active_rms(x, spans), 5)})
    print(name, round(len(x) / FS, 2), 's')
N = int(10.5 * FS)
for nid, fn, label in [('rain', rain, 'Rain on debris'), ('generator', generator, 'Petrol generator'), ('wind', wind, 'Wind through a gap')]:
    x = loopable(fn(N)); x = x / rms(x) * 0.08; name = 'voice-noise-%s.wav' % nid; save(name, x)
    manifest['noise'].append({'id': nid, 'file': name, 'label': label, 'dur': round(len(x) / FS, 3), 'rms': round(rms(x), 5)})
    print(name, round(len(x) / FS, 2), 's peak', round(float(np.max(np.abs(x))), 3))
with open(os.path.join(OUT, 'voice-stems.json'), 'w') as f: json.dump(manifest, f, ensure_ascii=False, indent=1)
print('ok')
