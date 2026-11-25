"""The landing ground: a finer Earth mesh, the last kilometres with trees, roofs and the river, and the noise the clouds are made of."""
import math, os, json
import numpy as np, cv2
from scipy import ndimage as nd
from scipy.spatial import cKDTree
from PIL import Image
import bake
from bake import B, R, M, TX, TY, LAT, LON, Dem, x0, y0
Image.MAX_IMAGE_PIXELS = None
H0 = float(np.load(B + 'ring.npz')['H0']); PX = M / 2 ** 18 / 256
def ring(d, nr=2000, na=2400):
    r = np.concatenate([[0], np.exp(np.linspace(math.log(120), math.log(math.pi * R * .93), nr - 1))]); th = np.linspace(0, 2 * math.pi, na + 1)
    delta = (r / R)[:, None]; th = th[None, :]; p1 = math.radians(LAT); l1 = math.radians(LON)
    sp = np.sin(p1) * np.cos(delta) + np.cos(p1) * np.sin(delta) * np.cos(th); p2 = np.arcsin(np.clip(sp, -1, 1))
    l2 = l1 + np.arctan2(np.sin(th) * np.sin(delta) * np.cos(p1), np.cos(delta) - np.sin(p1) * sp)
    mx = (np.degrees(l2) + 180) / 360; lat = np.clip(p2, -1.484, 1.484); my = (1 - np.arcsinh(np.tan(lat)) / math.pi) / 2
    spc = np.broadcast_to(np.maximum(r * .0045, 4)[:, None], mx.shape); h = np.zeros(mx.shape, np.float32)
    for k in range(0, nr, 200): h[k:k + 200] = d.at(mx[k:k + 200], my[k:k + 200], spc[k:k + 200])
    h *= np.clip(1 - (r[:, None] - 1.5e6) / 1e6, 0, 1); h[0] = h[0].mean()
    rr = R + h; pos = np.stack([rr * np.sin(delta) * np.sin(th), rr * np.sin(delta) * np.cos(th), h * np.cos(delta) - 2 * R * np.sin(delta / 2) ** 2 - H0], -1)
    v = np.concatenate([pos, (mx - TX)[..., None], (my - TY)[..., None]], -1).astype('f4')
    i = np.arange((nr - 1) * na).reshape(nr - 1, na); a = np.arange(nr * (na + 1)).reshape(nr, na + 1); q = np.stack([a[:-1, :-1], a[1:, :-1], a[:-1, 1:], a[:-1, 1:], a[1:, :-1], a[1:, 1:]], -1).astype('u4')
    v.tofile(B + 'ring_v.bin'); q.reshape(-1).tofile(B + 'ring_i.bin'); print('ring', v.shape, q.size // 3, flush=True)
# the river's middle line, read off the satellite picture near the village and from the map farther away
NEAR = np.array([(860, 0), (800, 28), (768, 70), (764, 110), (770, 148), (745, 185), (692, 214), (664, 262), (640, 284), (590, 303), (545, 322)], float)
CROP = np.array([(330, 62), (262, 108), (240, 160), (236, 250), (228, 400), (207, 560), (186, 690), (172, 800), (168, 900), (172, 1000), (160, 1130), (148, 1240), (124, 1350), (118, 1440), (118, 1520), (142, 1600), (160, 1690), (146, 1760), (100, 1810), (30, 1880)], float)
SOUTH = np.array([(398, 838), (352, 878), (310, 908), (262, 938), (218, 998)], float)
def river():
    n = np.stack([(NEAR[:, 0] - 500) * 2.56, (500 - NEAR[:, 1]) * 2.56], -1); c = np.stack([(2350 + 1.1 * CROP[:, 0] - 2693) * PX, (3345 - 2500 - 1.1 * CROP[:, 1]) * PX], -1); s = np.stack([(SOUTH[:, 0] - 500) * 2.56, (500 - SOUTH[:, 1]) * 2.56], -1)
    mid = np.concatenate([n, c, s]); o = json.load(open(os.path.expanduser('~/Developer/hound-ultra/app/workspaces/area/data/osm.json'))); P = {}
    for g in o['rivers']:
        q = np.array(g['g']); P[g['name']] = np.stack([((q[:, 0] + 180) / 360 - TX) * M, -((1 - np.arcsinh(np.tan(np.radians(q[:, 1]))) / math.pi) / 2 - TY) * M], -1)
    bk = P['Bhote Koshi']; up = bk[bk[:, 1] > mid[0, 1] + 60]; dn = bk[bk[:, 1] < mid[-1, 1] - 60]; gz = P['Gyirong Zangbo'][::-1] if 'Gyirong Zangbo' in P else None
    L = np.concatenate([up, mid, dn]); L = np.concatenate([P['Gyirong Zangbo'][:-1], L]) if gz is not None else L
    t = np.r_[0, np.cumsum(np.hypot(*np.diff(L, axis=0).T))]; tt = np.arange(0, t[-1], 1.0); D = np.stack([np.interp(tt, t, L[:, k]) for k in (0, 1)], -1); D = nd.gaussian_filter1d(D, 14, axis=0, mode='nearest'); return D
def main():
    d = Dem(); ring(d)
    D = river(); mxy = lambda X, Y: (TX + X / M, TY - Y / M); prof = d.at(*mxy(D[:, 0], D[:, 1]), np.full(len(D), 8.0)) - H0
    prof = np.minimum.accumulate(nd.gaussian_filter1d(prof, 40, mode='nearest')); prof = nd.gaussian_filter1d(prof, 60, mode='nearest'); T = cKDTree(D); print('river', len(D), 'm, level at the village', prof[np.argmin(np.hypot(*D.T))].round(1))
    G = 2048; ext = 8700.0; ax = (np.arange(G) + .5) / G * 2 * ext - ext; X, Y = np.meshgrid(ax, -ax); dist, i = T.query(np.stack([X, Y], -1).reshape(-1, 2), workers=-1)
    np.stack([dist.reshape(G, G), i.reshape(G, G).astype(float)], -1).astype('f4').tofile(B + 'river.bin')
    a = np.asarray(Image.open(B + 'c18.png')).astype(np.float32) / 255
    def pic(X, Y, s=.0):
        mx, my = mxy(X, Y); u = (mx * 2 ** 18 - x0) * 256 - .5; v = (my * 2 ** 18 - y0) * 256 - .5
        return np.stack([nd.map_coordinates(nd.gaussian_filter(a[..., k], s) if s else a[..., k], [v, u], order=1, mode='nearest') for k in range(3)], -1)
    def roofs(X, Y, res):
        c = pic(X, Y, .6); r, g, b = c[..., 0], c[..., 1], c[..., 2]; lum = (c * [.3, .59, .11]).sum(-1)
        poly = np.array([(425, 440), (495, 440), (515, 520), (560, 535), (600, 440), (645, 480), (645, 690), (560, 700), (558, 745), (535, 900), (515, 1040), (510, 1180), (530, 1280), (480, 1335), (440, 1345), (432, 1470), (385, 1475), (345, 1405), (305, 1220), (297, 1100), (328, 1000), (338, 950), (383, 870), (423, 800), (438, 700), (412, 640), (385, 580)], float)
        px = np.stack([(2350 + 1.1 * poly[:, 0] - 2693) * PX, (3345 - 2500 - 1.1 * poly[:, 1]) * PX], -1); pi = np.stack([(px[:, 0] - X[0, 0]) / res, (Y[0, 0] - px[:, 1]) / res], -1)
        inside = np.zeros(X.shape, np.uint8); cv2.fillPoly(inside, [pi.round().astype(np.int32)], 1)
        wide = np.zeros(X.shape, np.uint8); q = np.array([(20, 60), (660, 60), (720, 780), (620, 1300), (440, 1500), (20, 1300)], float); qx = np.stack([((2350 + 1.1 * q[:, 0] - 2693) * PX - X[0, 0]) / res, (Y[0, 0] - (3345 - 2500 - 1.1 * q[:, 1]) * PX) / res], -1); cv2.fillPoly(wide, [qx.round().astype(np.int32)], 1)
        red = (r - g > .13) & (r > .52) & (wide > 0); blue = (b - r > .02) & (b - g > -.02) & (lum > .16) & (wide > 0); grey = (inside > 0) & (b - r > -.085) & (g - r < .05) & (lum > .40); white = (inside > 0) & (lum > .72) & (r - b < .16)
        lab = np.zeros(X.shape, np.int32); H = np.zeros(X.shape, np.float32); I = np.zeros(X.shape, np.float32); n0 = 0; rng = np.random.default_rng(7); k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)); shades = np.clip(np.floor(lum * 14), 0, 13).astype(int)
        for m, kind in ((red, 0), (blue, 1), (grey | white, 2)):
            m = cv2.morphologyEx(cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, k), cv2.MORPH_OPEN, k)
            if kind == 2: sm = cv2.pyrMeanShiftFiltering((c * 255).astype(np.uint8), 4, 12); e = cv2.morphologyEx(sm, cv2.MORPH_GRADIENT, k).max(-1) > 26; m = m & (~e).astype(np.uint8)
            n, l, st, _ = cv2.connectedComponentsWithStats(m, connectivity=4)
            for j in range(1, n):
                A = st[j, 4] * res * res
                if A < 14 or A > 5200: continue
                w = l == j if A > 900 else None; yy, xx, hh, ww = st[j, 1], st[j, 0], st[j, 3], st[j, 2]; sub = l[yy:yy + hh, xx:xx + ww] == j
                ht = (6.5 if A > 900 else rng.choice([3.2, 5.6, 6.0, 8.4, 8.8], p=[.28, .28, .2, .16, .08])) if kind != 1 else rng.choice([3.0, 4.0, 5.6]); s2 = cv2.dilate(sub.astype(np.uint8), k) > 0 if False else sub
                H[yy:yy + hh, xx:xx + ww][s2] = ht + rng.uniform(-.4, .4); I[yy:yy + hh, xx:xx + ww][s2] = .15 + .85 * rng.random(); n0 += 1
        g2 = cv2.dilate(H, k); H = np.where((H == 0) & (cv2.dilate((H > 0).astype(np.uint8), k) > 0), g2, H); I = np.where(I == 0, cv2.dilate(I, k), I) * (H > 0); print('roofs', n0, 'covering', round(float((H > 0).sum() * res * res)), 'm2'); return H, I
    def ground(X, Y):
        g = d.at(*mxy(X, Y), np.full(X.shape, 2.0)) - H0; return g
    def carve(X, Y, g):
        ds, i = T.query(np.stack([X, Y], -1).reshape(-1, 2), workers=-1); ds = ds.reshape(X.shape); p = prof[i.reshape(X.shape)]
        bed = p - 2.5 + np.clip((ds - 20) / 26, 0, 1) ** 1.5 * 9; w = np.clip((62 - ds) / 26, 0, 1); w = w * w * (3 - 2 * w); return g * (1 - w) + np.minimum(g, bed) * w if False else g * (1 - w) + bed * w, ds
    res = 1.0; n = 2560; ax = (np.arange(n) - (n - 1) / 2) * res; X, Y = np.meshgrid(ax, -ax); t = np.load(B + 'near_tmp.npz'); g = nd.gaussian_filter(ground(X, Y), 4); g, ds = carve(X, Y, g); can = t['can'] * np.clip((ds - 34) / 14, 0, 1)
    edge = np.clip((np.minimum(n / 2 - np.abs(X), n / 2 - np.abs(Y)) - 12) / 60, 0, 1); g0 = ground(X, Y); g = g * edge + g0 * (1 - edge); can = can * edge
    np.stack([g, can], -1).astype('f4').tofile(B + 'near.bin')
    res = .5; vx0, vx1, vy0, vy1 = -240.0, 300.0, -760.0, 480.0; nx, ny = int((vx1 - vx0) / res) + 1, int((vy1 - vy0) / res) + 1; X, Y = np.meshgrid(vx0 + np.arange(nx) * res, vy1 - np.arange(ny) * res)
    u = (X + (n - 1) / 2); v = ((n - 1) / 2 - Y); gg = nd.map_coordinates(g, [v, u], order=1); cc = nd.map_coordinates(can, [v, u], order=1); H, I = roofs(X, Y, res); flat = nd.grey_dilation(H, 5) > 0
    base = nd.gaussian_filter(gg, 3); gg = np.where(H > 0, base, gg); cc = np.where(flat, 0, cc); np.stack([gg + H, cc * (H == 0), I, H], -1).astype('f4').tofile(B + 'vil.bin'); json.dump(dict(nx=nx, ny=ny, x0=vx0, y1=vy1, res=res), open(B + 'vil.json', 'w'))
    Image.fromarray((np.clip(H / 10, 0, 1) * 255).astype(np.uint8)).save(B + 'roofs.png')
    # cloud noise: soft lumps inside larger lumps, repeats without a seam
    N = 128; rng = np.random.default_rng(3); f = np.fft.fftfreq(N) * N; k = np.sqrt(f[:, None, None] ** 2 + f[None, :, None] ** 2 + f[None, None, :] ** 2); F = np.fft.fftn(rng.standard_normal((N, N, N))) * np.where(k > 1, k, 1) ** -2.2 * (k < 48) * (k > 1.5); p = np.real(np.fft.ifftn(F)); p = np.clip(.5 + p / p.std() * .19, 0, 1)
    w = np.zeros((N, N, N))
    for c, amp in ((5, .62), (11, .26), (23, .12)):
        q = rng.random((c ** 3, 3)) * N; m = np.ones((N, N, N), bool); qi = q.astype(int); z = np.concatenate([m] * 1); z[qi[:, 0], qi[:, 1], qi[:, 2]] = False; z3 = np.pad(z, 32, mode='wrap'); dd = nd.distance_transform_edt(z3)[32:-32, 32:-32, 32:-32]; w += amp * np.clip(1 - dd / (N / c * .72), 0, 1)
    out = np.stack([np.clip(w, 0, 1), p], -1); (out * 255).astype('u1').tofile(B + 'noise3.bin'); print('noise', w.mean(), p.mean())
if __name__ == '__main__': main()
