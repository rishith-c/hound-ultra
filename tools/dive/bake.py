"""Turns the tiles into what the renderer needs: colour-matched image levels, one 3-D ground, the river, the clouds."""
import json, math, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as nd
from fetch import PLAN, corner, merc
Image.MAX_IMAGE_PIXELS = None
D = os.path.dirname(os.path.abspath(__file__)) + '/'; B = D + 'b/'; os.makedirs(B, exist_ok=True)
EARTH = 40075016.686; R = 6371008.8
x0, y0 = corner(18, 24)
TX, TY = (x0 + 2693 / 256) / 2 ** 18, (y0 + 3345 / 256) / 2 ** 18          # the landing point: the yard between river and village
LON = TX * 360 - 180; LAT = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * TY)))); C = math.cos(math.radians(LAT)); M = EARTH * C
def img(z): return np.asarray(Image.open(D + f't/img{z}.png').convert('RGB')).astype(np.float32) / 255
def dem(z):
    a = np.asarray(Image.open(D + f't/dem{z}.png').convert('RGB')).astype(np.float32); return a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
def lvl(z, n): return corner(z, n)
blur = lambda a, s: np.stack([nd.gaussian_filter(a[..., k], s, mode='nearest') for k in range(a.shape[2])], -1)

def colour():
    """One look from 0.5 m to 300 m a pixel: take the haze out of the closest level, then match each wider level to the one inside it."""
    prev = None
    for z in range(18, 8, -1):
        a = img(z); n = PLAN[z]
        if z >= 13:                                             # haze: a constant veil, different in each colour
            lo = np.percentile(a.reshape(-1, 3)[::97], 0.4, axis=0); hi = np.percentile(a.reshape(-1, 3)[::97], 99.8, axis=0) if z >= 15 else np.array([1, 1, 1.])
            hi = np.maximum(hi, 0.62 if z >= 15 else 1); a = np.clip((a - lo * .86) / (hi - lo * .86), 0, 1)
        if z >= 15: a = np.clip(a, 0, 1) ** np.array([.80, .86, .88])
        g = (a * [.2126, .7152, .0722]).sum(-1, keepdims=True); sat = 1.06 if z >= 15 else (1.0 if z >= 12 else .62)
        a = np.clip(g + (a - g) * sat, 0, 1)
        if prev is not None:
            pz, pa, (px, py), pn = prev; x, y = lvl(z, n); s = pa.shape[0] // 2
            d = pa.reshape(s, 2, s, 2, 3).mean((1, 3)); ox, oy = int(round((px / 2 - x) * 256)), int(round((py / 2 - y) * 256))
            X0, Y0 = max(0, ox), max(0, oy); X1, Y1 = min(a.shape[1], ox + s), min(a.shape[0], oy + s)
            fine = d[Y0 - oy:Y1 - oy, X0 - ox:X1 - ox]; mine = a[Y0:Y1, X0:X1]; sg = fine.shape[0] / 14
            def small(x, f): h, w = x.shape[0] // f * f, x.shape[1] // f * f; return x[:h, :w].reshape(h // f, f, w // f, f, 3).mean((1, 3))
            f = 16; qs = np.clip((blur(small(fine, f), 6) + .02) / (blur(small(mine, f), 6) + .02), .55, 1.8); gain = np.clip(np.exp(np.log(qs).mean((0, 1))), .6, 1.6)
            lq = np.ones((a.shape[0] // f, a.shape[1] // f, 3), np.float32) * gain; w = np.zeros(lq.shape[:2], np.float32)
            yy, xx = Y0 // f, X0 // f; hh, ww = min(qs.shape[0], lq.shape[0] - yy), min(qs.shape[1], lq.shape[1] - xx)
            lq[yy:yy + hh, xx:xx + ww] = qs[:hh, :ww]; w[yy:yy + hh, xx:xx + ww] = 1
            sm = nd.gaussian_filter(w, w.shape[0] / 30)[..., None]; mixq = blur(lq, 5) * sm + gain * (1 - sm)
            full = np.stack([np.asarray(Image.fromarray(mixq[..., c].astype(np.float32)).resize((a.shape[1], a.shape[0]), Image.BILINEAR)) for c in range(3)], -1)
            a = np.clip(a * full, 0, 1); print(z, 'gain', gain.round(2))
        prev = (z, a, lvl(z, n), n)
        Image.fromarray((a * 255 + .5).astype(np.uint8)).save(B + f'c{z}.png', compress_level=1)

class Dem:
    def __init__(s):
        s.L = []
        for z in range(14, 5, -1):
            n = 16 if z == 14 else 8; a = dem(z); s.L.append((z, lvl(z, n), n, nd.gaussian_filter(a, .8)))
    def at(s, mx, my, sp):
        """Height at mercator (mx, my) for a wanted spacing in metres. Blends between levels so there are no steps."""
        out = np.zeros(mx.shape, np.float32); done = np.zeros(mx.shape, np.float32)
        for z, (x, y), n, a in s.L:
            res = M / 2 ** z / 256; u = (mx * 2 ** z - x) * 256 - .5; v = (my * 2 ** z - y) * 256 - .5; N = n * 256
            e = np.minimum(np.minimum(u, v), np.minimum(N - 1 - u, N - 1 - v)); w = np.clip(e / (N * .08), 0, 1) * np.clip(1.5 - np.log2(np.maximum(sp / res, .01)) / 2, 0, 1) if z > 6 else np.clip(e / (N * .08), 0, 1)
            w = w * (1 - done); m = w > 0
            if m.any(): out[m] += w[m] * nd.map_coordinates(a, [v[m], u[m]], order=1, mode='nearest'); done += w
        return np.maximum(out, 0) 

def ring():
    """The whole Earth as rings round the landing point, from half a metre to the far side."""
    d = Dem(); nr, na = 1250, 1440
    r = np.concatenate([[0], np.exp(np.linspace(math.log(40), math.log(math.pi * R * .93), nr - 1))]); th = np.linspace(0, 2 * math.pi, na, endpoint=False)
    delta = (r / R)[:, None]; th = th[None, :]; p1 = math.radians(LAT); l1 = math.radians(LON)
    sp = np.sin(p1) * np.cos(delta) + np.cos(p1) * np.sin(delta) * np.cos(th); p2 = np.arcsin(np.clip(sp, -1, 1))
    l2 = l1 + np.arctan2(np.sin(th) * np.sin(delta) * np.cos(p1), np.cos(delta) - np.sin(p1) * sp)
    mx = (np.degrees(l2) + 180) / 360; lat = np.clip(p2, -1.484, 1.484); my = (1 - np.arcsinh(np.tan(lat)) / math.pi) / 2
    near = np.broadcast_to(delta < .02, mx.shape)               # close in, use the exact small-angle offset so the picture does not swim
    spc = np.broadcast_to(np.maximum(r * .006, 4)[:, None], mx.shape)
    h = d.at(mx, my, spc) * np.clip(1 - (np.broadcast_to(r[:, None], mx.shape) - 1.5e6) / 1e6, 0, 1); h[0] = h[0].mean(); H0 = float(h[0, 0])
    rr = R + h; pos = np.stack([rr * np.sin(delta) * np.sin(th), rr * np.sin(delta) * np.cos(th), h * np.cos(delta) - 2 * R * np.sin(delta / 2) ** 2 - H0], -1)
    uv = np.stack([(mx - TX), (my - TY)], -1); ll = np.stack([np.degrees(l2), np.degrees(p2)], -1)
    np.savez(B + 'ring.npz', pos=pos.astype(np.float32), uv=(uv * 1e0).astype(np.float64), ll=ll.astype(np.float32), H0=H0, r=r)
    print('ring', pos.shape, 'ground at target', H0)
    return H0

def river(H0):
    o = json.load(open(os.path.expanduser('~/Developer/hound-ultra/app/workspaces/area/data/osm.json')))
    P = []
    for g in o['rivers']:
        q = np.array(g['g']); P.append(np.stack([(((q[:, 0] + 180) / 360) - TX) * M, -(((1 - np.arcsinh(np.tan(np.radians(q[:, 1]))) / math.pi) / 2) - TY) * M], -1)); print(g['name'], len(q), P[-1][0].round(), P[-1][-1].round())
    return o, P

def near(H0, G=2560, res=1.0):
    """The last two kilometres as one height picture: ground, trees where the image is green, and the buildings."""
    d = Dem(); ax = (np.arange(G) - (G - 1) / 2) * res; X, Y = np.meshgrid(ax, -ax)                # row 0 = north
    mx, my = TX + X / M, TY - Y / M; g = d.at(mx, my, np.full(X.shape, 2.0)); g = nd.gaussian_filter(g, 5) - H0
    a = np.asarray(Image.open(B + 'c18.png')).astype(np.float32) / 255; u = ((mx * 2 ** 18 - x0) * 256 - .5); v = ((my * 2 ** 18 - y0) * 256 - .5)
    c = np.stack([nd.map_coordinates(nd.gaussian_filter(a[..., k], .8), [v, u], order=1, mode='nearest') for k in range(3)], -1)
    lum = (c * [.3, .59, .11]).sum(-1); green = c[..., 1] - np.maximum(c[..., 0], c[..., 2])
    tex = nd.gaussian_filter(np.abs(lum - nd.gaussian_filter(lum, 2.5)), 8)
    veg = np.clip((green - .012) / .05, 0, 1) * np.clip((.50 - lum) / .16, 0, 1); veg = nd.gaussian_filter(veg, 1.2)
    loc = (lum - nd.gaussian_filter(lum, 5)) / (nd.gaussian_filter(np.abs(lum - nd.gaussian_filter(lum, 5)), 9) + .012); rng = np.random.default_rng(4)
    rough = nd.gaussian_filter(rng.standard_normal(X.shape), 2.2); rough /= rough.std()
    can = veg * np.clip(3.4 + 1.5 * np.clip(loc, -2, 2) + 1.1 * rough, 0, 9)
    can = nd.gaussian_filter(can, .8)
    np.savez(B + 'near_tmp.npz', g=g.astype(np.float32), can=can.astype(np.float32), veg=veg.astype(np.float32), X=X.astype(np.float32), Y=Y.astype(np.float32))
    Image.fromarray((c * 255).astype(np.uint8)).save(B + 'near_c.png'); Image.fromarray((np.clip(can / 9, 0, 1) * 255).astype(np.uint8)).save(B + 'near_can.png')
    print('near', g.shape, 'height range', g.min(), g.max(), 'canopy share', (can > 1.5).mean())

if __name__ == '__main__':
    w = sys.argv[1:] or ['colour', 'ring', 'near']
    if 'colour' in w: colour()
    H0 = ring() if 'ring' in w else float(np.load(B + 'ring.npz')['H0'])
    if 'near' in w: near(H0); river(H0)
    print('target', LON, LAT)
