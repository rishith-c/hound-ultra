# look.py: what things are made of, camera, sun, dust and the two shots. Run by buried.py inside fall.blend.
W, H = 3840, 1608
def key(id, path, f, v): setattr(id, path, v); id.keyframe_insert(path, frame=f)
def sm(a, b, x): x = max(0., min(1., (x - a) / (b - a))); return x * x * (3 - 2 * x)
class G:          # small helper for building shader graphs
    def __init__(s, nt): s.nt = nt; s.n = nt.nodes; s.l = nt.links
    def put(s, i, q):
        if hasattr(q, 'links'): s.l.new(q, i)
        else: i.default_value = q
    def M(s, op, a, b=None, c=None, clamp=False):
        x = s.n.new('ShaderNodeMath'); x.operation = op; x.use_clamp = clamp
        for i, q in enumerate((a, b, c)):
            if q is not None: s.put(x.inputs[i], q)
        return x.outputs[0]
    def mr(s, v, a, b, lo=0., hi=1., smooth=True):
        x = s.n.new('ShaderNodeMapRange'); x.interpolation_type = 'SMOOTHSTEP' if smooth else 'LINEAR'; s.l.new(v, x.inputs[0])
        for i, q in enumerate((a, b, lo, hi)): s.put(x.inputs[i + 1], q)
        return x.outputs[0]
    def mix(s, a, b, f, mode='MIX'):
        x = s.n.new('ShaderNodeMix'); x.data_type = 'RGBA'; x.blend_type = mode; x.clamp_result = False; s.put(x.inputs[0], f); s.put(x.inputs[6], a); s.put(x.inputs[7], b); return x.outputs[2]
    def noise(s, v, sc, d=6., r=.6):
        x = s.n.new('ShaderNodeTexNoise'); x.inputs['Scale'].default_value = sc; x.inputs['Detail'].default_value = d; x.inputs['Roughness'].default_value = r; s.l.new(v, x.inputs['Vector']); return x.outputs[0]
    def tex(s, v, f, non=False):
        x = s.n.new('ShaderNodeTexImage'); x.image = bpy.data.images.load(PH + f, check_existing=True); x.projection = 'BOX'; x.projection_blend = .2
        if non: x.image.colorspace_settings.name = 'Non-Color'
        s.l.new(v, x.inputs[0]); return x.outputs[0]
def start(name):
    m = mt(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear(); g = G(nt); out = g.n.new('ShaderNodeOutputMaterial'); p = g.n.new('ShaderNodeBsdfPrincipled'); g.l.new(p.outputs[0], out.inputs[0]); return m, g, p
def scan(name, f, size, tint=(1, 1, 1), sat=1., bump=.012, rnd=False, rmul=1., top=None, dusty=0.):
    m, g, p = start(name); tc = g.n.new('ShaderNodeTexCoord'); mp = g.n.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (1 / size,) * 3; g.l.new(tc.outputs['Object'], mp.inputs[0]); v = mp.outputs[0]; obj = tc.outputs['Object']
    if rnd:
        inf = g.n.new('ShaderNodeObjectInfo'); a = g.n.new('ShaderNodeVectorMath'); a.operation = 'ADD'; w = g.n.new('ShaderNodeTexWhiteNoise'); w.noise_dimensions = '1D'; g.l.new(inf.outputs['Random'], w.inputs['W']); sc = g.n.new('ShaderNodeVectorMath'); sc.operation = 'SCALE'; sc.inputs['Scale'].default_value = 5.; g.l.new(w.outputs['Color'], sc.inputs[0]); g.l.new(mp.outputs[0], a.inputs[0]); g.l.new(sc.outputs[0], a.inputs[1]); v = a.outputs[0]
    def layer(f, tint, sat):
        c = g.tex(v, f + '_diff.jpg'); hs = g.n.new('ShaderNodeHueSaturation'); hs.inputs['Saturation'].default_value = sat; g.l.new(c, hs.inputs['Color']); return g.mix(hs.outputs[0], (*tint, 1), 1., 'MULTIPLY')
    c = layer(f, tint, sat); ht = g.tex(v, f + '_disp.jpg', True); ro = g.tex(v, f + '_rough.jpg', True)
    if top:          # the other side of a slab is another material
        s = g.n.new('ShaderNodeSeparateXYZ'); g.l.new(tc.outputs['Normal'], s.inputs[0]); k = g.mr(s.outputs[2], -.2, .2, 0., 1.); c = g.mix(layer(*top), c, k); 
    geo = g.n.new('ShaderNodeNewGeometry'); sp = g.n.new('ShaderNodeSeparateXYZ'); g.l.new(geo.outputs['Normal'], sp.inputs[0]); dn = g.noise(obj, 5., 8., .7); up = g.M('MULTIPLY', g.mr(sp.outputs[2], .15, .85, 0., 1.), g.mr(dn, .28, .55, .35, 1.)); up = g.M('MULTIPLY', up, dusty); c = g.mix(c, (.30, .292, .282, 1), up); cav = g.noise(obj, 1.3, 5.); c = g.mix(c, g.mix(c, (.55, .52, .48, 1), 1., 'MULTIPLY'), g.mr(cav, .42, .68))
    g.l.new(c, p.inputs['Base Color']); g.l.new(g.M('MULTIPLY', g.mix(ro, (.95, .95, .95, 1), up), rmul, clamp=True), p.inputs['Roughness']); p.inputs['Specular IOR Level'].default_value = .35
    b1 = g.n.new('ShaderNodeBump'); b1.inputs['Distance'].default_value = bump; b1.inputs['Strength'].default_value = .9; g.l.new(ht, b1.inputs['Height']); b2 = g.n.new('ShaderNodeBump'); b2.inputs['Distance'].default_value = .0016; b2.inputs['Strength'].default_value = .5; g.l.new(g.noise(obj, 120., 5.), b2.inputs['Height']); g.l.new(b1.outputs[0], b2.inputs['Normal']); g.l.new(b2.outputs[0], p.inputs['Normal']); return m
def materials(shot):
    d = .0 if shot == 'a' else .95
    scan('concrete', 'white_plaster_02', 1.0, (1.25, 1.22, 1.15), .5, .006, True, 1., ('dirty_concrete', (.8, .78, .75), .6), d); scan('broken', 'concrete_debris', 1.1, (.92, .89, .85), .6, .030, True, 1., None, d * .8); scan('plaster', 'white_plaster_02', 1.4, (1.10, 1.22, 1.16), 1.1, .006, False, 1., None, d * .7); scan('tile', 'wood_floor_worn', 2.0, (.50, .46, .44), .72, .008, False, .62, None, d); scan('brick', 'broken_brick_wall', 1.8, (.62, .60, .58), .62, .02, True, 1., None, d); scan('gravel', 'concrete_debris', .5, (.95, .92, .88), .6, .01, True, 1., None, d * .7)
    m, g, p = start('rust'); p.inputs['Base Color'].default_value = (.085, .05, .035, 1); p.inputs['Roughness'].default_value = .7; p.inputs['Metallic'].default_value = .4
    m, g, p = start('trim'); p.inputs['Base Color'].default_value = (.46, .43, .38, 1); p.inputs['Roughness'].default_value = .45
    m, g, p = start('curtain'); p.inputs['Base Color'].default_value = (.60, .50, .40, 1); p.inputs['Roughness'].default_value = .95; t = g.n.new('ShaderNodeBsdfTranslucent'); t.inputs[0].default_value = (.70, .50, .32, 1); mx = g.n.new('ShaderNodeMixShader'); mx.inputs[0].default_value = .5; out = next(x for x in g.n if x.type == 'OUTPUT_MATERIAL'); g.l.new(p.outputs[0], mx.inputs[1]); g.l.new(t.outputs[0], mx.inputs[2]); g.l.new(mx.outputs[0], out.inputs[0])
    for m in bpy.data.materials:          # furniture gets dusty too
        if m.users and m.node_tree and m.name.split('.')[0] in ('dining_table', 'dining_table_cloth', 'painted_wooden_chair_01', 'wooden_bookshelf_worn') and d:
            g = G(m.node_tree); p = next((x for x in g.n if x.type == 'BSDF_PRINCIPLED'), None)
            if p and p.inputs['Base Color'].links: c = p.inputs['Base Color'].links[0].from_socket; geo = g.n.new('ShaderNodeNewGeometry'); sp = g.n.new('ShaderNodeSeparateXYZ'); g.l.new(geo.outputs['Normal'], sp.inputs[0]); g.l.new(g.mix(c, (.30, .292, .282, 1), g.mr(sp.outputs[2], -.3, .9, .35, .9)), p.inputs['Base Color'])
def volume(shot):
    bm = box(-2.99, 2.99, -3.38, 5.09, .005, 5.98); o = new('dust', bm); m = bpy.data.materials.new('dustv'); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear(); g = G(nt); out = g.n.new('ShaderNodeOutputMaterial'); v = g.n.new('ShaderNodeVolumePrincipled'); g.l.new(v.outputs[0], out.inputs['Volume']); v.inputs['Color'].default_value = (.93, .90, .865, 1) if shot == 'a' else (.86, .83, .79, 1); v.inputs['Anisotropy'].default_value = .5
    P = g.n.new('ShaderNodeNewGeometry').outputs['Position']; T = g.n.new('ShaderNodeValue'); F = g.n.new('ShaderNodeValue'); Q = g.n.new('ShaderNodeValue')          # time, how far the cloud has come, how thick
    def noi(s, d, wk, off):
        x = g.n.new('ShaderNodeTexNoise'); x.noise_dimensions = '4D'; x.inputs['Scale'].default_value = s; x.inputs['Detail'].default_value = d; x.inputs['Roughness'].default_value = .62; g.l.new(g.M('MULTIPLY_ADD', T.outputs[0], wk, off), x.inputs['W']); g.l.new(P, x.inputs['Vector']); return x.outputs[0]
    big, small = noi(.9, 3, .55, 0), noi(3.0, 4, 1.2, 7); d = g.n.new('ShaderNodeVectorMath'); d.operation = 'DISTANCE'; g.l.new(P, d.inputs[0]); d.inputs[1].default_value = (.3, 2.1, .2)
    dist = g.M('ADD', d.outputs['Value'], g.M('MULTIPLY', g.M('SUBTRACT', small, .5), 2.2)); dist = g.M('ADD', dist, g.M('MULTIPLY', g.M('SUBTRACT', big, .5), 1.8)); front = g.mr(dist, g.M('SUBTRACT', F.outputs[0], 1.1), F.outputs[0], 1., 0.)
    body = g.M('MULTIPLY', g.M('POWER', g.M('MULTIPLY', g.M('ADD', g.M('MULTIPLY', big, .5), g.M('MULTIPLY', small, .5)), 1.8), 3.6), Q.outputs[0]); sp = g.n.new('ShaderNodeSeparateXYZ'); g.l.new(P, sp.inputs[0]); low = g.mr(sp.outputs[2], 0., 4.5, 1.25, .5); dens = g.M('MULTIPLY', g.M('MULTIPLY', front, body), low)
    g.l.new(g.M('ADD', dens, .040 if shot == 'a' else .035), v.inputs['Density'])
    for f in (0, 420): key(T.outputs[0], 'default_value', f, f / 60.)
    if shot == 'a':
        for f, r in ((0, -2.), (44, -.6), (56, .8), (70, 2.0), (86, 3.4), (108, 6.0)): key(F.outputs[0], 'default_value', f, r)
        for f, q in ((0, .2), (48, .40), (70, .6), (90, .85), (108, 1.3)): key(Q.outputs[0], 'default_value', f, q)
    else:
        for f in (0, 420): key(F.outputs[0], 'default_value', f, 30.)
        for f, q in ((250, .13), (420, .10)): key(Q.outputs[0], 'default_value', f, q if shot == 'b' else .12)
    o.data.materials.append(m); return o
def motes(n=5):
    R2 = random.Random(5); m = bpy.data.materials.new('mote'); m.use_nodes = True; q = m.node_tree.nodes['Principled BSDF']; q.inputs['Base Color'].default_value = (.85, .8, .72, 1); q.inputs['Roughness'].default_value = 1
    for k in range(n):
        bm = bmesh.new()
        for _ in range(380): bmesh.ops.create_icosphere(bm, subdivisions=1, radius=R2.uniform(.0006, .0019) * (1 if R2.random() < .9 else 1.7), matrix=Matrix.Translation(Vector((R2.uniform(-2.0, 2.2), R2.uniform(-2.2, 3.0), R2.uniform(.05, 2.4)))))
        o = new(f'motes{k}', bm, (m,)); a = (R2.uniform(-.08, .08), R2.uniform(-.10, .02), R2.uniform(-.05, .01)); w = R2.uniform(.02, .06)
        for f in range(0, 431, 6): t = f / 60; o.location = (a[0] * t + w * math.sin(t * 1.1 + k), a[1] * t + w * math.sin(t * .8 + 2 * k), a[2] * t + w * .6 * math.sin(t * .9 + 3 * k)); o.keyframe_insert('location', frame=f)
def litter(frame, n=7000):          # what the fall leaves lying on everything
    S = bpy.context.scene; S.frame_set(frame); dg = bpy.context.evaluated_depsgraph_get(); R3 = random.Random(8); base = []
    for k in range(10):
        bm = bmesh.new(); pts = []
        for _ in range(12): p = Vector((R3.gauss(0, 1), R3.gauss(0, 1), R3.gauss(0, 1))); p.normalize(); pts.append(bm.verts.new(Vector((p.x * R3.uniform(.6, 1.2), p.y * R3.uniform(.5, 1.), p.z * R3.uniform(.4, .8)))))
        q = bmesh.ops.convex_hull(bm, input=pts); bmesh.ops.delete(bm, geom=list({x for x in q['geom_interior'] + q['geom_unused'] if isinstance(x, bmesh.types.BMVert)}), context='VERTS'); bmesh.ops.triangulate(bm, faces=bm.faces[:]); bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=2, use_grid_fill=True)
        for v in bm.verts: v.co += noise.noise_vector(v.co * 2.3 + Vector((k, 0, 0))) * .13
        me = bpy.data.meshes.new(f'grit{k}'); bm.to_mesh(me); bm.free(); me.materials.append(mt('gravel')); base.append(me)
    put = 0
    for _ in range(n * 3):
        if put >= n: break
        x, y = R3.uniform(-2.95, 2.95), R3.uniform(-2.6, 5.0); z = R3.uniform(.3, 5.8); ok, loc, nor, _, ob, _ = S.ray_cast(dg, Vector((x, y, z)), Vector((0, 0, -1)))
        if not ok or nor.z < .55 or ob.name.startswith(('motes', 'dust', 'st_cur', 'grit')): continue
        s = .004 + .026 * R3.random() ** 3.2; o = bpy.data.objects.new(f'grit_{put}', base[R3.randrange(10)]); o.location = loc + Vector((0, 0, s * .2)); o.scale = (s,) * 3; o.rotation_euler = (R3.uniform(0, 6), R3.uniform(0, 6), R3.uniform(0, 6)); S.collection.objects.link(o); put += 1
    print('litter', put)
def look(shot, pct, spp):
    S = bpy.context.scene; S.render.engine = 'CYCLES'; P = bpy.context.preferences.addons['cycles'].preferences; P.compute_device_type = 'METAL'; P.get_devices()
    for d in P.devices: d.use = d.type == 'METAL'
    C = S.cycles; C.device = 'CPU' if '--cpu' in A else 'GPU'; C.samples = spp; C.use_adaptive_sampling = True; C.adaptive_threshold = opt('--thr', .012); C.use_denoising = True; C.denoiser = 'OPENIMAGEDENOISE'; C.denoising_input_passes = opt('--den', 'RGB_ALBEDO_NORMAL'); C.denoising_prefilter = 'ACCURATE'
    try: C.denoising_use_gpu = True
    except Exception: pass
    C.max_bounces = 8; C.diffuse_bounces = 4; C.volume_bounces = 4 if shot == 'a' else 2; C.glossy_bounces = 2; C.transmission_bounces = 3; C.sample_clamp_indirect = 4; C.caustics_reflective = False; C.caustics_refractive = False; C.volume_step_rate = 1.; C.seed = 3; C.use_animated_seed = True
    S.render.use_persistent_data = '--persist' in A; S.render.resolution_x, S.render.resolution_y, S.render.resolution_percentage = W, H, pct; S.render.use_motion_blur = True; S.render.motion_blur_shutter = .5
    S.view_settings.view_transform = 'AgX'; S.view_settings.look = 'AgX - Medium High Contrast'; S.render.image_settings.file_format = 'PNG'; S.render.image_settings.color_depth = '8'; S.render.dither_intensity = 1.
    w = bpy.data.worlds.new('sky'); S.world = w; w.use_nodes = True; b = w.node_tree.nodes['Background']; b.inputs[0].default_value = (.60, .74, .95, 1); b.inputs[1].default_value = 1.5
    sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 60 if shot == 'a' else 80; sun.angle = math.radians(.55); sun.color = (1., .90, .77); so = bpy.data.objects.new('sun', sun); S.collection.objects.link(so); so.rotation_euler = Vector((.34, -1., -.70)).to_track_quat('-Z', 'Y').to_euler()
    win = bpy.data.lights.new('win', 'AREA'); win.shape = 'RECTANGLE'; win.size = 2.0; win.size_y = 1.4; win.energy = 90 if shot == 'a' else 40; win.color = (.78, .88, 1.); wo = bpy.data.objects.new('win', win); S.collection.objects.link(wo); wo.location = (0, 5.36, 1.52); wo.rotation_euler = Vector((0, -1, -.10)).to_track_quat('-Z', 'Y').to_euler(); wo.visible_camera = False
    if shot == 'c':          # night; somebody has come with a light
        sun.energy = 0.; win.energy = 0.; b.inputs[0].default_value = (.30, .46, .80, 1); b.inputs[1].default_value = .035
        sp = bpy.data.lights.new('search', 'SPOT'); sp.energy = opt('--spot', 60000.); sp.spot_size = math.radians(17); sp.spot_blend = .35; sp.shadow_soft_size = .05; sp.color = (.93, .97, 1.); so2 = bpy.data.objects.new('search', sp); S.collection.objects.link(so2); so2.rotation_mode = 'QUATERNION'
        for f in range(0, 112):
            u = f / 105; e = u * u * (3 - 2 * u); p = Vector((-4.0 + 3.6 * e + .05 * noise.noise(Vector((f * .05, 0, 0))), 9.4, 6.6 + .5 * math.sin(u * 2.4))); q = Vector((-1.15 + .75 * e, 5.2, 4.25)); tgt = q + (q - p) * 1.4; key(sp, 'energy', f, opt('--spot', 60000.) * (.02 + .98 * sm(.02, .30, u)) * (1 - .45 * sm(.80, 1., u))); so2.location = p; so2.rotation_quaternion = (tgt - p).to_track_quat('-Z', 'Y'); so2.keyframe_insert('location', frame=f); so2.keyframe_insert('rotation_quaternion', frame=f)
    cam = bpy.data.cameras.new('cam'); co = bpy.data.objects.new('cam', cam); S.collection.objects.link(co); S.camera = co; cam.sensor_width = 36; cam.clip_start = .02; cam.dof.use_dof = True; cam.dof.aperture_fstop = 4.; co.rotation_mode = 'QUATERNION'; materials(shot)
    def at(f, p, tgt, roll=0.):
        q = (tgt - p).to_track_quat('-Z', 'Y') @ Euler((0, 0, roll)).to_quaternion(); co.location = p; co.rotation_quaternion = q; co.keyframe_insert('location', frame=f); co.keyframe_insert('rotation_quaternion', frame=f)
    if shot == 'a':
        cam.lens = 22; cam.dof.focus_distance = 4.6
        for f in range(14, 114):
            t = (f - 18) / 60; hit = lambda at, w: math.exp(-max(0, f - at) / w) * (f >= at); e = .05 + .8 * hit(24, 7) + hit(48, 12) + 1.2 * hit(80, 14); sh = lambda k, s: noise.noise(Vector((t * s, k * 7.3, 1.7))) * e
            at(f, Vector((.22 + .022 * sh(1, 15), -2.86 + .06 * t + .015 * sh(2, 13), .40 + .024 * sh(3, 17))), Vector((.06 + .06 * sh(4, 12), 3.0, .70 + .07 * sh(5, 14))), .022 * sh(6, 11))
        S.view_settings.exposure = opt('--ev', 1.3)
    elif shot == 'c':
        cam.lens = 28; cam.dof.focus_distance = 3.0
        for f in range(0, 112, 2):
            t = f / 60; at(f, Vector((.36 + .03 * t, -2.36 + .20 * t, .42 + .008 * math.sin(t))), Vector((.10 + .05 * t, 3.0, 1.04)))
        S.view_settings.exposure = opt('--ev', -1.25); litter(330); motes()
        for o in S.objects:          # nothing falls any more: the room as it came to rest
            if o.animation_data and o.animation_data.action and not o.name.startswith(('cam', 'search', 'motes')): mw = o.matrix_world.copy(); o.animation_data_clear(); o.matrix_world = mw
    else:
        cam.lens = 26; cam.dof.focus_distance = 3.0
        for f in range(250, 424, 2):
            t = (f - 258) / 60; at(f, Vector((.22 + .05 * t, -2.86 + .17 * t, .40 + .012 * math.sin(t * .9))), Vector((.02 + .05 * t, 3.0, 1.02 + .01 * math.sin(t * .7))))
        S.view_settings.exposure = opt('--ev', .15); motes(); litter(330)
    volume(shot); exec(open(D + 'guides.py').read(), globals())
    if '--raw' not in A: guides(S, spp, opt('--gspp', 8))
    return S
shot = opt('--shot', 'a'); S = look(shot, opt('--pct', 25 if A[0] == 'still' else 100), opt('--spp', 32 if A[0] == 'still' else 96)); import time
fs = [int(x) for x in A[1].split(',')] if A[0] == 'still' else range(opt('--from', 18), opt('--to', 108)); od = D + 'out/' if A[0] == 'still' else A[1] + '/'; os.makedirs(od, exist_ok=True)
for f in (reversed(fs) if '--rev' in A else fs):
    if A[0] == 'render':
        if os.path.exists(od + f'{f:04d}.png'): continue
        try: os.close(os.open(od + f'{f:04d}.claim', os.O_CREAT | os.O_EXCL | os.O_WRONLY))          # several workers can share one shot
        except FileExistsError: continue
    t0 = time.time(); S.frame_set(f); S.render.filepath = od + (f'{shot}_{f:04d}.png' if A[0] == 'still' else f'{f:04d}.png'); bpy.ops.render.render(write_still=True); print('FRAME', f, round(time.time() - t0, 1), 's', flush=True)
if '--post' in A: exec(open(opt('--post', '')).read())
