"""The files for the placing page: each ghost with objects, as Tripo made it,
with the lone objects where swap.py puts them now, to move by hand; and the
ghosts without, alone, to mark their flaws on.

Out, per ghost, in the folder given: <name>.glb, the ghost (node "ghost") and
each new object as its own node, named after it, whose mesh is a 1 x 1 x 1 box
round it, so the node's scale is its size (width, depth, height). The page
saves each node's place; place.json (read by swap.py) is made from that.

    blender -b -P design/blender/placing.py -- ~/Downloads/tripo/originals <out dir>
"""
import bpy, sys, os
import numpy as np
from mathutils import Matrix, Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import swap

HERE = os.path.dirname(os.path.abspath(__file__))
src, out = sys.argv[sys.argv.index('--') + 1:][:2]
os.makedirs(out, exist_ok=True)


def export(name):
    for o in list(bpy.context.scene.objects):
        if o.type != 'MESH':
            bpy.data.objects.remove(o)
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, name + '.glb'), export_format='GLB',
                              export_image_format='JPEG', export_jpeg_quality=85,
                              export_draco_mesh_compression_enable=True,
                              export_draco_mesh_compression_level=7)
    print('placing:', name, os.path.getsize(os.path.join(out, name + '.glb')) // 1024, 'KB')


def ghost(name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(HERE, '..', 'tripo', name + '.glb'))
    o = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
    o.name = 'ghost'
    return o


# tripo.py's whole ghosts (importing it would run it)
for name in ('base', 'secretaria', 'redes', 'incorporacion', 'finanzas', 'productor'):
    specs = swap.SWAPS.get(name, [])
    if not specs:
        ghost(name)
        export(name)
        continue
    # where swap.py puts them now (it also changes the ghost, so start again after)
    swap.swap(ghost(name), name, src)
    placed = swap.PLACED[name]
    ghost(name)
    for spec in specs:
        p = swap.load(src, spec)
        a = np.array([v.co[:] for v in p.data.vertices])
        p.data.transform(Matrix.Diagonal(Vector([*(1 / (a.max(0) - a.min(0))), 1])))
        at, R, size = placed[spec['prop']]
        p.matrix_world = Matrix.Translation(at) @ R @ Matrix.Diagonal(Vector([*size, 1]))
    export(name)
