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

    # The bun: a twisted knot of three rolls round a core, back and to the side.
    bun_c = Vector((0.3, 0.9, -0.12))
    # A core, then three thick coils wound round it at different tilts, like hair
    # twisted into a knot.
    rolls = [ellipsoid("bun_core", bun_c + Vector((0, 0.14, 0)), (0.19, 0.18, 0.19))]
    for i, (tilt, lift, r) in enumerate([(0.0, 0.06, 0.2), (0.5, 0.15, 0.16), (-0.6, 0.24, 0.11)]):
        loop = []
        for k in range(29):
            a = 2 * math.pi * k / 28 * 0.93
            p = Vector((r * math.cos(a), 0.035 * math.sin(a), r * math.sin(a)))
            p = Matrix.Rotation(tilt, 3, "X") @ p
            loop.append(bun_c + Vector((0, lift, 0)) + p)
        thick = [0.075 * (0.55 + 0.45 * math.sin(math.pi * k / 28)) + 0.02 for k in range(29)]
        rolls.append(tube(f"bun_coil{i}", loop, thick, 12))
    parts["bun"] = join("bun", rolls)

    # The scarf: a band at the neck dipping a little at the front, a knot, two tails.
    neck = 0.22

    def sag(theta: float) -> float:
        return -0.06 * (0.5 + 0.5 * math.cos(theta))  # lower at the front

    scarf_bits = [band("scarf_band", neck, body_radius, 0.045, 0.1, sag=sag)]
    kx, ky = -0.05, neck - 0.08
    kz = math.sqrt(max(0.0, body_radius(ky) ** 2 - kx**2)) + 0.07
    scarf_bits.append(ellipsoid("scarf_knot", (kx, ky, kz), (0.12, 0.1, 0.085), (0, 0, 0.3)))
    for side, tilt in [(-1, 0.55), (1, -0.5)]:
        # A pointed tail: wide at the knot, tapering to a point, curling outward.
        outline = [(-0.11, 0.0), (0.11, 0.0), (0.09, -0.26), (0.02, -0.46), (-0.08, -0.3)]

        def bend(x, y, side=side, tilt=tilt):
            ca, sa = math.cos(tilt), math.sin(tilt)
            px, py = x * ca - y * sa, x * sa + y * ca
            gx, gy = kx + side * 0.08 + px, ky - 0.06 + py
            gz = math.sqrt(max(0.0, body_radius(gy) ** 2 - gx**2)) + 0.06 + 0.12 * (-y) ** 1.5
            return (gx, gy, gz)

        scarf_bits.append(sheet(f"scarf_tail{side}", outline, 0.025, bend))
    parts["scarf"] = join("scarf", [subdivide(o, 1) if o.name.startswith("scarf_tail") else o for o in scarf_bits])

    # The phone: a curved handle with a round cup at each end, facing her head.
    ear = Vector((-0.58, 0.55, 0.12))
    mouth = Vector((-0.74, 0.12, 0.22))
    handle = []
    for i in range(13):
        t = i / 12
        p = ear.lerp(mouth, t) + Vector((-0.12 * math.sin(math.pi * t), 0, 0.03 * math.sin(math.pi * t)))
        handle.append(p)
    pieces = [tube("phone_handle", handle, [0.06] * len(handle))]
    for name, c in [("phone_ear", ear), ("phone_mouth", mouth)]:
        pieces.append(ellipsoid(name, c + Vector((0.02, 0, 0)), (0.07, 0.13, 0.13)))
        pieces.append(ellipsoid(name + "_face", c + Vector((0.08, 0, 0)), (0.02, 0.105, 0.105)))
    parts["phone"] = join("phone", pieces)

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

    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = at(*on_pad(v.co.x * 0.36, v.co.y * 0.46, v.co.z * 0.05))
    paper = link("notepad_paper", bm)
    bevel = paper.modifiers.new("round", "BEVEL")
    bevel.width = 0.012
    bevel.segments = 2
    lines = []
    for i, w in enumerate([0.2, 0.24, 0.16, 0.22, 0.12]):
        y = 0.11 - i * 0.07
        lines.append(tube(f"line{i}", [on_pad(-0.13, y, 0.027), on_pad(-0.13 + w, y, 0.027)], [0.008, 0.008], 6))
    parts["paper"] = join("paper", [paper])
    rings = []
    for i in range(6):
        x = -0.14 + i * 0.056
        loop = [on_pad(x, 0.23 + 0.045 * math.sin(a), 0.045 * math.cos(a)) for a in [math.pi * k / 8 for k in range(-6, 7)]]
        rings.append(tube(f"ring{i}", loop, [0.011] * len(loop), 6))
    parts["spiral"] = join("spiral", rings)
    parts["ink"] = join("ink", lines)
    pen = [on_pad(0.04, -0.24, 0.06), on_pad(0.24, 0.26, 0.12)]
    body_pen = tube("pen_body", [pen[0].lerp(pen[1], 0.12), pen[1]], [0.03, 0.03], 12)
    tip = tube("pen_tip", [pen[0], pen[0].lerp(pen[1], 0.12)], [0.003, 0.028], 12)
    parts["pen"] = join("pen", [body_pen, tip])
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


def render_previews() -> None:
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
        scene.render.filepath = str(out / f"secretaria-{label}.png")
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

    parts = secretaria()
    write("secretaria.json", {name: mesh_arrays(obj) for name, obj in parts.items()})
    posed_arm(-1, 2.3, -0.45)
    posed_arm(1, 0.4, 0.35)

    bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "ghost.blend"), check_existing=False)
    (HERE / "ghost.blend1").unlink(missing_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(HERE / "ghost.glb"), export_apply=True)
    if "--render" in args:
        render_previews()
    counts = {k: len(v.data.vertices) for k, v in parts.items()}
    print("parts", counts)


main()
