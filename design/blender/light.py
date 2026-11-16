"""Make a light copy of a built ghost, the way an artist would: a simple shell
of a few tens of thousands of triangles, with the full model's detail moved into
pictures laid over it (colour, relief, shine), instead of Tripo's dense mesh.

  blender -b -P design/blender/light.py -- <built model.glb> <out.glb> <triangles>

The input is one of design/tripo/*.glb (already turned, scaled and touched up by
tripo.py and swap.py). Only the ghost's body (its biggest mesh) is rebuilt and
baked; the swapped objects are just cut to a quarter (they are light already and
have only a colour picture), and the printed words are left as they are.
Shown to Álvaro as the "Peso" switch on the Taller page (2026-11-16).
"""
import bpy, sys, os, math

TEX = int(os.environ.get('LIGHT_TEX', 2048))

args = sys.argv[sys.argv.index('--') + 1:]
src, out, target = args[0], args[1], int(args[2])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
high = max(meshes, key=lambda o: len(o.data.polygons))
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 4
sc.cycles.device = 'CPU'

def only(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o

# The swapped objects: cut to a quarter, their own pictures kept.
for o in meshes:
    if o is high or o.name.startswith('text-') or len(o.data.polygons) < 8000:
        continue
    only(o)
    m = o.modifiers.new('cut', 'DECIMATE')
    m.ratio = 0.25
    bpy.ops.object.modifier_apply(modifier='cut')

# The shell: the body cut evenly to `target` triangles, smooth, new unwrap.
only(high)
bpy.ops.object.duplicate()
low = bpy.context.view_layer.objects.active
low.name = high.name + '-light'
m = low.modifiers.new('cut', 'DECIMATE')
m.ratio = target / len(low.data.polygons)
m.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier='cut')
bpy.ops.object.shade_smooth()
for uv in list(low.data.uv_layers):
    low.data.uv_layers.remove(uv)
low.data.uv_layers.new(name='UVMap')
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004)
bpy.ops.object.mode_set(mode='OBJECT')

# The shell's material: the three baked pictures.
def image(name, size, data):
    img = bpy.data.images.new(name, size, size, alpha=False)
    if data:
        img.colorspace_settings.name = 'Non-Color'
    return img

colour = image('light-colour', TEX, False)
normal = image('light-normal', TEX, True)
shine = image('light-shine', TEX // 2, True)   # glTF's metal/rough: G rough, B metal
mat = bpy.data.materials.new('light')
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes['Principled BSDF']
tc = nt.nodes.new('ShaderNodeTexImage'); tc.image = colour
tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = normal
ts = nt.nodes.new('ShaderNodeTexImage'); ts.image = shine
nm = nt.nodes.new('ShaderNodeNormalMap')
sep = nt.nodes.new('ShaderNodeSeparateColor')
nt.links.new(tc.outputs['Color'], bsdf.inputs['Base Color'])
nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
nt.links.new(ts.outputs['Color'], sep.inputs['Color'])
nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
low.data.materials.clear()
low.data.materials.append(mat)

def bake(img, kind, **kw):
    for n in nt.nodes:
        n.select = False
    target_node = {colour: tc, normal: tn, shine: ts}[img]
    target_node.select = True
    nt.nodes.active = target_node
    bpy.ops.object.select_all(action='DESELECT')
    high.select_set(True)
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    sc.render.bake.use_selected_to_active = True
    sc.render.bake.cage_extrusion = 0.01
    sc.render.bake.max_ray_distance = 0.03
    sc.render.bake.margin = 8
    bpy.ops.object.bake(type=kind, **kw)

# The body's shine (Tripo packs rough in G, metal in B) goes through its
# emission so it bakes as it is, unlit; then the material is put back.
hm = high.data.materials[0]
hn = hm.node_tree
hb = hn.nodes['Principled BSDF']
outn = next(n for n in hn.nodes if n.type == 'OUTPUT_MATERIAL')
surface = outn.inputs['Surface'].links[0].from_socket

def source(name):
    s = hb.inputs[name]
    return s.links[0].from_node if s.links else None

colour_src = hb.inputs['Base Color'].links[0].from_socket
emit = hn.nodes.new('ShaderNodeEmission')
hn.links.new(emit.outputs['Emission'], outn.inputs['Surface'])
hn.links.new(colour_src, emit.inputs['Color'])
bake(colour, 'EMIT')
rough_src = source('Roughness')
if rough_src is not None and rough_src.type == 'SEPARATE_COLOR':
    hn.links.new(rough_src.inputs['Color'].links[0].from_socket, emit.inputs['Color'])
else:
    emit.inputs['Color'].default_value = (0, hb.inputs['Roughness'].default_value, hb.inputs['Metallic'].default_value, 1)
    for l in list(emit.inputs['Color'].links):
        hn.links.remove(l)
bake(shine, 'EMIT')
hn.links.new(surface, outn.inputs['Surface'])
bake(normal, 'NORMAL', normal_space='TANGENT')

for img in (colour, normal, shine):
    img.pack()
bpy.data.objects.remove(high)
for o in [o for o in bpy.context.scene.objects if o.type != 'MESH']:
    bpy.data.objects.remove(o)

bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=False,
                          export_image_format='JPEG', export_jpeg_quality=85,
                          export_apply=True,
                          export_draco_mesh_compression_enable=True,
                          export_draco_mesh_compression_level=7,
                          export_draco_position_quantization=14,
                          export_draco_normal_quantization=10,
                          export_draco_texcoord_quantization=12)
tris = sum(len(p.vertices) - 2 for o in bpy.context.scene.objects if o.type == 'MESH' for p in o.data.polygons)
print('light', os.path.basename(out), tris, 'tris,', os.path.getsize(out) // 1024, 'KB')
