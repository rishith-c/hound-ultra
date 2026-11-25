"""Everything the dive needs, fetched once. Target: the river bend and village of Timure."""
from tiles import *
import sys
LON, LAT = 85.3682, 28.2555
PLAN = {9: 16, 10: 16, 11: 16, 12: 16, 13: 16, 14: 16, 15: 16, 16: 24, 17: 24, 18: 24}
def corner(z, n):
    x, y = merc(LON, LAT); return round(x * 2 ** z) - n // 2, round(y * 2 ** z) - n // 2
if __name__ == '__main__':
    t = time.time()
    J = []
    SAT = {'n20': 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', 'n21': 'VIIRS_NOAA21_CorrectedReflectance_TrueColor', 'snpp': 'VIIRS_SNPP_CorrectedReflectance_TrueColor'}
    BB = {'globe': ('-90,-180,90,180', 8192, 4096), 'asia': ('-10,45,60,135', 8192, 6372), 'nepal': ('22,77.5,34,93.5', 8192, 6144)}
    for b, (bb, w, h) in BB.items():
        for s, l in SAT.items(): J.append(('2026-08-26', bb, w, h, f'day/{b}_{s}.jpg', l))
        J.append(('2026-08-26', bb, w, h, f'day/{b}_base.jpg', 'BlueMarble_NextGeneration'))
    J.append(('2016-01-01', *BB['globe'][:1], 8192, 4096, 'day/globe_night.jpg', 'VIIRS_Black_Marble'))
    J.append(('2016-01-01', BB['asia'][0], 8192, 6372, 'day/asia_night.jpg', 'VIIRS_Black_Marble'))
    with ThreadPoolExecutor(5) as ex:
        for j, p in zip(J, ex.map(lambda j: day(*j), J)): print(j[4], os.path.getsize(p) // 1024 if p else 'MISSING', flush=True)
    for z, n in PLAN.items():
        x0, y0 = corner(z, n); M, m = mosaic(z, x0, y0, n, 'img'); M.save(f't/img{z}.png', compress_level=1); print('img', z, n, 'missing', m, round(time.time() - t), 's', flush=True)
    for z in range(6, 15):
        n = 16 if z == 14 else 8
        x0, y0 = corner(z, n); M, m = mosaic(z, x0, y0, n, 'dem'); M.save(f't/dem{z}.png', compress_level=1); print('dem', z, n, 'missing', m, round(time.time() - t), 's', flush=True)
    print('bad', len(bad), bad[:6])
