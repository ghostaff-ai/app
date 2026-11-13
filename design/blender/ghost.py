"""Build the base ghost in Blender, headless, and export it for the app.

    blender -b -P design/blender/ghost.py -- [--render]

Writes, next to this script:
  ghost.blend   the model, to open and edit by hand in Blender
  ghost.glb     the same, in the standard format other 3D tools read
and, for the app, apps/mobile/components/ghost/models/base.json: each part's
smoothed mesh as plain arrays (positions, normals, triangle indices), in the
app's axes (y up, z towards the viewer). With --render it also saves preview
pictures to design/blender/renders/.

The ghost is lathed from 2D profiles (a curve spun around an axis), then
smoothed by a subdivision modifier. Its colour is not in the model: the glow is
the app's own shader, so the model is shape only.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
APP_MODEL = REPO / "apps/mobile/components/ghost/models/base.json"

SEGMENTS = 48  # around the axis

# --- Profiles: (radius, height) from the top pole down to the bottom pole -----

R = 0.70  # body radius at the waist
H = 1.00  # dome height above the waist
P = 2.4  # superellipse power: above 2 the dome is squarer than a circle


def body_profile() -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = [(0.0, H)]
    for k in range(1, 9):  # the dome, finer near the top
        t = math.pi / 2 * (1 - k / 8)
        pts.append((R * math.cos(t) ** (2 / P), H * math.sin(t) ** (2 / P)))
    for j in range(1, 6):  # the skirt, flaring a little
        f = j / 5
        pts.append((R + 0.14 * f**2, -0.62 * f))
    pts += [  # a thick rounded lip, then the hollow underside
        (R + 0.19, -0.70),
        (R + 0.16, -0.79),
        (R + 0.06, -0.83),
        (R - 0.12, -0.80),
        (0.42, -0.75),
        (0.20, -0.72),
        (0.0, -0.71),
    ]
    return pts


ARM_TOP = 0.10  # the shoulder end is buried inside the body


def arm_profile() -> list[tuple[float, float]]:
    return [
        (0.0, ARM_TOP),
        (0.09, 0.07),
        (0.115, 0.0),
        (0.11, -0.10),
        (0.10, -0.22),
        (0.09, -0.32),
        (0.06, -0.38),
        (0.0, -0.40),
    ]


# --- Building ------------------------------------------------------------------


def lathe(name: str, profile: list[tuple[float, float]], shape=None) -> bpy.types.Object:
    """Spin a profile around the Z axis. Both ends must sit on the axis (r=0).

    `shape(theta, r, z)` may move each vertex; theta 0 faces the viewer (-Y).
    """
    bm = bmesh.new()
    top = bm.verts.new((0, 0, profile[0][1]))
    bottom = bm.verts.new((0, 0, profile[-1][1]))
    rings = []
    for r, z in profile[1:-1]:
        ring = []
        for s in range(SEGMENTS):
            theta = 2 * math.pi * s / SEGMENTS
            rr, zz = shape(theta, r, z) if shape else (r, z)
            ring.append(bm.verts.new((rr * math.sin(theta), -rr * math.cos(theta), zz)))
        rings.append(ring)
    for s in range(SEGMENTS):
        n = (s + 1) % SEGMENTS
        bm.faces.new((top, rings[0][n], rings[0][s]))
        for a, b in zip(rings, rings[1:]):
            bm.faces.new((a[s], a[n], b[n], b[s]))
        bm.faces.new((rings[-1][s], rings[-1][n], bottom))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)  # outward, so the app's culling and lighting agree
    bm.normal_update()
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    sub = obj.modifiers.new("smooth", "SUBSURF")
    sub.levels = 1
    sub.render_levels = 2
    return obj


def hem_lobes(theta: float, r: float, z: float) -> tuple[float, float]:
    """Six soft lobes round the hem, one facing the viewer, hanging a bit lower."""
    if z > -0.25:
        return r, z
    w = min(1.2, ((-0.25 - z) / 0.57) ** 1.5)
    c = math.cos(6 * theta)
    return r * (1 + 0.1 * c * w), z - 0.09 * (0.5 + 0.5 * c) * w


# --- The Secretaría's props ------------------------------------------------------
# Placed in the app's axes (y up, z towards the viewer) and converted, so the
# numbers read the same as in the app's code.


def at(x: float, y: float, z: float) -> tuple[float, float, float]:
    return (x, -z, y)


def smooth(obj: bpy.types.Object, levels: int = 2) -> bpy.types.Object:
    for poly in obj.data.polygons:
        poly.use_smooth = True
    sub = obj.modifiers.new("smooth", "SUBSURF")
    sub.levels = levels
    sub.render_levels = levels
    return obj


def sphere(name, center, radius, scale=(1, 1, 1)) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=radius, location=at(*center))
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (scale[0], scale[2], scale[1])
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def ring(name, y: float, radius: float, tube_out: float, tube_up: float, segments: int = 64) -> bpy.types.Object:
    """A band round the body at height y: a torus with an oval cross-section."""
    bm = bmesh.new()
    sides = 12
    rows = []
    for s_ in range(segments):
        theta = 2 * math.pi * s_ / segments
        row = []
        for k in range(sides):
            phi = 2 * math.pi * k / sides
            r = radius + tube_out * math.cos(phi)
            yy = y + tube_up * math.sin(phi)
            row.append(bm.verts.new(at(r * math.sin(theta), yy, r * math.cos(theta))))
        rows.append(row)
    for s_ in range(segments):
        a_, b_ = rows[s_], rows[(s_ + 1) % segments]
        for k in range(sides):
            n = (k + 1) % sides
            bm.faces.new((a_[k], a_[n], b_[n], b_[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return smooth(obj, 1)


def handset(name) -> bpy.types.Object:
    """An old phone handset: a curved handle with a cup at each end."""
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = 0.07
    curve.bevel_resolution = 4
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(1)
    ear, mouth = Vector(at(0.74, 0.56, 0.16)), Vector(at(0.86, 0.16, 0.2))
    bulge = Vector(at(0.14, 0, 0.06))
    for p_, co, handle in [(spline.bezier_points[0], ear, ear + bulge), (spline.bezier_points[1], mouth, mouth + bulge)]:
        p_.co = co
        p_.handle_left = co - (handle - co)
        p_.handle_right = handle
    obj = bpy.data.objects.new(name, curve)
    bpy.context.scene.collection.objects.link(obj)
    parts = [obj]
    for i, (c, toward) in enumerate([(ear, (-1, 0.1)), (mouth, (-1, -0.2))]):
        cup = sphere(f"{name}_cup{i}", (0, 0, 0), 0.14, (0.75, 1, 1))
        cup.location = c + Vector(at(-0.04, 0, 0))
        parts.append(cup)
    return join(name, parts)


def join(name, objs) -> bpy.types.Object:
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        if o.type == "CURVE":
            bpy.ops.object.convert(target="MESH")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return obj


def secretaria() -> tuple[bpy.types.Object, bpy.types.Object]:
    neck = 0.12
    neck_r = 0.705
    parts = [
        # A bun of three twisted lobes, held by a band.
        sphere("bun1", (0.0, H + 0.17, -0.06), 0.22),
        sphere("bun2", (-0.12, H + 0.08, -0.02), 0.16),
        sphere("bun3", (0.12, H + 0.09, -0.1), 0.16),
        ring("bun_band", H + 0.0, 0.2, 0.045, 0.045, 32),
        # The scarf: a soft band round the neck, a knot to one side, two tails.
        ring("scarf", neck, neck_r, 0.07, 0.11),
        sphere("knot", (0.22, neck - 0.02, 0.76), 0.13, (1.1, 0.85, 0.7)),
        sphere("tail1", (0.12, neck - 0.24, 0.76), 0.11, (0.7, 1.7, 0.4)),
        sphere("tail2", (0.32, neck - 0.21, 0.73), 0.1, (0.7, 1.6, 0.4)),
        handset("phone"),
    ]
    props = join("secretaria", parts)  # shaded smooth; dense enough without subdividing
    # The notepad, in the left arm's own frame (hanging from the shoulder).
    bpy.ops.mesh.primitive_cube_add(size=1, location=at(0.02, -0.42, 0.08))
    pad = bpy.context.active_object
    pad.name = "notepad"
    pad.scale = (0.22, 0.035, 0.28)
    pad.rotation_euler = (-1.1, 0, 0.5)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bevel = pad.modifiers.new("round", "BEVEL")
    bevel.width = 0.015
    bevel.segments = 3
    return props, pad


# --- Export for the app ----------------------------------------------------------


def to_app(v) -> list[float]:
    """Blender is Z up with the viewer at -Y; the app is Y up with the viewer at +Z."""
    return [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]


def mesh_arrays(obj: bpy.types.Object) -> dict:
    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    mesh = ev.to_mesh()
    mesh.calc_loop_triangles()
    position = [c for v in mesh.vertices for c in to_app(v.co)]
    normal = [c for v in mesh.vertices for c in to_app(v.normal)]
    index = [i for tri in mesh.loop_triangles for i in tri.vertices]
    ev.to_mesh_clear()
    return {"position": position, "normal": normal, "index": index}


# --- Preview renders ---------------------------------------------------------------


def render_previews(objs: list[bpy.types.Object]) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "SINGLE"
    scene.display.shading.single_color = (0.55, 0.5, 0.95)
    scene.display.shading.show_cavity = False
    scene.render.resolution_x = 480  # small enough to keep in the repo
    scene.render.resolution_y = 480
    scene.render.film_transparent = False
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
        dist = 7.0
        cam.location = (dist * math.sin(a), -dist * math.cos(a), 0.25)
        direction = Vector((0, 0, 0.1)) - cam.location
        cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(out / f"secretaria-{label}.png")
        bpy.ops.render.render(write_still=True)


# --- Main ----------------------------------------------------------------------------


def main() -> None:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)

    body = lathe("body", body_profile(), hem_lobes)
    arms = []
    for side, label in [(-1, "arm_left"), (1, "arm_right")]:
        arm = lathe(label, arm_profile())
        # Shoulder in Blender axes; posed out from the side, a little forward.
        arm.location = (side * 0.62, -0.08, -0.02)
        arm.rotation_euler = (math.radians(-11), side * -0.8, 0)
        arms.append(arm)

    APP_MODEL.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "note": "Generated by design/blender/ghost.py; do not edit by hand.",
        "body": mesh_arrays(body),
    }
    # The arm goes to the app unposed, hanging from its shoulder at the origin;
    # the app places and swings it.
    rest = lathe("arm_rest", arm_profile())
    data["arm"] = mesh_arrays(rest)
    bpy.data.objects.remove(rest)
    APP_MODEL.write_text(json.dumps(data, separators=(",", ":")))

    props, pad = secretaria()
    sec = {
        "note": "Generated by design/blender/ghost.py; do not edit by hand.",
        "props": mesh_arrays(props),  # in the body's frame
        "notepad": mesh_arrays(pad),  # in the left arm's frame
    }
    (APP_MODEL.parent / "secretaria.json").write_text(json.dumps(sec, separators=(",", ":")))
    pad.hide_render = True  # it belongs to the arm; the previews show the body only

    bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "ghost.blend"), check_existing=False)
    (HERE / "ghost.blend1").unlink(missing_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(HERE / "ghost.glb"), export_apply=True)

    if "--render" in args:
        render_previews([body, *arms])

    print("verts body", len(data["body"]["position"]) // 3, "arm", len(data["arm"]["position"]) // 3)


main()
