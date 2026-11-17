"""The phone copy of an app ghost (2026-11-17): Expo Go and the store apps have no
WebAssembly, so they cannot decode Draco, and Tripo's full mesh unpacked is up to
24 MB. This cuts the body evenly to BODY triangles (props to PROP; the printed
words are left alone) and exports plain glTF, about 2-3 MB a ghost. Álvaro
compared them with full detail and could not tell them apart at phone size.

  blender -b -P design/blender/phone.py -- <full.glb> <out.glb>
"""
import bpy, sys, os
src, out = sys.argv[sys.argv.index('--') + 1:]
BODY, PROP = int(os.environ.get('BODY', 60000)), int(os.environ.get('PROP', 8000))
bpy.ops.wm.read_factory_settings(use_empty=True)
# Merged vertices, or the cut tears the mesh along Tripo's split edges.
bpy.ops.import_scene.gltf(filepath=src, merge_vertices=True)
for o in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
    if o.name.startswith('text-'):
        continue
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    target = BODY if o.name.startswith('tripo_node') else PROP
    if tris <= target:
        continue
    m = o.modifiers.new('cut', 'DECIMATE')
    m.ratio = target / tris
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier='cut')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_image_format='AUTO',
                          export_apply=True, export_draco_mesh_compression_enable=False)
print('wrote', out, os.path.getsize(out) // 1024, 'KB')
