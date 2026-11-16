"""Put Tripo's own model of an object in place of the one painted into a whole ghost.

A whole Tripo ghost carries its objects (a badge, a calculator, a pocket) made
in the same go as the body, and they come out soft and with crooked letters.
Tripo also made each object alone, from a picture of just that object
(assemble.py uses them), and those are crisper. swap() finds the flat face of
the ghost's own object, fits the lone object to the same place, size and turn,
a little larger, and writes real letters on it. The old one never shows beside
the new: a held or thin one is pushed back inside the new one; a worn one with
another outline is pressed flat into the body and painted in the body's colours.

Used by tripo.py through SWAPS, on the light model (1 tall, facing -y, z up).
Where each new object goes is measured, unless Álvaro placed it by hand on the
placing page (placing.py makes its files): then place.json says, and wins.
"""
import os, math, json
import numpy as np
import bpy
from mathutils import Matrix, Vector

import touchup

# Each model's objects: the lone object's file, the box (x0, x1, z0, z1) its old
# self sits in, seen from the front, how thick the old one is, a turn to put
# the lone one the right way up and round, and its letters (words, u, v across
# the front from its bottom left, letter height, colour, and maybe a dict:
# `tilt`, degrees turned in the face, anticlockwise; `align` 'RIGHT' to end at u).
INK = (0.06, 0.07, 0.16)
WHITE = (0.95, 0.96, 1.0)
GOLD = (0.13, 0.06, 0.035)   # the pocket's plate: dark, to read on its copper
SWAPS = {
    'incorporacion': [
        {'prop': 'badge', 'box': (0.023, 0.2, 0.265, 0.405), 'thick': 0.006, 'keep_below': 0.34,
         'turn': 180, 'flip': False,
         'labels': [('HOLA', 0.5, 0.576, 0.085, WHITE), ('Soy Gus', 0.5, 0.309, 0.13, INK)]},
    ],
    'finanzas': [
        {'prop': 'pocket', 'keep_old': True, 'box': (-0.01, 0.18, 0.24, 0.47), 'also': (0.1, 0.2, 0.24, 0.5), 'thick': 0.012, 'press': 1.15, 'grow': (1.0, 1.3), 'lift': 0.12, 'turn': 205, 'flip': False,
         'labels': [('FINANZAS', 0.505, 0.369, 0.06, GOLD, {'tilt': 5.6})]},
        {'prop': 'calculator', 'keep_old': True, 'box': (-0.48, -0.23, 0.32, 0.6), 'thick': 0.03, 'turn': 180, 'hand': (0, 0.45, 0, 0.55), 'flip': True,
         'labels': [('1.250,00', 0.845, 0.794, 0.07, INK, {'align': 'RIGHT'})]},
        {'prop': 'clipboard', 'keep_old': True, 'box': (0.165, 0.48, 0.18, 0.52), 'thick': 0.03, 'turn': 180, 'hand': (0.55, 1, 0, 0.45), 'flip': True,
         'labels': []},
    ],
}

TURN = Matrix.Rotation(-math.pi / 2, 4, 'Z')   # Tripo's lone objects look along +x
TEX = 1024

# Placed by hand (place.json, from the placing page), per ghost and object: the
# new one's middle (`at`), its axes (`right`, `back`, `up`) and size (`size`:
# width, depth, height), and boxes seen from the front (x0, x1, z0, z1) of what
# stays in front of it (`keep`: fingers) and what else goes (`also`).
PLACE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'place.json')
PLACE = json.load(open(PLACE_FILE)) if os.path.exists(PLACE_FILE) else {}

# Where swap() put each new object, per ghost: (middle, axes, size), for placing.py.
PLACED = {}


def front_plane(co, m, tries=400, tol=0.003, seed=1):
    """The flat face most of the points m lie on, facing the front: a point on
    it and its normal (pointing back, into the ghost)."""
    rng = np.random.default_rng(seed)
    p = co[m]
    best, bn, bc = -1, None, None
    for _ in range(tries):
        a, b, c = p[rng.choice(len(p), 3, replace=False)]
        n = np.cross(b - a, c - a)
        if np.linalg.norm(n) < 1e-9:
            continue
        n /= np.linalg.norm(n)
        if abs(n[1]) < 0.75:
            continue
        if n[1] < 0:
            n = -n
        k = (np.abs((p - a) @ n) < tol).sum()
        if k > best:
            best, bn, bc = k, n, a
    # refine on its points
    q = p[np.abs((p - bc) @ bn) < tol]
    c = q.mean(0)
    w, v = np.linalg.eigh(np.cov((q - c).T))
    n = v[:, 0] if v[1, 0] > 0 else -v[:, 0]
    return c, n, q


def old_object(co, spec):
    """Where the old object is: its centre on the front face, its axes (right,
    up, back) and its width and height."""
    x0, x1, z0, z1 = spec['box']
    m = (co[:, 0] > x0) & (co[:, 0] < x1) & (co[:, 2] > z0) & (co[:, 2] < z1)
    # only what is seen from the front: the frontmost point of each 4 mm cell
    idx = np.nonzero(m)[0]
    cell = np.floor(co[idx][:, [0, 2]] / 0.004).astype(np.int64)
    key = cell[:, 0] * 100000 + cell[:, 1]
    order = np.lexsort((co[idx, 1], key))
    first = np.r_[True, key[order][1:] != key[order][:-1]]
    seen = np.zeros(len(co), bool)
    seen[idx[order][first]] = True
    c, n, q = front_plane(co, seen)
    # the face itself: what is seen and lies on or near that plane (the plane's
    # strict points are only its flattest patch)
    near = seen & (np.abs((co - c) @ n) < spec.get('near', 0.012))
    q = co[near]
    c = q.mean(0)
    # its turn in the face: the one giving the smallest box round its points
    # (an object nearly as wide as tall has no clear long side to go by)
    d = q - c
    d -= np.outer(d @ n, n)
    e1 = np.cross([0, 0, 1], n)   # level, across the face
    e1 /= np.linalg.norm(e1)
    if e1[0] < 0:
        e1 = -e1
    e2 = np.cross(e1, n)          # up the face
    best = None
    for deg in np.arange(-45, 45.5, 0.5):
        r = math.radians(deg)
        right = math.cos(r) * e1 + math.sin(r) * e2
        up = np.cross(right, n)
        u, v_ = d @ right, d @ up
        lo = np.array([np.percentile(u, 1), np.percentile(v_, 1)])
        hi = np.array([np.percentile(u, 99), np.percentile(v_, 99)])
        area = np.prod(hi - lo)
        if best is None or area < best[0]:
            best = (area, right, up, lo, hi)
    _, right, up, lo, hi = best
    centre = c + right * (lo[0] + hi[0]) / 2 + up * (lo[1] + hi[1]) / 2
    # what stands out of the face (keys, a clip, a pen) and must be covered
    # too; a hand in front of it is left out (it covers less of it)
    s = co[seen] - c
    inside = (np.abs(s @ right - (lo[0] + hi[0]) / 2) < (hi[0] - lo[0]) / 2) & \
             (np.abs(s @ up - (lo[1] + hi[1]) / 2) < (hi[1] - lo[1]) / 2)
    lead = float(np.clip(-np.percentile(s[inside] @ n, spec.get('cover', 15)), 0, 0.012))
    return centre, right, up, n, hi - lo, lead


def where(co, spec, margin):
    """The new one's front-face middle, axes (right, up, back), the old face's
    width and height, the new one's width and height, how far it is lifted
    and how thick it is."""
    if 'place' in spec:
        p = spec['place']
        right, back, up = (np.array(p[k], float) for k in ('right', 'back', 'up'))
        W, T, H = p['size']
        centre = np.array(p['at'], float) - back * (T / 2 - margin)
        return centre, right, up, back, W - 2 * margin, H - 2 * margin, W, H, 0.0, T - margin
    centre, right, up, back, (w, h), lead = old_object(co, spec)
    # the new one's size and place: the old face and a margin round it; the
    # lone one may carry more (a pocket's pen and calculator stick out above
    # it): `grow` and `lift` make room for that, as fractions of the old face
    gx, gz = spec.get('grow', (1, 1))
    return centre, right, up, back, w, h, (w + 2 * margin) * gx, (h + 2 * margin) * gz, spec.get('lift', 0) * h, spec['thick']


def load(src, spec):
    """The lone object, squared up: its thin side along y, long side along z,
    centred, its own size, its texture shrunk to TEX."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(src, spec['prop'] + '.glb'), merge_vertices=True)
    new = [o for o in bpy.data.objects if o not in before]
    ms = [o for o in new if o.type == 'MESH']
    for o in ms:
        mw = o.matrix_world.copy()
        o.parent = None
        o.data.transform(mw)
        o.matrix_world = Matrix()
    for o in new:
        if o.type != 'MESH':
            bpy.data.objects.remove(o)
    if len(ms) > 1:
        with bpy.context.temp_override(active_object=ms[0], selected_editable_objects=ms):
            bpy.ops.object.join()
    o = ms[0]
    o.name = spec['prop']
    o.data.transform(TURN)
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    print('swap: loaded', spec['prop'], len(o.data.vertices), 'points', tris, 'triangles')
    if tris > 40000:
        # Tripo splits every point on a texture seam: weld them first, or the
        # cut leaves the seams in shards
        import bmesh
        b = bmesh.new()
        b.from_mesh(o.data)
        bmesh.ops.remove_doubles(b, verts=b.verts, dist=1e-6)
        b.to_mesh(o.data)
        b.free()
        mod = o.modifiers.new('cut', 'DECIMATE')
        mod.ratio = 40000 / tris
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        cut = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
        o.modifiers.remove(mod)
        old = o.data
        o.data = cut
        bpy.data.meshes.remove(old)
        print('swap: cut to', len(o.data.vertices), 'points')
    # the importer's own normals no longer fit the cut mesh: let Blender work
    # them out again, smooth
    if o.data.has_custom_normals:
        bpy.context.view_layer.objects.active = o
        with bpy.context.temp_override(object=o, active_object=o):
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
    o.data.shade_smooth()
    # Small on screen: its colour picture is enough. Its bumps and shine
    # pictures go (a shine is set instead), which keeps the file light.
    for mat in o.data.materials:
        nt = mat.node_tree
        bsdf = next(nd for nd in nt.nodes if nd.type == 'BSDF_PRINCIPLED')
        for nd in list(nt.nodes):
            if nd.type != 'TEX_IMAGE' or not nd.image:
                continue
            if any(l.to_socket.name == 'Base Color' for l in nd.outputs['Color'].links):
                if nd.image.size[0] > TEX:
                    nd.image.scale(TEX, TEX)
                    nd.image.pack()
            else:
                nt.nodes.remove(nd)
        for nd in list(nt.nodes):
            if nd.type in ('NORMAL_MAP', 'SEPARATE_COLOR'):
                nt.nodes.remove(nd)
        bsdf.inputs['Roughness'].default_value = 0.4
        bsdf.inputs['Metallic'].default_value = 0.0
    a = np.array([v.co[:] for v in o.data.vertices])
    c = a.mean(0)
    w, v = np.linalg.eigh(np.cov((a - c).T))
    R = np.array([v[:, 1], v[:, 0], v[:, 2]])   # rows: mid -> x, thin -> y, long -> z
    if np.linalg.det(R) < 0:
        R[0] = -R[0]
    M = Matrix([list(R[0]) + [0], list(R[1]) + [0], list(R[2]) + [0], [0, 0, 0, 1]])
    o.data.transform(M @ Matrix.Translation(-Vector(c)))
    # Which way the eigenvectors point is a coin toss: the spec's turn and flip
    # set it right (found by looking).
    o.data.transform(Matrix.Rotation(math.radians(spec.get('turn', 0)), 4, 'Y'))
    if spec.get('flip'):
        o.data.transform(Matrix.Rotation(math.pi, 4, 'Z'))
    a = np.array([v.co[:] for v in o.data.vertices])
    if 'keep_below' in spec:   # only the lower part (a badge's card, not its strap)
        import bmesh
        cut_z = a[:, 2].min() + spec['keep_below'] * np.ptp(a[:, 2])
        b = bmesh.new()
        b.from_mesh(o.data)
        bmesh.ops.delete(b, geom=[f for f in b.faces if f.calc_center_median().z > cut_z], context='FACES')
        b.to_mesh(o.data)
        b.free()
        a = np.array([v.co[:] for v in o.data.vertices])
    a = np.array([v.co[:] for v in o.data.vertices])
    o.data.transform(Matrix.Translation(-Vector((a.min(0) + a.max(0)) / 2)))
    return o


def swap(obj, name, src, margin=0.004):
    """Every object of SWAPS[name] in place of its old self in `obj`: the old
    one is flattened out of sight first, so only the new one shows."""
    for spec in SWAPS.get(name, []):
        hand_placed = PLACE.get(name, {}).get(spec['prop'])
        if hand_placed:
            spec = {**spec, 'place': hand_placed, **{k: hand_placed[k] for k in ('keep', 'also') if hand_placed.get(k)}}
        co, e = touchup.mesh_arrays(obj)
        centre, right, up, back, w, h, W, H, lift, t = where(co, spec, margin)
        s = co - centre
        u, v, d = s @ right, (s @ up), s @ back
        if spec.get('keep_old'):
            # placed by hand over the old one, which it already hides
            # (Álvaro, 2026-11-16: pushing or pressing the old one away spoilt
            # Finanzas, and was not needed)
            print('swap: left the old', spec['prop'], 'as it is')
        elif 'press' not in spec:
            # held in a hand: push all of the old one that is in front of the
            # middle of where the new one will be back to that middle, so it
            # is wholly inside the new one; the hand's
            # fingers in front of it (the `hand` box, fractions of the face
            # from its bottom left) stay
            inner = (np.abs(u / (W / 2 - 0.002)) ** 8 + np.abs((v - lift) / (H / 2 - 0.002)) ** 8) < 1
            u0, u1, v0, v1 = spec.get('hand', (0, 0, 0, 0))
            fu, fv = u / w + 0.5, v / h + 0.5
            hand = (fu > u0) & (fu < u1) & (fv > v0) & (fv < v1) & (d < -margin)
            if spec.get('keep'):   # the same, as a box seen from the front
                x0, x1, z0, z1 = spec['keep']
                hand |= (co[:, 0] > x0) & (co[:, 0] < x1) & (co[:, 2] > z0) & (co[:, 2] < z1) & (d < -margin)
            mid = (t - margin) / 2
            flat = inner & ~hand & (d > -0.07) & (d < mid)
            if spec.get('also'):   # more of it, outside its outline, pushed back too
                x0, x1, z0, z1 = spec['also']
                flat |= (co[:, 0] > x0) & (co[:, 0] < x1) & (co[:, 2] > z0) & (co[:, 2] < z1) & ~hand & (d > -0.07) & (d < mid)
            co[flat] += np.outer(mid - d[flat], back)
            print('swap: squashed', int(flat.sum()), 'points of the old', spec['prop'], 'inside the new one')
        else:
            # worn on the body (a pocket, a badge): press the old one flat into
            # the body, so no hole opens where the new one's outline differs,
            # and paint the body's own colour over it; the body's surface and
            # colour there are guessed from the body round it
            k = spec['press']
            # and `also` (x0, x1, z0, z1, from the front): a pen standing out
            x0, x1, z0, z1 = spec.get('also', spec['box'])
            foot = ((np.abs(u) < w / 2 * k) & (np.abs(v) < h / 2 * k)) | \
                   ((np.abs(u) < W / 2) & (np.abs(v - lift) < H / 2)) | \
                   ((co[:, 0] > x0) & (co[:, 0] < x1) & (co[:, 2] > z0) & (co[:, 2] < z1) & (d > -0.05) & (d < 0.04))
            ring = (np.abs(u) < W / 2 + w * 0.3) & (np.abs(v - lift) < H / 2 + h * 0.3) & ~foot & (d > -0.01) & (d < 0.08)
            A = lambda m: np.c_[u[m] ** 2, u[m] * v[m], v[m] ** 2, u[m], v[m], np.ones(m.sum())]
            fit = ring.copy()
            for _ in range(4):
                coef, *_ = np.linalg.lstsq(A(fit), d[fit], rcond=None)
                r = A(ring) @ coef - d[ring]
                fit = ring.copy()
                fit[ring] = np.abs(r) < np.percentile(np.abs(r), 60)
            # only the front of the body there, not its back
            everywhere = np.ones(len(co), bool)
            foot &= d < A(everywhere) @ coef + 0.01
            body = A(foot) @ coef
            ahead = d[foot] < body + 0.004
            idx = np.nonzero(foot)[0][ahead]
            co[idx] += np.outer(body[ahead] - 0.001 - d[idx], back)
            # its colour: the body's round it, run smoothly across, matching
            # the body at its edge (each point the mean of its neighbours, the
            # points outside held as they are; a guess from the shirt nearby,
            # not a tie, to start from)
            vc, _, _ = touchup.colours(obj)
            near = ring & fit
            gap = np.linalg.norm(vc[near] - np.median(vc[near], 0), axis=1)
            near[near] = gap < np.percentile(gap, 60)
            fill = vc.copy()
            for c in range(3):
                cf, *_ = np.linalg.lstsq(A(near), vc[near, c], rcond=None)
                fill[foot, c] = A(foot) @ cf
            # Tripo's mesh is in many loose pieces, so what is next to what is
            # found by distance, not by the mesh's edges
            from mathutils.kdtree import KDTree
            around = np.nonzero(foot | ring)[0]
            kd = KDTree(int(foot.sum()))
            for i, q in enumerate(co[foot]):
                kd.insert(q, i)
            kd.balance()
            dist = np.full(len(co), np.inf)
            dist[around] = [kd.find(co[i])[2] for i in around]
            # all of the footprint, and a soft edge 6 mm wide round it
            x = np.clip(1 - dist / 0.006, 0, 1)
            soft = x * x * (3 - 2 * x)
            soft[foot] = 1
            kd = KDTree(len(around))
            for i in around:
                kd.insert(co[i], int(i))
            kd.balance()
            ids = np.nonzero(foot)[0]
            nb = [[j for _, j, _ in kd.find_range(co[i], 0.0025)] for i in ids]
            start = np.r_[0, np.cumsum([len(l) for l in nb])[:-1]]
            flat_nb = np.concatenate([np.array(l, np.int64) for l in nb])
            cnt = np.array([len(l) for l in nb])[:, None]
            for _ in range(4000):
                fill[ids] = np.add.reduceat(fill[flat_nb], start, axis=0) / cnt
            touchup.paint(obj, soft, np.clip(fill, 0, 1))
            # pressed flat, the old one's back and inner faces now lie on its
            # front, turned the wrong way, and show dark: take them away
            obj.data.vertices.foreach_set('co', co.ravel())
            obj.data.update()
            import bmesh
            b = bmesh.new()
            b.from_mesh(obj.data)
            b.faces.ensure_lookup_table()
            bk = Vector(back)
            wrong = [f for f in b.faces if all(foot[v.index] for v in f.verts) and f.normal.dot(bk) > 0.3]
            bmesh.ops.delete(b, geom=wrong, context='FACES_ONLY')
            b.to_mesh(obj.data)
            b.free()
            co, e = touchup.mesh_arrays(obj)
            print('swap: pressed and painted over', len(idx), 'points of the old', spec['prop'], 'and took away', len(wrong), 'faces turned the wrong way')
        obj.data.vertices.foreach_set('co', co.ravel())
        obj.data.update()
        p = load(src, spec)
        a = np.array([v.co[:] for v in p.data.vertices])
        size = a.max(0) - a.min(0)
        centre = centre + up * lift
        S = Matrix.Diagonal(Vector((W / size[0], (t + margin) / size[1], H / size[2], 1)))
        # its front a margin in front of the old face, its back `thick` behind it
        at = Vector(centre) + Vector(back) * ((t + margin) / 2 - margin)
        R = Matrix((right, back, up)).transposed().to_4x4()   # x -> right, y -> back, z -> up
        p.data.transform(Matrix.Translation(at) @ R @ S)
        PLACED.setdefault(name, {})[spec['prop']] = (at.copy(), R.copy(), (W, t + margin, H))
        print('swap:', spec['prop'], 'at', [round(x, 3) for x in centre], 'size', round(w, 3), round(h, 3),
              'turned', round(math.degrees(math.atan2(right[2], right[0])), 1), 'deg')
        bpy.context.view_layer.update()
        front = Vector(centre) - Vector(back) * margin
        for words, fu, fv, height, colour, *more in spec.get('labels', []):
            opt = more[0] if more else {}
            o = front + Vector(right) * (fu - 0.5) * W + Vector(up) * (fv - 0.5) * H
            # lie on the new object's face: cast a ray at it from the front
            ok, loc, _, _ = p.ray_cast(o - Vector(back) * 0.05, Vector(back))
            if ok:
                o = loc
            r = math.radians(opt.get('tilt', 0))
            rt = Vector(right) * math.cos(r) + Vector(up) * math.sin(r)
            ut = Vector(up) * math.cos(r) - Vector(right) * math.sin(r)
            touchup.text_at(words, o - Vector(back) * 0.0016, rt, ut, height * H, colour, opt.get('align', 'CENTER'))
