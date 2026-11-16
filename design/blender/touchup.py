"""Hand fixes to whole Tripo ghosts, applied by tripo.py before it exports one:
the line on the head where Tripo's views meet (soften_seams, SEAMS), and the
helpers swap.py uses. They work on the light model (welded, cut down, 1 unit
tall, facing -Y, Blender's z up) and its textures. (The spikes along a collar
and the ragged eye rims came from the cut, not from Tripo: tripo.py leaves those
places whole, KEEP.)
"""
import numpy as np


def mesh_arrays(obj):
    me = obj.data
    n = len(me.vertices)
    co = np.zeros(n * 3); me.vertices.foreach_get('co', co)
    e = np.zeros(len(me.edges) * 2, dtype=np.int64); me.edges.foreach_get('vertices', e)
    return co.reshape(-1, 3), e.reshape(-1, 2)


def texture(obj, socket='Base Color'):
    """The image feeding the material's `socket` (through at most one node in
    between, as the normal map does), and its pixels as an h x w x 4 array."""
    for node in (nd for m in obj.data.materials if m and m.node_tree for nd in m.node_tree.nodes):
        if node.type == 'TEX_IMAGE' and node.image:
            ends = [l.to_socket.name for l in node.outputs['Color'].links]
            ends += [l2.to_socket.name for l in node.outputs['Color'].links for o in l.to_node.outputs for l2 in o.links]
            if socket in ends:
                img = node.image
                w, h = img.size
                return img, np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    return None, None


def save_texture(img, px):
    img.pixels.foreach_set(px.ravel())
    img.update()
    img.pack()


def raster(uv, tri, shape, grow=1.5):
    """Texel rows, columns and barycentric weights (n x 3) inside UV triangle
    `tri` (three loop indices), grown by `grow` texels so the chart's border,
    which filtering also reads, is covered too."""
    h, w = shape
    t = uv[tri] * [w, h]
    lo = np.clip(np.floor(t.min(0) - grow).astype(int), 0, [w - 1, h - 1])
    hi = np.clip(np.ceil(t.max(0) + grow).astype(int), 0, [w - 1, h - 1])
    xs, ys = np.meshgrid(np.arange(lo[0], hi[0] + 1) + 0.5, np.arange(lo[1], hi[1] + 1) + 0.5)
    a, b, c = t
    d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if abs(d) < 1e-9:
        return None
    l1 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
    l2 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
    l3 = 1 - l1 - l2
    # how far outside, in texels: a barycentric unit is about the triangle's height
    size = max(np.ptp(t[:, 0]), np.ptp(t[:, 1]), 1)
    m = np.minimum(np.minimum(l1, l2), l3) >= -grow / size
    if not m.any():
        return None
    bc = np.clip(np.c_[l1[m], l2[m], l3[m]], 0, 1)
    bc /= bc.sum(1, keepdims=True)
    return ys[m].astype(int), xs[m].astype(int), bc


def colours(obj):
    """Each point's colour in the texture (the mean of its corners'), and its
    corners' own colours."""
    me = obj.data
    n = len(me.vertices)
    img, px = texture(obj)
    h, w = px.shape[:2]
    uv = np.zeros(len(me.loops) * 2); me.uv_layers.active.data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
    lv = np.zeros(len(me.loops), np.int64); me.loops.foreach_get('vertex_index', lv)
    lc = px[np.clip((uv[:, 1] * h).astype(int), 0, h - 1), np.clip((uv[:, 0] * w).astype(int), 0, w - 1), :3]
    vc = np.zeros((n, 3))
    for k in range(3):
        vc[:, k] = np.bincount(lv, lc[:, k], n) / np.maximum(np.bincount(lv, None, n), 1)
    return vc, lc, lv


def paint(obj, wt, colour):
    """Repaint the texture round the points with weight `wt` > 0: toward
    `colour` (one per point) by that weight, the bumps (normal map) toward
    flat by the same."""
    me = obj.data
    img, px = texture(obj)
    nimg, npx = texture(obj, 'Normal')
    h, w = px.shape[:2]
    uv = np.zeros(len(me.loops) * 2); me.uv_layers.active.data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
    lv = np.zeros(len(me.loops), np.int64); me.loops.foreach_get('vertex_index', lv)
    tris = []
    for poly in me.polygons:
        if wt[list(poly.vertices)].max() > 0:
            ls = list(poly.loop_indices)
            tris += [(ls[0], ls[k], ls[k + 1]) for k in range(1, len(ls) - 1)]
    flat = np.array([0.5, 0.5, 1.0], np.float32)
    for tri in tris:
        r = raster(uv, np.array(tri), (h, w))
        if r is None:
            continue
        ys, xs, bc = r
        vs = lv[list(tri)]
        k = (bc @ wt[vs])[:, None]
        if colour is not None:   # None: the bumps only
            px[ys, xs, :3] = px[ys, xs, :3] * (1 - k) + (bc @ colour[vs]) * k
        if npx is not None:
            npx[ys, xs, :3] = npx[ys, xs, :3] * (1 - k) + flat * k
    if colour is not None:
        save_texture(img, px)
    if npx is not None:
        save_texture(nimg, npx)
    return len(tris)


def smooth_marks(obj, marks, fixes=('bumps',)):
    """Smooth the places Álvaro painted as rough on the placing page
    (marks.json), fading out round each stroke, with any of these fixes, which
    he compares on the Taller page (2026-11-16):

    bumps         the bumps picture (normal map) made flat
    colour        the colour picture blended with the colours just round it
                  (Tripo bakes light and shade into it)
    shape         the shape smoothed gently: across the surface only, at most
                  1 mm, loose edges left where they are
    shape_strong  the first try: smoothed freely (pulled spikes out of the
                  collar's loose edges)
    """
    co, e = mesh_arrays(obj)
    n = len(co)
    from mathutils.kdtree import KDTree
    wt = np.zeros(n)
    for m in marks:
        pts = np.array(m['points'], float)
        reach = max(m.get('radius', 0.006) * 4, 0.02)
        kd = KDTree(len(pts))
        for i, p in enumerate(pts):
            kd.insert(p, i)
        kd.balance()
        lo, hi = pts.min(0) - reach, pts.max(0) + reach
        near = np.nonzero(np.all((co > lo) & (co < hi), axis=1))[0]
        d = np.array([kd.find(co[i])[2] for i in near])
        x = np.clip((1 - d / reach) * 1.6, 0, 1)
        wt[near] = np.maximum(wt[near], x * x * (3 - 2 * x))
    if not wt.any():
        return
    idx = np.nonzero(wt > 0)[0]
    a = np.r_[e[:, 0], e[:, 1]]; b = np.r_[e[:, 1], e[:, 0]]
    deg = np.maximum(np.bincount(a, None, n), 1)[:, None]
    if 'shape' in fixes or 'shape_strong' in fixes:
        p = co.copy()
        w = wt.copy()
        strong = 'shape_strong' in fixes
        if not strong:
            # loose edges (an edge with one face) and their neighbours stay
            import bmesh
            bm = bmesh.new(); bm.from_mesh(obj.data)
            edge = np.zeros(n, bool)
            for ed in bm.edges:
                if len(ed.link_faces) < 2:
                    edge[ed.verts[0].index] = edge[ed.verts[1].index] = True
            bm.free()
            near_edge = edge.copy()
            near_edge[b[edge[a]]] = True
            w[near_edge] = 0
            nrm = np.zeros(n * 3); obj.data.vertices.foreach_get('normal', nrm); nrm = nrm.reshape(-1, 3)
        for it in range(80):
            avg = np.stack([np.bincount(a, p[b, k], n) for k in range(3)], 1) / deg
            step = (0.5 if it % 2 == 0 else -0.53) * (avg - p)
            if not strong:
                step = nrm * (step * nrm).sum(1, keepdims=True)   # along the surface's normal only
            p += w[:, None] * step
        if not strong:
            dv = p - co
            ln = np.linalg.norm(dv, axis=1, keepdims=True)
            p = co + dv * np.minimum(1, 0.001 / np.maximum(ln, 1e-9))
        obj.data.vertices.foreach_set('co', p.ravel())
        obj.data.update()
        print('marks: shape', 'strong' if strong else 'gentle', 'moved up to',
              round(float(np.linalg.norm(p - co, axis=1).max()) * 1000, 2), 'mm')
    if 'colour' in fixes:
        # each point's colour: the mean of the colours within 6 mm (by distance:
        # Tripo's mesh is in loose pieces), more of it the stronger the mark
        vc, _, _ = colours(obj)
        around = np.nonzero(np.all((co > co[idx].min(0) - 0.01) & (co < co[idx].max(0) + 0.01), axis=1))[0]
        kd = KDTree(len(around))
        for i in around:
            kd.insert(co[i], int(i))
        kd.balance()
        blur = vc.copy()
        for i in idx:
            nb = [j for _, j, _ in kd.find_range(co[i], 0.006)]
            blur[i] = vc[nb].mean(0)
        paint(obj, wt, blur) if 'bumps' in fixes else paint_colour_only(obj, wt, blur)
        print('marks: colour blended round', len(idx), 'points')
    elif 'bumps' in fixes:
        paint(obj, wt, None)
        print('marks: flattened the bumps round', len(idx), 'points')


def paint_colour_only(obj, wt, colour):
    """paint(), keeping the bumps as they are."""
    nimg, npx = texture(obj, 'Normal')
    keep = None if npx is None else npx.copy()
    paint(obj, wt, colour)
    if keep is not None:
        save_texture(nimg, keep)


def soften_seams(obj, eyes=(), zmin=0.6, skip=(), step=0.12, reach=0.035):
    """Tripo paints a ghost from a few views, and where two views meet on the
    head their colours (and its normal map) jump: a hard line from the front
    to the back. Find where the colour jumps from one point to the next on the
    head (not at the eyes, not in the `skip` boxes), and repaint a band `reach`
    wide around it with colours that run smoothly from one side to the other."""
    co, e = mesh_arrays(obj)
    n = len(co)
    vc, lc, lv = colours(obj)
    # where the colour jumps: along an edge, or between a point's own corners
    # (a point on the border of two texture pieces painted from two views)
    seam = np.zeros(n, bool)
    jump = np.linalg.norm(vc[e[:, 0]] - vc[e[:, 1]], axis=1) > step
    seam[e[jump].ravel()] = True
    gap = np.zeros(n); np.maximum.at(gap, lv, np.linalg.norm(lc - vc[lv], axis=1))
    seam |= gap > step
    ok = co[:, 2] > zmin
    for (cx, cz, _), (rx, rz) in eyes:
        ok &= ~((np.abs(co[:, 0] - cx) < rx * 1.9) & (np.abs(co[:, 2] - cz) < rz * 1.9) & (co[:, 1] < 0))
    for x0, x1, y0, y1, z0, z1 in skip:
        ok &= ~((co[:, 0] > x0) & (co[:, 0] < x1) & (co[:, 1] > y0) & (co[:, 1] < y1) & (co[:, 2] > z0) & (co[:, 2] < z1))
    seam &= ok
    if not seam.any():
        print('seams: none')
        return
    from mathutils.kdtree import KDTree
    kd = KDTree(int(seam.sum()))
    for i, p in enumerate(co[seam]):
        kd.insert(p, i)
    kd.balance()
    d = np.array([kd.find(p)[2] for p in co])
    band = (d < reach) & ok
    wt = np.clip((reach - d) / (reach * 0.5), 0, 1)
    wt = wt * wt * (3 - 2 * wt) * band
    # colours inside the band: the smoothest fill between its edges (each point
    # the average of its neighbours, the points outside held as they are)
    a = np.r_[e[:, 0], e[:, 1]]; b = np.r_[e[:, 1], e[:, 0]]
    deg = np.maximum(np.bincount(a, None, n), 1)
    sm = vc.copy()
    for _ in range(400):
        avg = np.stack([np.bincount(a, sm[b, k], n) for k in range(3)], 1) / deg[:, None]
        sm[band] = avg[band]
    paint(obj, wt, sm)
    print('seams: softened', int(seam.sum()), 'points,', int(band.sum()), 'in the band')


def text_at(words, at, right, up, height, colour, align='CENTER'):
    """Real, straight letters centred at `at` (or ending there, align
    'RIGHT'), reading along `right`, standing along `up`, as a mesh in the
    model's own coordinates."""
    import bpy
    from mathutils import Matrix
    n = right.cross(up).normalized()   # out of the face, toward the viewer
    cu = bpy.data.curves.new('text', 'FONT')
    cu.body = words
    cu.align_x = align
    cu.align_y = 'CENTER'
    cu.size = height
    cu.extrude = 0.0008
    t = bpy.data.objects.new('text-' + words, cu)
    bpy.context.scene.collection.objects.link(t)
    t.matrix_world = Matrix.Translation(at) @ Matrix((right.normalized(), up.normalized(), n)).transposed().to_4x4()
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


# Where to look for the line on the head, per model: above `zmin`, minus the
# things that sit there (boxes x0, x1, y0, y1, z0, z1). Redes has none: its
# beret covers the place.
SEAMS = {
    'base': {},
    'secretaria': {'skip': [(0.03, 0.25, 0.0, 0.23, 0.88, 1.01),      # the bun
                            (-0.4, -0.15, -0.3, 0.3, 0.4, 0.86)]},    # the phone
    'incorporacion': {'zmin': 0.66, 'skip': [(-0.5, -0.27, -0.3, 0.3, 0.3, 0.9)]},  # the waving hand
    'finanzas': {'zmin': 0.66},
    'productor': {'zmin': 0.68},   # below, the headphones' band
}
