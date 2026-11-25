"""buried.py: the first shot of the film, seen from under a table. The ceiling comes down, the table holds, the light goes out.

    blender -b -P buried.py -- sim                     build the room, break the ceiling, let it fall, save fall.blend
    blender -b fall.blend -P buried.py -- still 10,40,80 [--pct 25] [--spp 32] [--shot a|b]
    blender -b fall.blend -P buried.py -- render OUTDIR --shot a --from 0 --to 90
Nothing here is a real place. The film tags it Simulated. Materials and furniture: Poly Haven (CC0)."""
import bpy, bmesh, sys, os, math, random
import numpy as np
from mathutils import Vector, Matrix, Euler, noise
from mathutils.bvhtree import BVHTree
D = os.path.expanduser('~/Developer/.hound-release/film/buried/'); PH = D + 'ph/'
A = sys.argv[sys.argv.index('--') + 1:]; opt = lambda n, d: type(d)(A[A.index(n) + 1]) if n in A else d
R = random.Random(11); FPS = 60; NSIM = 420; REL0 = 10
def mt(n): return bpy.data.materials.get(n) or bpy.data.materials.new(n)
def new(name, bm, mats=()):
    m = bpy.data.meshes.new(name); bm.to_mesh(m); bm.free(); o = bpy.data.objects.new(name, m); bpy.context.collection.objects.link(o)
    for x in mats: m.materials.append(x)
    return o
def box(x0, x1, y0, y1, z0, z1):
    bm = bmesh.new(); v = [bm.verts.new((x, y, z)) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    for f in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)): bm.faces.new([v[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); return bm
def copybm(bm): b = bm.copy(); return b
# ------------------------------------------------------------------ breaking a slab
def rough(bm, L, amp):          # break up the broken faces: fine mesh, then only ever inward, so neighbours never start overlapped
    for _ in range(6):
        e = [x for x in bm.edges if x.calc_length() > L and any(f.material_index == 1 for f in x.link_faces)]
        if not e: break
        bmesh.ops.subdivide_edges(bm, edges=e, cuts=1); bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
    bm.normal_update()
    for v in bm.verts:
        k = [f.material_index for f in v.link_faces]
        if 1 in k:
            q = v.co; a = amp * (.15 + 1.1 * abs(noise.noise(q * 2.7)) + .8 * abs(noise.noise(q * 7.)) + .5 * abs(noise.noise(q * 17.)) + .3 * abs(noise.noise(q * 41.))); v.co = q - v.normal * a * (.6 if 0 in k else 1.)
def fracture(name, x0, x1, y0, y1, z0, z1, seeds, mats, amp=.058, L=.05, chip=0.):
    out = []
    for i, s in enumerate(seeds):
        bm = box(x0, x1, y0, y1, z0, z1)
        for j, q in enumerate(seeds):
            if i == j: continue
            d = Vector((q[0] - s[0], q[1] - s[1], (q[2] - s[2]))); m = Vector(((q[0] + s[0]) / 2, (q[1] + s[1]) / 2, (q[2] + s[2]) / 2))
            if d.length > 4.5: continue
            g = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=m, plane_no=d, clear_outer=True); e = [x for x in g['geom_cut'] if isinstance(x, bmesh.types.BMEdge)]
            if e:
                for x in bmesh.ops.holes_fill(bm, edges=e, sides=0)['faces']: x.material_index = 1
        if len(bm.faces) < 4: bm.free(); continue
        for f in bm.faces:
            if R.random() < chip: f.material_index = 1
        bmesh.ops.triangulate(bm, faces=bm.faces[:]); c = Vector((0, 0, 0))
        for v in bm.verts: c += v.co
        c /= len(bm.verts)
        for v in bm.verts: v.co -= c
        px = new(f'px_{name}{i}', copybm(bm)); px.location = c; rough(bm, L, amp); o = new(f'{name}{i}', bm, mats); o.location = c; out.append((o, px))
    return out
def chunk(name, r, mats, fine=True):
    bm = bmesh.new(); pts = []
    for _ in range(R.randint(9, 15)):
        p = Vector((R.gauss(0, 1), R.gauss(0, 1), R.gauss(0, 1))); p.normalize(); p = Vector((p.x * R.uniform(.6, 1.25), p.y * R.uniform(.5, 1.1), p.z * R.uniform(.35, .8))) * r; pts.append(bm.verts.new(p))
    g = bmesh.ops.convex_hull(bm, input=pts); bmesh.ops.delete(bm, geom=list({x for x in g['geom_interior'] + g['geom_unused'] if isinstance(x, bmesh.types.BMVert)}), context='VERTS'); bmesh.ops.triangulate(bm, faces=bm.faces[:]); px = new('px_' + name, copybm(bm))
    for f in bm.faces: f.material_index = 1 if R.random() < .82 else 0
    if fine: rough(bm, max(.012, r * .22), r * .16)
    return new(name, bm, mats), px
def rod(name, pts, r, m):
    c = bpy.data.curves.new(name, 'CURVE'); c.dimensions = '3D'; c.bevel_depth = r; c.bevel_resolution = 2; s = c.splines.new('POLY'); s.points.add(len(pts) - 1)
    for p, q in zip(s.points, pts): p.co = (*q, 1)
    o = bpy.data.objects.new(name, c); bpy.context.collection.objects.link(o); c.materials.append(m); return o
def rb(o, kind='ACTIVE', shape='CONVEX_HULL', mass=None, fr=.85, bo=.05):
    bpy.context.view_layer.objects.active = o; bpy.ops.rigidbody.object_add(type=kind); b = o.rigid_body; b.collision_shape = shape; b.friction = fr; b.restitution = bo; b.use_margin = True; b.collision_margin = .003
    if mass: b.mass = mass
    b.linear_damping = .02; b.angular_damping = .08; return b
def prop(n, loc, rz=0., sc=1., rx=0., keep=None):
    old = set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=PH + f'{n}/{n}.gltf'); L = [o for o in bpy.data.objects if o not in old]; ms = [o for o in L if o.type == 'MESH' and (keep is None or any(k in o.name for k in keep))]
    for o in L:
        if o not in ms: bpy.data.objects.remove(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in ms: o.select_set(True)
    bpy.context.view_layer.objects.active = ms[0]; bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM'); bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(ms) > 1: bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active; o.name = n; o.scale = (sc,) * 3; o.rotation_mode = 'XYZ'; o.rotation_euler = (rx, 0, rz); o.location = loc; bpy.ops.object.transform_apply(location=False, rotation=True, scale=True); return o
def hull(o, name):          # a simple shape for the physics to hold
    bm = bmesh.new(); bm.from_mesh(o.data); P = [v.co.copy() for v in bm.verts]; bm.free(); bm = bmesh.new(); st = max(1, len(P) // 1500)
    for p in P[::st]: bm.verts.new(p)
    g = bmesh.ops.convex_hull(bm, input=bm.verts[:]); bmesh.ops.delete(bm, geom=list({x for x in g['geom_interior'] + g['geom_unused'] if isinstance(x, bmesh.types.BMVert)}), context='VERTS'); x = new('px_' + name, bm); x.location = o.location; return x
# ------------------------------------------------------------------ the place
HOLE = (-2.5, .7, 3.35, 5.25)          # where the sun gets in above the ceiling
def build():
    bpy.ops.wm.read_factory_settings(use_empty=True); S = bpy.context.scene; S.render.fps = FPS; S.frame_start = 0; S.frame_end = NSIM
    con, bro, pla, til, bri, ru, wood = (mt(n) for n in ('concrete', 'broken', 'plaster', 'tile', 'brick', 'rust', 'trim')); M = (con, bro); hx0, hx1, hz0, hz1 = HOLE
    for n, b, m in (('floor', (-3.2, 3.2, -3.6, 5.3, -.3, 0), til), ('wallL', (-3.2, -3, -3.6, 5.3, 0, 2.8), pla), ('wallR', (3, 3.2, -3.6, 5.3, 0, 2.8), pla), ('wallB', (-3.2, 3.2, -3.6, -3.4, 0, 6), pla), ('f1', (-3.2, -1.05, 5.1, 5.3, 0, 2.8), pla), ('f2', (1.05, 3.2, 5.1, 5.3, 0, 2.8), pla), ('f3', (-1.05, 1.05, 5.1, 5.3, 0, .80), pla), ('f4', (-1.05, 1.05, 5.1, 5.3, 2.25, 2.8), pla),
                    ('upR', (3, 3.2, -3.6, 5.3, 2.8, 6), bri), ('upL', (-3.2, -3, -3.6, 5.3, 2.8, 6), bri), ('u1', (-3.2, hx0, 5.1, 5.3, 2.8, 6), bri), ('u2', (hx1, 3.2, 5.1, 5.3, 2.8, 6), bri), ('u3', (hx0, hx1, 5.1, 5.3, 2.8, hz0), bri), ('u4', (hx0, hx1, 5.1, 5.3, hz1, 6), bri), ('roof', (-3.2, 3.2, -3.6, 5.3, 6, 6.2), con),
                    ('sk1', (-3.0, -2.985, -3.4, 5.1, 0, .09), wood), ('sk2', (2.985, 3.0, -3.4, 5.1, 0, .09), wood), ('sk3', (-3, 3, 5.085, 5.1, 0, .09), wood), ('sill', (-1.18, 1.18, 4.98, 5.12, .77, .81), wood), ('w1', (-1.11, -1.0, 5.06, 5.16, .80, 2.31), wood), ('w2', (1.0, 1.11, 5.06, 5.16, .80, 2.31), wood), ('w3', (-1.11, 1.11, 5.06, 5.16, 2.20, 2.31), wood), ('w4', (-.028, .028, 5.12, 5.18, .80, 2.25), wood), ('w5', (-1.05, 1.05, 5.12, 5.18, 1.70, 1.745), wood)):
        o = new('st_' + n, box(*b), (m,))
        if m is wood: bv = o.modifiers.new('b', 'BEVEL'); bv.width = .006; bv.segments = 2
    for i in range(150):          # the torn edge of the hole: loose bricks
        t = R.random() * 4; w, h = hx1 - hx0, hz1 - hz0; x, z = ((hx0 + R.random() * w, hz0) if t < 1 else (hx0 + R.random() * w, hz1) if t < 2 else (hx0, hz0 + R.random() * h) if t < 3 else (hx1, hz0 + R.random() * h)); bm = box(-.11, .11, -.052, .052, -.033, .033); o = new(f'st_bk{i}', bm, (bri,)); o.location = (x + R.gauss(0, .10), 5.2 + R.uniform(-.06, .06), z + R.gauss(0, .10)); o.rotation_euler = (R.gauss(0, .12), R.gauss(0, .10), R.gauss(0, .12)); bv = o.modifiers.new('b', 'BEVEL'); bv.width = .006
    for s in (-1, 1):          # curtains
        bm = bmesh.new(); nx, nz = 60, 40; g = [[None] * (nz + 1) for _ in range(nx + 1)]
        for i in range(nx + 1):
            for j in range(nz + 1):
                u, v = i / nx, j / nz; x = s * (.92 + .46 * u); z = 2.42 - 1.96 * v; g[i][j] = bm.verts.new((x + .012 * math.sin(40 * u + 3 * v), 4.94 + (.045 + .02 * v) * math.sin(u * 34 + s + .8 * math.sin(v * 3)) + .02 * noise.noise(Vector((u * 5, v * 3, s * 9.))), z))
        for i in range(nx):
            for j in range(nz): bm.faces.new((g[i][j], g[i + 1][j], g[i + 1][j + 1], g[i][j + 1])).smooth = True
        new(f'st_curtain{s}', bm, (mt('curtain'),))
    rod('st_rail', [(-1.55, 4.93, 2.45), (1.55, 4.93, 2.45)], .012, mt('rust'))
    tb = prop('dining_table', (.18, -2.35, 0)); pa = prop('hanging_picture_frame_02', (-2.985, 1.15, 1.62), math.pi / 2); pb = prop('hanging_picture_frame_02', (-2.985, 2.35, 1.70), math.pi / 2, .7)
    ck = prop('wall_clock', (-1.95, 5.09, 1.95)); loose = []
    for n, l, rz, sc, ms in (('painted_wooden_chair_01', (-1.40, .75, .002), 2.3, 1., 6), ('painted_wooden_chair_01', (1.62, 1.25, .002), -2.2, 1., 6), ('painted_wooden_chair_01', (.12, 2.75, .002), 3.5, 1., 6), ('wooden_bookshelf_worn', (2.66, 2.4, .002), -math.pi / 2, 1., 70), ('book_encyclopedia_set_01', (-.2, 4.6, .002), .1, 1., 5)):
        o = prop(n, l, rz, sc); p = hull(o, n); p['m'] = ms; p['rel'] = 0; loose.append((o, p))
    lamp = prop('hanging_industrial_lamp', (-.35, 1.2, 2.80), .4, .8, .10); lp = hull(lamp, 'lamp'); lp['m'] = 4; lp['rel'] = REL0 + 4; loose.append((lamp, lp))
    seeds = [(R.uniform(-3, 3), R.uniform(-3.4, 5.1), 2.9 + R.uniform(-.02, .02)) for _ in range(34)]
    pc = fracture('slab', -2.995, 2.995, -3.395, 5.095, 2.8, 3.04, seeds, M)
    b1 = fracture('beam', -2.95, 2.95, 1.75, 2.05, 2.44, 2.795, [(x + R.uniform(-.25, .25), 1.9 + R.uniform(-.1, .1), 2.62 + R.uniform(-.12, .12)) for x in (-2.5, -1.5, -.4, .5, 1.6, 2.6)], M, .035, .04, .5); b2 = fracture('beam2', -2.95, 2.95, -.95, -.65, 2.44, 2.795, [(x + R.uniform(-.25, .25), -.8 + R.uniform(-.1, .1), 2.62 + R.uniform(-.12, .12)) for x in (-2.5, -1.2, .1, 1.3, 2.5)], M, .035, .04, .5)
    big = pc + b1 + b2; act = list(big)
    for i in range(46):          # what was standing on the floor above
        o, p = chunk(f'up{i}', R.uniform(.14, .40), (bri if R.random() < .45 else con, bro)); l = (R.uniform(-2.6, 2.6), R.uniform(-2.4, 4.6), R.uniform(3.4, 4.7)); e = (R.uniform(0, 6), R.uniform(0, 6), R.uniform(0, 6))
        for q in (o, p): q.location = l; q.rotation_euler = e
        act.append((o, p))
    for i in range(620):          # crumbs out of the cracks
        o, p = chunk(f'cr{i}', .016 + .13 * R.random() ** 2.5, M, True); s = R.choice(seeds); l = (max(-2.85, min(2.85, s[0] + R.uniform(-1.1, 1.1))), max(-3.1, min(4.9, s[1] + R.uniform(-1.1, 1.1))), R.uniform(3.10, 3.42)); e = (R.uniform(0, 6), R.uniform(0, 6), R.uniform(0, 6))
        for q in (o, p): q.location = l; q.rotation_euler = e
        act.append((o, p))
    for n, b in (('floor', (-9, 9, -9, 11, -3, 0)), ('L', (-6, -3, -7, 9, 0, 6)), ('R', (3, 6, -7, 9, 0, 6)), ('B', (-6, 6, -7, -3.4, 0, 6)), ('f1', (-6, -1.05, 5.1, 9, 0, 2.8)), ('f2', (1.05, 6, 5.1, 9, 0, 2.8)), ('f3', (-1.05, 1.05, 5.1, 9, 0, .8)), ('f4', (-1.05, 1.05, 5.1, 9, 2.25, 2.8)), ('u1', (-6, hx0, 5.1, 9, 2.8, 6)), ('u2', (hx1, 6, 5.1, 9, 2.8, 6)), ('u3', (hx0, hx1, 5.1, 9, 2.8, hz0)), ('u4', (hx0, hx1, 5.1, 9, hz1, 6)), ('table', (-.95, 1.30, -3.0, -1.67, .78, .87))):          # thick walls, felt but not seen
        o = new('hit_' + n, box(*b)); rb(o, 'PASSIVE', 'CONVEX_HULL', fr=.9)
    bm = bmesh.new(); ring = [(-1.0, 0), (-.95, .60), (-.5, .98), (.75, 1.02), (1.22, .66), (1.3, 0)]          # the room to live that the table keeps open
    for y in (-3.3, .25):
        for x, z in ring: bm.verts.new((x, y, z * (1. if y < 0 else .60)))
    bmesh.ops.convex_hull(bm, input=bm.verts[:]); sp = new('hit_space', bm); rb(sp, 'PASSIVE', 'CONVEX_HULL')
    bpy.context.view_layer.update(); bpy.ops.object.select_all(action='DESELECT')
    for _, p in act + loose: p.select_set(True)
    bpy.context.view_layer.objects.active = act[0][1]; bpy.ops.rigidbody.objects_add(type='ACTIVE')
    for o, p in act + loose:
        dim = p.dimensions; b = p.rigid_body; b.collision_shape = 'CONVEX_HULL'; b.friction = .85; b.restitution = .05; b.use_margin = True; b.collision_margin = .003; b.mass = float(p.get('m', 0)) or max(.05, dim.x * dim.y * dim.z * 1200); b.linear_damping = .02; b.angular_damping = .08; p.hide_render = True
        if 'rel' in p: f = p['rel']
        else: d = math.hypot(p.location.x - .4, p.location.y - 2.1); f = REL0 + (int(d * 5.2) + R.randint(0, 5) if o.name[:2] != 'up' else int(d * 5) + R.randint(4, 14))
        if o.name[:4] in ('slab', 'beam') and math.hypot(p.location.x - .4, p.location.y - 2.1) < 1.0: f = REL0
        if f: b.kinematic = True; b.keyframe_insert('kinematic', frame=0); b.kinematic = True; b.keyframe_insert('kinematic', frame=f - 1); b.kinematic = False; b.keyframe_insert('kinematic', frame=f)
    for i, (o, p) in enumerate(big):          # bars sticking out of the broken edges
        dm = p.dimensions
        for k in range(R.randint(2, 5)):
            a = R.uniform(0, 6.283); q = Vector((math.cos(a) * dm.x * .36, math.sin(a) * dm.y * .36, R.uniform(-.3, .3) * dm.z)); dr = Vector((math.cos(a), math.sin(a), R.uniform(-.25, .25))); bend = Vector((R.uniform(-1, 1), R.uniform(-1, 1), -R.uniform(.1, 1.2))) * .35; L = R.uniform(.2, .7); pts = [q + dr * (L * t) + bend * (L * t * t) for t in [x / 9 for x in range(10)]]; rod(f'bar{i}_{k}', pts, R.choice((.005, .006, .008)), ru).parent = o
    w = S.rigidbody_world; w.substeps_per_frame = 12; w.solver_iterations = 24; w.point_cache.frame_start = 0; w.point_cache.frame_end = NSIM; return act + loose
def sim():
    act = build(); S = bpy.context.scene; T = np.zeros((NSIM + 1, len(act), 7)); print('bodies', len(act), flush=True)
    for f in range(NSIM + 1):
        S.frame_set(f); dg = bpy.context.evaluated_depsgraph_get()
        for i, (o, p) in enumerate(act): mw = p.evaluated_get(dg).matrix_world; T[f, i] = (*mw.translation, *mw.to_quaternion())
        if f % 60 == 0: print('frame', f, flush=True)
    z = T[-1, :, 2]; print('settled: lowest', z.min().round(2), 'mean', z.mean().round(2), 'still moving', int((np.abs(T[-1, :, :3] - T[-8, :, :3]).max(1) > .004).sum()), 'of', len(act))
    for o in list(S.objects):
        if o.rigid_body: bpy.data.objects.remove(o)
    for i, (o, _) in enumerate(act):
        o.rotation_mode = 'QUATERNION'; last = None
        for f in range(NSIM + 1):
            v = T[f, i]
            if last is not None and f < NSIM and np.abs(v - last).max() < 2e-5 and np.abs(T[f + 1, i] - v).max() < 2e-5: continue
            q = v[3:]; q = -q if last is not None and (last[3:] * q).sum() < 0 else q; T[f, i, 3:] = q; o.location = v[:3]; o.rotation_quaternion = q; o.keyframe_insert('location', frame=f); o.keyframe_insert('rotation_quaternion', frame=f); last = T[f, i].copy()
    np.save(D + 'fall.npy', T); bpy.ops.wm.save_as_mainfile(filepath=D + 'fall.blend')
exec(open(D + 'look.py').read()) if A[0] != 'sim' else sim()
