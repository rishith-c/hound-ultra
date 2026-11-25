from tiles import *
import numpy as np
def grid(date, s, w, n, e, W, H, c, r, name, layer):
    out = f't/day/{name}.jpg'
    if os.path.exists(out): return out
    jobs = [(i, j) for j in range(r) for i in range(c)]; dl, dt = (e - w) / c, (n - s) / r
    def one(a):
        i, j = a; bb = f'{n - (j + 1) * dt:.6f},{w + i * dl:.6f},{n - j * dt:.6f},{w + (i + 1) * dl:.6f}'
        for k in range(4):
            p = day(date, bb, W // c, H // r, f'day/part/{name}_{i}_{j}.jpg', layer)
            if p and np.asarray(Image.open(p).convert('L').resize((64, 64))).mean() > 1: return a, p
            if p: os.rename(p, p + f'.bad{k}')
            time.sleep(2)
        return a, None
    M = Image.new('RGB', (W, H)); miss = 0
    with ThreadPoolExecutor(4) as ex:
        for a, p in ex.map(one, jobs):
            if p: M.paste(Image.open(p).convert('RGB'), (a[0] * (W // c), a[1] * (H // r)))
            else: miss += 1
    M.save(out, quality=95); print(name, M.size, 'missing', miss, flush=True); return out
S = {'n20': 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', 'n21': 'VIIRS_NOAA21_CorrectedReflectance_TrueColor', 'snpp': 'VIIRS_SNPP_CorrectedReflectance_TrueColor'}
if __name__ == '__main__':
    for q in ('globe_base', 'asia_n20', 'asia_n21', 'asia_snpp', 'asia_base', 'asia_night', 'nepal_base'):
        p = f't/day/{q}.jpg'
        if os.path.exists(p): os.rename(p, p + '.blank')
    grid('2004-08-01', -90, -180, 90, 180, 8192, 4096, 4, 2, 'globe_base', 'BlueMarble_NextGeneration')
    grid('2004-08-01', -8, 45, 59.5, 135, 8192, 6144, 4, 3, 'asia_base', 'BlueMarble_NextGeneration')
    for k, l in S.items(): grid('2026-08-26', -8, 45, 59.5, 135, 8192, 6144, 4, 3, 'asia_' + k, l)
    grid('2012-01-01', -8, 45, 59.5, 135, 4096, 3072, 2, 2, 'asia_night', 'VIIRS_CityLights_2012')
    grid('2004-08-01', 22, 77.5, 34, 93.5, 8192, 6144, 2, 2, 'nepal_base', 'BlueMarble_NextGeneration')
    print('bad', bad[:5])
