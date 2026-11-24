#!/usr/bin/env python3
"""forge_export.py: every measured number and every data file behind the Model forge workspace.

    /usr/local/bin/python3 tools/forge_export.py            (stages are cached in /tmp/forge_cache; --force redoes them)
    /usr/local/bin/python3 tools/forge_export.py --only int8,snn

Source of truth: ~/Developer/rover-design-study/ml (net.py, train.py, csi_window.py, data/synth.npz, data/synth_clean.npz,
models/csi_nn.npz, models/csi_nn_clean.npz). This script imports that code; it does not re-implement the network.
It first reproduces the published confusion matrix (240 / 30 / 359 / 326) and refuses to continue if it does not match.

Writes data/forge/:
    forge.json        every number the page shows that it cannot compute itself, the models, scores and features
    train.i8          1,536 training windows (whole people), 52 x 200, companded int8
    val.i8            224 validation windows
    test.i8           320 test windows (messy simulator: the real test set)
    test_clean.i8     the same 320 windows from the clean simulator (same people, same seed, no ESP32 faults)
Everything is SIMULATED data (Blender people in a channel simulator). Nothing here was recorded with the rover.
"""
import argparse, base64, json, os, sys, time
os.environ.setdefault("VECLIB_MAXIMUM_THREADS", "4")
os.environ.setdefault("OMP_NUM_THREADS", "4")
import numpy as np

ML = os.environ.get("FORGE_ML", os.path.expanduser("~/Developer/rover-design-study/ml"))
sys.path.insert(0, ML)
import csi_window as cw  # noqa: E402
from net import Adam, CsiNet, softmax  # noqa: E402
from train import balance, load, person_threshold, split_of, take, train  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "forge")
CACHE = "/tmp/forge_cache"
N_TRAIN, N_VAL, N_TEST = 1536, 224, 320
S0 = 0.25                                   # companding knee, in % change


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def b64(a, dtype):
    return base64.b64encode(np.ascontiguousarray(a, dtype=dtype).tobytes()).decode()


def r(x, n=4):
    return round(float(x), n)


# ---------- window codec: 52 x 200 float -> int8, fine steps near zero where breathing lives ----------
def compand(x):
    q = np.round(127 * np.log1p(np.abs(x) / S0) / np.log1p(50 / S0))
    return (np.sign(x) * q).astype(np.int8)


DEC = (np.sign(np.arange(-128, 128)) * S0 * np.expm1(np.abs(np.arange(-128, 128)) / 127 * np.log1p(50 / S0))).astype(np.float32)


def expand(q):
    return DEC[q.astype(np.int16) + 128]


# ---------- the network, layer by layer (the project's own layer objects) ----------
def acts(net, X, batch=256):
    """Every layer's output for X (N, 52, 200): c1 p1 c2 p2 c3 (after ReLU / pooling), feat (48), hid (32), logits."""
    keys = ["c1", "p1", "c2", "p2", "c3", "feat", "hid"]
    out = {k: [] for k in keys + ["person", "moving"]}
    for i in range(0, len(X), batch):
        h = X[i:i + batch].astype(np.float32)
        b = net.body
        h = b[1].forward(b[0].forward(h)); out["c1"].append(h)
        h = b[2].forward(h); out["p1"].append(h)
        h = b[4].forward(b[3].forward(h)); out["c2"].append(h)
        h = b[5].forward(h); out["p2"].append(h)
        h = b[7].forward(b[6].forward(h)); out["c3"].append(h)
        h = b[8].forward(h); out["feat"].append(h)
        h = b[10].forward(b[9].forward(h)); out["hid"].append(h)
        out["person"].append(net.heads[0].forward(h)); out["moving"].append(net.heads[1].forward(h))
    return {k: np.concatenate(v) for k, v in out.items()}


def logits(net, X):
    a = acts(net, X)
    return a["person"], a["moving"], a["hid"]


def p_person(lg):
    return softmax(lg)[:, 1]


def auc(score, label):
    """Area under the ROC curve by ranks (ties share a rank)."""
    order = np.argsort(score, kind="stable"); s = score[order]
    ranks = np.empty(len(s)); i = 0
    while i < len(s):
        j = i
        while j + 1 < len(s) and s[j + 1] == s[i]:
            j += 1
        ranks[i:j + 1] = (i + j) / 2 + 1; i = j + 1
    rk = np.empty(len(s)); rk[order] = ranks
    pos = label == 1; n1, n0 = pos.sum(), (~pos).sum()
    return float((rk[pos].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))


def rates(p, thr, kind, fan=None, moving_lg=None):
    said = (p > thr).astype(int); pres = (kind > 0).astype(int)
    conf = [[int(((pres == a) & (said == b)).sum()) for b in (0, 1)] for a in (0, 1)]
    out = {"threshold": r(thr), "confusion": conf, "accuracy": r((said == pres).mean()),
           "empty_ok": r((said[kind == 0] == 0).mean()), "still_found": r((said[kind == 1] == 1).mean()),
           "moving_found": r((said[kind == 2] == 1).mean()), "auc": r(auc(p, pres)),
           "by_kind": [[int(((kind == k) & (said == b)).sum()) for b in (0, 1)] for k in (0, 1, 2)]}
    if fan is not None:
        out["fan_false_alarm"] = r((said[(kind == 0) & (fan == 1)] == 1).mean())
        out["nofan_false_alarm"] = r((said[(kind == 0) & (fan == 0)] == 1).mean())
    if moving_lg is not None:
        mv = moving_lg.argmax(1)
        out["moving_acc"] = r((mv[kind > 0] == (kind[kind > 0] == 2)).mean())
    return out


def thr_on_val(p_val, kind_val, fa=0.10):
    return float(np.quantile(p_val[kind_val == 0], 1 - fa))


class D:
    """Loads the data once, lazily."""
    _d = None

    @classmethod
    def get(cls):
        if cls._d is None:
            log("loading", ML)
            X, y, meta = load(os.path.join(ML, "data", "synth.npz"))
            s = split_of(meta["group"])
            net = CsiNet.load(os.path.join(ML, "models", "csi_nn.npz"))
            netc = CsiNet.load(os.path.join(ML, "models", "csi_nn_clean.npz"))
            cls._d = dict(X=X, y=y, meta=meta, s=s, net=net, netc=netc, tr=np.where(s == 0)[0], va=np.where(s == 1)[0], te=np.where(s == 2)[0])
            cls._d.update(subsets(meta, s))
        return cls._d


def subsets(meta, s):
    """The windows that ship: whole people for training; validation and test stratified by kind in their true shares."""
    rng = np.random.default_rng(20261123)
    tr = np.where(s == 0)[0]
    groups = rng.permutation(np.unique(meta["group"][tr]))
    sel = []
    for g in groups:
        sel.extend(tr[meta["group"][tr] == g].tolist())
        if len(sel) >= N_TRAIN:
            break
    out = {"sub_tr": np.array(sorted(sel[:N_TRAIN]))}
    for name, split, n in (("sub_va", 1, N_VAL), ("sub_te", 2, N_TEST)):
        idx = np.where(s == split)[0]; kind = meta["kind"][idx]
        share = np.bincount(kind, minlength=3) / len(idx)
        take_n = np.floor(share * n).astype(int); take_n[np.argmax(share)] += n - take_n.sum()
        out[name] = np.array(sorted(np.concatenate([rng.choice(idx[kind == k], take_n[k], replace=False) for k in range(3)]).tolist()))
    return out


# =====================================================================================================================
def stage_repro():
    d = D.get(); X, meta, te, va, net = d["X"], d["meta"], d["te"], d["va"], d["net"]
    thr = net.meta["person_threshold"]
    pl, ml, _ = logits(net, X[te])
    res = rates(p_person(pl), thr, meta["kind"][te], meta["fan"][te], ml)
    assert res["confusion"] == [[240, 30], [359, 326]], f"pipeline does not reproduce the published matrix: {res['confusion']}"
    log("reproduced the published confusion matrix", res["confusion"])
    # the int8 window codec: what does it change?
    pl2, _, _ = logits(net, expand(compand(X[te])))
    res2 = rates(p_person(pl2), thr, meta["kind"][te])
    codec = {"knee_pct": S0, "confusion": res2["confusion"], "max_dp": r(np.abs(p_person(pl) - p_person(pl2)).max(), 5),
             "flips": int(((p_person(pl) > thr) != (p_person(pl2) > thr)).sum())}
    counts = {k: int((d["s"] == i).sum()) for i, k in enumerate(("train", "val", "test"))}
    return {"published": [[240, 30], [359, 326]], "test": res, "codec": codec, "counts": counts, "params": net.n_params(),
            "model_meta": net.meta, "kinds_test": np.bincount(meta["kind"][te]).tolist(), "kinds_val": np.bincount(meta["kind"][va]).tolist(),
            "kinds_train": np.bincount(meta["kind"][d["tr"]]).tolist(), "fan_test": int(meta["fan"][te].sum())}


# ---------- scores and hidden features for every validation and test window ----------
def stage_scores():
    d = D.get(); X, meta, net = d["X"], d["meta"], d["net"]
    out = {}
    for name, idx in (("val", d["va"]), ("test", d["te"])):
        pl, ml, hid = logits(net, X[idx])
        out[name] = {"n": len(idx), "person": b64(pl, np.float32), "moving": b64(ml, np.float32), "hidden": b64(hid, np.float32),
                     "kind": meta["kind"][idx].tolist(), "fan": meta["fan"][idx].tolist(), "lying": meta["lying"][idx].tolist(),
                     "depth": [r(v, 2) for v in meta["depth"][idx]]}
    return out


# ---------- int8 ----------
def fixed_mult(M):
    """Real multiplier M -> (m, shift) with m a 15-bit integer: M ~ m * 2^-shift."""
    sh = 0
    while M * (1 << sh) < (1 << 14) and sh < 40:
        sh += 1
    return int(round(M * (1 << sh))), sh


def requant(acc, m, sh, hi=255):
    return np.clip((acc.astype(np.int64) * m + (1 << (sh - 1))) >> sh, 0, hi)


def conv_int(xq, Wq, bq, k=9):
    """xq (N, C, T) integers, Wq (C*k, F) integers, bq (F,) -> (N, F, T') exact integers (float64 matmul is exact here)."""
    N, C, T = xq.shape
    cols = np.lib.stride_tricks.sliding_window_view(xq, k, axis=2).transpose(0, 2, 1, 3).reshape(N * (T - k + 1), C * k)
    acc = cols.astype(np.float64) @ Wq.astype(np.float64) + bq
    return np.rint(acc).astype(np.int64).reshape(N, T - k + 1, -1).transpose(0, 2, 1)


def pool_int(a, p):
    N, C, T = a.shape; T2 = T // p
    return (a[:, :, :T2 * p].reshape(N, C, T2, p).sum(-1) + p // 2) // p


def build_int8(net, calib, pct, s_in, s_motion):
    """Symmetric per-layer int8 weights, uint8 activations (after ReLU), int32 biases, fixed-point requantisation."""
    P = net.params(); A = acts(net, calib)
    W = [P[0].copy(), P[2], P[4], P[6], P[8], P[10]]; B = [P[1], P[3], P[5], P[7], P[9], P[11]]
    C, k = 52, 9
    W0 = W[0].reshape(C, k, -1).copy(); W0[51] *= s_motion / s_in; W[0] = W0.reshape(C * k, -1)    # fold the motion row's own input scale
    sw = [float(np.abs(w).max()) / 127 for w in W[:4]]
    swh = float(max(np.abs(W[4]).max(), np.abs(W[5]).max())) / 127
    sa = [float(np.percentile(A[key], pct)) / 255 for key in ("c1", "c2", "c3", "hid")]
    sin = [s_in, sa[0], sa[1], sa[2]]
    q = {"s_in": s_in, "s_motion": s_motion, "sw": sw + [swh], "sa": sa, "pct": pct,
         "W": [np.clip(np.rint(W[i] / sw[i]), -127, 127).astype(np.int8) for i in range(4)] + [np.clip(np.rint(W[i] / swh), -127, 127).astype(np.int8) for i in (4, 5)],
         "B": [np.rint(B[i] / (sin[i] * sw[i])).astype(np.int64) for i in range(4)] + [np.rint(B[i] / (sa[3] * swh)).astype(np.int64) for i in (4, 5)],
         "mult": [fixed_mult(sin[i] * sw[i] / sa[i]) for i in range(4)], "out_scale": sa[3] * swh}
    return q


def quant_input(X, q):
    xs = np.clip(np.rint(X[:, :51] / q["s_in"]), -127, 127); xm = np.clip(np.rint(X[:, 51:] / q["s_motion"]), -127, 127)
    return np.concatenate([xs, xm], axis=1).astype(np.int64)


def run_int8(q, xq, batch=128, trace=False):
    """Integer-only forward. Returns the int32 head accumulators (N, 2) for person and moving (and the hidden layer)."""
    outs = []
    for i in range(0, len(xq), batch):
        h = xq[i:i + batch]
        h = pool_int(requant(conv_int(h, q["W"][0], q["B"][0]), *q["mult"][0]), 4)
        h = pool_int(requant(conv_int(h, q["W"][1], q["B"][1]), *q["mult"][1]), 2)
        h = requant(conv_int(h, q["W"][2], q["B"][2]), *q["mult"][2])
        T = h.shape[2]
        feat = np.concatenate([(2 * h.sum(2) + T) // (2 * T), h.max(2)], axis=1)
        hid = requant(feat @ q["W"][3].astype(np.int64) + q["B"][3], *q["mult"][3])
        outs.append((hid @ q["W"][4].astype(np.int64) + q["B"][4], hid @ q["W"][5].astype(np.int64) + q["B"][5], hid))
    return [np.concatenate([o[j] for o in outs]) for j in range(3)]


def stage_int8():
    d = D.get(); X, meta, net, te, va = d["X"], d["meta"], d["net"], d["te"], d["va"]
    thr = net.meta["person_threshold"]
    pf_val = p_person(logits(net, X[va])[0]); pl_t, ml_t, _ = logits(net, X[te]); pf_te = p_person(pl_t)
    calib = X[d["sub_tr"][:512]]
    best = None
    for s_in in (0.03, 0.05, 0.08, 0.12, 0.2):          # % change per int8 step for the 51 subcarrier rows
        for pct in (99.9, 99.99, 100.0):
            q = build_int8(net, calib, pct, s_in, 0.25)
            pa, _, _ = run_int8(q, quant_input(X[va], q))
            pi = 1 / (1 + np.exp(-(pa[:, 1] - pa[:, 0]) * q["out_scale"]))
            agree = float(((pi > thr) == (pf_val > thr)).mean()); mad = float(np.abs(pi - pf_val).mean())
            log(f"int8 calibration: step {s_in} %, activation percentile {pct}: validation agreement {agree:.4f}, mean |dP| {mad:.4f}")
            if best is None or (agree, -mad) > (best[0], -best[1]):
                best = (agree, mad, s_in, pct, q)
    agree_val, mad_val, s_in, pct, q = best
    pa, ma, _ = run_int8(q, quant_input(X[te], q))
    pi = 1 / (1 + np.exp(-(pa[:, 1] - pa[:, 0]) * q["out_scale"]))
    kind = meta["kind"][te]
    thr_int = int(np.floor(np.log(thr / (1 - thr)) / q["out_scale"]))       # says PERSON when acc1 - acc0 > thr_int: no float on the chip
    said_int = ((pa[:, 1] - pa[:, 0]) > thr_int)
    assert (said_int == (pi > thr)).all()
    res_i = rates(pi, thr, kind, meta["fan"][te], ma.astype(np.float64))
    res_f = rates(pf_te, thr, kind, meta["fan"][te], ml_t)
    # bundled windows: the page runs the same integers; ship what it must get
    sub = d["sub_te"]; codes = compand(X[sub])
    lut_s = np.clip(np.rint(DEC / q["s_in"]), -127, 127).astype(np.int8); lut_m = np.clip(np.rint(DEC / q["s_motion"]), -127, 127).astype(np.int8)
    xq = np.concatenate([lut_s[codes[:, :51].astype(np.int16) + 128], lut_m[codes[:, 51:].astype(np.int16) + 128]], axis=1).astype(np.int64)
    pb, mb, _ = run_int8(q, xq)
    # how few bits? weights only, per-layer symmetric, activations left in float
    bits = []
    P0 = [p.copy() for p in net.params()]
    for b in (8, 7, 6, 5, 4, 3, 2):
        lv = 2 ** (b - 1) - 1
        for p, p0 in zip(net.params(), P0):
            if p.ndim > 1:
                sc = np.abs(p0).max() / lv; p[...] = np.clip(np.rint(p0 / sc), -lv, lv) * sc
        pb_val = p_person(logits(net, X[va])[0]); pb_te = p_person(logits(net, X[te])[0])
        rr = rates(pb_te, thr, kind)
        bits.append({"bits": b, "bytes": int(np.ceil(23264 * b / 8)) + 432, "auc": rr["auc"], "accuracy": rr["accuracy"], "confusion": rr["confusion"],
                     "agree": r(((pb_te > thr) == (pf_te > thr)).mean()), "moving_found": rr["moving_found"], "empty_ok": rr["empty_ok"], "still_found": rr["still_found"]})
        log("bits", b, bits[-1])
    for p, p0 in zip(net.params(), P0):
        p[...] = p0
    n_w = int(sum(w.size for w in q["W"])); n_b = int(sum(b.size for b in q["B"]))
    macs = {"conv1": 192 * 24 * 468, "conv2": 40 * 24 * 216, "conv3": 12 * 24 * 216, "dense": 48 * 32, "heads": 32 * 4}
    return {"s_in": s_in, "s_motion": q["s_motion"], "pct": pct, "sw": [r(v, 7) for v in q["sw"]], "sa": [r(v, 6) for v in q["sa"]],
            "mult": q["mult"], "out_scale": q["out_scale"], "thr_int": thr_int,
            "W": [b64(w, np.int8) for w in q["W"]], "B": [[int(v) for v in b] for b in q["B"]],
            "lut_sub": b64(lut_s, np.int8), "lut_motion": b64(lut_m, np.int8),
            "bytes": {"float32": net.n_params() * 4, "int8_weights": n_w, "int32_biases": n_b * 4, "scales": 4 * 3 + 4 + 4, "int8_total": n_w + n_b * 4 + 20,
                      "n_weights": n_w, "n_biases": n_b},
            "ram": {"input": 52 * 200, "conv1_out": 24 * 192, "peak_arena": 52 * 200 + 24 * 192, "float_window": 52 * 200 * 4,
                    "layers": [["input", 52 * 200], ["conv 1", 24 * 192], ["pool", 24 * 48], ["conv 2", 24 * 40], ["pool", 24 * 20], ["conv 3", 24 * 12], ["mean + max", 48], ["dense", 32]]},
            "macs": macs, "macs_total": int(sum(macs.values())),
            "val": {"agree": r(agree_val), "mean_abs_dp": r(mad_val, 5)},
            "test": {"float": res_f, "int8": res_i, "agree": r(((pi > thr) == (pf_te > thr)).mean()), "flips": int(((pi > thr) != (pf_te > thr)).sum()),
                     "mean_abs_dp": r(np.abs(pi - pf_te).mean(), 5), "max_abs_dp": r(np.abs(pi - pf_te).max(), 5)},
            "bundle_acc": {"person": pb.astype(int).tolist(), "moving": mb.astype(int).tolist()}, "bits": bits}


# ---------- pruning ----------
def prune_masks(net, frac):
    mats = [p for p in net.params() if p.ndim > 1]
    mag = np.concatenate([np.abs(m).ravel() for m in mats])
    if frac <= 0:
        return [np.ones_like(m, bool) for m in mats]
    cut = np.sort(mag)[min(len(mag) - 1, int(round(frac * len(mag))) - 1)]
    return [np.abs(m) > cut for m in mats]


FRACS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 0.98, 0.99]


def prune_eval(net, d, masks):
    X, meta, te, va = d["X"], d["meta"], d["te"], d["va"]
    mats = [p for p in net.params() if p.ndim > 1]
    keep = [m.copy() for m in mats]
    for m, k in zip(mats, masks):
        m *= k
    pv = p_person(logits(net, X[va])[0]); pl, ml, _ = logits(net, X[te])
    thr = thr_on_val(pv, meta["kind"][va])
    res = rates(p_person(pl), thr, meta["kind"][te], meta["fan"][te], ml)
    res_fixed = rates(p_person(pl), net.meta["person_threshold"], meta["kind"][te])
    for m, k in zip(mats, keep):
        m[...] = k
    res["fixed_threshold"] = {k: res_fixed[k] for k in ("confusion", "empty_ok", "still_found", "moving_found", "accuracy")}
    res["left_by_layer"] = [int(k.sum()) for k in masks]
    return res


def knee_of(curve, key="auc", tol=0.01):
    base = curve[0][key]; knee = 0
    for c in curve:
        if c[key] >= base - tol:
            knee = c["frac"]
        else:
            break
    return knee


def stage_prune():
    d = D.get(); net = d["net"]
    curve = []
    for f in FRACS:
        res = prune_eval(net, d, prune_masks(net, f)); res["frac"] = f; curve.append(res)
        log(f"prune {f:.2f}: AUC {res['auc']:.3f}, moving {res['moving_found']:.3f}, still {res['still_found']:.3f}, empty ok {res['empty_ok']:.3f}")
    sizes = [int(p.size) for p in net.params() if p.ndim > 1]
    return {"fracs": FRACS, "one_shot": curve, "knee_one_shot": knee_of(curve), "knee_rule": "the largest share removed for which the test AUC stays within 0.01 of the unpruned network",
            "layer_sizes": sizes, "layer_names": ["conv 1", "conv 2", "conv 3", "dense", "person head", "moving head"]}


def stage_prune_ft():
    """Prune, then retrain the surviving weights for 3 epochs on the full training set (masks held)."""
    d = D.get(); X, y, meta, tr = d["X"], d["y"], d["meta"], d["tr"]
    base = CsiNet.load(os.path.join(ML, "models", "csi_nn.npz"))
    Xt, yt = X[tr], take(y, tr); cwt = balance(yt)
    curve = []
    for f in FRACS:
        net = CsiNet.load(os.path.join(ML, "models", "csi_nn.npz"))
        masks = prune_masks(base, f)
        mats = [p for p in net.params() if p.ndim > 1]
        for m, k in zip(mats, masks):
            m *= k
        if f > 0:
            opt = Adam(net.params(), lr=1e-3); rng = np.random.default_rng(0)
            for ep in range(3):
                idx = rng.permutation(len(Xt))
                for i in range(0, len(idx), 64):
                    b = idx[i:i + 64]; xb = Xt[b].copy(); flip = rng.random(len(b)) < 0.5; xb[flip] = xb[flip, :, ::-1]
                    net.loss(xb, take(yt, b), cwt); opt.step(net.grads())
                    for m, k in zip(mats, masks):
                        m *= k
        res = prune_eval(net, d, masks); res["frac"] = f; curve.append(res)
        log(f"prune + retrain {f:.2f}: AUC {res['auc']:.3f}, moving {res['moving_found']:.3f}, still {res['still_found']:.3f}, empty ok {res['empty_ok']:.3f}")
    return {"curve": curve, "knee": knee_of(curve), "epochs": 3, "lr": 1e-3}


# ---------- calibration, conformal (the page recomputes these; here is the cross-check) ----------
def nll_T(z, yb, T, b=0.0):
    zz = z / T + b
    return float(np.mean(np.log1p(np.exp(-np.where(yb == 1, zz, -zz)))))


def ece(p, yb, bins=15):
    conf = np.maximum(p, 1 - p); pred = (p > 0.5).astype(int); e = 0.0
    for i in range(bins):
        lo, hi = 0.5 + 0.5 * i / bins, 0.5 + 0.5 * (i + 1) / bins
        m = (conf > lo) & (conf <= hi) if i else (conf >= lo) & (conf <= hi)
        if m.any():
            e += m.mean() * abs((pred[m] == yb[m]).mean() - conf[m].mean())
    return float(e)


def stage_uncertainty():
    d = D.get(); X, meta, net, va, te = d["X"], d["meta"], d["net"], d["va"], d["te"]
    zv = logits(net, X[va])[0]; zt = logits(net, X[te])[0]
    zv, zt = (zv[:, 1] - zv[:, 0]).astype(np.float64), (zt[:, 1] - zt[:, 0]).astype(np.float64)
    yv, yt = (meta["kind"][va] > 0).astype(int), (meta["kind"][te] > 0).astype(int)
    Ts = np.exp(np.linspace(np.log(0.05), np.log(20), 2000)); T = float(Ts[np.argmin([nll_T(zv, yv, t) for t in Ts])])
    sig = lambda z: 1 / (1 + np.exp(-z))
    # Platt: scale and offset, by Newton steps on validation
    a, b = 1.0, 0.0
    for _ in range(100):
        p = sig(a * zv + b); g = np.array([((p - yv) * zv).mean(), (p - yv).mean()])
        w = p * (1 - p); H = np.array([[(w * zv * zv).mean(), (w * zv).mean()], [(w * zv).mean(), w.mean()]]) + 1e-9 * np.eye(2)
        a, b = np.array([a, b]) - np.linalg.solve(H, g)
    cal = {"T": r(T), "platt": [r(a), r(b)], "ece_test_before": r(ece(sig(zt), yt)), "ece_test_temp": r(ece(sig(zt / T), yt)), "ece_test_platt": r(ece(sig(a * zt + b), yt)),
           "nll_test_before": r(nll_T(zt, yt, 1)), "nll_test_temp": r(nll_T(zt, yt, T)), "nll_test_platt": r(float(np.mean(np.log1p(np.exp(-np.where(yt == 1, a * zt + b, -(a * zt + b))))))),
           "bins": 15, "prior_test": r(yt.mean()), "prior_val": r(yv.mean())}
    # split conformal at 90 %: calibrate on validation, check on test
    conf = {}
    for alpha in (0.05, 0.1, 0.2):
        pv, pt = sig(zv), sig(zt)
        sv = np.where(yv == 1, 1 - pv, pv); n = len(sv)
        qh = float(np.sort(sv)[min(n - 1, int(np.ceil((n + 1) * (1 - alpha))) - 1)])
        inc1, inc0 = (1 - pt) <= qh, pt <= qh
        covered = np.where(yt == 1, inc1, inc0); kind = meta["kind"][te]
        conf[str(alpha)] = {"qhat": r(qh), "coverage": r(covered.mean()), "abstain": r((inc1 & inc0).mean()), "empty_set": r((~inc1 & ~inc0).mean()),
                            "abstain_by_kind": [r((inc1 & inc0)[kind == k].mean()) for k in range(3)], "coverage_by_kind": [r(covered[kind == k].mean()) for k in range(3)]}
    log("calibration", cal); log("conformal", conf)
    return {"calibration": cal, "conformal": conf}


# ---------- out-of-distribution ----------
def corrupt(Xn, kind, sev, seed):
    """Deliberate damage to normalised windows (N, 52, 200). Same definitions as app/workspaces/forge/lib/corrupt.js."""
    X = Xn.copy(); N, _, T = X.shape; rng = np.random.default_rng(seed)
    for i in range(N):
        if kind == "interference":             # three bursts of wide-band noise, sev = its size in % of each subcarrier's level
            for _ in range(3):
                L = int(rng.uniform(6, 30)); t0 = int(rng.integers(0, T - L))
                X[i, :51, t0:t0 + L] += rng.standard_normal((51, L)).astype(np.float32) * sev
                X[i, 51, t0:t0 + L] += sev
        elif kind == "dead":                   # sev subcarriers stop varying (read flat)
            X[i, rng.choice(51, int(sev), replace=False)] = 0
        elif kind == "step":                   # one gain step of sev % that the AGC filter missed
            t0 = int(rng.integers(40, 160)); f = t0 / T; sgn = 1.0 if rng.random() < 0.5 else -1.0
            X[i, :51, :t0] -= sgn * sev * (1 - f); X[i, :51, t0:] += sgn * sev * f
        elif kind == "dropout":                # sev seconds with no packets: the last value is held
            L = int(round(sev * 20)); t0 = int(rng.integers(1, T - L))
            X[i, :, t0:t0 + L] = X[i, :, t0 - 1:t0]
    X[:, :51] = np.clip(X[:, :51], -50, 50); X[:, 51] = np.clip(X[:, 51], -5, 50)
    return X


CORRUPTIONS = {"interference": [0.5, 1, 2, 4, 8], "dead": [4, 8, 16, 32, 48], "step": [0.5, 1, 2, 4, 8], "dropout": [0.5, 1, 2, 3, 3.5]}


def maha_fit(hid, kind):
    mu = np.stack([hid[kind == k].mean(0) for k in range(3)]).astype(np.float64)
    R = hid.astype(np.float64) - mu[kind]
    cov = R.T @ R / len(hid) + 1e-6 * np.eye(hid.shape[1])
    return mu, np.linalg.inv(cov)


def maha(hid, mu, P):
    dd = hid.astype(np.float64)[:, None, :] - mu[None]
    return np.einsum("nkd,de,nke->nk", dd, P, dd).min(1)


def energy(pl):
    z = pl.astype(np.float64); m = z.max(1)
    return -(m + np.log(np.exp(z - m[:, None]).sum(1)))


def stage_ood():
    d = D.get(); X, meta, net, tr, va, te = d["X"], d["meta"], d["net"], d["tr"], d["va"], d["te"]
    thr = net.meta["person_threshold"]
    _, _, h_tr = logits(net, X[tr]); mu, P = maha_fit(h_tr, meta["kind"][tr])
    pl_v, _, h_v = logits(net, X[va]); pl_t, _, h_t = logits(net, X[te])
    mv, mt = maha(h_v, mu, P), maha(h_t, mu, P); ev, et = energy(pl_v), energy(pl_t)
    thr_m, thr_e = float(np.quantile(mv, 0.95)), float(np.quantile(ev, 0.95))
    kind = meta["kind"][te]; base_said = p_person(pl_t) > thr
    out = {"mu": b64(mu, np.float32), "precision": b64(P, np.float32), "thr_maha": r(thr_m, 3), "thr_energy": r(thr_e, 4), "flag_rate": 0.05,
           "clean_flagged": {"maha": r((mt > thr_m).mean()), "energy": r((et > thr_e).mean())}, "maha_val_median": r(np.median(mv), 3), "fit_on": int(len(tr)),
           "levels": CORRUPTIONS, "table": {}}
    for ck, sevs in CORRUPTIONS.items():
        rows = []
        for j, sev in enumerate(sevs):
            Xc = corrupt(X[te], ck, sev, 1000 + j)
            pl_c, _, h_c = logits(net, Xc); mc, ec = maha(h_c, mu, P), energy(pl_c); said = p_person(pl_c) > thr
            both = lambda a, b: auc(np.concatenate([a, b]), np.concatenate([np.zeros(len(a), int), np.ones(len(b), int)]))
            rows.append({"sev": sev, "maha_detect": r((mc > thr_m).mean()), "energy_detect": r((ec > thr_e).mean()), "maha_auc": r(both(mt, mc)), "energy_auc": r(both(et, ec)),
                         "empty_false_alarm": r(said[kind == 0].mean()), "still_found": r(said[kind == 1].mean()), "moving_found": r(said[kind == 2].mean()),
                         "answers_changed": r((said != base_said).mean()),
                         "changed_caught": r(((mc > thr_m) & (said != base_said)).sum() / max(1, (said != base_said).sum()))})
            log("ood", ck, rows[-1])
        out["table"][ck] = rows
    return out


# ---------- spiking ----------
def stage_snn():
    """Rate-coded integrate-and-fire copy of the trained network (data-based threshold balancing, reset by subtraction,
    analog input current, spike-count gate for the max over time). Measured on all 955 test windows."""
    d = D.get(); X, meta, net, te = d["X"], d["meta"], d["net"], d["te"]
    thr = net.meta["person_threshold"]
    A = acts(net, X[d["sub_tr"][:512]])
    lam = [float(np.percentile(A[k], 99.9)) for k in ("c1", "c2", "c3", "hid")]
    P = [p.astype(np.float32) for p in net.params()]
    Xt = X[te]; N = len(Xt); kind = meta["kind"][te]
    pl_a, _, _ = logits(net, Xt); pa = p_person(pl_a); said_a = pa > thr

    def conv_lin(x, W, b, k=9):
        n, C, T = x.shape
        cols = np.lib.stride_tricks.sliding_window_view(x, k, axis=2).transpose(0, 2, 1, 3).reshape(n * (T - k + 1), C * k)
        return (cols @ W + b).reshape(n, T - k + 1, -1).transpose(0, 2, 1)

    def pool(x, p):
        n, C, T = x.shape; T2 = T // p
        return x[:, :, :T2 * p].reshape(n, C, T2, p).mean(-1)

    I1 = np.concatenate([conv_lin(Xt[i:i + 128], P[0], P[1]) for i in range(0, N, 128)]) / lam[0]      # constant input current
    W2, b2 = P[2] * lam[0] / lam[1], P[3] / lam[1]; W3, b3 = P[4] * lam[1] / lam[2], P[5] / lam[2]; W4, b4 = P[6] * lam[2] / lam[3], P[7] / lam[3]
    V1 = np.zeros_like(I1); V2 = np.zeros((N, 24, 40), np.float32); V3 = np.zeros((N, 24, 12), np.float32); V4 = np.zeros((N, 32), np.float32)
    cnt3 = np.zeros((N, 24, 12), np.float32); cnt4 = np.zeros((N, 32), np.float32)
    fan2 = np.array([min(u, 39) - max(u - 8, 0) + 1 for u in range(48)]) * 24          # synapses a spike on pooled step u reaches in conv 2
    fan3 = np.array([min(u, 11) - max(u - 8, 0) + 1 for u in range(20)]) * 24
    syn = np.zeros(N); spk = np.zeros((4, N)); checkpoints = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512]; rows = []
    ar = np.arange(N)[:, None], np.arange(24)[None]
    for t in range(1, checkpoints[-1] + 1):
        V1 += I1; s1 = V1 >= 1; V1 -= s1
        V2 += conv_lin(pool(s1.astype(np.float32), 4), W2, b2); s2 = V2 >= 1; V2 -= s2
        V3 += conv_lin(pool(s2.astype(np.float32), 2), W3, b3); s3 = V3 >= 1; V3 -= s3
        cnt3 += s3
        gate = cnt3.argmax(2)                                                           # the step with the most spikes so far carries the max
        smax = s3[ar[0], ar[1], gate]
        feat = np.concatenate([s3.mean(2), smax], axis=1).astype(np.float32)
        V4 += feat @ W4 + b4; s4 = V4 >= 1; V4 -= s4; cnt4 += s4
        syn += (s1.reshape(N, 24, 48, 4).sum((1, 3)) * fan2).sum(1) + (s2.reshape(N, 24, 20, 2).sum((1, 3)) * fan3).sum(1) + s3.sum((1, 2)) * 32 + smax.sum(1) * 32 + s4.sum(1) * 4
        spk[0] += s1.sum((1, 2)); spk[1] += s2.sum((1, 2)); spk[2] += s3.sum((1, 2)); spk[3] += s4.sum(1)
        if t in checkpoints:
            z = lam[3] * (cnt4 / t) @ P[8] + P[9]; ps = p_person(z); said = ps > thr
            rr = rates(ps, thr, kind)
            rows.append({"T": t, "agree": r((said == said_a).mean()), "mean_abs_dp": r(np.abs(ps - pa).mean()), "accuracy": rr["accuracy"], "confusion": rr["confusion"],
                         "moving_found": rr["moving_found"], "still_found": rr["still_found"], "empty_ok": rr["empty_ok"], "auc": rr["auc"],
                         "synops": r(syn.mean(), 0), "spikes": [r(v.mean(), 1) for v in spk],
                         "rate": [r(spk[0].mean() / (4608 * t), 4), r(spk[1].mean() / (960 * t), 4), r(spk[2].mean() / (288 * t), 4), r(spk[3].mean() / (32 * t), 4)]})
            log("snn", rows[-1])
    return {"lambda": [r(v, 5) for v in lam], "percentile": 99.9, "rows": rows, "neurons": [4608, 960, 288, 32],
            "ann": {"macs_conv1": 192 * 24 * 468, "macs_rest": 40 * 24 * 216 + 12 * 24 * 216 + 48 * 32 + 128, "macs_total": 192 * 24 * 468 + 40 * 24 * 216 + 12 * 24 * 216 + 48 * 32 + 128},
            "membrane_updates_per_step": 4608 + 960 + 288 + 32}


# ---------- clean vs messy ----------
def stage_clean():
    d = D.get(); X, meta, net, netc, te, va = d["X"], d["meta"], d["net"], d["netc"], d["te"], d["va"]
    Xc, _, metac = load(os.path.join(ML, "data", "synth_clean.npz"))
    assert (metac["group"] == meta["group"]).all() and (metac["kind"] == meta["kind"]).all()
    kind = meta["kind"][te]; fan = meta["fan"][te]
    cells = {}
    for mname, m in (("messy", net), ("clean", netc)):
        for dname, XX in (("messy", X), ("clean", Xc)):
            pl, ml, _ = logits(m, XX[te]); cells[f"{mname}_on_{dname}"] = rates(p_person(pl), m.meta["person_threshold"], kind, fan, ml)
            log("model", mname, "on", dname, "data:", cells[f"{mname}_on_{dname}"]["confusion"], "moving acc", cells[f"{mname}_on_{dname}"]["moving_acc"])
    assert cells["clean_on_messy"]["confusion"] == [[52, 218], [15, 670]], cells["clean_on_messy"]["confusion"]
    logs = {k: json.load(open(os.path.join(ML, "results", f)))["epochs"] for k, f in (("messy", "train_log.json"), ("clean", "train_log_clean.json"))}
    D._d["Xc"] = Xc
    sub = d["sub_te"]; ref = {}
    for mname, m in (("messy", net), ("clean", netc)):
        for dname, XX in (("messy", X), ("clean", Xc)):
            pl, ml, _ = logits(m, expand(compand(XX[sub]))); ref[f"{mname}_on_{dname}"] = [r(v, 5) for v in p_person(pl)]
    noise = {"messy_bin_std_pct": r(np.median(np.std(np.diff(X[te][:, :51], axis=2), axis=2)) / np.sqrt(2), 4),
             "clean_bin_std_pct": r(np.median(np.std(np.diff(Xc[te][:, :51], axis=2), axis=2)) / np.sqrt(2), 4)}
    return {"cells": cells, "thresholds": {"messy": net.meta["person_threshold"], "clean": netc.meta["person_threshold"]}, "train_logs": logs,
            "clean_meta": netc.meta, "bundle_ref": ref, "noise": noise}


# ---------- training in the page: what it ships with and what Python gets on the same windows ----------
def stage_train_ref():
    d = D.get(); X, y, meta, net = d["X"], d["y"], d["meta"], d["net"]
    sub, va_s, te_s, va, te = d["sub_tr"], d["sub_va"], d["sub_te"], d["va"], d["te"]
    Xs = expand(compand(X[sub])); Xv = expand(compand(X[va_s])); Xte = expand(compand(X[te_s]))
    t0 = time.time(); lines = []
    n2, hist = train(Xs, take(y, sub), Xv, take(y, va_s), seed=0, log=lambda s: (lines.append(s), log("  " + s)))
    secs = time.time() - t0
    out = {"python_same_windows": {"epochs": hist, "seconds": r(secs, 1)}}
    pv = p_person(logits(n2, Xv)[0]); th = thr_on_val(pv, meta["kind"][va_s])
    pl, ml, _ = logits(n2, Xte); out["python_same_windows"]["bundle_test"] = rates(p_person(pl), th, meta["kind"][te_s], None, ml)
    pvf = p_person(logits(n2, X[va])[0]); thf = thr_on_val(pvf, meta["kind"][va])
    pl, ml, _ = logits(n2, X[te]); out["python_same_windows"]["full_test"] = rates(p_person(pl), thf, meta["kind"][te], meta["fan"][te], ml)
    # the shipped network on the same bundled windows (decoded from int8)
    pl, ml, _ = logits(net, Xte); out["shipped_bundle_test"] = rates(p_person(pl), net.meta["person_threshold"], meta["kind"][te_s], None, ml)
    out["shipped_bundle_p"] = [r(v, 5) for v in p_person(pl)]
    pl, ml, _ = logits(net, Xv); out["shipped_bundle_val"] = rates(p_person(pl), net.meta["person_threshold"], meta["kind"][va_s], None, ml)
    # gradient cross-check: NumPy's loss and gradients for one fixed batch, for the page to reproduce
    b = np.arange(8); yb = take(y, va_s[b]); cwt = balance(take(y, sub))
    loss = net.loss(Xv[b], yb, cwt); G = net.grads(); rng = np.random.default_rng(5)
    names = ["conv1.W", "conv1.b", "conv2.W", "conv2.b", "conv3.W", "conv3.b", "dense.W", "dense.b", "person.W", "person.b", "moving.W", "moving.b"]
    grads = []
    for nme, g in zip(names, G):
        idx = rng.choice(g.size, min(6, g.size), replace=False)
        grads.append({"name": nme, "shape": list(g.shape), "norm": float(np.linalg.norm(g.astype(np.float64))), "idx": idx.tolist(), "val": [float(g.ravel()[i]) for i in idx]})
    out["grad_ref"] = {"batch": 8, "loss": float(loss), "grads": grads, "class_weights": {k: [float(x) for x in v] for k, v in cwt.items() if k != "zone"}}
    out["class_weights"] = out["grad_ref"]["class_weights"]
    out["hyper"] = {"lr": 2e-3, "batch": 64, "b1": 0.9, "b2": 0.999, "wd": 1e-4, "patience": 6, "halve_after": 3, "max_epochs": 40, "false_alarm": 0.10}
    return out


def stage_bundle():
    d = D.get(); X, meta = d["X"], d["meta"]
    if "Xc" not in d:
        d["Xc"] = load(os.path.join(ML, "data", "synth_clean.npz"))[0]
    os.makedirs(OUT, exist_ok=True); info = {}
    for name, idx, XX in (("train", d["sub_tr"], X), ("val", d["sub_va"], X), ("test", d["sub_te"], X), ("test_clean", d["sub_te"], d["Xc"])):
        q = compand(XX[idx]); path = os.path.join(OUT, name + ".i8"); q.tofile(path)
        info[name] = {"file": name + ".i8", "n": int(len(idx)), "bytes": int(q.size), "kind": meta["kind"][idx].tolist(), "fan": meta["fan"][idx].tolist(),
                      "lying": meta["lying"][idx].tolist(), "depth": [r(v, 2) for v in meta["depth"][idx]], "group": meta["group"][idx].tolist(), "index": idx.tolist()}
        log("wrote", path, q.shape)
    info["decode"] = b64(DEC, np.float32); info["knee_pct"] = S0
    info["people_in_train"] = int(len(np.unique(meta["group"][d["sub_tr"]][meta["kind"][d["sub_tr"]] > 0])))
    models = {}
    for k, m in (("messy", d["net"]), ("clean", d["netc"])):
        models[k] = {"w": [b64(p, np.float32) for p in m.params()], "shapes": [list(p.shape) for p in m.params()], "threshold": m.meta["person_threshold"], "meta": m.meta}
    info["models"] = models
    return info


STAGES = {"repro": stage_repro, "scores": stage_scores, "int8": stage_int8, "prune": stage_prune, "uncertainty": stage_uncertainty, "ood": stage_ood,
          "snn": stage_snn, "clean": stage_clean, "train_ref": stage_train_ref, "bundle": stage_bundle, "prune_ft": stage_prune_ft}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--only", default="", help="comma-separated stages to (re)run; the others come from the cache")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--skip", default="", help="stages to leave out if they are not cached (e.g. prune_ft)")
    a = ap.parse_args()
    os.makedirs(CACHE, exist_ok=True); os.makedirs(OUT, exist_ok=True)
    only = [s for s in a.only.split(",") if s]; skip = [s for s in a.skip.split(",") if s]
    doc = {"generated": time.strftime("%Y-%m-%d %H:%M"), "source": "rover-design-study/ml (net.py, train.py, csi_window.py, data/synth.npz seed 7, models/csi_nn.npz, models/csi_nn_clean.npz)",
           "note": "Every number is from SIMULATED people (Blender bodies in a Wi-Fi channel simulator). Nothing was recorded with the rover."}
    for name, fn in STAGES.items():
        path = os.path.join(CACHE, name + ".json")
        if (name in only or a.force or not os.path.exists(path)) and not (name in skip and name not in only):
            log("stage", name); t0 = time.time(); res = fn(); json.dump(res, open(path, "w")); log("stage", name, f"done in {time.time() - t0:.0f} s")
        if os.path.exists(path):
            doc[name] = json.load(open(path))
    out = os.path.join(OUT, "forge.json"); json.dump(doc, open(out, "w"), separators=(",", ":"))
    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    log(f"wrote {out} ({os.path.getsize(out) / 1e6:.2f} MB); data/forge is {total / 1e6:.1f} MB in total")


if __name__ == "__main__":
    main()
