"""Find where a whole Tripo ghost's eyes are, so the app can make them blink.

Tripo paints the eyes into the texture: two dark ovals on the front of the head.
This reads each light model (design/tripo/<name>.glb, made by tripo.py), looks at
the texture under every front-facing point of the head, and keeps the dark ones,
split into a left and a right eye. Out: design/tripo/eyes.json, in the app's
coordinates (x right, y up, z towards the viewer; the model 1 unit tall), with
the colour round each eye, which the app paints over it as a closing eyelid.

    blender -b -P design/blender/eyes.py -- base,secretaria,redes,incorporacion,finanzas
"""
import json
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
TRIPO = os.path.join(HERE, '..', 'tripo')
names = sys.argv[sys.argv.index('--') + 1].split(',')
out = {}
for name in names:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(TRIPO, f'{name}.glb'))
    pts, cols, ring_pts, ring_cols = [], [], [], []
    for obj in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
        me = obj.data
        mw = obj.matrix_world
        img = None
        for n in me.materials[0].node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image and 'base' in (n.image.name + n.label + n.name).lower():
                img = n.image
        if img is None:
            img = next(n.image for n in me.materials[0].node_tree.nodes if n.type == 'TEX_IMAGE' and n.image)
        w, h = img.size
        px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
        uv = me.uv_layers.active.data
        nl = len(me.loops)
        uvs = np.zeros(nl * 2, dtype=np.float32)
        uv.foreach_get('uv', uvs)
        uvs = uvs.reshape(nl, 2)
        vidx = np.zeros(nl, dtype=np.int32)
        me.loops.foreach_get('vertex_index', vidx)
        co = np.zeros(len(me.vertices) * 3, dtype=np.float32)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        no = np.zeros(len(me.vertices) * 3, dtype=np.float32)
        me.vertices.foreach_get('normal', no)
        no = no.reshape(-1, 3)
        M = np.array(mw)
        co = co @ M[:3, :3].T + M[:3, 3]
        no = no @ M[:3, :3].T
        x = np.clip((uvs[:, 0] % 1) * (w - 1), 0, w - 1).astype(int)
        y = np.clip((uvs[:, 1] % 1) * (h - 1), 0, h - 1).astype(int)
        c = px[y, x, :3]
        p = co[vidx]
        n = no[vidx]
        lum = c @ np.array([0.3, 0.59, 0.11])
        front = (p[:, 2] > 0.5) & (p[:, 2] < 0.97) & (n[:, 1] < -0.2) & (np.abs(p[:, 0]) < 0.3)
        dark = front & (lum < 0.08)
        pts.append(p[dark]); cols.append(c[dark])
        ring_pts.append(p[front & (lum >= 0.08)]); ring_cols.append(c[front & (lum >= 0.08)])
    P = np.concatenate(pts)
    R = np.concatenate(ring_pts); RC = np.concatenate(ring_cols)
    # The eyes are the two big dark blobs: split at the middle, keep the densest
    # height band so a dark tie or phone below does not count.
    eyes = []
    for side in (-1, 1):
        S = P[(P[:, 0] * side) > 0.01]
        if len(S) < 20:
            print('no eye', name, side); continue
        # Flood from the densest 1 cm cell through cells that are mostly dark,
        # so a dark beret or tie touching the eye's box is left out.
        ij = np.floor(S[:, [0, 2]] / 0.01).astype(int)
        cells = {}
        for k in map(tuple, ij):
            cells[k] = cells.get(k, 0) + 1
        blob = lambda k: sum(cells.get((k[0] + i, k[1] + j), 0) for i in range(-2, 3) for j in range(-2, 3))
        start = max(cells, key=lambda k: blob(k) if 0.6 < k[1] * 0.01 < 0.76 else 0)
        keep, todo = {start}, [start]
        floor_ = max(3, cells[start] * 0.15)
        while todo:
            a, b = todo.pop()
            for d in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                k = (a + d[0], b + d[1])
                if (k not in keep and cells.get(k, 0) >= floor_
                        and abs(k[0] - start[0]) <= 6 and abs(k[1] - start[1]) <= 8):
                    keep.add(k); todo.append(k)
        S = S[np.array([tuple(k) in keep for k in ij])]
        lo, hi = S.min(axis=0), S.max(axis=0)
        cen = (lo + hi) / 2
        rx, rz = (hi[0] - lo[0]) / 2, (hi[2] - lo[2]) / 2
        near = R[(np.abs(R[:, 0] - cen[0]) < rx * 1.9) & (np.abs(R[:, 2] - cen[2]) < rz * 1.6)
                 & ~((np.abs(R[:, 0] - cen[0]) < rx * 1.15) & (np.abs(R[:, 2] - cen[2]) < rz * 1.15))]
        nc = RC[(np.abs(R[:, 0] - cen[0]) < rx * 1.9) & (np.abs(R[:, 2] - cen[2]) < rz * 1.6)
                & ~((np.abs(R[:, 0] - cen[0]) < rx * 1.15) & (np.abs(R[:, 2] - cen[2]) < rz * 1.15))]
        lid = np.median(nc, axis=0) if len(nc) else np.array([0.6, 0.6, 0.8])
        # Blender (x, y, z up, front -y) to the app (x, y up, z front).
        eyes.append({'center': [round(float(cen[0]), 4), round(float(cen[2]), 4), round(float(-lo[1]), 4)],
                     'radius': [round(float(rx), 4), round(float(rz), 4)],
                     'lid': [round(float(v), 3) for v in lid], 'points': int(len(S))})
    out[name] = eyes
    print(name, eyes)
path = os.path.join(TRIPO, 'eyes.json')
old = json.load(open(path)) if os.path.exists(path) else {}
old.update(out)
json.dump(old, open(path, 'w'), indent=1)
