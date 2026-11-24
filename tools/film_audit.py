"""Measures a cut against what the research says (docs/EDITING.md). python3 tools/film_audit.py FILM.mp4 EDIT.json [-v]. Needs numpy and scipy."""
import json, subprocess, sys
import numpy as np
from scipy import ndimage, signal
FF = "/Library/Frameworks/Python.framework/Versions/3.12/lib/python3.12/site-packages/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1"
W, H, R = 192, 108, 20
def frames(f):
    r = subprocess.run([FF, '-loglevel', 'error', '-i', f, '-vf', f'scale={W}:{H}:flags=area,fps={R}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
    return np.frombuffer(r, np.uint8).reshape(-1, H, W, 3).astype(np.float32) / 255
def audio(f):
    r = subprocess.run([FF, '-loglevel', 'error', '-i', f, '-ac', '1', '-ar', '22050', '-f', 'f32le', '-'], capture_output=True).stdout
    return np.frombuffer(r, np.float32).copy()
yy, xx = np.mgrid[0:H, 0:W]; CB = np.exp(-(((xx - W / 2) / (.30 * W)) ** 2 + ((yy - H / 2) / (.30 * H)) ** 2) / 2)
def sal(fr):
    """Where people would look: what moves, what stands out, and the pull of the centre."""
    g = fr.mean(3); m = np.abs(np.diff(g, axis=0)).mean(0) if len(g) > 1 else np.zeros((H, W)); a = g.mean(0)
    c = np.abs(ndimage.gaussian_filter(a, 1.5) - ndimage.gaussian_filter(a, 9)); col = np.abs(fr.mean(0) - fr.mean((0, 1, 2))).sum(2); col = np.abs(col - ndimage.gaussian_filter(col, 9))
    n = lambda q: q / (q.max() + 1e-6)
    s = (.8 * n(ndimage.gaussian_filter(m, 2)) * min(1, m.max() / .05) + .6 * n(c) + .4 * n(col)) * (.25 + .75 * CB); s = ndimage.gaussian_filter(s, 3.5)
    if a.max() < .03: s = CB * 1e-3
    w = np.maximum(s - .6 * s.max(), 0); w = w / (w.sum() + 1e-9); return float((w * xx).sum() / W), float((w * yy).sum() / H), a
def main(f, e, v):
    ed = json.load(open(e)); S = ed['segments']; t = 0; C = []
    for x in S: d = x['d'] / x['s']; C.append((t, t + d, x)); t += d
    F = frames(f); n = len(F); rows = []
    lum = F.mean((1, 2, 3)); mo = np.r_[0, np.abs(np.diff(F.mean(3), axis=0)).mean((1, 2))]
    cx = np.array([np.abs(ndimage.sobel(q.mean(2), 0)).mean() + np.abs(ndimage.sobel(q.mean(2), 1)).mean() for q in F[::4]])
    pv = None
    for k, (a, b, x) in enumerate(C):
        i, j = int(round(a * R)) + 1, max(int(round(b * R)) - 1, int(round(a * R)) + 2); hx, hy, h = sal(F[i:min(i + 8, j)]); ex, ey, l = sal(F[max(j - 6, i):j]); black = x['clip'] in ('black', 'k_title', 'k_end')
        jump = None if pv is None else float(np.hypot(hx - pv[0], (hy - pv[1]) * H / W))
        rows.append(dict(t=a, d=b - a, clip=x['clip'], jump=jump, black=black, cx=float(cx[i // 4:max(j // 4, i // 4 + 1)].mean()), mo=float(mo[i + 1:j].mean()) if j > i + 1 else 0., lum=float(lum[i:j].mean()), still=float((mo[i + 1:j] < .0006).mean()) if j > i + 1 else 0.))
        pv = None if black else (ex, ey)
    A = audio(f); hop = 220; S_ = np.abs(signal.stft(A, 22050, nperseg=1024, noverlap=1024 - hop)[2]); fl = np.maximum(np.diff(np.log1p(30 * S_), axis=1), 0).sum(0); fl = fl / (np.convolve(fl, np.ones(200) / 200, 'same') + 1e-6)
    pk = signal.find_peaks(fl, height=1.9, distance=6)[0] * hop / 22050
    off = [float(np.min(np.abs(pk - r['t']))) for r in rows if r['t'] > 0]
    cuts = [r for r in rows if r['jump'] is not None and not r['black']]; J = np.array([r['jump'] for r in cuts])
    ds = np.array([r['d'] for r in rows if not r['black']])
    print(f'shots {len(rows)}  average {ds.mean():.2f}s  median {np.median(ds):.2f}s')
    print(f'eye jump at a cut: median {np.median(J)*100:.0f}% of the width, over 25%: {(J>.25).sum()} of {len(J)}')
    print(f'cuts within 60 ms of a sound accent: {np.mean(np.array(off)<.06)*100:.0f}%  median {np.median(off)*1000:.0f} ms')
    print(f'still frames: {sum(r["still"]*r["d"] for r in rows if not r["black"]):.1f}s')
    q = np.linspace(0, C[-1][1], 13)
    print('part     shot   motion  light  busy'); 
    for a, b in zip(q, q[1:]):
        z = [r for r in rows if a <= r['t'] + r['d'] / 2 < b and not r['black']]
        if z: print(f'{a:5.0f}-{b:3.0f} {np.mean([r["d"] for r in z]):6.2f} {100*np.mean([r["mo"] for r in z]):7.2f} {np.mean([r["lum"] for r in z]):6.2f} {np.mean([r["cx"] for r in z]):6.2f}')
    if v:
        print('worst eye jumps'); 
        for r in sorted(cuts, key=lambda r: -r['jump'])[:24]: print(f"  {r['t']:6.2f} {r['clip']:9s} {r['jump']*100:4.0f}%")
        print('busiest and longest'); 
        for r in sorted(rows, key=lambda r: -r['cx'] * r['d'])[:14]: print(f"  {r['t']:6.2f} {r['clip']:9s} d{r['d']:.1f} busy {r['cx']:.2f}")
        print('still'); 
        for r in sorted(rows, key=lambda r: -r['still'] * r['d'])[:10]: print(f"  {r['t']:6.2f} {r['clip']:9s} d{r['d']:.1f} still {r['still']*r['d']:.1f}s")
        print('cuts far from an accent', [f"{r['t']:.2f} {r['clip']} {o*1000:.0f}" for r, o in zip(rows[1:], off) if o > .15][:40])
    json.dump(rows, open('/tmp/audit.json' if False else f.rsplit('/', 1)[0] + '/audit.json', 'w'))
main(sys.argv[1], sys.argv[2], '-v' in sys.argv)
