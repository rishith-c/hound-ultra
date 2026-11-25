"""The word HOUND and one very large O, as transparent pictures, with the exact places in a 3840 x 2160 frame."""
import os, sys, json
import numpy as np
sys.path.insert(0, os.path.expanduser('~/Developer/hound-ultra/tools')); import film_cut as fc
from PIL import Image
D = os.path.dirname(os.path.abspath(__file__)) + '/b/'; fc.K = 4
word = lambda y, s: f'<div style="position:absolute;left:0;right:0;top:{y}px;text-align:center;font:400 {s}px/1 HSerif;letter-spacing:.2em;text-indent:.2em;color:#eef1f4">HOUND</div>'
fc.stills([('w_title.png', word(425, 230)), ('w_end.png', word(352, 190)), ('O.png', '<div style="position:absolute;left:0;right:0;top:-125px;text-align:center;font:400 1350px/1 HSerif;color:#eef1f4">O</div>')], D)
out = {}
def boxes(n):
    a = np.asarray(Image.open(D + n))[..., 3]; cols = (a > 8).any(0); e = np.flatnonzero(np.diff(np.r_[0, cols.astype(int), 0])); L = []
    for x0, x1 in zip(e[::2], e[1::2]):
        r = np.flatnonzero((a[:, x0:x1] > 8).any(1)); L.append((int(x0), int(r[0]), int(x1), int(r[-1]) + 1))
    return a, L
for n in ('w_title', 'w_end'):
    a, L = boxes(n + '.png'); O = L[1]; s = np.pad(a[O[1]:O[3], O[0]:O[2]], 1); mid = s[s.shape[0] // 2] > 128; e = np.flatnonzero(np.diff(mid.astype(int))); cv = s[:, s.shape[1] // 2] > 128; f = np.flatnonzero(np.diff(cv.astype(int)))
    out[n] = dict(letters=[[v / 2 for v in b] for b in L], O=[v / 2 for v in O], hole=[(O[0] + e[1]) / 2, (O[1] + f[1]) / 2, (O[0] + e[2]) / 2, (O[1] + f[2]) / 2])
    x0, y0, x1, y1 = min(b[0] for b in L) - 8, min(b[1] for b in L) - 8, max(b[2] for b in L) + 8, max(b[3] for b in L) + 8
    Image.open(D + n + '.png').crop((x0, y0, x1, y1)).save(D + n + '_c.png'); out[n]['crop'] = [v / 2 for v in (x0, y0, x1, y1)]
a, L = boxes('O.png'); print('big O', L, a.shape); b = L[0]; Image.open(D + 'O.png').crop((b[0] - 8, b[1] - 8, b[2] + 8, b[3] + 8)).save(D + 'O_c.png'); out['big'] = dict(size=[b[2] - b[0], b[3] - b[1]], pad=8)
json.dump(out, open(D + 'title.json', 'w'), indent=1); print(json.dumps(out)[:900])
