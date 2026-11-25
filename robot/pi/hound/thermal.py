"""The thermal camera: 32 by 24 temperatures. It cannot see through a wall, so it only speaks about what is in front of it.
Skin under rubble reads 24 to 38 C. A pipe or an engine is far hotter than a person can be, and that is an answer too."""
import numpy as np

def blobs(mask):
    """Connected warm patches, biggest first, as lists of (row, column)."""
    seen, out = np.zeros_like(mask, bool), []
    for r, c in zip(*np.nonzero(mask)):
        if seen[r, c]: continue
        q, seen[r, c], b = [(r, c)], True, []
        while q:
            y, x = q.pop(); b.append((y, x))
            for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= yy < mask.shape[0] and 0 <= xx < mask.shape[1] and mask[yy, xx] and not seen[yy, xx]: seen[yy, xx] = True; q.append((yy, xx))
        out.append(b)
    return sorted(out, key=len, reverse=True)

def look(frames):
    """frames: several 24 x 32 arrays in C, the same view. Returns (answer, where in degrees, why)."""
    if not len(frames): return 'blind', None, 'no thermal picture'
    f = np.median(np.asarray(frames, float), axis=0)                                 # several frames, so one noisy pixel is never a person
    if f.shape != (24, 32) or not np.isfinite(f).all() or f.min() < -40 or f.max() > 300: return 'blind', None, 'the thermal picture is damaged'
    if np.ptp(f) < .05: return 'blind', None, 'the thermal picture is frozen'
    bg = np.median(f); sd = max(.25, 1.4826 * np.median(abs(f - bg)))
    if bg > 33: return 'blind', None, 'everything is as warm as a person'
    for b in blobs(f > bg + max(1.5, 4 * sd)):
        t = np.array([f[p] for p in b]); y, x = np.mean(b, axis=0); az, el = (x - 15.5) / 32 * 55, (11.5 - y) / 24 * 35          # the 55 x 35 degree lens
        if t.max() > 45: return 'tooHot', (az, el), f'{t.max():.0f} C, too hot to be a person'
        if len(b) >= 6 and 24 <= t.max() <= 40: return 'pos', (az, el), f'{t.max():.0f} C, {len(b)} warm pixels'
        if len(b) >= 2 and t.max() - bg > 2: return 'faint', (az, el), f'{t.max():.0f} C, only {len(b)} pixels'
    return 'neg', None, 'nothing warm in view'
