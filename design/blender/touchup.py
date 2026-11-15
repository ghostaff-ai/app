"""Hand fixes to single Tripo models, applied by tripo.py before it exports one.

Tripo paints letters crooked (and raises them off the surface). Each fix here
works on the light model (welded, cut down, 1 unit tall, facing -Y, Blender's z
up) and its texture, and is listed in FIXES under the model's name. (The spikes
along a collar and the ragged eye rims came from the cut, not from Tripo: tripo.py
leaves those places whole, KEEP.)
"""
import numpy as np


def mesh_arrays(obj):
    me = obj.data
    n = len(me.vertices)
    co = np.zeros(n * 3); me.vertices.foreach_get('co', co)
    e = np.zeros(len(me.edges) * 2, dtype=np.int64); me.edges.foreach_get('vertices', e)
    return co.reshape(-1, 3), e.reshape(-1, 2)


def texture(obj):
    for node in obj.data.materials[0].node_tree.nodes:
        if node.type == 'TEX_IMAGE' and node.image:
            img = node.image
            w, h = img.size
            return img, np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)


def save_texture(img, px):
    img.pixels.foreach_set(px.ravel())
    img.update()
    img.pack()


def texel_mask(obj, shape, keep, any_corner=False):
    """The texels covered by the triangles whose three corners pass keep(xyz)."""
    me = obj.data
    h, w = shape
    co, _ = mesh_arrays(obj)
    uv = np.zeros(len(me.loops) * 2); me.uv_layers.active.data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
    mask = np.zeros((h, w), bool)
    ok = keep(co)
    for poly in me.polygons:
        vs = list(poly.vertices)
        if not (any if any_corner else all)(ok[v] for v in vs):
            continue
        ls = list(poly.loop_indices)
        for k in range(1, len(ls) - 1):
            t = uv[[ls[0], ls[k], ls[k + 1]]] * [w, h]
            lo = np.floor(t.min(0)).astype(int) - 1; hi = np.ceil(t.max(0)).astype(int) + 1
            lo = np.clip(lo, 0, [w - 1, h - 1]); hi = np.clip(hi, 0, [w - 1, h - 1])
            xs, ys = np.meshgrid(np.arange(lo[0], hi[0] + 1) + 0.5, np.arange(lo[1], hi[1] + 1) + 0.5)
            a, b, c = t
            d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(d) < 1e-12:
                continue
            l1 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
            l2 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
            inside = (l1 >= -0.05) & (l2 >= -0.05) & (1 - l1 - l2 >= -0.05)
            mask[ys[inside].astype(int), xs[inside].astype(int)] = True
    return mask


def plane(co, m):
    """The plane y = a*x + b*z + c best fitting the points m, refitted twice on
    the points nearest it, so raised letters don't tilt it."""
    for _ in range(3):
        A = np.c_[co[m, 0], co[m, 2], np.ones(m.sum())]
        coef, *_ = np.linalg.lstsq(A, co[m, 1], rcond=None)
        r = np.abs(np.c_[co[:, 0], co[:, 2], np.ones(len(co))] @ coef - co[:, 1])
        m = m & (r < np.percentile(r[m], 60))
    return coef


def text(obj, words, x, z, height, colour, coef):
    """Real, straight letters lying on the plane coef at (x, z), as a mesh in the
    model's own coordinates (so the app's sway moves them with it)."""
    import bpy
    from mathutils import Matrix, Vector
    a, b, c = coef
    n = Vector((-a, 1, -b)).normalized()          # points into the model (+y)
    right = Vector((1, a, 0)).normalized()
    up = n.cross(right).normalized() * -1
    if up.z < 0:
        up = -up
    cu = bpy.data.curves.new('text', 'FONT')
    cu.body = words
    cu.align_x = cu.align_y = 'CENTER'
    cu.size = height
    cu.extrude = 0.0008
    t = bpy.data.objects.new('text-' + words, cu)
    bpy.context.scene.collection.objects.link(t)
    y = a * x + b * z + c - 0.0016
    rot = Matrix((right, up, -n)).transposed().to_4x4()
    t.matrix_world = Matrix.Translation((x, y, z)) @ rot
    mat = bpy.data.materials.new('ink-' + words)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*colour, 1)
    bsdf.inputs['Roughness'].default_value = 0.6
    cu.materials.append(mat)
    bpy.context.view_layer.update()
    with bpy.context.temp_override(active_object=t, selected_editable_objects=[t], object=t):
        bpy.ops.object.convert(target='MESH')
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return t


def incorporacion(obj):
    # The badge: Tripo's "HELLO / I'M GUSTAV" is crooked and its letters raised.
    # Flatten the card, paint the letters out, write ours ("HOLA", "Soy Gus").
    co, _ = mesh_arrays(obj)
    box = (co[:, 0] > 0.035) & (co[:, 0] < 0.195) & (co[:, 2] > 0.28) & (co[:, 2] < 0.39)
    box &= co[:, 1] < co[box, 1].min() + 0.03
    coef = plane(co, box)
    r = np.c_[co[:, 0], co[:, 2], np.ones(len(co))] @ coef - co[:, 1]
    card = box & (np.abs(r) < 0.007)
    co[card, 1] = (np.c_[co[:, 0], co[:, 2], np.ones(len(co))] @ coef)[card]
    obj.data.vertices.foreach_set('co', co.ravel())
    obj.data.update()
    print('badge: flattened', int(card.sum()), 'points')
    within = lambda x0, x1, z0, z1: card & (co[:, 0] > x0) & (co[:, 0] < x1) & (co[:, 2] > z0) & (co[:, 2] < z1)
    head = within(0.05, 0.183, 0.357, 0.381)
    name = within(0.09, 0.188, 0.288, 0.353)
    img, px = texture(obj)
    mh = texel_mask(obj, px.shape[:2], lambda c: head, any_corner=True)
    mn = texel_mask(obj, px.shape[:2], lambda c: name, any_corner=True)
    lum = px[..., :3] @ np.array([0.3, 0.59, 0.11])
    blue = np.median(px[mh & (lum < np.percentile(lum[mh], 50))][:, :3], axis=0)
    white = np.median(px[mn & (lum > np.percentile(lum[mn], 60))][:, :3], axis=0)
    px[mh, :3] = blue
    px[mn, :3] = white
    save_texture(img, px)
    text(obj, 'HOLA', 0.112, 0.368, 0.019, (0.95, 0.96, 1.0), coef)
    text(obj, 'Soy Gus', 0.139, 0.321, 0.017, (0.06, 0.07, 0.16), coef)


FIXES = {'incorporacion': incorporacion}
