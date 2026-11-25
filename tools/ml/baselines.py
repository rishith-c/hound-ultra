"""Run during the event (25 November 2026). Reads the training data and the network from ~/Developer/rover-design-study (made before the event), and writes data/baselines.json.
Same 955 test windows, same people held out. Every method is cut at the same false-alarm rate on empty rooms as the network (11.1 %)."""
import sys, os, json, time
import numpy as np
sys.path.insert(0, os.path.expanduser('~/Developer/rover-design-study/ml'))
from train import load, split_of, person_threshold
from net import CsiNet
ML = os.path.expanduser('~/Developer/rover-design-study/ml/')
X, y, m = load(ML + 'data/synth.npz'); z = np.load(ML + 'data/synth.npz', allow_pickle=True); print(list(z.keys()))
sp = split_of(m['group']); tr, va, te = sp == 0, sp == 1, sp == 2; kind, fan = m['kind'], m['fan']; t = y['person']
def line(sc, fa=.10): e = np.sort(sc[va & (t == 0)]); return float(e[int(np.ceil((1 - fa) * len(e))) - 1])
MATCH = {}
def auc(a, b): r = np.argsort(np.argsort(np.r_[a, b])) + 1; return float((r[:len(a)].sum() - len(a) * (len(a) + 1) / 2) / (len(a) * len(b)))
def matched(name, sc, fa):
    k = kind[te]; s = sc[te]; e = np.sort(s[k == 0]); thr = e[int(np.ceil((1 - fa) * len(e))) - 1]; mv = 100 * (s[k == 2] > thr).mean(); st = 100 * (s[k == 1] > thr).mean(); f = 100 * (s[(k == 0) & (fan[te] == 1)] > thr).mean()
    MATCH[name] = dict(moving=round(mv, 1), still=round(st, 1), fan_fa=round(f, 1), auc_moving_vs_empty=round(auc(s[k == 2], s[k == 0]), 3)); print('MATCHED', name, MATCH[name])
def report(name, sc, thr=None):
    matched(name, sc, .111)
    thr = line(sc) if thr is None else thr; s = sc > thr; k = kind[te]; q = s[te]
    r = dict(moving=100 * q[k == 2].mean(), still=100 * q[k == 1].mean(), empty=100 * (~q[k == 0]).mean(), fan_fa=100 * q[(k == 0) & (fan[te] == 1)].mean()); print(f"{name:46s} moving found {r['moving']:5.1f}  still found {r['still']:5.1f}  empty right {r['empty']:5.1f}  fan false alarm {r['fan_fa']:5.1f}"); return r
net = CsiNet.load(ML + 'models/csi_nn.npz'); p = np.concatenate([net.predict(X[i:i + 256])['person'][:, 1] for i in range(0, len(X), 256)]); R = {}
R['net'] = report('our network (its own line)', p, float(net.meta['person_threshold'])); R['net10'] = report('our network (line set as below)', p)
A = X[:, :51]; print('channel 52 std', X[:, 51].std())
d = np.diff(A, axis=2)
f1 = A.std(2).mean(1); R['std'] = report('rule: how much the signal varies', f1)
f2 = np.abs(d).mean((1, 2)); R['diff'] = report('rule: how fast it changes', f2)
F = np.abs(np.fft.rfft(A - A.mean(2, keepdims=True), axis=2)) ** 2; hz = np.fft.rfftfreq(200, 10 / 200); bands = [(.12, .5), (.5, 1.5), (1.5, 4), (4, 9.9)]; E = np.stack([F[:, :, (hz >= a) & (hz < b)].sum(2) for a, b in bands], 2); tot = E.sum(2, keepdims=True)
R['band'] = report('rule: share of energy at walking speed', (E[:, :, 1:3].sum(2) / tot[:, :, 0].clip(1e-9)).mean(1))
feats = np.concatenate([A.std(2), np.abs(d).mean(2), np.log(E.reshape(len(E), -1) + 1e-6)], 1); mu, sd = feats[tr].mean(0), feats[tr].std(0) + 1e-6; Z = (feats - mu) / sd
def logreg(Z, t, l2=1e-2, it=1500, lr=.5):
    w = np.zeros(Z.shape[1]); b = 0.0; zt, tt = Z[tr], t[tr]; vw = np.zeros_like(w); vb = 0.0
    for k in range(it):
        g = 1 / (1 + np.exp(-(zt @ w + b))) - tt; vw = .9 * vw - lr * (zt.T @ g / len(g) + l2 * w); vb = .9 * vb - lr * g.mean(); w += vw; b += vb
    return Z @ w + b
R['logreg'] = report(f'logistic regression on {Z.shape[1]} hand-made features', logreg(Z, t))
t0 = time.time(); [net.predict(X[i:i + 1]) for i in range(200)]; ms = (time.time() - t0) / 200 * 1000; print('network, one window', round(ms, 2), 'ms on this laptop')
json.dump(dict(R, matched_at_11_1=MATCH, ms=ms), open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'data', 'baselines.json'), 'w'), indent=1)
# the fairest simple method: the same features, trained only to tell a moving person from an empty room, both sides counted the same
def logreg2(Z, l2, it=4000, lr=.3):
    use = tr & (kind != 1); zt, tt = Z[use], (kind[use] == 2).astype(float); cw_ = np.where(tt > 0, .5 / tt.mean(), .5 / (1 - tt.mean())); w = np.zeros(Z.shape[1]); b = 0.0; vw = np.zeros_like(w); vb = 0.0
    for k in range(it):
        g = (1 / (1 + np.exp(-(zt @ w + b))) - tt) * cw_; vw = .9 * vw - lr * (zt.T @ g / len(g) + l2 * w); vb = .9 * vb - lr * g.mean(); w += vw; b += vb
    return Z @ w + b
best = None
for l2 in (1e-4, 1e-3, 1e-2, 1e-1):
    sc = logreg2(Z, l2); thr = line(sc); v = 100 * (sc[va & (kind == 2)] > thr).mean(); print('l2', l2, 'validation moving found', round(v, 1))
    if best is None or v > best[0]: best = (v, l2, sc)
R['logreg2'] = report(f'logistic regression, moving vs empty (l2 {best[1]})', best[2]); json.dump(dict(R, matched_at_11_1=MATCH, ms=ms), open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'data', 'baselines.json'), 'w'), indent=1)
print('--- at the same false-alarm rate on the test rooms (11.1 %)')
def same(sc):
    e = np.sort(sc[te & (kind == 0)]); thr = np.quantile(e, 1 - .1111); s = sc[te] > thr; k = kind[te]
    a, b_ = sc[te & (kind == 2)], sc[te & (kind == 0)]; auc = (a[:, None] > b_[None]).mean(); return 100 * s[k == 2].mean(), 100 * s[k == 1].mean(), auc
for n, sc in (('network', p), ('varies', f1), ('changes', f2), ('logistic', best[2])): print(n, *[round(float(x), 3) for x in same(sc)])
