"""Turn Tripo's exports into models the app can load.

Tripo (studio.tripo3d.ai, Pro plan, so the models are ours to use) makes each
ghost and each prop from one picture, at about 1.2 million vertices with 4K-ish
textures, 50-70 MB a file. The originals stay in the Ghostaff Drive
(ghosts/tripo/); this script makes the light copies kept in the repo:

  blender -b -P design/blender/tripo.py -- <folder with the originals>

For each <name>.glb in that folder it writes design/tripo/<name>.glb: turned to
face the front (Tripo's face +X), standing on the ground, 1 unit tall, centred,
cut to about TARGET triangles (60,000 left the collar edges ragged), textures shrunk to TEX px,
with the fine places left whole (KEEP), the line on its head softened
(touchup.py) and its objects replaced by Tripo's own models of them, found in
the same folder (swap.py). And a front render in design/tripo/renders/.
"""
import bpy, bmesh, sys, os, glob, math
import json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import touchup
import swap
from mathutils import Vector, Matrix

TARGET = int(os.environ.get('TRIPO_TRIS', 150000))   # triangles
TEX = int(os.environ.get('TRIPO_TEX', 2048))
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get('TRIPO_OUT', os.path.join(HERE, '..', 'tripo'))

def bounds(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    return lo, hi

# Places to leave at full detail, per model: boxes (x0, x1, z0, z1) on the front,
# in the model's units (1 tall, x across, z up), plus every eye in eyes.json.
KEEP = {
    'incorporacion': [(-0.32, 0.32, 0.46, 0.7)],
    'finanzas': [(-0.32, 0.32, 0.46, 0.7)],
}

# The whole ghosts in the folder; anything else there is a lone object.
GHOSTS = {'base', 'secretaria', 'redes', 'incorporacion', 'finanzas', 'productor'}

def keep_group(obj, name):
    """A vertex group of the points the cut must leave alone."""
    co = np.zeros(len(obj.data.vertices) * 3); obj.data.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    boxes = list(KEEP.get(name, []))
    path = os.path.join(OUT, 'eyes.json')
    if os.path.exists(path):
        for e in json.load(open(path)).get(name, []):
            (cx, cz, _), (rx, rz) = e['center'], e['radius']
            boxes.append((cx - rx * 1.6, cx + rx * 1.6, cz - rz * 1.6, cz + rz * 1.6))
    keep = np.zeros(len(co), bool)
    for x0, x1, z0, z1 in boxes:
        keep |= (co[:, 0] > x0) & (co[:, 0] < x1) & (co[:, 2] > z0) & (co[:, 2] < z1) & (co[:, 1] < 0)
    g = obj.vertex_groups.new(name='keep')
    g.add(np.nonzero(keep)[0].tolist(), 1.0, 'REPLACE')
    print('kept whole', int(keep.sum()), 'of', len(co), 'points')
    return g, int(keep.sum())

def render(obj, path):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = sc.render.resolution_y = 512
    sc.render.film_transparent = False
    sc.world = bpy.data.worlds.new('w')
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (1, 1, 1, 1)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    lo, hi = bounds([obj])
    c, size = (lo + hi) / 2, max(hi - lo)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = size * 1.15
    cam.location = c + Vector((size * 0.9, -size * 2.6, size * 0.3))
    cam.rotation_euler = (Vector((0, 0, 0)) + (c - cam.location)).to_track_quat('-Z', 'Y').to_euler()
    cam.data.clip_end = size * 20
    sc.camera = cam
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)   # or the next export carries it

def run(src):
    os.makedirs(os.path.join(OUT, 'renders'), exist_ok=True)
    for f in sorted(glob.glob(os.path.join(src, '*.glb'))):
        name = os.path.splitext(os.path.basename(f))[0]
        if name not in GHOSTS:   # the lone objects in the same folder are for swap.py
            continue
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=f, merge_vertices=True)
        meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
        bpy.ops.object.select_all(action='DESELECT')
        for o in meshes:
            o.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        if len(meshes) > 1:
            bpy.ops.object.join()
        obj = bpy.context.view_layer.objects.active
        bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
        for o in list(bpy.context.scene.objects):
            if o is not obj:
                bpy.data.objects.remove(o)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        # Face the front: Tripo's ghosts look along +X, Blender's front is -Y.
        # (Rotate the mesh itself: the importer leaves objects in quaternion mode.)
        obj.data.transform(Matrix.Rotation(-math.pi / 2, 4, 'Z'))
        lo, hi = bounds([obj])
        s = 1.0 / (hi.z - lo.z)
        obj.data.transform(Matrix.Scale(s, 4) @ Matrix.Translation(-Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))))
        # Tripo splits every vertex on a texture seam; weld them back (the
        # texture coordinates live on the corners, so they survive) or the
        # cut cannot collapse anything near a seam.
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
        bm.to_mesh(obj.data)
        bm.free()
        tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        if tris > TARGET:
            m = obj.modifiers.new('cut', 'DECIMATE')
            # But leave the fine places whole: cut, a collar's thin top edge became a
            # fringe of spikes and the eyes' rims went ragged (KEEP, below). The
            # rest is cut as much as before, so the total grows by what is kept.
            g, kept = keep_group(obj, name)
            f = kept / len(obj.data.vertices)
            m.ratio = TARGET / tris * (1 - f) + f
            m.vertex_group = g.name
            m.invert_vertex_group = True
            bpy.ops.object.modifier_apply(modifier='cut')
        for img in bpy.data.images:
            if img.size[0] > TEX:
                img.scale(TEX, TEX)
                img.pack()
        # the hard line where Tripo's views meet on the head, softened
        if name in touchup.SEAMS:
            eyes = [(e['center'], e['radius']) for e in json.load(open(os.path.join(OUT, 'eyes.json'))).get(name, [])]
            touchup.soften_seams(obj, eyes, **touchup.SEAMS[name])
        # Two of each ghost with objects: as Tripo made them (<name>.glb), and
        # with Tripo's lone models of them in their place (<name>-swap.glb, swap.py)
        export(obj, name, tris)
        if name in swap.SWAPS:
            swap.swap(obj, name, src)
            export(obj, name + '-swap', tris)

def export(obj, name, tris):
    out = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=False,
                              export_image_format='JPEG', export_jpeg_quality=85,
                              export_apply=True,
                              # Draco shrinks the geometry about five times; the app
                              # decodes it with three.js's decoder (apps/mobile/public/draco/).
                              export_draco_mesh_compression_enable=True,
                              export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=14,
                              export_draco_normal_quantization=10,
                              export_draco_texcoord_quantization=12)
    print('wrote', name, tris, '->', sum(len(p.vertices) - 2 for p in obj.data.polygons),
          'tris,', os.path.getsize(out) // 1024, 'KB')
    render(obj, os.path.join(OUT, 'renders', name + '.png'))

run(sys.argv[sys.argv.index('--') + 1])
