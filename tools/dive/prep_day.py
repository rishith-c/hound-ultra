"""Real day, 26 August 2026: the clear Earth under it and how thick the cloud is, for three picture sizes."""
import os, numpy as np
from PIL import Image
from scipy import ndimage as nd
Image.MAX_IMAGE_PIXELS = None
T = os.path.dirname(os.path.abspath(__file__)) + '/t/day/'; B = T + '../../b/'
L = lambda n: np.asarray(Image.open(T + n + '.jpg').convert('RGB')).astype(np.float32) / 255
for s in ('globe', 'asia', 'nepal'):
    base = L(s + '_base'); D = [L(f'{s}_{k}') for k in ('n20', 'n21', 'snpp')]
    if base.shape != D[0].shape: base = np.asarray(Image.fromarray((base * 255).astype(np.uint8)).resize((D[0].shape[1], D[0].shape[0]), Image.LANCZOS)).astype(np.float32) / 255
    ocean = nd.gaussian_filter(((base[..., 2] > base[..., 0] * 1.35) & (base.max(-1) < .42)).astype(np.float32), 2)[..., None]
    M = [d.min(-1, keepdims=True) for d in D]; ok = [(d.max(-1, keepdims=True) > .02).astype(np.float32) for d in D]
    # land: the first satellite that has a picture; ocean: the darkest of the three takes the sun's reflection out
    land = M[0] * ok[0] + (1 - ok[0]) * (M[1] * ok[1] + (1 - ok[1]) * M[2])
    big = [m + (1 - o) * 9 for m, o in zip(M, ok)]; sea = np.sort(np.concatenate(big, -1), -1); sea = np.where(sea[..., 1:2] < 5, sea[..., :1] * .7 + sea[..., 1:2] * .3, sea[..., :1]); sea = np.where(sea > 5, 0, sea)
    m = land * (1 - ocean) + sea * ocean
    bm = base.min(-1, keepdims=True); clear = .075 * ocean + (1 - ocean) * (.10 + .80 * nd.gaussian_filter(bm[..., 0], 1.2)[..., None])
    snow = np.clip((bm - .45) / .25, 0, 1); a = np.clip((m - clear - .035) / np.maximum(.93 - clear, .12), 0, 1) * (1 - .55 * snow)
    any_ok = np.clip(ok[0] + ok[1] + ok[2], 0, 1); a = a * any_ok
    a = np.clip(a, 0, 1)
    out = np.concatenate([base, a], -1); Image.fromarray((out * 255 + .5).astype(np.uint8), 'RGBA').save(B + f'day_{s}.png', compress_level=1)
    print(s, out.shape, 'cloud', a.mean().round(3), flush=True)
n = L('globe_night'); Image.fromarray((np.clip(n, 0, 1) * 255).astype(np.uint8)).resize((8192, 4096), Image.LANCZOS).save(B + 'night_globe.png', compress_level=1)
n = Image.open(T + 'asia_night.jpg').convert('RGB'); n.save(B + 'night_asia.png', compress_level=1); print(n.size)
