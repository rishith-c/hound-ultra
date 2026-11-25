# The denoiser needs to know what each surface looks like. Seen through dust that guide is noise, and the noise ends up in the picture as speckle. So: a second layer without the dust gives clean guides.
def guides(S, spp, gspp=16):
    C = S.cycles; C.use_denoising = False; C.use_adaptive_sampling = False; C.samples = spp
    main = S.view_layers[0]; main.name = 'main'; g = S.view_layers.new('guide'); dust = S.objects['dust']; col = bpy.data.collections.new('dustcol'); S.collection.children.link(col)
    for c in list(dust.users_collection): c.objects.unlink(dust)
    col.objects.link(dust); g.layer_collection.children['dustcol'].exclude = True; g.samples = gspp; g.cycles.denoising_store_passes = True
    for f in ('use_pass_combined',): setattr(g, f, True)
    ng = bpy.data.node_groups.new('comp', 'CompositorNodeTree'); S.compositing_node_group = ng; ng.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    a = ng.nodes.new('CompositorNodeRLayers'); a.scene = S; a.layer = 'main'; b = ng.nodes.new('CompositorNodeRLayers'); b.scene = S; b.layer = 'guide'; d = ng.nodes.new('CompositorNodeDenoise'); o = ng.nodes.new('NodeGroupOutput')
    print('DENOISE', [(i.name, getattr(i, 'default_value', None)) for i in d.inputs], [x.name for x in b.outputs if x.enabled])
    ng.links.new(a.outputs['Image'], d.inputs['Image']); ng.links.new(b.outputs['Denoising Normal'], d.inputs['Normal']); ng.links.new(b.outputs['Denoising Albedo'], d.inputs['Albedo']); ng.links.new(d.outputs[0], o.inputs[0])
    S.render.compositor_device = 'GPU'
