"""Turn Tripo's exports into models the app can load.

Tripo (studio.tripo3d.ai, Pro plan, so the models are ours to use) makes each
ghost and each prop from one picture, at about 1.2 million vertices with 4K-ish
textures, 50-70 MB a file. The originals stay in the Ghostaff Drive
(ghosts/tripo/); this script makes the light copies kept in the repo:

  blender -b -P design/blender/tripo.py -- <folder with the originals>

For each <name>.glb in that folder it writes design/tripo/<name>.glb: turned to
face the front (Tripo's face +X), standing on the ground, 1 unit tall, centred,
cut to about TARGET triangles, textures shrunk to TEX px. And a front render in
design/tripo/renders/.
"""
import bpy, bmesh, sys, os, glob, math
from mathutils import Vector, Matrix

TARGET = 60000   # triangles
TEX = 1024
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'tripo')

def bounds(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    return lo, hi

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

def run(src):
    os.makedirs(os.path.join(OUT, 'renders'), exist_ok=True)
    for f in sorted(glob.glob(os.path.join(src, '*.glb'))):
        name = os.path.splitext(os.path.basename(f))[0]
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
            m.ratio = TARGET / tris
            bpy.ops.object.modifier_apply(modifier='cut')
        for img in bpy.data.images:
            if img.size[0] > TEX:
                img.scale(TEX, TEX)
                img.pack()
        out = os.path.join(OUT, name + '.glb')
        bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=False,
                                  export_image_format='JPEG', export_jpeg_quality=85,
                                  export_apply=True)
        print('wrote', name, tris, '->', sum(len(p.vertices) - 2 for p in obj.data.polygons),
              'tris,', os.path.getsize(out) // 1024, 'KB')
        render(obj, os.path.join(OUT, 'renders', name + '.png'))

run(sys.argv[sys.argv.index('--') + 1])
