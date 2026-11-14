"""Check that no part passes through another, as the app shows them.

    blender -b --python design/blender/clash.py -- secretaria,redes

For each agent, at rest, at both ends of the arms' sway and at the top of a hop,
prints every part sunk more than 5 mm into another. Expected and fine: the arm
roots inside the body, worn things (bun, scarf band, beret) sitting into the
head, the rings through the notepad's pages, and a hand closed on what it holds
(arm0 in phone, about 5 cm). Odd one-point hits are the ray test's noise.
"""
import json, math, sys
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
M = "apps/mobile/components/ghost/models"; HEM = 1.0
def load(f): return json.load(open(f"{M}/{f}"))
def narrow(y, hem):
    t = min(1, max(0, (0.25 - y) / 0.95)); return 1 - (1 - hem) * t * t * (3 - 2 * t)
def mesh(d, mat=Matrix.Identity(4), fn=None):
    p = d["position"]; vs = [Vector(p[i:i+3]) for i in range(0, len(p), 3)]
    if fn: vs = [fn(v) for v in vs]
    vs = [mat @ v for v in vs]
    idx = d["index"]; return vs, [idx[i:i+3] for i in range(0, len(idx), 3)]
def tree(m): return BVHTree.FromPolygons(m[0], m[1])
def inside(a, b, bt):
    """Deepest point of a inside b (closed mesh; parity of ray hits)."""
    worst = 0.0; n = 0
    for v in a[0]:
        hits = 0; o = v.copy(); d = Vector((0.3123, 0.9, 0.3017)).normalized()
        while True:
            h = bt.ray_cast(o, d)
            if h[0] is None: break
            hits += 1; o = h[0] + d * 1e-5
            if hits > 40: break
        if hits % 2:
            n += 1; c = bt.find_nearest(v); worst = max(worst, (c[0] - v).length)
    return worst, n
def arm_mat(side, angle, forward, sway, ss):
    T = Matrix.Translation((side * 0.56 * ss, -0.02, 0.08))
    return T @ Matrix.Rotation(-forward, 4, "X") @ Matrix.Rotation(side * (angle + sway), 4, "Z")
# Each arm's (swing, fling), as in POSES in GhostScene.tsx; angles come from the models.
POSES = {"secretaria": [[0.01, 0], [0.05, 1]], "redes": [[0.03, 0.4], [0.06, 0.4]]}
IN_ARM = {"phone": 0, "phone_holes": 0, "handset": 0, "lenses": 0, "screen": 0, "peace": 1}
base = load("base.json")
body = mesh(base["body"], fn=lambda v: Vector((v.x * narrow(v.y, HEM), v.y, v.z * narrow(v.y, HEM))))
ss = 1; ps = 1
for agent in sys.argv[-1].split(","):
    parts = load(f"{agent}.json"); parts.pop("note"); arms_json = parts.pop("arms")
    for label, sway in [("rest", 0), ("sway+", 1), ("sway-", -1), ("hop", 99)]:
        arms = []
        for i, ((a, f), (s, fl)) in enumerate(zip(arms_json, POSES[agent])):
            side = -1 if i == 0 else 1
            sw = 0.3 * 0.8 * fl if sway == 99 else s * sway
            m = arm_mat(side, a, f, sw, ss)
            geo = parts.get("arm_l" if i == 0 else "arm_r") if agent == "redes" else (parts["arm_phone"] if i == 0 else base["arm"])
            arms.append(("arm%d" % i, mesh(geo, m), m))
        props = []
        for k, d in parts.items():
            if k.startswith("arm_"): continue
            if k in IN_ARM: props.append((k, mesh(d, arms[IN_ARM[k]][2]))); continue
            S = Matrix.Diagonal((ps, 1, ps, 1)) if k in ("paper", "cover", "spiral", "ink", "pen") else Matrix.Identity(4)
            props.append((k, mesh(d, S)))
        solids = [("body", body)] + [(n, g) for n, g, _ in arms] + props
        trees = {n: tree(g) for n, g in solids}
        out = []
        for na, ga in solids:
            for nb, gb in solids:
                if na == nb or (na.startswith("arm") and nb == "body"): continue
                if (na, nb) in [("peace", "arm1"), ("arm1", "peace"), ("phone_holes", "phone"), ("lenses", "handset")]: continue
                w, n = inside(ga, gb, trees[nb])
                if w > 0.005: out.append(f"{na} in {nb}: {w:.3f} ({n} pts)")
        print(agent, label, "|", "; ".join(out) or "clean")
