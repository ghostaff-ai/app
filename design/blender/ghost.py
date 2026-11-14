"""Build the ghosts in Blender, headless, and export them for the app.

    blender -b -P design/blender/ghost.py -- [--render]

Writes, next to this script:
  ghost.blend   the models, to open and edit by hand in Blender
  ghost.glb     the same, in the standard format other 3D tools read
and, for the app, apps/mobile/components/ghost/models/:
  base.json        the body and the arm
  secretaria.json  the Secretaría's props, one mesh per material
each as plain arrays (positions, normals, triangle indices) in the app's axes
(y up, z towards the viewer). With --render it also saves preview pictures to
design/blender/renders/.

The shapes follow Álvaro's Gemini pictures (design/concepts/gemini-round1/):
base-b.jpg for the body, secretaria-front.jpg for the Secretaría. Colours are
not in the model: they are the app's shaders, chosen per part.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
MODELS = REPO / "apps/mobile/components/ghost/models"

SEGMENTS = 64  # around the axis

# --- Axes ---------------------------------------------------------------------------
# Everything below is written in the app's axes (y up, z towards the viewer) and
# converted, so the numbers read the same as in the app's code.


def at(x: float, y: float, z: float) -> Vector:
    return Vector((x, -z, y))


def to_app(v) -> list[float]:
    return [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]


# --- The body ---------------------------------------------------------------------
# A narrow rounded head that flares into a wide skirt, ending in deep drip lobes.

DOME_Y = 0.25  # where the head's dome meets the skirt
DOME_R = 0.60
TOP = 1.0
P = 2.2  # superellipse power: above 2 the dome is a little squarer than a circle
HEM_Y = -0.62
HEM_R = 0.94
LOBES = 8


def dome_radius(y: float) -> float:
    k = max(0.0, 1 - ((y - DOME_Y) / (TOP - DOME_Y)) ** P)
    return DOME_R * k ** (1 / P)


def skirt_radius(y: float) -> float:
    f = (DOME_Y - y) / (DOME_Y - HEM_Y)
    return DOME_R + (HEM_R - DOME_R) * f**1.7


def body_radius(y: float) -> float:
    """The body's radius at height y, before smoothing and lobes (for placing props)."""
    return dome_radius(y) if y >= DOME_Y else skirt_radius(y)


def body_profile() -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = [(0.0, TOP)]
    for k in range(1, 11):  # the dome, finer near the top
        t = math.pi / 2 * (1 - k / 10)
        pts.append((DOME_R * math.cos(t) ** (2 / P), DOME_Y + (TOP - DOME_Y) * math.sin(t) ** (2 / P)))
    for j in range(1, 9):
        y = DOME_Y + (HEM_Y - DOME_Y) * j / 8
        pts.append((skirt_radius(y), y))
    pts += [  # a thick rounded lip, then the hollow underside
        (HEM_R + 0.05, -0.70),
        (HEM_R + 0.02, -0.78),
        (HEM_R - 0.08, -0.82),
        (HEM_R - 0.22, -0.80),
        (0.45, -0.75),
        (0.2, -0.72),
        (0.0, -0.71),
    ]
    return pts


def hem_lobes(theta: float, r: float, y: float) -> tuple[float, float]:
    """Deep rounded drips round the hem; the gaps between them ride up."""
    if y > -0.15:
        return r, y
    w = min(1.25, ((-0.15 - y) / 0.6) ** 1.4)
    c = math.cos(LOBES * theta)
    return r * (1 + 0.06 * c * w), y - 0.15 * (0.5 + 0.5 * c) * w


# --- The arm: thick where it grows out of the body, ending in a round mitten ------

ARM_TOP = 0.14  # the root is buried inside the body


def arm_profile() -> list[tuple[float, float]]:
    return [
        (0.0, ARM_TOP),
        (0.12, 0.1),
        (0.15, 0.02),
        (0.14, -0.08),
        (0.125, -0.18),
        (0.12, -0.27),
        (0.11, -0.34),
        (0.075, -0.40),
        (0.0, -0.42),
    ]


# --- Building blocks ---------------------------------------------------------------


def link(name: str, bm: bmesh.types.BMesh) -> bpy.types.Object:
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)  # outward, so culling and lighting agree
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def subdivide(obj: bpy.types.Object, levels: int = 1) -> bpy.types.Object:
    sub = obj.modifiers.new("smooth", "SUBSURF")
    sub.levels = levels
    sub.render_levels = levels
    return obj


def lathe(name: str, profile, shape=None, segments: int = SEGMENTS) -> bpy.types.Object:
    """Spin a (radius, height) profile round the vertical axis; both ends on the axis.

    `shape(theta, r, y)` may move each vertex; theta 0 faces the viewer.
    """
    bm = bmesh.new()
    top = bm.verts.new(at(0, profile[0][1], 0))
    bottom = bm.verts.new(at(0, profile[-1][1], 0))
    rings = []
    for r, y in profile[1:-1]:
        row = []
        for s in range(segments):
            theta = 2 * math.pi * s / segments
            rr, yy = shape(theta, r, y) if shape else (r, y)
            row.append(bm.verts.new(at(rr * math.sin(theta), yy, rr * math.cos(theta))))
        rings.append(row)
    for s in range(segments):
        n = (s + 1) % segments
        bm.faces.new((top, rings[0][n], rings[0][s]))
        for a, b in zip(rings, rings[1:]):
            bm.faces.new((a[s], a[n], b[n], b[s]))
        bm.faces.new((rings[-1][s], rings[-1][n], bottom))
    return link(name, bm)


def tube(name, path, radii, sides: int = 16) -> bpy.types.Object:
    """A tube along a list of points (app axes), with a radius per point, capped round."""
    bm = bmesh.new()
    pts = [Vector(p) for p in path]
    rows = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        side = t.cross(Vector((0, 0, 1)))
        if side.length < 1e-3:
            side = t.cross(Vector((1, 0, 0)))
        side.normalize()
        up = side.cross(t)
        row = []
        for k in range(sides):
            a = 2 * math.pi * k / sides
            q = p + radii[i] * (math.cos(a) * side + math.sin(a) * up)
            row.append(bm.verts.new(at(*q)))
        rows.append(row)
    for a_, b_ in zip(rows, rows[1:]):
        for k in range(sides):
            n = (k + 1) % sides
            bm.faces.new((a_[k], a_[n], b_[n], b_[k]))
    for row, p in [(rows[0], pts[0]), (rows[-1], pts[-1])]:
        c = bm.verts.new(at(*p))
        for k in range(sides):
            bm.faces.new((row[k], row[(k + 1) % sides], c))
    return link(name, bm)


def ellipsoid(name, center, radii, rotate=(0, 0, 0)) -> bpy.types.Object:
    """A smooth ellipsoid in app axes; `rotate` is (x, y, z) radians in app axes."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=14, radius=1.0)
    rot = (
        Matrix.Rotation(rotate[2], 4, "Z")
        @ Matrix.Rotation(rotate[1], 4, "Y")
        @ Matrix.Rotation(rotate[0], 4, "X")
    )
    for v in bm.verts:
        p = Vector((v.co.x * radii[0], v.co.z * radii[1], -v.co.y * radii[2]))  # app axes
        p = rot @ p
        v.co = at(*(Vector(center) + p))
    return link(name, bm)


def band(name, y: float, radius_at, thick: float, height: float, segments: int = 96, sag=None) -> bpy.types.Object:
    """A flat fabric band round the body at height y: an oval cross-section, wide and thin."""
    bm = bmesh.new()
    sides = 14
    rows = []
    for s in range(segments):
        theta = 2 * math.pi * s / segments
        dy = sag(theta) if sag else 0.0
        r0 = radius_at(y + dy)
        row = []
        for k in range(sides):
            phi = 2 * math.pi * k / sides
            r = r0 + thick * (0.5 + 0.5 * math.cos(phi))
            yy = y + dy + height * math.sin(phi)
            row.append(bm.verts.new(at(r * math.sin(theta), yy, r * math.cos(theta))))
        rows.append(row)
    for s in range(segments):
        a_, b_ = rows[s], rows[(s + 1) % segments]
        for k in range(sides):
            n = (k + 1) % sides
            bm.faces.new((a_[k], a_[n], b_[n], b_[k]))
    return link(name, bm)


def sheet(name, outline, thickness: float, bend=None) -> bpy.types.Object:
    """A thin flat shape (a scarf tail): a 2D outline in app x/y, given thickness.

    `bend(x, y)` returns the (x, y, z) where each outline point goes.
    """
    bm = bmesh.new()
    front, back = [], []
    for x, y in outline:
        p = Vector(bend(x, y))
        front.append(bm.verts.new(at(*(p + Vector((0, 0, thickness / 2))))))
        back.append(bm.verts.new(at(*(p - Vector((0, 0, thickness / 2))))))
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[i], back[i], back[j], front[j]))
    bmesh.ops.triangulate(bm, faces=bm.faces)
    return link(name, bm)


def ribbon(name, shape, along: int, thickness: float) -> bpy.types.Object:
    """A thin strip of cloth, `along` steps long.

    For v in 0..1 down its length, `shape(v)` gives (centre, half-width vector,
    normal); the strip spans centre ± half-width. Each cross-section bows a little
    outward, like folded silk.
    """
    bm = bmesh.new()
    cols = 7
    front, back = [], []
    for i in range(along + 1):
        v = i / along
        c, half, normal = shape(v)
        f_row, b_row = [], []
        for k in range(cols):
            u = -1 + 2 * k / (cols - 1)
            p = c + half * u + normal * (0.025 * (1 - u * u))  # the fold bows outward
            f_row.append(bm.verts.new(at(*(p + normal * thickness / 2))))
            b_row.append(bm.verts.new(at(*(p - normal * thickness / 2))))
        front.append(f_row)
        back.append(b_row)
    for a_, b_ in zip(range(along), range(1, along + 1)):
        for k in range(cols - 1):
            bm.faces.new((front[a_][k], front[a_][k + 1], front[b_][k + 1], front[b_][k]))
            bm.faces.new((back[a_][k], back[b_][k], back[b_][k + 1], back[a_][k + 1]))
        for k in (0, cols - 1):
            bm.faces.new((front[a_][k], front[b_][k], back[b_][k], back[a_][k]))
    for row in (0, along):
        for k in range(cols - 1):
            bm.faces.new((front[row][k], back[row][k], back[row][k + 1], front[row][k + 1]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)  # the pointed tip closes up
    return link(name, bm)


# --- Borrowed shapes ------------------------------------------------------------------
# Some props start from free models (design/blender/sources/, credits in CREDITS.md):
# the shape is theirs, rescaled and placed here; the colour is still the app's.

SOURCES = HERE / "sources"


def borrowed(file: str, objects=None, materials=None) -> list[list[Vector]]:
    """Import a model and return its triangles in app axes, keeping only some parts.

    `objects` keeps meshes by name; `materials` keeps faces by material name. The
    source is removed from the scene afterwards.
    """
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(SOURCES / file))
    new = [o for o in bpy.data.objects if o not in before]
    tris = []
    for o in new:
        if o.type != "MESH" or (objects and o.name not in objects):
            continue
        me = o.data
        me.calc_loop_triangles()
        for t in me.loop_triangles:
            mat = me.materials[t.material_index].name.split(".")[0] if me.materials else ""  # a re-import adds ".001"
            if materials and mat not in materials:
                continue
            tris.append([Vector(to_app(o.matrix_world @ me.vertices[i].co)) for i in t.vertices])
    for o in new:
        bpy.data.objects.remove(o)
    return tris


def from_tris(name: str, tris, place) -> bpy.types.Object:
    """Build a mesh from app-axes triangles, moving each point through `place`."""
    bm = bmesh.new()
    for tri in tris:
        bm.faces.new([bm.verts.new(at(*place(p))) for p in tri])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    return link(name, bm)


def axes_of(points) -> tuple[Vector, list[Vector], list[float]]:
    """Centre, principal axes (longest first) and spreads of a cloud of points."""
    import numpy as np

    arr = np.array([tuple(p) for p in points])
    centre = arr.mean(axis=0)
    vals, vecs = np.linalg.eigh(np.cov((arr - centre).T))
    order = vals.argsort()[::-1]
    return Vector(centre), [Vector(vecs[:, i]) for i in order], [float(vals[i]) for i in order]


def join(name, objs) -> bpy.types.Object:
    """Apply each part's modifiers, then merge them into one object."""
    deps = bpy.context.evaluated_depsgraph_get()
    bm = bmesh.new()
    for o in objs:
        ev = o.evaluated_get(deps)
        me = ev.to_mesh()
        me.transform(o.matrix_world)
        bm.from_mesh(me)
        ev.to_mesh_clear()
    for o in objs:
        bpy.data.objects.remove(o)
    obj = link(name, bm)
    return obj


# --- The Secretaría -------------------------------------------------------------------
# From secretaria-front.jpg: a twisted bun on the back of the head, a patterned silk
# scarf tied in a knot with two pointed tails, an old phone handset at her right ear
# (the viewer's left), and a spiral notepad with a pen held against her front.


def secretaria() -> dict[str, bpy.types.Object]:
    parts: dict[str, bpy.types.Object] = {}

    # The bun, from props-round1/bun.png (drawn from secretaria-back.jpg): a squat
    # round bun of ten puffed ribs with narrow creases, like a small pumpkin, flat
    # underneath, with a smaller twisted knot off-centre on top. It sits on the
    # crown, towards the back and her left.
    bun_c = Vector((0.26, 0.98, -0.16))
    tilt = Matrix.Rotation(-0.45, 3, "X") @ Matrix.Rotation(-0.35, 3, "Z")  # leans back and out

    def ribbed(name, centre, radius, height, ribs, twist):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=120, v_segments=36, radius=1.0)
        for v in bm.verts:
            x, y, z = v.co.x, v.co.z, -v.co.y  # app axes, y along the bun's axis
            theta = math.atan2(z, x) + twist * y
            crease = abs(math.cos(ribs / 2 * theta)) ** 0.5  # round ribs, narrow creases
            r = radius * (0.84 + 0.16 * crease) * (1 - 0.1 * y * y)
            yy = y if y > 0 else y * 0.45  # flatter underneath, where it sits on the head
            p = tilt @ Vector((x * r, yy * height, z * r))
            v.co = at(*(centre + p))
        return link(name, bm)

    bun = [
        ribbed("bun_main", bun_c, 0.26, 0.2, 10, 0.25),
        ribbed("bun_knot", bun_c + tilt @ Vector((0.06, 0.18, -0.05)), 0.11, 0.1, 6, -1.5),
    ]
    parts["bun"] = join("bun", bun)

    # The scarf, from props-round1/scarf.png: a rolled silk band round the neck
    # (round in section), dipping at the front into a wrapped knot with two
    # leaf-shaped tails that hang down and splay a little.
    neck = 0.22

    def sag(theta: float) -> float:
        return -0.07 * (0.5 + 0.5 * math.cos(theta)) ** 2  # lower at the front

    scarf_bits = [band("scarf_band", neck, body_radius, 0.075, 0.065, sag=sag)]
    kx, ky = -0.04, neck - 0.075
    kz = math.sqrt(max(0.0, body_radius(ky) ** 2 - kx**2)) + 0.045
    knot = Vector((kx, ky, kz))
    scarf_bits.append(ellipsoid("scarf_knot", knot, (0.11, 0.1, 0.085), (0, 0, 0.2)))
    # The wrap round the knot's middle, as in the picture: a ring round its
    # left-right axis.
    wrap = [knot + Vector((0, 0.1 * math.cos(a), 0.085 * math.sin(a))) for a in [2 * math.pi * k / 24 for k in range(25)]]
    scarf_bits.append(tube("scarf_wrap", wrap, [0.038] * len(wrap), 10))
    for side, spread, length in [(-1, 0.42, 0.44), (1, 0.3, 0.48)]:
        # A tail leaves the knot, flares to its widest past halfway, then narrows
        # to a point; it hangs off the body and flips a little outward.
        def centre(v, side=side, spread=spread, length=length):
            ang = -math.pi / 2 + side * spread * (0.6 + 0.4 * v)  # straight down is -pi/2
            x = kx + side * 0.03 + length * v * math.cos(ang) * 0.9
            y = ky - 0.03 + length * v * math.sin(ang)
            z = math.sqrt(max(0.0, body_radius(y) ** 2 - x**2)) + 0.05 + 0.1 * v**1.5
            down = Vector((math.cos(ang), math.sin(ang), 0))
            normal = Vector((x * 0.3, 0.2, 1)).normalized()  # mostly facing the viewer
            width = 0.025 + 0.11 * math.sin(math.pi * v**1.2)  # leaf: widest past halfway, pointed
            across = down.cross(normal).normalized() * width
            return Vector((x, y, z)), across, normal

        scarf_bits.append(ribbon(f"scarf_tail{side}", centre, 16, 0.012))
    parts["scarf"] = join("scarf", scarf_bits)

    # The phone: a real handset's shape (Office Phone, by dook), scaled and turned
    # so its cups face her head, from the ear down to the mouth.
    ear = Vector((-0.58, 0.55, 0.12))
    mouth = Vector((-0.74, 0.12, 0.22))
    tris = borrowed("office-phone.glb", objects={"Handle"})
    pts = [p for t in tris for p in t]
    c, (u, _, _), _ = axes_of(pts)
    span = max((p - c).dot(u) for p in pts) - min((p - c).dot(u) for p in pts)
    mid_pts = [p - c - u * (p - c).dot(u) for p in pts if abs((p - c).dot(u)) < 0.12 * span]
    end_pts = [p - c - u * (p - c).dot(u) for p in pts if abs((p - c).dot(u)) > 0.38 * span]
    face = (sum(end_pts, Vector()) / len(end_pts) - sum(mid_pts, Vector()) / len(mid_pts)).normalized()
    w = u.cross(face)
    reach = max((p - c).dot(face) for p in pts)
    axis = (ear - mouth).normalized()
    toward = (Vector((1, 0, 0.4)) - axis * Vector((1, 0, 0.4)).dot(axis)).normalized()  # cups to her head, turned a little to the viewer
    side_ = axis.cross(toward)
    scale = 0.72 / span
    anchor = (ear + mouth) / 2 + toward * 0.13

    def place_phone(p):
        d = p - c
        # 1.5x thicker side to side: the pictures' handset is a chunky toy.
        return anchor + (axis * d.dot(u) + toward * (d.dot(face) - reach) + side_ * d.dot(w) * 1.5) * scale

    parts["phone"] = from_tris("phone", tris, place_phone)

    # The notepad, against her front on the viewer's right, tilted to the body.
    pad_c = Vector((0.36, -0.12, 0.0))
    pad_c.z = math.sqrt(max(0.0, (body_radius(pad_c.y) - 0.02) ** 2 - pad_c.x**2)) + 0.06
    turn = math.atan2(pad_c.x, pad_c.z)
    lean = -0.15
    frame = (
        Matrix.Translation(pad_c)
        @ Matrix.Rotation(turn, 4, "Y")
        @ Matrix.Rotation(lean, 4, "Z")
        @ Matrix.Rotation(-0.12, 4, "X")
    )

    def on_pad(x, y, z):
        return frame @ Vector((x, y, z))

    # The pad itself is a real spiral notebook's shape (Green Notebook, by Ryan
    # Donaldson): its pages and covers become the white paper, its wire the spiral.
    # The source's spiral runs down a long side; turned so it runs along the top,
    # and narrowed so the pad stands taller than wide, as in the picture.
    def place_pad(p):
        # Source (app axes): pages span x 0..0.34, the spiral at x near 0, along z.
        return on_pad(-p.z * 0.74, (0.165 - p.x) * 0.95, p.y * 0.95)

    pad_paper = borrowed("green-notebook.glb", materials={"mat21", "mat10"})
    pad_wire = borrowed("green-notebook.glb", materials={"mat22"})
    parts["paper"] = from_tris("paper", pad_paper, place_pad)
    parts["spiral"] = from_tris("spiral", pad_wire, place_pad)
    pad_face = max(p.y for t in pad_paper for p in t) * 0.95 + 0.004

    lines = []
    for i, w in enumerate([0.2, 0.24, 0.16, 0.22, 0.12]):
        y = 0.09 - i * 0.065
        lines.append(tube(f"line{i}", [on_pad(-0.12, y, pad_face), on_pad(-0.12 + w, y, pad_face)], [0.007, 0.007], 6))
    parts["ink"] = join("ink", lines)

    # A ballpoint: a slim body, a cone to the tip, a clip and a rounded end.
    a, b = on_pad(0.05, -0.2, pad_face + 0.03), on_pad(0.22, 0.24, pad_face + 0.09)
    along = (b - a).normalized()
    pen = [
        tube("pen_tip", [a, a.lerp(b, 0.14)], [0.004, 0.026], 12),
        tube("pen_grip", [a.lerp(b, 0.14), a.lerp(b, 0.36)], [0.028, 0.03], 14),
        tube("pen_body", [a.lerp(b, 0.36), b], [0.03, 0.027], 14),
        ellipsoid("pen_end", b, (0.027, 0.027, 0.027)),
    ]
    clip_out = along.cross(Vector((0, 0, 1))).cross(along).normalized() * -0.04
    pen.append(tube("pen_clip", [a.lerp(b, 0.62) + clip_out, a.lerp(b, 0.95) + clip_out * 0.8], [0.009, 0.01], 8))
    parts["pen"] = join("pen", pen)
    return parts


# --- Redes ------------------------------------------------------------------------------
# From redes-front.jpg and redes-back.jpg, with each prop drawn alone in
# design/concepts/redes-props-round1/: a deep navy felt beret tilted on the head,
# a smartphone held up for a selfie in her right hand (the viewer's left), and a
# peace sign with the other.

# Kept in step with POSES.redes in GhostScene.tsx.
REDES_ARMS = [(-1, 2.35, -0.25), (1, 2.45, 0.2)]  # (side, angle, forward)


def arm_matrix(side: int, angle: float, forward: float) -> Matrix:
    return (
        Matrix.Translation(at(side * SHOULDER[0], SHOULDER[1], SHOULDER[2]))
        @ Matrix.Rotation(-forward, 4, "X")
        @ Matrix.Rotation(-side * angle, 4, "Y")
    )


def arm_point(side: int, angle: float, forward: float, x: float, y: float, z: float) -> Vector:
    """A point given in the arm's own (hanging, app-axes) frame, in the body's app axes."""
    return Vector(to_app(arm_matrix(side, angle, forward) @ at(x, y, z)))


def rounded_box(name, centre, basis: Matrix, size, round_: float, segments: int = 4) -> bpy.types.Object:
    """A box of `size` (app axes, before turning), corners rounded, turned by `basis`."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    obj = link(name, bm)
    bev = obj.modifiers.new("round", "BEVEL")
    bev.width = round_
    bev.segments = segments
    bev.limit_method = "NONE"
    obj = join(name, [obj])  # apply the bevel while still in local axes
    for v in obj.data.vertices:
        local = Vector((v.co.x, v.co.y, v.co.z))  # local box axes, used as app axes
        v.co = at(*(centre + basis @ local))
    return obj


def redes() -> dict[str, bpy.types.Object]:
    parts: dict[str, bpy.types.Object] = {}

    # The beret: a soft flat felt cap, wider than the head, tilted down towards
    # the viewer's right, with a rolled band hugging the head and a little stalk.
    band_y = 0.86
    band_r = body_radius(band_y) + 0.015
    profile = [  # (radius, height) from the top centre round to the underside
        (0.0, 0.21), (0.14, 0.208), (0.28, 0.194), (0.39, 0.168), (0.48, 0.125),
        (0.54, 0.075), (0.56, 0.02), (0.54, -0.025), (0.48, -0.05),
        (band_r + 0.04, -0.05), (band_r - 0.02, -0.02), (band_r * 0.6, 0.04), (0.0, 0.06),
    ]
    tilt = Matrix.Rotation(-0.3, 3, "Z") @ Matrix.Rotation(0.12, 3, "X")  # lowers the viewer's right
    hat_c = Vector((0.07, band_y + 0.0, 0.0))
    cap = lathe("beret_cap", profile, segments=64)
    for v in cap.data.vertices:
        v.co = at(*(hat_c + tilt @ Vector(to_app(v.co))))
    rim = [tilt @ Vector((band_r * math.sin(a), -0.05, band_r * math.cos(a))) + hat_c
           for a in [2 * math.pi * k / 48 for k in range(49)]]
    stalk = [hat_c + tilt @ Vector(p) for p in [(0.0, 0.19, 0.0), (0.01, 0.24, 0.0), (0.035, 0.28, 0.0), (0.06, 0.295, 0.0)]]
    parts["beret"] = join("beret", [
        subdivide(cap),
        tube("beret_band", rim, [0.04] * len(rim), 12),
        tube("beret_stalk", stalk, [0.028, 0.026, 0.023, 0.02], 10),
    ])

    # The smartphone, held up in the raised hand for a selfie: its back, with the
    # camera bump, faces the viewer; its screen faces her.
    side, angle, forward = REDES_ARMS[0]
    grip = arm_point(side, angle, forward, 0.0, -0.4, 0.0)
    back = Vector((-0.45, 0.0, 0.9)).normalized()  # towards the viewer, a little to the left
    up = Vector((0.08, 1.0, 0.0))
    up = (up - back * up.dot(back)).normalized()
    across = up.cross(back)
    basis = Matrix((across, up, back)).transposed()  # local x, y, z -> world
    phone_c = grip + up * 0.15 + back * 0.03
    w, h, d = 0.24, 0.48, 0.038
    parts["handset"] = rounded_box("handset", phone_c, basis, (w, h, d), 0.03)
    # The camera bump at the top corner, its three lenses, a flash and the side buttons.
    bump_c = Vector((-w / 2 + 0.065, h / 2 - 0.065, d / 2 + 0.006))
    bump = rounded_box("bump", phone_c + basis @ bump_c, basis, (0.11, 0.11, 0.014), 0.025)
    buttons = [
        rounded_box(f"button{i}", phone_c + basis @ Vector((w / 2 + 0.004, y, 0)), basis, (0.012, l, 0.012), 0.005, 2)
        for i, (y, l) in enumerate([(0.1, 0.06), (0.02, 0.05), (-0.04, 0.05)])
    ]
    parts["handset"] = join("handset", [parts["handset"], bump, *buttons])
    lenses = []
    for i, (lx, ly) in enumerate([(-0.025, 0.025), (-0.025, -0.025), (0.025, 0.0)]):
        c = phone_c + basis @ (bump_c + Vector((lx, ly, 0.008)))
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=0.021, radius2=0.017, depth=0.012)
        for v in bm.verts:
            v.co = at(*(c + basis @ Vector((v.co.x, v.co.y, v.co.z))))
        lenses.append(link(f"lens{i}", bm))
    flash = ellipsoid("flash", phone_c + basis @ (bump_c + Vector((0.027, 0.032, 0.008))), (0.008, 0.008, 0.004))
    parts["lenses"] = join("lenses", lenses + [flash])
    parts["screen"] = rounded_box("screen", phone_c + basis @ Vector((0, 0, -d / 2 - 0.001)), basis, (w - 0.02, h - 0.02, 0.003), 0.025, 3)

    # The peace sign: two fat fingers in a V from the other hand, and the curled
    # fingers as a bump below them. Built in the arm's own frame (hanging down, tip
    # at y -0.42); the app renders it inside that arm, so it follows the arm.
    fingers = []
    for sx in (-1, 1):
        a = Vector((sx * 0.045, -0.34, 0.02))
        b = Vector((sx * 0.12 + 0.2, -0.55, 0.0))  # leaning in, so they point up once the arm is raised
        fingers.append(tube(f"finger{sx}", [a, a.lerp(b, 0.5), b], [0.08, 0.075, 0.07], 16))
        fingers.append(ellipsoid(f"fingertip{sx}", b, (0.07, 0.07, 0.07)))
    fingers.append(ellipsoid("curl", Vector((0.0, -0.36, 0.09)), (0.1, 0.085, 0.07)))
    parts["peace"] = join("peace", fingers)
    return parts


# --- Export for the app ----------------------------------------------------------------


def mesh_arrays(obj: bpy.types.Object) -> dict:
    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    mesh = ev.to_mesh()
    mesh.transform(obj.matrix_world)
    mesh.calc_loop_triangles()
    position = [c for v in mesh.vertices for c in to_app(v.co)]
    normal = [c for v in mesh.vertices for c in to_app(v.normal)]
    index = [i for tri in mesh.loop_triangles for i in tri.vertices]
    ev.to_mesh_clear()
    return {"position": position, "normal": normal, "index": index}


def write(name: str, data: dict) -> None:
    data = {"note": "Generated by design/blender/ghost.py; do not edit by hand.", **data}
    (MODELS / name).write_text(json.dumps(data, separators=(",", ":")))


# --- Preview renders -----------------------------------------------------------------------


def render_previews(agent: str = "secretaria") -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "SINGLE"
    scene.display.shading.single_color = (0.55, 0.5, 0.95)
    scene.display.shading.show_cavity = False
    scene.render.resolution_x = 480  # small enough to keep in the repo
    scene.render.resolution_y = 480
    world = bpy.data.worlds.new("w")
    world.color = (0.93, 0.93, 0.95)
    scene.world = world
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.lens = 85
    out = HERE / "renders"
    out.mkdir(exist_ok=True)
    for label, angle in [("front", 0), ("three-quarter", 35), ("side", 90), ("back", 180)]:
        a = math.radians(angle)
        cam.location = (7.0 * math.sin(a), -7.0 * math.cos(a), 0.3)
        direction = Vector((0, 0, 0.15)) - cam.location
        cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(out / f"{agent}-{label}.png")
        bpy.ops.render.render(write_still=True)


# --- Main -------------------------------------------------------------------------------------

# The Secretaría's arms, as the app poses them (kept in step with POSES in
# GhostScene.tsx): the right one raised to the phone, the left one at the notepad.
SHOULDER = (0.56, -0.02, 0.08)


def posed_arm(side: int, angle: float, forward: float) -> bpy.types.Object:
    arm = lathe("arm", arm_profile(), segments=32)
    subdivide(arm)
    m = (
        Matrix.Translation(at(side * SHOULDER[0], SHOULDER[1], SHOULDER[2]))
        @ Matrix.Rotation(-forward, 4, "X")  # app rotation.x = -forward; Blender X is the same axis
        @ Matrix.Rotation(-side * angle, 4, "Y")  # app rotation.z (towards the viewer) is about Blender -Y
    )
    arm.matrix_world = m
    return arm


def main() -> None:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MODELS.mkdir(parents=True, exist_ok=True)

    body = subdivide(lathe("body", body_profile(), hem_lobes))
    arm = subdivide(lathe("arm_rest", arm_profile(), segments=32))
    write("base.json", {"body": mesh_arrays(body), "arm": mesh_arrays(arm)})
    arm.hide_render = True

    before = set(bpy.data.objects)
    parts = secretaria()
    write("secretaria.json", {name: mesh_arrays(obj) for name, obj in parts.items()})
    posed_arm(-1, 2.3, -0.45)
    posed_arm(1, 0.4, 0.35)
    secretaria_objs = set(bpy.data.objects) - before

    before = set(bpy.data.objects)
    redes_parts = redes()
    write("redes.json", {name: mesh_arrays(obj) for name, obj in redes_parts.items()})
    for side, angle, forward in REDES_ARMS:
        posed_arm(side, angle, forward)
    peace = redes_parts["peace"]
    peace.matrix_world = arm_matrix(*REDES_ARMS[1])  # previews only; exported unposed above
    redes_objs = set(bpy.data.objects) - before

    bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "ghost.blend"), check_existing=False)
    (HERE / "ghost.blend1").unlink(missing_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(HERE / "ghost.glb"), export_apply=True)
    if "--render" in args:
        for agent, show, hide in [("secretaria", secretaria_objs, redes_objs), ("redes", redes_objs, secretaria_objs)]:
            for o in show:
                o.hide_render = False
            for o in hide:
                o.hide_render = True
            render_previews(agent)
    counts = {k: len(v.data.vertices) for k, v in {**parts, **redes_parts}.items()}
    print("parts", counts)


main()
