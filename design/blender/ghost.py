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
HEM_R = 0.74  # Álvaro's narrow skirt (Z), 2026-11-14
WAIST = 0.06  # how far the body pulls in under the head, as in the pictures
WAIST_Y = 0.07
LOBES = 8


def dome_radius(y: float) -> float:
    k = max(0.0, 1 - ((y - DOME_Y) / (TOP - DOME_Y)) ** P)
    return DOME_R * k ** (1 / P)


def skirt_radius(y: float) -> float:
    """Below the head the body pulls in a little at the neck, so the head reads
    wider than the hips, then flares out to the hem."""
    f = (DOME_Y - y) / (DOME_Y - HEM_Y)
    flare = DOME_R + (HEM_R - DOME_R) * f**1.7
    w = (DOME_Y - y) / (2 * (DOME_Y - WAIST_Y))  # 0 at the head, 0.5 at the waist, 1 below it
    return flare - WAIST * math.sin(math.pi * min(1.0, w)) ** 2


def body_radius(y: float) -> float:
    """The body's radius at height y, before smoothing and lobes (for placing props)."""
    return dome_radius(y) if y >= DOME_Y else skirt_radius(y)


def body_profile() -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = [(0.0, TOP)]
    for k in range(1, 11):  # the dome, finer near the top
        t = math.pi / 2 * (1 - k / 10)
        pts.append((DOME_R * math.cos(t) ** (2 / P), DOME_Y + (TOP - DOME_Y) * math.sin(t) ** (2 / P)))
    for j in range(1, 17):
        y = DOME_Y + (HEM_Y - DOME_Y) * j / 16
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


def bent_arm(name: str, side: int, reach: float = 0.38, bend: Vector | None = None) -> bpy.types.Object:
    """An arm bent at the elbow, in the hanging arm's own frame (root up, hand at
    the same tip as the straight arm, so props held there still fit). The elbow
    bulges out and down from the body once the arm is raised.
    """
    root, hand = Vector((0.0, 0.1, 0.0)), Vector((0.0, -reach, 0.0))
    ctrl = Vector((-side * 0.4, 0.0, 0.02)) if bend is None else bend.copy()
    ctrl.y = -0.12 * reach / 0.38
    path, radii = [], []
    for k in range(17):
        t = k / 16
        path.append(root * (1 - t) ** 2 + ctrl * 2 * t * (1 - t) + hand * t * t)
        radii.append(0.15 - 0.045 * t)
    return join(name, [
        tube(name + "_tube", path, radii, 20),
        ellipsoid(name + "_root", root, (0.15, 0.15, 0.15)),
        ellipsoid(name + "_hand", hand, (0.108, 0.11, 0.108)),
    ])


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


HAND_R = 0.115  # the mitten's radius round its centre, (0, -0.32, 0) in the arm's frame


def surface_at(p: Vector) -> tuple[Vector, Vector]:
    """The body's surface point level with and nearest to p, and its outward normal
    (the body is round, so straight out from the axis, tipped by the slope)."""
    rho = math.hypot(p.x, p.z)
    out = Vector((p.x / rho, 0.0, p.z / rho))
    e = 0.005
    slope = (body_radius(p.y + e) - body_radius(p.y - e)) / (2 * e)
    return out * body_radius(p.y) + Vector((0, p.y, 0)), (out - Vector((0, slope, 0))).normalized()


def clearance(p: Vector) -> float:
    """Roughly how far p is outside the body (negative: inside it)."""
    return math.hypot(p.x, p.z) - body_radius(p.y)


def reach_for(side: int, hand: Vector) -> tuple:
    """The arm pose (side, angle, forward) and length that put the hand's centre
    at `hand`: the inverse of arm_matrix for the point (0, -reach, 0)."""
    d = hand - Vector((side * SHOULDER[0], SHOULDER[1], SHOULDER[2]))
    reach = d.length
    d.normalize()
    phi = math.atan2(d.z, d.y) if d.y > 0 else math.atan2(-d.z, -d.y)
    c = -math.copysign(math.hypot(d.y, d.z), d.y)  # cos of the swing; negative once raised
    theta = math.atan2(d.x, c)
    return (side, round(side * theta, 4), round(-phi, 4), round(reach, 4))


def into_arm(obj: bpy.types.Object, side: int, angle: float, forward: float, *_) -> bpy.types.Object:
    """Re-express a part built in the body's frame in the arm's own frame, so the
    app can carry it in that arm and it moves with the hand."""
    inv = arm_matrix(side, angle, forward).inverted()
    for v in obj.data.vertices:
        v.co = inv @ v.co
    return obj


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
        bmesh.ops.create_uvsphere(bm, u_segments=90, v_segments=28, radius=1.0)
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
    scarf_bits.append(ellipsoid("scarf_knot", knot, (0.13, 0.085, 0.085), (0, 0, 0.12)))
    # The wrap round the knot's middle, as in the picture: a ring round its
    # left-right axis.
    wrap = [knot + Vector((0, 0.09 * math.cos(a), 0.088 * math.sin(a))) for a in [2 * math.pi * k / 24 for k in range(25)]]
    scarf_bits.append(tube("scarf_wrap", wrap, [0.038] * len(wrap), 10))
    for side, spread, length in [(-1, 0.62, 0.44), (1, 0.5, 0.47)]:
        # A tail leaves the knot, flares to its widest past halfway, then narrows
        # to a point; it hangs off the body and flips a little outward.
        def centre(v, side=side, spread=spread, length=length):
            ang = -math.pi / 2 + side * spread * (0.6 + 0.4 * v)  # straight down is -pi/2
            x = kx + side * 0.06 + length * v * math.cos(ang) * 0.9
            y = ky - 0.03 + length * v * math.sin(ang)
            z = math.sqrt(max(0.0, body_radius(y) ** 2 - x**2)) + 0.05 + 0.1 * v**1.5
            down = Vector((math.cos(ang), math.sin(ang), 0))
            normal = Vector((x * 0.3, 0.2, 1)).normalized()  # mostly facing the viewer
            width = 0.025 + 0.11 * math.sin(math.pi * v**1.2)  # leaf: widest past halfway, pointed
            across = down.cross(normal).normalized() * width
            return Vector((x, y, z)), across, normal

        scarf_bits.append(ribbon(f"scarf_tail{side}", centre, 16, 0.012))
    parts["scarf"] = join("scarf", scarf_bits)

    # The phone, from props-round1/phone.png and secretaria-front.jpg: a chunky
    # C-shaped handle with a round cup at each end, each cup's face sunk inside a
    # rim and dotted with speaker holes, held up along the side of her head: the
    # ear cup level with her eyes, the mouth cup down by the scarf and forward.
    # Nothing passes through anything else. The cups sit a small gap off the head;
    # the handle bows out, and her hand closes on it from outside, below the
    # middle, clear of both cups. The arm is then posed (and made long enough) to
    # put the hand exactly there.
    gap = 0.012

    def on_head(y, az):
        """The head's surface point at height y, `az` radians round from her right
        side towards the front, and the outward normal there."""
        return surface_at(Vector((-math.cos(az), y, math.sin(az))))

    cup_profile = [(0.0, 0.035), (0.085, 0.035), (0.098, 0.05), (0.117, 0.045), (0.125, 0.022),
                   (0.122, -0.02), (0.102, -0.05), (0.055, -0.066), (0.0, -0.069)]
    ends = {"ear": on_head(0.5, 0.3), "mouth": on_head(-0.08, 0.6)}  # the mouth cup clears the scarf
    axis = (ends["ear"][0] - ends["mouth"][0]).normalized()  # mouth to ear
    pieces, holes, backs, centres = [], [], [], []
    for name, (surf, n_) in ends.items():
        toward = -n_ + Vector((0, 0, 0.35))  # faces her head, turned a little to the viewer
        toward = (toward - axis * toward.dot(axis)).normalized()
        across = axis.cross(toward)
        centre = surf + n_ * (gap + 0.035)

        def place(local, toward=toward, across=across):
            x, y, z = local
            return across * x + toward * y + axis * z

        cup = subdivide(lathe(f"phone_{name}", cup_profile, segments=40))
        local = [place(Vector(to_app(v.co))) for v in cup.data.vertices]
        while min(clearance(centre + q) for q in local) < gap:  # push it out until it clears
            centre += n_ * 0.003
        for v, q in zip(cup.data.vertices, local):
            v.co = at(*(centre + q))
        pieces.append(cup)
        centres.append(centre)
        dots = [(0.0, 0.0)] + [(0.03, 2 * math.pi * k / 6) for k in range(6)] + [(0.058, 2 * math.pi * (k + 0.5) / 10) for k in range(10)]
        for r, a in dots:
            dot = bmesh.new()
            bmesh.ops.create_icosphere(dot, subdivisions=1, radius=0.008)
            c = centre + place((r * math.cos(a), 0.036, r * math.sin(a)))
            bmesh.ops.translate(dot, verts=dot.verts, vec=at(*c))
            holes.append(link(f"hole_{name}", dot))
        backs.append(centre - toward * 0.045)
    ear_back, mouth_back = backs
    mid = (ear_back + mouth_back) / 2
    out = surface_at(mid)[1]
    ctrl = mid + out * 0.1  # the handle bows away from her head

    def handle_at(t):
        return ear_back * (1 - t) ** 2 + ctrl * 2 * t * (1 - t) + mouth_back * t * t

    handle_r = [0.05 + 0.01 * math.sin(math.pi * k / 14) for k in range(15)]
    pieces.append(tube("phone_handle", [handle_at(k / 14) for k in range(15)], handle_r, 16))
    # The hand: outside the handle, a little below its middle, closed on it: the
    # handle sinks halfway into the mitten's palm and never comes out its back.
    g = handle_at(0.56)
    hand = g + surface_at(g)[1] * HAND_R
    pose = reach_for(-1, hand)
    SEC_ARMS[0] = pose
    nearest_cup = min((c - hand).length for c in centres)
    print(f"phone hand at {tuple(round(x, 3) for x in hand)}, arm pose {pose}, hand to nearest cup centre {nearest_cup:.3f}")
    # The elbow points out and down, away from her body.
    elbow = arm_matrix(*pose[:3]).to_3x3().inverted() @ at(-1.0, -0.7, -0.2)
    elbow = Vector(to_app(elbow))
    elbow.y = 0.0
    parts["arm_phone"] = bent_arm("arm_phone", -1, pose[3], elbow.normalized() * 0.4)
    parts["phone"] = into_arm(join("phone", pieces), *pose[:3])
    parts["phone_holes"] = into_arm(join("phone_holes", holes), *pose[:3])

    # The notepad, from props-round1/notepad.png, against her front on the viewer's
    # right, tilted to the body: a thick block of white pages on an iridescent back
    # cover, six big copper rings looping over the top, ruled blue lines, and a
    # slim rose-gold pen lying across it.
    pad_c = Vector((0.4, -0.18, 0.0))  # clear of the scarf tails
    pad_c.z = math.sqrt(max(0.0, (body_radius(pad_c.y) - 0.02) ** 2 - pad_c.x**2)) + 0.085
    turn = math.atan2(pad_c.x, pad_c.z)
    frame = (
        Matrix.Translation(pad_c)
        @ Matrix.Rotation(turn, 4, "Y")
        @ Matrix.Rotation(-0.15, 4, "Z")
        @ Matrix.Rotation(-0.12, 4, "X")
    )

    def on_pad(x, y, z):
        return frame @ Vector((x, y, z))

    def block(name, w, h, d, z, bevel):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co = at(*on_pad(v.co.x * w, v.co.y * h, z + v.co.z * d))
        obj = link(name, bm)
        mod = obj.modifiers.new("round", "BEVEL")
        mod.width = bevel
        mod.segments = 3
        return obj

    parts["paper"] = join("paper", [block("pages", 0.34, 0.42, 0.05, 0.0, 0.008)])
    parts["cover"] = join("cover", [block("cover", 0.36, 0.44, 0.018, -0.033, 0.008)])
    rings = []
    for k in range(6):
        x = -0.125 + k * 0.05
        loop = [on_pad(x, 0.205 + 0.042 * math.sin(a), 0.042 * math.cos(a)) for a in [2 * math.pi * (0.04 + 0.92 * q / 20) for q in range(21)]]
        rings.append(tube(f"ring{k}", loop, [0.011] * len(loop), 8))
    parts["spiral"] = join("spiral", rings)

    face_z = 0.027
    lines = []
    for k in range(7):
        y = 0.13 - k * 0.045
        path = [on_pad(-0.13 + 0.26 * q / 6, y + 0.005 * math.sin(q * 1.7 + k), face_z) for q in range(7)]
        lines.append(tube(f"line{k}", path, [0.0045] * len(path), 6))
    parts["ink"] = join("ink", lines)

    # The pen lies on the pages, from the lower left up to the upper right.
    a, b = on_pad(-0.11, -0.17, face_z + 0.02), on_pad(0.16, 0.15, face_z + 0.02)
    along = (b - a).normalized()
    pen = [
        tube("pen_tip", [a, a.lerp(b, 0.12)], [0.003, 0.017], 12),
        tube("pen_body", [a.lerp(b, 0.12), b], [0.018, 0.017], 14),
        tube("pen_band", [a.lerp(b, 0.7), a.lerp(b, 0.74)], [0.0195, 0.0195], 14),
        ellipsoid("pen_end", b, (0.017, 0.017, 0.017)),
    ]
    up = (frame.to_3x3() @ Vector((0, 0, 1))).normalized()
    pen.append(tube("pen_clip", [a.lerp(b, 0.72) + up * 0.022, a.lerp(b, 0.97) + up * 0.02], [0.006, 0.007], 8))
    parts["pen"] = join("pen", pen)
    return parts


# --- Redes ------------------------------------------------------------------------------
# From redes-front.jpg and redes-back.jpg, with each prop drawn alone in
# design/concepts/redes-props-round1/: a deep navy felt beret tilted on the head,
# a smartphone held up for a selfie in her right hand (the viewer's left), and a
# peace sign with the other.

# Kept in step with POSES in GhostScene.tsx. The Secretaría's right arm (the
# viewer's left) is raised to the phone at her head, the left one at the notepad.
# The phone arm's pose and length are worked out from where its hand must be
# (see the phone in secretaria()); both poses go to the app in secretaria.json.
SEC_ARMS = [(-1, 2.1, -0.3, 0.38), (1, 0.4, 0.35)]  # (side, angle, forward[, reach])
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
    for name in ("handset", "lenses", "screen"):  # carried in the hand, so it moves with it
        parts[name] = into_arm(parts[name], *REDES_ARMS[0])

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
    write("secretaria.json", {"arms": [list(p[1:3]) for p in SEC_ARMS], **{name: mesh_arrays(obj) for name, obj in parts.items()}})
    posed_arm(*SEC_ARMS[1])
    for name in ("arm_phone", "phone", "phone_holes"):  # previews only; exported in the arm's frame
        parts[name].matrix_world = arm_matrix(*SEC_ARMS[0][:3])
    secretaria_objs = set(bpy.data.objects) - before

    before = set(bpy.data.objects)
    redes_parts = redes()
    # Bent arms, exported unposed like the fingers: the app turns them like any arm.
    redes_parts["arm_l"] = bent_arm("arm_l", -1)
    redes_parts["arm_r"] = bent_arm("arm_r", 1)
    write("redes.json", {"arms": [list(p[1:3]) for p in REDES_ARMS], **{name: mesh_arrays(obj) for name, obj in redes_parts.items()}})
    redes_parts["arm_l"].matrix_world = arm_matrix(*REDES_ARMS[0])
    redes_parts["arm_r"].matrix_world = arm_matrix(*REDES_ARMS[1])
    peace = redes_parts["peace"]
    peace.matrix_world = arm_matrix(*REDES_ARMS[1])  # previews only; exported unposed above
    for name in ("handset", "lenses", "screen"):
        redes_parts[name].matrix_world = arm_matrix(*REDES_ARMS[0])
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
