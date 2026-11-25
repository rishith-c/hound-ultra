"""Fetch CC0 materials and furniture from Poly Haven (public, free for any use) into ph/."""
import urllib.request, json, os, concurrent.futures as cf
H = {'User-Agent': 'texture-fetch/1.0'}
g = lambda u: urllib.request.urlopen(urllib.request.Request(u, headers=H), timeout=60).read()
TEX = {'worn_plaster_wall': '2k', 'plastered_wall_04': '2k', 'wood_floor_worn': '4k', 'concrete_debris': '2k', 'broken_brick_wall': '2k', 'dirty_concrete': '2k', 'cracked_concrete_wall': '2k', 'rubble': '2k', 'white_plaster_02': '2k', 'rough_plaster_broken': '2k'}
MOD = {'WoodenChair_01': '2k', 'dining_table': '2k', 'hanging_picture_frame_02': '1k', 'tea_set_01': '1k', 'wooden_bookshelf_worn': '2k', 'book_encyclopedia_set_01': '1k', 'hanging_industrial_lamp': '1k'}
J = []
for a, r in TEX.items():
    f = json.loads(g(f'https://api.polyhaven.com/files/{a}'))
    for m, n in (('Diffuse', 'diff'), ('Rough', 'rough'), ('Displacement', 'disp')):
        if m in f and r in f[m]: e = f[m][r].get('jpg') or f[m][r].get('png'); J.append((e['url'], f'ph/{a}_{n}.' + e['url'].rsplit('.', 1)[1], e['size']))
for a, r in MOD.items():
    f = json.loads(g(f'https://api.polyhaven.com/files/{a}'))['gltf'][r]['gltf']; J.append((f['url'], f'ph/{a}/{a}.gltf', f['size']))
    for p, v in f.get('include', {}).items(): J.append((v['url'], f'ph/{a}/{p}', v['size']))
print(len(J), 'files', round(sum(x[2] for x in J) / 1e6, 1), 'MB')
def get(j):
    if os.path.exists(j[1]) and os.path.getsize(j[1]) == j[2]: return
    os.makedirs(os.path.dirname(j[1]), exist_ok=True); open(j[1], 'wb').write(g(j[0]))
with cf.ThreadPoolExecutor(6) as ex: list(ex.map(get, J))
print('ok')
