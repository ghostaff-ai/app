"""Put each agent together from Tripo's parts.

    blender -b -P design/blender/assemble.py -- <folder with Tripo's originals> [agent,...]

The originals are in the Ghostaff Drive, ghosts/tripo/ (rclone copy
drive-ghostaff:ghosts/tripo <folder>). Every agent is the same base ghost
(base-parts.glb: Tripo's Segment tool cut it into body and two arms, Fill Parts
closed the cuts) plus its objects, each made alone by Tripo. An object held in a
hand hangs from that arm, so it moves with it; a worn one sits on the body.

Writes design/tripo/agents/<agent>.glb, with nodes `body`, `arm_L` (the ghost's
left, +x) and `arm_R`, each arm's origin at its shoulder and its pose in the
node's rotation, so the app can swing it from there. Plus a render per agent in
design/tripo/agents/renders/.
"""
import bpy, bmesh, sys, os, math
import numpy as np
from mathutils import Vector, Matrix, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get('ASSEMBLE_OUT', os.path.join(HERE, '..', 'tripo', 'agents'))
TEX = 2048

# Tripo's single-object exports look along +X; the segmented base looks along -Y.
TURN = Matrix.Rotation(-math.pi / 2, 4, 'Z')

# How each object sits once squared up (see `square`): extra turn in degrees,
# found by looking at design/tripo/agents/renders/props.png.
FIX = {
    'badge': (0, 180, 0),
    'beret': (90, 0, 0),
    'bun': (90, 0, 0),
    'calculator': (180, 0, 0),
    'clipboard': (180, 0, 0),
}

# Each agent: arm poses (raise, forward) in degrees for arm_L, arm_R, and its
# objects: (name, on, size, where, turn). `on` is 'body', 'arm_L' or 'arm_R';
# size is the object's longest side; where is its centre, in the ghost's frame
# (1 tall, standing on z=0, looking along -y) for 'body', or relative to the
# hand for an arm, with the arm already posed; turn is XYZ degrees after FIX.
INK = (0.06, 0.07, 0.16, 1)
INK_WHITE = (0.95, 0.96, 1, 1)
INK_GOLD = (0.35, 0.18, 0.12, 1)

AGENTS = {
    'base': {'arms': [(0, 0), (0, 0)], 'props': []},
    'secretaria': {
        'arms': [(20, 60), (105, 25)],
        'props': [
            ('put', 'bun', {'size': 0.24, 'at': (0.0, 0.04, 1.0), 'turn': (0, 0, 0)}),
            ('wear', 'scarf', {'top': 0.62, 'fit': 1.0, 'sz': 0.8, 'ring': 0.4}),
            ('hold', 'phone', {'arm': 'arm_R', 'size': 0.34, 'at': (0.05, 0.0, 0.02), 'turn': (0, 0, -15)}),
            ('hold', 'notepad', {'arm': 'arm_L', 'size': 0.26, 'at': (-0.04, 0.03, 0.12), 'turn': (0, 0, 8)}),
        ],
    },
    'redes': {
        'arms': [(80, 15), (110, 35)],
        'props': [
            ('put', 'beret', {'size': 0.44, 'at': (0.03, 0.02, 0.95), 'turn': (0, -12, 0)}),
            ('hold', 'selfie-phone', {'arm': 'arm_R', 'size': 0.26, 'at': (0.02, -0.01, 0.1), 'turn': (0, 0, 10)}),
        ],
    },
    'incorporacion': {
        'arms': [(10, 25), (125, 10)],
        'props': [
            ('wear', 'collar-tie', {'top': 0.63, 'fit': 1.0, 'sz': 0.6}),
            ('put', 'badge', {'size': 0.2, 'at': (0.1, None, 0.38), 'turn': (0, 0, 4), 'keep_below': 0.34,
                              'labels': [('HOLA', 0.5, 0.6, 0.032, INK_WHITE), ('Soy Gus', 0.5, 0.33, 0.036, INK)]}),
        ],
    },
    'productor': {
        'arms': [(25, 55), (30, 55)],
        'props': [
            ('wear', 'jacket', {'top': 0.6, 'fit': 1.08, 'sz': 1.0, 'ring': 0.3, 'sleeveless': 0.3}),
            ('wear', 'headphones', {'top': 0.6, 'fit': 0.98, 'sz': 0.7, 'ring': 1.0, 'turn': (-90, 0, 0)}),
            ('hold', 'walkie', {'arm': 'arm_R', 'size': 0.24, 'at': (0.02, 0.03, 0.1), 'turn': (0, 0, -10)}),
            ('hold', 'clapperboard', {'arm': 'arm_L', 'size': 0.32, 'at': (-0.05, 0.03, 0.13), 'turn': (0, 0, 8)}),
        ],
    },
    'finanzas': {
        'arms': [(25, 55), (25, 55)],
        'props': [
            ('wear', 'collar-tie', {'top': 0.63, 'fit': 1.0, 'sz': 0.6}),
            ('hold', 'calculator', {'arm': 'arm_R', 'size': 0.28, 'at': (0.04, 0.03, 0.12), 'turn': (0, 0, -12), 'labels': [('1.250,00', 0.5, 0.83, 0.09, INK)]}),
            ('hold', 'clipboard', {'arm': 'arm_L', 'size': 0.34, 'at': (-0.05, 0.03, 0.15), 'turn': (0, 0, 10)}),
            ('put', 'pocket', {'size': 0.17, 'at': (0.13, None, 0.4), 'turn': (0, 0, 0), 'labels': [('FINANZAS', 0.47, 0.46, 0.028, INK_GOLD)]}),
        ],
    },
}


def sm(a, b, x):
    t = min(1, max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_meshes(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    for o in new:
        if o.type != 'MESH':
            bpy.data.objects.remove(o)
    for o in meshes:
        o.data.transform(o.matrix_world)
        o.matrix_world = Matrix()
    return meshes


def weld(o):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bm.to_mesh(o.data)
    bm.free()


def cut(o, tris):
    n = sum(len(p.vertices) - 2 for p in o.data.polygons)
    if n > tris:
        weld(o)
        bpy.context.view_layer.objects.active = o
        m = o.modifiers.new('cut', 'DECIMATE')
        m.ratio = tris / n
        with bpy.context.temp_override(object=o):
            bpy.ops.object.modifier_apply(modifier='cut')


def bounds(objs):
    pts = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
    a = np.array([p[:] for p in pts])
    return Vector(a.min(0)), Vector(a.max(0))


def square(o):
    """Turn an object so its thinnest side faces the front (-y) and its longest
    stands up (z), from the spread of its points."""
    a = np.array([v.co[:] for v in o.data.vertices])
    c = a.mean(0)
    w, v = np.linalg.eigh(np.cov((a - c).T))  # ascending spread
    thin, mid, long = v[:, 0], v[:, 1], v[:, 2]
    # rows: where each of the object's axes goes: long -> z, thin -> y, mid -> x
    R = np.array([mid, thin, long])
    if np.linalg.det(R) < 0:
        R[0] = -R[0]
    M = Matrix([list(R[0]) + [0], list(R[1]) + [0], list(R[2]) + [0], [0, 0, 0, 1]])
    o.data.transform(M @ Matrix.Translation(-Vector(c)))


def load_prop(src, name, tris=30000):
    ms = import_meshes(os.path.join(src, name + '.glb'))
    for o in ms:
        o.data.transform(TURN)
    if len(ms) > 1:
        with bpy.context.temp_override(active_object=ms[0], selected_editable_objects=ms):
            bpy.ops.object.join()
    o = ms[0]
    o.name = name
    cut(o, tris)
    if name in SQUARE:
        square(o)
    lo, hi = bounds([o])
    o.data.transform(Matrix.Scale(1 / max(hi - lo), 4) @ Matrix.Translation(-(lo + hi) / 2))
    e = FIX.get(name)
    if e:
        o.data.transform(Euler([math.radians(x) for x in e]).to_matrix().to_4x4())
    return o


# Flat or long things squared up from their own shape; round or worn ones
# (bun, beret, scarf, collar, jacket, headphones) keep Tripo's turn.
SQUARE = {'calculator', 'clipboard', 'phone', 'selfie-phone', 'walkie', 'notepad', 'badge'}


def load_ghost(src):
    """The base ghost as body, arm_L and arm_R: 1 tall, standing on z=0, centred,
    looking along -y, each arm's origin at its shoulder."""
    ms = import_meshes(os.path.join(src, 'base-parts.glb'))
    lo, hi = bounds(ms)
    k = 1 / (hi.z - lo.z)
    T = Matrix.Scale(k, 4) @ Matrix.Translation(-Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z)))
    for o in ms:
        o.data.transform(T)
    ms.sort(key=lambda o: len(o.data.vertices), reverse=True)
    body, arms = ms[0], ms[1:]
    body.name = 'body'
    cut(body, 120000)
    out = {'body': body}
    for o in arms:
        a, b = bounds([o])
        side = 1 if (a.x + b.x) > 0 else -1
        o.name = 'arm_L' if side > 0 else 'arm_R'
        cut(o, 15000)
        # Shoulder: the arm's inner end, at the height of its top, a little inside.
        pts = np.array([v.co[:] for v in o.data.vertices])
        inner = pts[np.argsort(side * pts[:, 0])[:200]].mean(0)
        pivot = Vector(inner) + Vector((-side * 0.02, 0, 0.0))
        o.data.transform(Matrix.Translation(-pivot))
        o.location = pivot
        far = pts[np.argmax(((pts - np.array(pivot[:])) ** 2).sum(1))]
        o['hand'] = list(Vector(far) - pivot)  # hand tip, in the arm's rest frame
        out[o.name] = o
    return out


def section(body, z, dz=0.012):
    """The body's extent at height z: (xmin, xmax, ymin, ymax)."""
    a = np.array([v.co[:] for v in body.data.vertices])
    a = a[np.abs(a[:, 2] - z) < dz]
    return a[:, 0].min(), a[:, 0].max(), a[:, 1].min(), a[:, 1].max()


def push_out(o, body, gap=0.006):
    """Move every point of `o` that is inside the body out to just above its
    surface: worn things lie on the ghost instead of passing through it."""
    from mathutils.bvhtree import BVHTree
    tree = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
    M = o.matrix_world
    Mi = M.inverted()
    moved = 0
    for v in o.data.vertices:
        p = M @ v.co
        hit, n, _, d = tree.find_nearest(p)
        if hit is None:
            continue
        if (p - hit).dot(n) < gap:
            v.co = Mi @ (hit + n * gap)
            moved += 1
    return moved


def wear(o, body, top, fit, sz=1.0, ringfrac=0.18, height=None):
    """Fit a ring-shaped thing (collar, scarf, lanyard, jacket) round the body:
    its top at height `top`, its ring a little wider than the body there."""
    a = np.array([v.co[:] for v in o.data.vertices])
    h = a[:, 2].max() - a[:, 2].min()
    ring = a[a[:, 2] > a[:, 2].max() - ringfrac * h]
    x0, x1, y0, y1 = section(body, top - 0.05)
    sx = fit * (x1 - x0) / (ring[:, 0].max() - ring[:, 0].min())
    sy = fit * (y1 - y0) / (ring[:, 1].max() - ring[:, 1].min())
    s = (sx + sy) / 2
    if height:  # a set overall height (a lanyard's card hangs at a set depth)
        sz = height / (h * s)
    cx = (ring[:, 0].max() + ring[:, 0].min()) / 2
    cy = (ring[:, 1].max() + ring[:, 1].min()) / 2
    o.data.transform(Matrix.Translation(Vector(((x0 + x1) / 2, (y0 + y1) / 2, top))) @
                     Matrix.Diagonal(Vector((sx, sy, s * sz, 1))) @
                     Matrix.Translation(Vector((-cx, -cy, -a[:, 2].max()))))


def surface_y(body, x, z):
    """The front of the body at (x, z): the smallest y there."""
    a = np.array([v.co[:] for v in body.data.vertices])
    m = (np.abs(a[:, 0] - x) < 0.02) & (np.abs(a[:, 2] - z) < 0.02)
    return a[m, 1].min()


def label(p, text, u, v, height, color, weight=1.0):
    """Straight text on the front of object `p`: u, v place its centre across the
    front (0..1, left to right and bottom to top), `height` is the letters' size
    in the object's own units. Tripo paints letters crooked; these are real."""
    lo, hi = bounds([p]) if p.parent is None and p.matrix_world == Matrix() else local_bounds(p)
    x = lo.x + u * (hi.x - lo.x)
    z = lo.z + v * (hi.z - lo.z)
    ok, loc, n, _ = p.ray_cast(Vector((x, lo.y - 1, z)), Vector((0, 1, 0)))
    y = (loc.y if ok else lo.y) - 0.004
    cu = bpy.data.curves.new('label', 'FONT')
    cu.body = text
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.size = height
    cu.extrude = 0.002
    t = bpy.data.objects.new('label-' + text, cu)
    bpy.context.scene.collection.objects.link(t)
    t.rotation_euler = (math.pi / 2, 0, 0)
    t.location = (x, y, z)
    m = bpy.data.materials.new('ink')
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = 0.6
    cu.materials.append(m)
    bpy.context.view_layer.update()
    with bpy.context.temp_override(active_object=t, selected_editable_objects=[t], object=t):
        bpy.ops.object.convert(target='MESH')
    t = bpy.context.scene.objects[t.name]
    t.parent = p
    t.matrix_parent_inverse = Matrix()
    return t


def local_bounds(o):
    a = np.array([v.co[:] for v in o.data.vertices])
    return Vector(a.min(0)), Vector(a.max(0))


def build(src, name):
    spec = AGENTS[name]
    reset()
    g = load_ghost(src)
    body = g['body']
    poses = {}
    for (n, side), (r, f) in zip((('arm_L', 1), ('arm_R', -1)), spec['arms']):
        R = arm_rotation(side, r, f)
        g[n].rotation_mode = 'QUATERNION'
        g[n].rotation_quaternion = R.to_quaternion()
        poses[n] = R
    bpy.context.view_layer.update()
    for kind, pname, o in spec['props']:
        p = load_prop(src, pname)
        labels = o.get('labels', [])
        if kind == 'wear':
            if 'sleeveless' in o:
                # Sleeves would hang where the arms are not: cut them off, the
                # arms come out of the armholes.
                lim = o['sleeveless']
                b = bmesh.new()
                b.from_mesh(p.data)
                bmesh.ops.delete(b, geom=[f for f in b.faces if abs(f.calc_center_median().x) > lim], context='FACES')
                b.to_mesh(p.data)
                b.free()
            if 'turn' in o:
                p.data.transform(Euler([math.radians(x) for x in o['turn']]).to_matrix().to_4x4())
            wear(p, body, o['top'], o['fit'], o.get('sz', 1.0), o.get('ring', 0.18), o.get('height'))
            bpy.context.view_layer.update()
            print('pushed', pname, push_out(p, body))
        elif kind == 'put':
            if 'keep_below' in o:
                # Only the lower part (a badge's card, without its strap).
                b = bmesh.new()
                b.from_mesh(p.data)
                zs = [v.co.z for v in b.verts]
                cut_z = min(zs) + o['keep_below'] * (max(zs) - min(zs))
                bmesh.ops.delete(b, geom=[f for f in b.faces if f.calc_center_median().z > cut_z], context='FACES')
                b.to_mesh(p.data)
                b.free()
                lo, hi = bounds([p])
                p.data.transform(Matrix.Scale(1 / max(hi - lo), 4) @ Matrix.Translation(-(lo + hi) / 2))
            p.data.transform(Euler([math.radians(x) for x in o['turn']]).to_matrix().to_4x4() @ Matrix.Scale(o['size'], 4))
            x, y, z = o['at']
            if y is None:
                lo, hi = bounds([p])
                y = surface_y(body, x, z) - (hi.y - lo.y) / 2 + 0.01
            p.location = (x, y, z)
            bpy.context.view_layer.update()
            print('pushed', pname, push_out(p, body))
            for lb in labels:
                label(p, *lb)
        else:  # hold: centre at the posed hand plus `at`, then hang it from the arm
            arm = g[o['arm']]
            hand = arm.matrix_world @ Vector(arm['hand'])
            W = (Matrix.Translation(hand + Vector(o['at'])) @
                 Euler([math.radians(x) for x in o['turn']]).to_matrix().to_4x4() @
                 Matrix.Scale(o['size'], 4))
            for lb in labels:
                label(p, *lb)
            p.parent = arm
            p.matrix_world = W
    return g


def export(name):
    """design/tripo/agents/<name>.glb: body, arm_L and arm_R (each holding its
    objects), textures at most TEX px, geometry Draco-compressed."""
    for img in bpy.data.images:
        if img.size[0] > TEX:
            img.scale(TEX, TEX * img.size[1] // img.size[0])
            img.pack()
    for o in list(bpy.context.scene.objects):
        if o.type not in ('MESH',):
            bpy.data.objects.remove(o)
    path = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_image_format='JPEG',
                              export_jpeg_quality=85, export_apply=True,
                              export_draco_mesh_compression_enable=True,
                              export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=14,
                              export_draco_normal_quantization=10,
                              export_draco_texcoord_quantization=12)
    print('wrote', name, os.path.getsize(path) // 1024, 'KB')


def arm_rotation(side, raise_, forward):
    """Lift the arm out and up by `raise_` degrees, then swing it forward."""
    return (Matrix.Rotation(math.radians(-forward), 4, 'X') @
            Matrix.Rotation(math.radians(-side * raise_), 4, 'Y'))


def render(objs, path, size=1.15, centre=(0, 0, 0.5), res=600, az=20):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = sc.render.resolution_y = res
    if not sc.world:
        sc.world = bpy.data.worlds.new('w')
        sc.world.use_nodes = True
        sc.world.node_tree.nodes['Background'].inputs[0].default_value = (1, 1, 1, 1)
    cam = bpy.data.objects.get('cam') or bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    if cam.name not in sc.collection.objects:
        sc.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = size
    t = Vector(centre)
    d = Vector((math.sin(math.radians(az)), -math.cos(math.radians(az)), 0.12))
    cam.location = t + d * 4
    cam.rotation_euler = (t - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.clip_end = 20
    sc.camera = cam
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def props_sheet(src, args):
    """Every object squared up, from the front, to set FIX."""
    os.makedirs(os.path.join(OUT, 'renders'), exist_ok=True)
    names = args[2].split(',') if len(args) > 2 else sorted(SQUARE | {'bun', 'beret', 'scarf', 'collar-tie', 'jacket', 'headphones', 'clapperboard', 'pocket'})
    for n in names:
        reset()
        o = load_prop(src, n, 20000)
        render([o], os.path.join(OUT, 'renders', 'prop-' + n + '.png'), size=1.2, centre=(0, 0, 0), res=300, az=0)


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:]
    src = args[0]
    if len(args) > 1 and args[1] == 'props':
        props_sheet(src, args)
    elif len(args) == 1 or args[1] not in ('try', 'arms'):
        os.makedirs(os.path.join(OUT, 'renders'), exist_ok=True)
        names = args[1].split(',') if len(args) > 1 else list(AGENTS)
        for name in names:
            build(src, name)
            objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
            render(objs, os.path.join(OUT, 'renders', f'{name}.png'), res=600, az=20)
            export(name)
    elif len(args) > 1 and args[1] == 'try':
        os.makedirs(os.path.join(OUT, 'renders'), exist_ok=True)
        for name in args[2].split(','):
            g = build(src, name)
            objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
            for az in (0, 35):
                render(objs, os.path.join(OUT, 'renders', f'{name}-{az}.png'), res=500, az=az)
    elif len(args) > 1 and args[1] == 'arms':
        # The arms at a few poses, to check the shoulders.
        os.makedirs(os.path.join(OUT, 'renders'), exist_ok=True)
        for i, (r, f) in enumerate([(0, 0), (60, 0), (100, 30), (30, 60)]):
            reset()
            g = load_ghost(src)
            for n, side in (('arm_L', 1), ('arm_R', -1)):
                g[n].matrix_world = Matrix.Translation(g[n].location) @ arm_rotation(side, r, f)
            render(list(g.values()), os.path.join(OUT, 'renders', f'arms-{i}.png'), res=400)
