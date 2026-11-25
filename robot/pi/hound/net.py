"""The Wi-Fi neural network, forward pass only, in NumPy: 23,372 numbers, three layers of small filters, two answers (is a person there, is the person moving)."""
import json
import numpy as np

class Net:
    def __init__(self, path):
        d = json.load(open(path)); self.w = [np.array(x, np.float32) for x in d['weights']]; self.line = float(d['threshold']); self.samples = d['samples']
        assert [x.shape for x in self.w[:2]] == [(468, 24), (24,)], 'not the network this code was written for'
    def size(self): return sum(x.size for x in self.w)
    @staticmethod
    def _filters(x, W, b, k=9):
        v = np.lib.stride_tricks.sliding_window_view(x, k, axis=1)                  # channel, place, tap
        return np.maximum(np.einsum('ctk,ckf->ft', v, W.reshape(x.shape[0], k, -1), optimize=True) + b[:, None], 0)
    @staticmethod
    def _pool(x, p): n = x.shape[1] // p; return x[:, :n * p].reshape(x.shape[0], n, p).mean(2)
    def __call__(self, x):
        x = np.asarray(x, np.float32)
        if x.shape != (52, 200) or not np.isfinite(x).all(): raise ValueError('a window must be 52 by 200 finite numbers')
        w = self.w; h = self._pool(self._filters(x, w[0], w[1]), 4); h = self._pool(self._filters(h, w[2], w[3]), 2); h = self._filters(h, w[4], w[5])
        f = np.concatenate([h.mean(1), h.max(1)]); h = np.maximum(f @ w[6] + w[7], 0)
        two = lambda z: float(np.exp(z[1] - z.max()) / np.exp(z - z.max()).sum())
        return two(h @ w[8] + w[9]), two(h @ w[10] + w[11])
    def reads(self, x): p, m = self(x); return dict(person=p, moving=m, says=p > self.line)
