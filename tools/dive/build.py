"""Houses as real boxes with straight edges, fitted to the roofs in the satellite picture, and the shadows that houses and trees throw."""
import json, math, os
import numpy as np, cv2
from scipy import ndimage as nd
from PIL import Image
from bake import B, M, TX, TY, x0, y0
from render import SUN
Image.MAX_IMAGE_PIXELS = None; PX = M / 2 ** 18 / 256; RNG = np.random.default_rng(11)
n = 2560; near = np.fromfile(B + 'near.bin', 'f4').reshape(n, n, -1); g, can = near[..., 0].astype(np.float64), near[..., 1].astype(np.float64)
v = json.load(open(B + 'vil.json')); res = v['res']; nx, ny = v['nx'], v['ny']; X, Y = np.meshgrid(v['x0'] + np.arange(nx) * res, v['y1'] - np.arange(ny) * res)
at = lambda a, X, Y: nd.map_coordinates(a, [(n - 1) / 2 - Y, X + (n - 1) / 2], order=1)
gg, cc = at(g, X, Y), at(can, X, Y)
a = np.asarray(Image.open(B + 'c18.png')).astype(np.float32) / 255
mx, my = TX + X / M, TY - Y / M; U, V = (mx * 2 ** 18 - x0) * 256 - .5, (my * 2 ** 18 - y0) * 256 - .5
c = np.stack([nd.map_coordinates(nd.gaussian_filter(a[..., k], .5), [V, U], order=1) for k in range(3)], -1); r_, g_, b_ = c[..., 0], c[..., 1], c[..., 2]; lum = (c * [.3, .59, .11]).sum(-1)
def poly(P):
    P = np.array(P, float); q = np.stack([((2350 + 1.1 * P[:, 0] - 2693) * PX - v['x0']) / res, (v['y1'] - (3345 - 2500 - 1.1 * P[:, 1]) * PX) / res], -1); m = np.zeros(X.shape, np.uint8); cv2.fillPoly(m, [q.round().astype(np.int32)], 1); return m > 0
inside = poly([(425, 440), (495, 440), (515, 520), (560, 535), (600, 440), (645, 480), (645, 690), (560, 700), (558, 745), (535, 900), (515, 1040), (510, 1180), (530, 1280), (480, 1335), (440, 1345), (432, 1470), (385, 1475), (345, 1405), (305, 1220), (297, 1100), (328, 1000), (338, 950), (383, 870), (423, 800), (438, 700), (412, 640), (385, 580)])
cars = poly([(425, 445), (492, 440), (470, 560), (425, 570), (385, 640), (385, 540)]); wide = poly([(20, 60), (660, 60), (720, 780), (620, 1300), (440, 1500), (20, 1300)]); yard = poly([(230, 560), (345, 600), (330, 820), (265, 960), (215, 900)])
red = (r_ - g_ > .12) & (r_ > .50) & wide; blue = (b_ - r_ > .02) & (b_ - g_ > -.02) & (lum > .16) & wide & ~yard; grey = inside & ~cars & (b_ - r_ > -.22) & (g_ - r_ < .07) & (lum > .30); white = inside & ~cars & (lum > .66) & (r_ - b_ < .20)
veg = (g_ > r_ + .015) & (g_ > b_ + .03)
mask = ((red | blue | grey | white) & ~veg).astype(np.uint8); k3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)); mask = cv2.morphologyEx(cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k3), cv2.MORPH_OPEN, k3)
gx, gy = nd.sobel(nd.gaussian_filter(lum, .7), 1), nd.sobel(nd.gaussian_filter(lum, .7), 0); w4 = (gx + 1j * gy) ** 4 / (np.abs(gx + 1j * gy) ** 2 + 1e-6); th = np.angle(nd.gaussian_filter(w4.real, 9) + 1j * nd.gaussian_filter(w4.imag, 9)) / 4          # main direction of the walls, every 90 degrees the same
cls = np.where(red, 1, np.where(blue, 2, 3)) * mask
occ = np.zeros(X.shape, bool); boxes = []; dt = cv2.distanceTransform(mask, cv2.DIST_L2, 5); order = np.argsort(-(dt + RNG.random(dt.shape) * .4).ravel())[:400000]
sm = np.stack([nd.gaussian_filter(c[..., k], 1.5) for k in range(3)], -1)
for o in order:
    y, x = divmod(int(o), nx)
    if dt[y, x] < 1.5 or occ[y, x]: continue
    C = cls[y, x]; col = sm[y, x]; t = th[y, x]; e1 = np.array([math.cos(t), math.sin(t)]); e2 = np.array([-e1[1], e1[0]]); lim = {1: 175, 2: 50, 3: 27}[C] * RNG.uniform(.75, 1.1); ext = np.array([1.5, 1.5, 1.5, 1.5]); live = [True] * 4
    def ok(px):
        xi, yi = np.round(px[:, 0]).astype(int), np.round(px[:, 1]).astype(int); m = (xi >= 0) & (yi >= 0) & (xi < nx) & (yi < ny)
        if not m.all(): return False
        return ((mask[yi, xi] > 0) & ~occ[yi, xi] & ((cls[yi, xi] == C) | (C == 3)) & (np.abs(sm[yi, xi] - col).max(-1) < (.22 if C == 3 else .34))).mean() > (.58 if C == 3 else .62)
    while any(live):
        for s in range(4):
            if not live[s]: continue
            e = ext.copy(); e[s] += 1.0
            if e[0] + e[1] > lim or e[2] + e[3] > lim * (.62 if C == 3 else .42): live[s] = False; continue
            if s < 2: q = np.linspace(-e[2], e[3], max(4, int(e[2] + e[3]))); d = (-e[0] if s == 0 else e[1]); px = np.array([x, y]) + d * e1 + q[:, None] * e2
            else: q = np.linspace(-e[0], e[1], max(4, int(e[0] + e[1]))); d = (-e[2] if s == 2 else e[3]); px = np.array([x, y]) + d * e2 + q[:, None] * e1
            if ok(px): ext = e
            else: live[s] = False
    L, W = ext[0] + ext[1], ext[2] + ext[3]
    if L * W * res * res < 14 or min(L, W) * res < 2.6: continue
    ctr = np.array([x, y]) + (ext[1] - ext[0]) / 2 * e1 + (ext[3] - ext[2]) / 2 * e2; P4 = np.array([ctr + sx * L / 2 * e1 + sy * W / 2 * e2 for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]); tmp = np.zeros(X.shape, np.uint8); cv2.fillPoly(tmp, [P4.round().astype(np.int32)], 1)
    if (tmp.astype(bool) & occ).sum() > .25 * tmp.sum(): occ[y, x] = True; continue
    mean = np.median(c[tmp > 0], 0); occ |= cv2.dilate(tmp, k3) > 0; A = L * W * res * res; h = (RNG.choice([3.2, 5.9, 6.1, 8.8, 11.6], p=[.30, .32, .22, .13, .03]) if C == 3 else RNG.choice([3.4, 4.4, 6.0])) if A < 420 else 7.5
    boxes.append((P4, float(h + RNG.uniform(-.3, .3)), int(C), mean, float(RNG.random())))
print('boxes', len(boxes), flush=True)
walls = np.array([(.62, .58, .50), (.66, .62, .56), (.55, .42, .32), (.60, .46, .38), (.48, .52, .54), (.56, .58, .48), (.64, .50, .44), (.50, .30, .23), (.58, .55, .52), (.68, .66, .62)])
H = np.zeros(X.shape, np.float32); VB = []
def quad(p, nrm, uv, kind, col, idn, size): [VB.append([*p[i], *nrm, *uv[i], kind, *col, idn, *size]) for i in (0, 1, 2, 0, 2, 3)]
for P4, h, C, mean, idn in boxes:
    xy = np.stack([v['x0'] + P4[:, 0] * res, v['y1'] - P4[:, 1] * res], -1); s = 0.5 * np.sum(xy[:, 0] * np.roll(xy[:, 1], -1) - np.roll(xy[:, 0], -1) * xy[:, 1])
    if s < 0: xy = xy[::-1]
    zc = at(g, xy[:, 0], xy[:, 1]); z0, z1 = zc.min() - 1.2, zc.max(); top = zc.mean() + (z1 - zc.mean()) * .35 + h; wc = walls[int(idn * 977) % len(walls)] * (.80 + .3 * ((idn * 13.7) % 1)); tmp = np.zeros(X.shape, np.uint8); cv2.fillPoly(tmp, [P4.round().astype(np.int32)], 1); H = np.where(tmp > 0, np.maximum(H, top - gg), H)
    for i in range(4):
        p, q = xy[i], xy[(i + 1) % 4]; d = q - p; l = np.hypot(*d); nr = np.array([d[1], -d[0]]) / l; par = .5 if C == 3 else 0
        quad([(*p, z0), (*q, z0), (*q, top + par), (*p, top + par)], (*nr, 0), [(0, z0 - (top - h)), (l, z0 - (top - h)), (l, h + par), (0, h + par)], 0, wc, idn, (l, h))
        if par:                                  # the inside of the low wall round a flat roof
            quad([(*q, top - .05), (*p, top - .05), (*p, top + par), (*q, top + par)], (*-nr, 0), [(0, 0), (l, 0), (l, .5), (0, .5)], 3, wc * 1.05, idn, (l, h))
    e = xy[1] - xy[0]; f = xy[3] - xy[0]; le, lf = np.hypot(*e), np.hypot(*f)
    if C == 3: quad([(*xy[k], top) for k in range(4)], (0, 0, 1), [(0, 0), (le, 0), (le, lf), (0, lf)], 1, mean ** 2.2, idn, (le, lf))
    else:                                        # sheet roofs: two slopes
        a0, b0, c0, d0 = xy if le >= lf else xy[[1, 2, 3, 0]]; le2, lf2 = max(le, lf), min(le, lf); rise = lf2 * .13; m0, m1 = (a0 + d0) / 2, (b0 + c0) / 2; ov = (b0 - a0) / le2 * .4; a1, b1, c1, d1 = a0 - ov, b0 + ov, c0 + ov, d0 - ov; m0, m1 = m0 - ov, m1 + ov; sl = np.hypot(lf2 / 2, rise)
        for (p, q), (r, s2) in (((a1, b1), (m1, m0)), ((c1, d1), (m0, m1))):
            side = (p - m0) if (p is a1) else (c1 - m1); nrm = np.array([side[0], side[1], 0.]); nrm = nrm / np.hypot(*nrm[:2]) * rise; nrm[2] = lf2 / 2; nrm /= np.linalg.norm(nrm)
            quad([(*p, top), (*q, top), (*r, top + rise), (*s2, top + rise)], nrm, [(0, 0), (le2, 0), (le2, sl), (0, sl)], 2, mean ** 2.2, idn, (le2, sl))
        for p, q, m in ((b0, c0, (b0 + c0) / 2), (d0, a0, (d0 + a0) / 2)):
            d = q - p; l = np.hypot(*d); nr = np.array([d[1], -d[0]]) / l; [VB.append([*pp, *nr, 0, *uu, 0, *wc, idn, l, h]) for pp, uu in (((*p, top), (0, h)), ((*q, top), (l, h)), ((*m, top + rise), (l / 2, h + rise)))]
np.array(VB, 'f4').tofile(B + 'houses.bin'); print('house vertices', len(VB), 'roof share', round(float((H > 0).sum() * res * res)), 'm2')
Image.fromarray((np.clip(H / 12, 0, 1) * 255).astype(np.uint8)).save(B + 'roofs.png')
# shadows: walk from each point towards the sun over the height picture
def shade(top, base, r, reach):
    el = SUN[2] / math.hypot(SUN[0], SUN[1]); sx, sy = SUN[:2] / math.hypot(SUN[0], SUN[1]); lit = np.ones(top.shape, np.float32); yy, xx = np.mgrid[0:top.shape[0], 0:top.shape[1]].astype(np.float32)
    for d in np.arange(r, reach, r):
        s = cv2.remap(top.astype(np.float32), xx + np.float32(sx * d / r), yy - np.float32(sy * d / r), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE); lit = np.minimum(lit, np.clip(1 - (s - (base + d * el) - .1) / .5, 0, 1))
    return nd.gaussian_filter(lit, .7)
ao = lambda H, s: 1 - np.clip(nd.gaussian_filter((H > 1.2).astype(np.float32), s), 0, 1)
tall = np.maximum(gg + cc * (H == 0), gg + H); near_h = cv2.dilate((H > 0).astype(np.uint8), k3) > 0; cc2 = np.where(near_h, 0, cc); sh = shade(tall, np.where(H > 0, tall, gg + cc2 * .6), res, 14)
np.stack([gg, cc2, sh, np.clip(1.15 - .9 * nd.gaussian_filter((H > 0).astype(np.float32), 2.2), .35, 1) * np.where(H > 0, .5, 1)], -1).astype('f4').tofile(B + 'vil.bin')
Hn = cv2.remap(H, ((np.arange(n) - (n - 1) / 2 - v['x0']) / res)[None, :].repeat(n, 0).astype(np.float32), ((v['y1'] - ((n - 1) / 2 - np.arange(n))) / res)[:, None].repeat(n, 1).astype(np.float32), cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
sh = shade(g + can, g + can * .7, 1.0, 12); lo = nd.gaussian_filter(can, 5); np.stack([g, can, sh, np.clip(.75 + (can - lo) * .16, .45, 1.15)], -1).astype('f4').tofile(B + 'near4.bin'); print('shade', sh.mean())
