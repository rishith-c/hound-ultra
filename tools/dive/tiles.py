"""Satellite and height tiles for the dive, kept on disk so each is fetched once."""
import io, math, os, ssl, time, urllib.request, urllib.error
import certifi
CTX = ssl.create_default_context(cafile=certifi.where())
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
D = os.path.dirname(os.path.abspath(__file__)) + '/t/'
UA = {'User-Agent': 'Mozilla/5.0'}
IMG = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false'
DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
bad = []
def get(url, name):
    p = D + name
    if os.path.exists(p) and os.path.getsize(p) > 100: return p
    os.makedirs(os.path.dirname(p), exist_ok=True)
    for k in range(4):
        try:
            b = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60, context=CTX).read(); open(p, 'wb').write(b); return p
        except urllib.error.HTTPError as e:
            if e.code in (404, 403, 400): bad.append((name, e.code)); return None
            time.sleep(1 + k)
        except Exception as e: time.sleep(1 + k)
    bad.append((name, 'failed')); return None
def merc(lon, lat): return (lon + 180) / 360, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2
def mosaic(z, x0, y0, n, kind='img', workers=10):
    M = Image.new('RGB', (n * 256, n * 256)); N = 2 ** z; miss = 0
    def one(a):
        i, j = a; x = (x0 + i) % N; y = y0 + j
        if y < 0 or y >= N: return None
        p = get((IMG if kind == 'img' else DEM).format(z=z, x=x, y=y), f'{kind}/{z}/{x}_{y}.' + ('jpg' if kind == 'img' else 'png'))
        return a, p
    with ThreadPoolExecutor(workers) as ex:
        for r in ex.map(one, [(i, j) for j in range(n) for i in range(n)]):
            if r and r[1]: M.paste(Image.open(r[1]).convert('RGB'), (r[0][0] * 256, r[0][1] * 256))
            else: miss += 1
    return M, miss
def day(date, bbox, w, h, name, layer='VIIRS_NOAA20_CorrectedReflectance_TrueColor', crs='EPSG:4326'):
    return get(f'https://wvs.earthdata.nasa.gov/api/v1/snapshot?REQUEST=GetSnapshot&LAYERS={layer}&CRS={crs}&TIME={date}&BBOX={bbox}&FORMAT=image/jpeg&WIDTH={w}&HEIGHT={h}', name)
