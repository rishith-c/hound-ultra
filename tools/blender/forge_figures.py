"""Sculpt the six plaster figures of the Model forge hall, as signed distance fields, and bake them to data/forge/figures.bin.gz.

    /opt/homebrew/bin/blender -b --factory-startup -P tools/blender/forge_figures.py [-- --voxel 0.006 --preview]

No scan, no portrait, no downloaded mesh: every figure is a smooth union of tapered capsules and ellipsoids on a posed
skeleton with human proportions (1.75 m, 7.5 heads), dressed in a loose shirt and trousers whose folds are displaced
on the field itself. Surface nets turn the field into a mesh; the field's gradient gives the normals, and marching the
field gives ambient occlusion and the bent (least blocked) direction, so the small meshes keep the light of the big one.
Axes: z up, the figure faces +y, its left is +x. Feet on z = 0.
"""
import gzip, json, os, sys, time
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "data", "forge", "figures.bin.gz")
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
VOX = float(argv[argv.index("--voxel") + 1]) if "--voxel" in argv else 0.006
ONLY = [int(v) for v in argv[argv.index("--only") + 1].split(",")] if "--only" in argv else range(6)
F = np.float32


def rot(ax, deg):
    a = np.radians(deg); c, s = np.cos(a), np.sin(a)
    return {"x": np.array([[1, 0, 0], [0, c, -s], [0, s, c]]), "y": np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]]), "z": np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])}[ax]


class Pose:
    """Forward kinematics. Angles in degrees: flex = forward swing, abd = outwards, twist about the bone."""
    def __init__(self, **k):
        d = dict(lean=0, side=0, twist=0, chest=0, chest_twist=0, head=0, head_yaw=0, head_tilt=0,
                 lh=(0, 4, 0), rh=(0, 4, 0), lk=4, rk=4, la=0, ra=0, lt=0, rt=0,
                 ls=(0, 8, 0), rs=(0, 8, 0), le=12, re=12, lw=0, rw=0, curl=24); d.update(k); self.__dict__.update(d)
        J = self.J = {}; B = self.B = {}
        pel = rot("z", self.twist) @ rot("y", self.side) @ rot("x", self.lean * 0.4); B["pelvis"] = pel
        J["pelvis"] = np.array([0, 0, 0.965]); U = lambda m, x, y, z: m @ np.array([x, y, z])
        sp = pel @ rot("x", -self.lean * 0.6 * -1) @ rot("y", -self.side * 1.5)
        J["waist"] = J["pelvis"] + U(pel, 0, 0, 0.135)
        ch = sp @ rot("x", -self.chest) @ rot("z", self.chest_twist); B["chest"] = ch
        J["sternum"] = J["waist"] + U(ch, 0, 0.0, 0.225); J["neck"] = J["waist"] + U(ch, 0, -0.018, 0.395)
        hd = ch @ rot("z", self.head_yaw) @ rot("x", -self.head) @ rot("y", self.head_tilt); B["head"] = hd
        J["skull"] = J["neck"] + U(ch, 0, 0.012, 0.075) + U(hd, 0, 0.014, 0.105)
        for s, sx in (("l", 1), ("r", -1)):
            fl, ab, tw = getattr(self, s + "h"); hip = J[s + "hip"] = J["pelvis"] + U(pel, sx * 0.092, 0, -0.045)
            th = pel @ rot("z", sx * -tw) @ rot("x", fl) @ rot("y", -sx * ab); B[s + "th"] = th
            kn = J[s + "knee"] = hip + U(th, 0, 0, -0.435)
            sh = th @ rot("x", -getattr(self, s + "k")); B[s + "sh"] = sh
            an = J[s + "ank"] = kn + U(sh, 0, 0, -0.425)
            B[s + "ft"] = sh @ rot("x", getattr(self, s + "a")) @ rot("z", -sx * (8 + getattr(self, s + "t")))
            fl, ab, tw = getattr(self, s + "s"); so = J[s + "sho"] = J["waist"] + U(ch, sx * 0.164, -0.016, 0.334)
            ua = ch @ rot("x", fl) @ rot("y", -sx * ab) @ rot("z", -sx * tw); B[s + "ua"] = ua
            el = J[s + "elb"] = so + U(ua, 0, 0, -0.300)
            fa = ua @ rot("x", getattr(self, s + "e")); B[s + "fa"] = fa
            wr = J[s + "wri"] = el + U(fa, 0, 0, -0.255)
            B[s + "hd"] = fa @ rot("x", getattr(self, s + "w")) @ rot("z", sx * 70)


POSES = [
    Pose(lean=-4, chest=-2, twist=-5, chest_twist=11, head=8, head_yaw=-5, lh=(27, 2, 0), lk=8, la=-14, rh=(-19, 3, 0), rk=14, ra=10, ls=(-22, 9, 0), le=14, rs=(24, 9, 0), re=26),
    Pose(lean=-3, chest=-1, twist=4, chest_twist=-9, head=5, head_yaw=8, rh=(13, 2, 0), rk=5, ra=-8, lh=(-11, 3, 0), lk=42, la=-14, rs=(-15, 8, 0), re=12, ls=(17, 10, 0), le=30),
    Pose(side=3.5, chest=2, head=12, head_yaw=6, lh=(0, 5, 0), lk=3, rh=(6, 7, 6), rk=13, ra=7, ls=(3, 8, 0), le=16, rs=(5, 11, 0), re=20),
    Pose(side=-2.5, chest=-1, twist=3, head=-3, head_yaw=-14, lh=(4, 7, 4), lk=9, la=5, rh=(-1, 5, 0), rk=2, ls=(16, 7, 34), le=66, rs=(16, 7, 34), re=62, lw=8, rw=8),
    Pose(chest=2, head=2, head_yaw=20, lh=(3, 8, 8), lk=5, la=-38, rh=(22, 13, 12), rk=46, ra=-22, ls=(4, 20, 0), le=14, rs=(6, 26, 10), re=52),
    Pose(chest=1, head=-4, head_yaw=-12, lh=(48, 8, 0), lk=88, la=0, rh=(2, 9, 8), rk=4, ra=-40, ls=(86, 6, 0), le=22, rs=(2, 24, 0), re=20, lw=-18, curl=14),
]


class Field:
    def __init__(self, lo, hi, vox):
        self.vox = vox; self.lo = np.array(lo); self.n = np.ceil((np.array(hi) - lo) / vox).astype(int) + 1
        self.ax = [(self.lo[i] + np.arange(self.n[i]) * vox).astype(F) for i in range(3)]
        self.d = {}

    def grid(self, lo, hi):
        sl = tuple(slice(max(0, int((lo[i] - self.lo[i]) / self.vox)), min(self.n[i], int((hi[i] - self.lo[i]) / self.vox) + 2)) for i in range(3))
        return sl, self.ax[0][sl[0]][:, None, None], self.ax[1][sl[1]][None, :, None], self.ax[2][sl[2]][None, None, :]

    def layer(self, name):
        if name not in self.d: self.d[name] = np.full(self.n, 0.25, F)
        return self.d[name]

    def add(self, name, lo, hi, fn, k, sub=False):
        sl, x, y, z = self.grid(np.asarray(lo) - 0.09, np.asarray(hi) + 0.09)
        L = self.layer(name); a = L[sl]; b = fn(x, y, z).astype(F)
        if sub: b = -b
        if k <= 0: L[sl] = np.maximum(a, b) if sub else np.minimum(a, b); return
        h = np.maximum(k - np.abs(a - b), 0) / k
        L[sl] = np.maximum(a, b) + h * h * k * 0.25 if sub else np.minimum(a, b) - h * h * k * 0.25

    def cone(self, name, a, b, ra, rb, k=0.02, squash=None, m=None, sub=False):
        """A capsule from a to b whose radius runs ra..rb. squash = (sx, sy) in the bone frame m (flattens it)."""
        a, b = np.asarray(a, float), np.asarray(b, float); rm = max(ra, rb) * 1.25
        def fn(x, y, z):
            px, py, pz = x - a[0], y - a[1], z - a[2]; v = b - a; L2 = v @ v
            t = np.clip((px * v[0] + py * v[1] + pz * v[2]) / L2, 0, 1)
            qx, qy, qz = px - t * v[0], py - t * v[1], pz - t * v[2]
            r = ra + (rb - ra) * t
            if squash is None: return np.sqrt(qx * qx + qy * qy + qz * qz) - r
            u = m[:, 0]; w = m[:, 1]; e = m[:, 2]
            cu, cw_, ce = (qx * u[0] + qy * u[1] + qz * u[2]) / squash[0], (qx * w[0] + qy * w[1] + qz * w[2]) / squash[1], qx * e[0] + qy * e[1] + qz * e[2]
            return (np.sqrt(cu * cu + cw_ * cw_ + ce * ce) - r) * min(squash)
        self.add(name, np.minimum(a, b) - rm, np.maximum(a, b) + rm, fn, k, sub)

    def ell(self, name, c, rad, m=np.eye(3), k=0.02, sub=False):
        c = np.asarray(c, float); R = max(rad)
        def fn(x, y, z):
            px, py, pz = x - c[0], y - c[1], z - c[2]
            q = [(px * m[0, i] + py * m[1, i] + pz * m[2, i]) for i in range(3)]
            k0 = np.sqrt(sum((q[i] / rad[i]) ** 2 for i in range(3))); k1 = np.sqrt(sum((q[i] / rad[i] ** 2) ** 2 for i in range(3)))
            return np.where(k1 > 1e-6, k0 * (k0 - 1) / np.maximum(k1, 1e-6), -min(rad))
        self.add(name, c - R, c + R, fn, k, sub)


def noise3(x, y, z, seed):
    """Cheap smooth noise: a sum of rotated sines. Enough to break up fold spacing."""
    r = np.random.default_rng(seed); o = 0
    for i in range(5):
        v = r.normal(size=3); v /= np.linalg.norm(v); f = r.uniform(5, 13); o = o + np.sin((x * v[0] + y * v[1] + z * v[2]) * f * 2 + r.uniform(0, 6.3))
    return o / 2.6


def build(pose, vox):
    P, B = pose.J, pose.B
    pts = np.array(list(P.values())); lo = pts.min(0) - 0.30; hi = pts.max(0) + 0.30
    f = Field(lo, hi, vox); pel, ch, hd = B["pelvis"], B["chest"], B["head"]
    at = lambda j, m, x, y, z: P[j] + m @ np.array([x, y, z])
    # ---- body under the cloth (layer 'skin': head, neck, forearms, hands)
    s = "skin"
    sk = P["skull"]
    f.ell(s, sk + hd @ [0, -0.008, 0.022], (0.0785, 0.095, 0.086), hd, 0)                     # cranium
    f.ell(s, sk + hd @ [0, 0.026, -0.048], (0.060, 0.068, 0.076), hd, 0.04)                 # face mass
    f.ell(s, sk + hd @ [0, 0.052, -0.100], (0.030, 0.026, 0.024), hd, 0.034)                 # chin
    for sx in (1, -1):
        f.cone(s, sk + hd @ [sx * 0.056, -0.004, -0.062], sk + hd @ [sx * 0.020, 0.058, -0.104], 0.017, 0.015, 0.03)     # jaw
        f.ell(s, sk + hd @ [sx * 0.040, 0.062, -0.034], (0.021, 0.017, 0.016), hd, 0.028)    # cheekbone
        f.ell(s, sk + hd @ [sx * 0.031, 0.094, -0.012], (0.019, 0.014, 0.010), hd, 0.020, sub=True)                   # orbit: a hollow, no eye
        f.ell(s, sk + hd @ [sx * 0.076, -0.008, -0.030], (0.008, 0.021, 0.032), hd @ rot("z", sx * 20), 0.008)       # ear
        f.ell(s, sk + hd @ [sx * 0.083, -0.004, -0.030], (0.006, 0.010, 0.017), hd @ rot("z", sx * 20), 0.006, sub=True)
    f.cone(s, sk + hd @ [0, 0.082, 0.004], sk + hd @ [0, 0.076, 0.006], 0.012, 0.012, 0.03)
    f.cone(s, sk + hd @ [0, 0.085, 0.000], sk + hd @ [0, 0.101, -0.043], 0.008, 0.0125, 0.014)                        # nose
    f.ell(s, sk + hd @ [0, 0.084, -0.074], (0.023, 0.011, 0.0085), hd, 0.016)                # lips, one soft mass
    # hair: a close, sculpted cap
    f.ell("hair", sk + hd @ [0, -0.016, 0.030], (0.0825, 0.100, 0.0885), hd, 0)
    f.ell("hair", sk + hd @ [0, -0.044, -0.030], (0.070, 0.068, 0.075), hd, 0.03)
    f.ell("hair", sk + hd @ [0, 0.100, -0.030], (0.085, 0.072, 0.092), hd, 0.02, sub=True)   # the face opening
    f.ell("hair", sk + hd @ [0, 0.02, -0.125], (0.12, 0.12, 0.062), hd, 0.015, sub=True)
    nk = P["neck"]
    f.cone(s, nk + ch @ [0, -0.016, -0.030], sk + hd @ [0, -0.030, -0.040], 0.057, 0.052, 0.04)
    for sx in (1, -1):
        f.cone(s, sk + hd @ [sx * 0.056, -0.024, -0.052], nk + ch @ [sx * 0.018, 0.048, -0.026], 0.017, 0.014, 0.022)  # sternomastoid
    f.ell(s, nk + ch @ [0, 0.042, 0.045], (0.014, 0.014, 0.020), ch, 0.02)
    # ---- torso volume (used for the shirt)
    t = "torso"; c = lambda x, y, z: P["waist"] + ch @ np.array([x, y, z])
    f.ell(t, c(0, 0.0, 0.215), (0.143, 0.104, 0.190), ch, 0)
    f.ell(t, c(0, 0.006, 0.075), (0.134, 0.097, 0.140), ch, 0.07)
    f.ell(t, P["pelvis"] + pel @ [0, -0.004, 0.02], (0.146, 0.106, 0.120), pel, 0.07)
    for sx in (1, -1):
        f.ell(t, c(sx * 0.072, 0.072, 0.232), (0.080, 0.042, 0.062), ch @ rot("z", -sx * 18), 0.05)                   # chest muscle
        f.ell(t, c(sx * 0.098, -0.062, 0.215), (0.066, 0.046, 0.115), ch, 0.05)              # shoulder blade, lat
        f.cone(t, c(sx * 0.030, -0.030, 0.385), c(sx * 0.150, -0.020, 0.330), 0.044, 0.038, 0.06)                    # trapezius to shoulder
        f.ell(t, P["pelvis"] + pel @ [sx * 0.072, -0.072, -0.030], (0.082, 0.078, 0.098), pel, 0.05)                  # seat
        f.ell(t, P["pelvis"] + pel @ [sx * 0.118, 0.0, 0.0], (0.050, 0.075, 0.095), pel, 0.05)
    f.ell(t, c(0, 0.050, 0.035), (0.095, 0.050, 0.105), ch, 0.06)
    f.cone(t, c(0, -0.070, 0.06), c(0, -0.092, 0.30), 0.010, 0.012, 0.03, sub=True)           # spine furrow
    # ---- arms
    for q, sx in (("l", 1), ("r", -1)):
        ua, fa, hn = B[q + "ua"], B[q + "fa"], B[q + "hd"]; so, el, wr = P[q + "sho"], P[q + "elb"], P[q + "wri"]
        f.ell("arm" + q, so + ua @ [sx * 0.004, 0, -0.030], (0.047, 0.051, 0.068), ua, 0)
        f.cone("arm" + q, so + ua @ [0, 0, -0.02], el, 0.043, 0.036, 0.04)
        f.ell("arm" + q, so + ua @ [0, 0.016, -0.165], (0.034, 0.036, 0.085), ua, 0.03)
        f.ell("arm" + q, so + ua @ [0, -0.020, -0.150], (0.034, 0.033, 0.095), ua, 0.03)
        f.cone(s, el + fa @ [0, 0, 0.04], el, 0.038, 0.038, 0.02)
        f.cone(s, el, wr, 0.034, 0.024, 0.03, (1.0, 0.92), fa)
        f.ell(s, el + fa @ [sx * 0.008, 0.008, -0.070], (0.033, 0.036, 0.082), fa, 0.03)
        f.ell(s, el + fa @ [0, -0.030, 0.004], (0.017, 0.014, 0.022), fa, 0.02)
        # hand: palm, four fingers and a thumb, loosely curled. Local frame: -z along the hand, x across the palm, y palm normal
        h0 = wr
        f.ell(s, h0 + hn @ [0, 0.002, -0.048], (0.039, 0.0165, 0.052), hn, 0.022)
        f.cone(s, h0, h0 + hn @ [0, 0, -0.03], 0.025, 0.027, 0.02, (1.15, 0.72), hn)
        for i, (fx, L, rr) in enumerate(((-0.029, 0.070, 0.0088), (-0.010, 0.080, 0.0092), (0.010, 0.075, 0.0090), (0.028, 0.060, 0.0080))):
            p0 = h0 + hn @ [fx * 0.9, 0.0, -0.086 + abs(fx) * 0.16]; ang = 0; d = hn @ rot("y", fx * 130); cu = pose.curl * (1 + 0.16 * i)
            for j, fr in enumerate((0.45, 0.32, 0.23)):
                ang += cu * (0.6 if j == 0 else 1.0); p1 = p0 + d @ rot("x", ang) @ [0, 0, -L * fr]
                f.cone(s, p0, p1, rr * (1 - 0.08 * j), rr * (0.94 - 0.09 * j), 0.006); p0 = p1
        tb = h0 + hn @ [-0.026, 0.008, -0.026]; t1 = tb + hn @ [-0.026, 0.018, -0.034]; t2 = t1 + hn @ [-0.006, 0.012, -0.028]
        f.cone(s, tb, t1, 0.0155, 0.011, 0.014); f.cone(s, t1, t2, 0.0108, 0.0088, 0.006)
        # ---- legs
        th, sh, ft = B[q + "th"], B[q + "sh"], B[q + "ft"]; hp, kn, an = P[q + "hip"], P[q + "knee"], P[q + "ank"]; g = "leg" + q
        f.cone(g, hp, kn, 0.089, 0.058, 0.03)
        f.ell(g, hp + th @ [sx * 0.012, 0.030, -0.180], (0.070, 0.062, 0.160), th, 0.04)
        f.ell(g, hp + th @ [0, -0.034, -0.200], (0.062, 0.056, 0.160), th, 0.04)
        f.ell(g, kn + th @ [0, 0.026, 0.0], (0.044, 0.036, 0.050), sh, 0.03)
        f.cone(g, kn, an, 0.056, 0.040, 0.03)
        f.ell(g, kn + sh @ [0, -0.026, -0.115], (0.054, 0.052, 0.110), sh, 0.03)
        # ---- shoes
        sh_ = "shoe"; lo_ = an + ft @ [0, 0, -0.030]
        f.cone(sh_, an + ft @ [0, -0.012, 0.030], lo_, 0.043, 0.041, 0.02)
        f.ell(sh_, an + ft @ [0, -0.032, -0.050], (0.036, 0.046, 0.040), ft, 0.03)
        f.cone(sh_, an + ft @ [0, 0.0, -0.026], an + ft @ [sx * 0.004, 0.125, -0.058], 0.044, 0.030, 0.03)
        f.ell(sh_, an + ft @ [sx * 0.006, 0.122, -0.061], (0.047, 0.062, 0.029), ft, 0.03)
        def cut(x, y, z, an=an, ft=ft):
            e = ft[:, 2]; return -((x - an[0]) * e[0] + (y - an[1]) * e[1] + (z - an[2]) * e[2] + 0.080)
        f.add("shoe" , an - 0.2, an + 0.2, cut, 0.006) if False else None
        c0 = an + ft @ [0, -0.045, -0.076]; c1 = an + ft @ [sx * 0.006, 0.125, -0.076]
        f.cone("sole", c0, c1, 0.040, 0.049, 0.01, (1.0, 0.95), ft)
        if q == "l": f.foot = []
        f.foot.append((an, ft))
    # flat soles
    for an, ft in f.foot:
        sl, x, y, z = f.grid(an - 0.24, an + 0.24); e = ft[:, 2]
        h = (x - an[0]) * e[0] + (y - an[1]) * e[1] + (z - an[2]) * e[2]
        near = (x - an[0]) ** 2 + (y - an[1]) ** 2 + (z - an[2]) ** 2 < 0.24 ** 2
        for nm, top in (("shoe", None), ("sole", -0.066)):
            L = f.layer(nm); v = L[sl]; w = np.maximum(v, -(h + 0.085))
            if top is not None: w = np.maximum(w, h - top)
            L[sl] = np.where(near, w, v)
    # ---- cloth
    X, Y, Z = f.ax[0][:, None, None], f.ax[1][None, :, None], f.ax[2][None, None, :]
    nz = noise3(X, Y, Z, 3).astype(F); nz2 = noise3(X * 1.9, Y * 1.9, Z * 1.9, 8).astype(F)
    def proj(a, b):
        v = b - a; L = np.linalg.norm(v); e = v / L
        return ((X - a[0]) * e[0] + (Y - a[1]) * e[1] + (Z - a[2]) * e[2]).astype(F), L
    def ang(a, m):
        u, w = m[:, 0], m[:, 1]
        return np.arctan2((X - a[0]) * w[0] + (Y - a[1]) * w[1] + (Z - a[2]) * w[2], (X - a[0]) * u[0] + (Y - a[1]) * u[1] + (Z - a[2]) * u[2]).astype(F)
    ridge = lambda v: np.power(0.5 + 0.5 * np.sin(v), 2.2)
    smin = lambda a, b, k: np.minimum(a, b) - (np.maximum(k - np.abs(a - b), 0) / k) ** 2 * k * 0.25
    G = lambda v, w: np.exp(-(v / w) ** 2)
    # shirt = torso + sleeves, loose, hem below the hips
    pz0, _ = proj(P["pelvis"], P["waist"]); shirt = f.d["torso"] - 0.009 - 0.018 * G(pz0 - 0.10, 0.16)
    for q, sx in (("l", 1), ("r", -1)):
        a, b = P[q + "sho"], P[q + "elb"]; s_, L = proj(a, b); an_ = ang(a, B[q + "ua"])
        arm = f.d["arm" + q] - (0.005 + 0.009 * np.clip(s_ / L, 0, 1) ** 1.5)
        w = G(s_ - L * 0.22, 0.08) * 0.0042 + G(s_ - L * 0.72, 0.06) * 0.0052
        arm = arm - w * ridge(s_ * 78 + np.cos(an_ - 0.6 * sx) * 4.4 + nz * 3.0)
        arm = np.maximum(arm, s_ - L * 0.80)                                              # sleeve end
        shirt = smin(shirt, arm, 0.050)
    cz, _ = proj(P["waist"], P["sternum"]); pz, _ = proj(P["pelvis"], P["waist"]); ca = ang(P["waist"], ch)
    shirt = shirt - 0.0062 * G(cz - 0.03, 0.10) * ridge(cz * 52 + np.abs(np.sin(ca)) * 4.2 + nz * 3.2)          # blousing at the waist
    shirt = shirt - 0.0050 * G(cz - 0.265, 0.06) * ridge(np.cos(ca) * 7 + np.abs(np.cos(ca)) * cz * 60 + nz * 2.2)   # drag lines from the armpits
    shirt = shirt - 0.0072 * G(pz + 0.02, 0.12) * ridge(ca * 8 + nz * 2.8 + pz * 9)                                 # skirt of the shirt hangs in flutes
    shirt = shirt - 0.0030 * nz2
    hem = -(pz + 0.075 + 0.006 * np.sin(ca * 3 + nz))
    shirt = np.maximum(shirt, hem)
    nzq, _ = proj(P["neck"], P["skull"]); col = nzq - 0.000 - 0.02 * 0
    nd = np.sqrt((X - P["neck"][0]) ** 2 + (Y - P["neck"][1]) ** 2 + (Z - P["neck"][2]) ** 2)
    shirt = np.maximum(shirt, nzq - 0.018)                                               # neckline
    # trousers
    tr = f.d["torso"] - 0.004
    tr = np.maximum(tr, pz - 0.10)
    for q, sx in (("l", 1), ("r", -1)):
        hp, kn, an = P[q + "hip"], P[q + "knee"], P[q + "ank"]; st, Lt = proj(hp, kn); ss, Ls = proj(kn, an); at_ = ang(hp, B[q + "th"]); as_ = ang(kn, B[q + "sh"])
        leg = f.d["leg" + q] - (0.011 + 0.016 * np.clip(ss / Ls, 0, 1) * (st > Lt * 0.8))
        bend = getattr(pose, q + "k")
        leg = leg - (0.0042 + 0.0050 * min(bend, 60) / 40) * G(ss, 0.075) * ridge(ss * 88 + np.cos(as_ + 1.57) * 3.2 + nz * 2.2)       # behind and around the knee
        leg = leg - 0.0056 * G(st - 0.08, 0.085) * ridge(st * 66 - np.sin(at_) * 3.6 + nz * 2.0)                                       # crotch and hip drag lines
        leg = leg - 0.0082 * G(ss - Ls * 0.93, 0.060) * ridge(ss * 118 + np.sin(as_) * 2.6 + nz * 2.6)                                 # breaks over the shoe
        leg = leg - 0.0045 * ridge(np.cos(at_ * 1 + 0.4) * 5 + nz * 2.6 + st * 9) * G(st - Lt * 0.6, 0.16)                             # long soft flutes down the thigh
        leg = leg - 0.0022 * nz2
        leg = np.maximum(leg, np.where(st > Lt * 0.5, ss - Ls * 1.015, -1))
        tr = smin(tr, leg, 0.030)
    d = smin(np.minimum(f.d["skin"], 9), f.d["hair"] + 0.0016 * np.sin(nz * 9 + Z * 160 + X * 60), 0.006)
    d = np.minimum(d, np.minimum(shirt, tr)); d = np.minimum(d, np.minimum(f.d["shoe"], f.d["sole"]))
    f.sdf = d.astype(F); f.d.clear()
    # the only marks: collar groove and a button line, as shallow cuts
    return f


def surface_nets(d, lo, vox):
    n = d.shape; s = d < 0
    c = np.zeros((n[0] - 1, n[1] - 1, n[2] - 1), np.int32)
    for i in (0, 1):
        for j in (0, 1):
            for k in (0, 1):
                c += s[i:n[0] - 1 + i, j:n[1] - 1 + j, k:n[2] - 1 + k]
    act = (c > 0) & (c < 8); idx = np.argwhere(act)
    vid = np.full(act.shape, -1, np.int32); vid[act] = np.arange(len(idx))
    P = np.zeros((len(idx), 3)); W = np.zeros(len(idx)); co = [(i, j, k) for i in (0, 1) for j in (0, 1) for k in (0, 1)]
    for a in co:
        for e in range(3):
            if a[e]: continue
            b = list(a); b[e] = 1
            va = d[idx[:, 0] + a[0], idx[:, 1] + a[1], idx[:, 2] + a[2]]; vb = d[idx[:, 0] + b[0], idx[:, 1] + b[1], idx[:, 2] + b[2]]
            m = (va < 0) != (vb < 0); t = np.where(m, va / np.where(m, va - vb, 1), 0)
            q = np.array(a, float)[None].repeat(len(idx), 0); q[:, e] += t; P += q * m[:, None]; W += m
    V = (idx + P / W[:, None]) * vox + lo
    F_ = []
    for e in range(3):
        sl0 = [slice(None)] * 3; sl1 = [slice(None)] * 3; sl0[e] = slice(0, n[e] - 1); sl1[e] = slice(1, n[e])
        cross = s[tuple(sl0)] != s[tuple(sl1)]; pos = np.argwhere(cross)
        u, v = [(1, 2), (2, 0), (0, 1)][e]
        ok = (pos[:, u] > 0) & (pos[:, v] > 0) & (pos[:, u] < n[u] - 1) & (pos[:, v] < n[v] - 1); pos = pos[ok]
        fl = s[tuple(pos.T)]
        def g(du, dv):
            q = pos.copy(); q[:, u] -= du; q[:, v] -= dv; return vid[tuple(q.T)]
        a, b, c_, d_ = g(1, 1), g(0, 1), g(0, 0), g(1, 0)
        Q = np.stack([a, b, c_, d_], 1); Q[~fl] = Q[~fl][:, ::-1]; F_.append(Q)
    return V, np.concatenate(F_)


def sample(f, P):
    g = (P - f.lo) / f.vox; g = np.clip(g, 0, np.array(f.sdf.shape) - 1.001); i = g.astype(int); t = (g - i).astype(F); o = 0
    for a in (0, 1):
        for b in (0, 1):
            for c in (0, 1):
                w = (t[:, 0] if a else 1 - t[:, 0]) * (t[:, 1] if b else 1 - t[:, 1]) * (t[:, 2] if c else 1 - t[:, 2])
                o = o + w * f.sdf[i[:, 0] + a, i[:, 1] + b, i[:, 2] + c]
    return o


def grad(f, P):
    e = f.vox * 0.9; g = np.stack([sample(f, P + np.eye(3)[k] * e) - sample(f, P - np.eye(3)[k] * e) for k in range(3)], 1)
    return g / np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)


def occlusion(f, P, N, rays=48):
    """Ambient occlusion and bent normal from cone-marched rays over each vertex's hemisphere, plus a floor."""
    r = np.random.default_rng(1); u = (np.arange(rays) + 0.5) / rays; ph = np.arange(rays) * 2.39996
    D = np.stack([np.sqrt(1 - (1 - 2 * u) ** 2) * np.cos(ph), np.sqrt(1 - (1 - 2 * u) ** 2) * np.sin(ph), 1 - 2 * u], 1)
    ao = np.zeros(len(P)); bent = np.zeros_like(P); W = np.zeros(len(P))
    for d in D:
        c = N @ d; m = c > 0.02
        if not m.any(): continue
        p = P[m] + N[m] * 0.010; t = np.full(m.sum(), 0.012); vis = np.ones(m.sum())
        for _ in range(11):
            q = sample(f, p + d * t[:, None]); vis = np.minimum(vis, np.clip(0.5 + 4.0 * q / t * 0.5, 0, 1)); t += np.clip(q, 0.012, 0.09)
        vis = np.clip(vis, 0, 1); w = c[m]
        ao[m] += vis * w; W[m] += w; bent[m] += d * (vis * w)[:, None]
    bent += N * 1e-3; bent /= np.linalg.norm(bent, axis=1, keepdims=True)
    return ao / np.maximum(W, 1e-6), bent


def decimate(V, Q, target):
    import bpy
    me = bpy.data.meshes.new("m"); me.from_pydata(V.tolist(), [], Q.tolist()); ob = bpy.data.objects.new("o", me); bpy.context.scene.collection.objects.link(ob)
    tri = len(Q) * (2 if Q.shape[1] == 4 else 1)
    md = ob.modifiers.new("d", "DECIMATE"); md.ratio = min(1, target / tri)
    dg = bpy.context.evaluated_depsgraph_get(); e = ob.evaluated_get(dg); m2 = e.to_mesh(); m2.calc_loop_triangles()
    v = np.empty(len(m2.vertices) * 3, F); m2.vertices.foreach_get("co", v); t = np.empty(len(m2.loop_triangles) * 3, np.int32); m2.loop_triangles.foreach_get("vertices", t)
    e.to_mesh_clear(); bpy.data.objects.remove(ob); bpy.data.meshes.remove(me)
    return v.reshape(-1, 3).astype(float), t.reshape(-1, 3)


def oct_(n):
    n = n / np.abs(n).sum(1, keepdims=True); o = n[:, :2].copy(); m = n[:, 2] < 0
    o[m] = (1 - np.abs(n[m][:, ::-1][:, 1:] if False else n[m][:, [1, 0]])) * np.where(n[m][:, :2] >= 0, 1, -1)
    return np.round(np.clip(o, -1, 1) * 127).astype(np.int8)


def reorder(V, T, *A):
    """Vertices in order of first use, triangles sorted along a Morton-ish sweep, so the file compresses well."""
    order = np.lexsort((V[T].mean(1)[:, 0], np.round(V[T].mean(1)[:, 2] * 40))); T = T[order]
    fl = T.ravel(); _, first = np.unique(fl, return_index=True); seq = fl[np.sort(first)]; mp = np.empty(len(V), int); mp[seq] = np.arange(len(seq))
    return V[seq], mp[T], [a[seq] for a in A]


def main():
    blob, figs, pre = [], [], []
    def put(a):
        a = np.ascontiguousarray(a); o = sum(len(b) for b in blob); pad = -len(a.tobytes()) % 4; blob.append(a.tobytes() + b"\0" * pad); return o
    for pi in ONLY:
        t0 = time.time(); f = build(POSES[pi], VOX); V, Q = surface_nets(f.sdf, f.lo, VOX)
        # keep the largest piece
        print("pose", pi, "grid", f.sdf.shape, "verts", len(V), f"{time.time() - t0:.0f} s", flush=True)
        lying = pi >= 4
        levels = [9000 if pi in (0, 2) else 0, 5200, 1300] if False else [26000 if pi == 0 else 0, 5200, 1250]
        ent = {"lying": lying, "lod": []}
        for li, tri in enumerate(levels):
            if not tri: ent["lod"].append(None); continue
            v, tr = decimate(V, Q, tri); n = grad(f, v); ao, bent = occlusion(f, v, n, 64 if li == 0 else 48)
            if lying:                                            # lay the figure on its back: rotate so that it faces up
                M = rot("x", 90)
                v2 = (v - [0, 0, 0.9]) @ M.T; n2, b2 = n @ M.T, bent @ M.T
            else: v2, n2, b2 = v, n, bent
            v2 = v2 - [0, 0, v2[:, 2].min()] if li == min(i for i, x in enumerate(levels) if x) else v2 - [0, 0, base]
            if li == min(i for i, x in enumerate(levels) if x): base = (v2[:, 2].min() if False else ((v - [0, 0, 0.9]) @ rot("x", 90).T if lying else v)[:, 2].min())
            hgt = np.where(v[:, 2] > 0, np.clip(v[:, 2], 0, 1.8), 0)      # height along the body, for breathing and the inner glow
            v2, tr, (n2, b2, ao, hgt) = reorder(v2, tr, n2, b2, ao, hgt)
            lo, hi = v2.min(0), v2.max(0); q = np.round((v2 - lo) / (hi - lo) * 65535).astype(np.uint16)
            a = np.zeros((len(v2), 8), np.int8); a[:, 0:2] = oct_(n2); a[:, 2] = np.round(np.clip(ao, 0, 1) * 127); a[:, 4:6] = oct_(b2); a[:, 3] = np.round(hgt / 1.8 * 127)
            ent["lod"].append({"lo": lo.round(5).tolist(), "hi": hi.round(5).tolist(), "nv": len(v2), "nt": len(tr),
                               "p": put(np.concatenate([q[:, :1], q[:, 1:2], q[:, 2:3]], 1)), "a": put(a), "i": put(tr.astype(np.uint16))})
            print("   lod", li, "tris", len(tr), "verts", len(v2), "ao", round(float(ao.mean()), 3), f"{time.time() - t0:.0f} s", flush=True)
            if li < 2: pre.append((pi, li, v2, tr, n2, ao))
        figs.append(ent)
    head = json.dumps({"figs": figs, "height": 1.75}, separators=(",", ":")).encode(); head += b" " * (-len(head) % 4)
    raw = np.uint32(len(head)).tobytes() + head + b"".join(blob)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, "wb").write(gzip.compress(raw, 9, mtime=0)); print("wrote", OUT, len(raw), os.path.getsize(OUT))
    if "--preview" in argv: preview(pre)


def preview(pre):
    import bpy
    sc = bpy.context.scene
    for o in list(sc.objects): bpy.data.objects.remove(o)
    best = {}
    for pi, li, v, t, n, ao in pre: best.setdefault(pi, (v, t, n))
    mat = bpy.data.materials.new("plaster"); mat.use_nodes = True; b = mat.node_tree.nodes["Principled BSDF"]; b.inputs["Base Color"].default_value = (0.55, 0.54, 0.52, 1); b.inputs["Roughness"].default_value = 0.8
    for k, (pi, (v, t, n)) in enumerate(sorted(best.items())):
        me = bpy.data.meshes.new(f"p{pi}"); me.from_pydata((v + [k * 1.05 - 2.6 + (0.5 if pi >= 4 else 0), 0, 0]).tolist(), [], t.tolist()); me.polygons.foreach_set("use_smooth", [True] * len(t))
        me.normals_split_custom_set_from_vertices(n.tolist())
        ob = bpy.data.objects.new(f"p{pi}", me); ob.data.materials.append(mat); sc.collection.objects.link(ob)
        
    bpy.ops.mesh.primitive_plane_add(size=40); bpy.context.object.data.materials.append(mat)
    def area(loc, rot_, size, e):
        l = bpy.data.lights.new("a", "AREA"); l.size = size; l.energy = e; o = bpy.data.objects.new("a", l); o.location = loc; o.rotation_euler = rot_; sc.collection.objects.link(o)
    area((-2, 3, 4), (-0.8, -0.4, 0), 2, 260); area((4, -4, 3), (0.9, 0.6, 0), 1, 160)
    cam = bpy.data.cameras.new("c"); cam.lens = 50; co = bpy.data.objects.new("c", cam); co.location = (0, 8.2, 1.35); co.rotation_euler = (np.pi / 2 - 0.05, 0, np.pi); sc.collection.objects.link(co); sc.camera = co
    sc.render.engine = "CYCLES"; sc.cycles.samples = 24; sc.cycles.use_denoising = True; sc.render.resolution_x, sc.render.resolution_y = 1600, 620
    try:
        pr = bpy.context.preferences.addons["cycles"].preferences; pr.compute_device_type = "METAL"; pr.get_devices(); [setattr(d, "use", d.type == "METAL") for d in pr.devices]; sc.cycles.device = "GPU"
    except Exception as e: print(e)
    sc.render.filepath = "/tmp/forge_fig.png"; bpy.ops.render.render(write_still=True)
    co.location = (-2.3, 1.6, 1.62); cam.lens = 60; co.rotation_euler = (np.pi / 2 - 0.12, 0, np.pi + 0.2); sc.render.resolution_x = 900; sc.render.resolution_y = 900; sc.render.filepath = "/tmp/forge_fig_close.png"; bpy.ops.render.render(write_still=True)


main()
