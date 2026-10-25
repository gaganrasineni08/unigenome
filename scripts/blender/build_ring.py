"""Builds the home page's 3D centrepiece in Blender and exports it to public/models/ring.glb.

A neon ring road at night: four checkpoints on the outside (factory, warehouse, retailer, buyer),
a scanner arch across the road at each one, the regulator's tower in the centre, a skyline around
it all, and the cargo hauler (exported at the origin; the page drives it around the ring).

Run with Blender:   blender -b -P scripts/blender/build_ring.py
or the bpy module:  python scripts/blender/build_ring.py

Blender is Z-up; the glTF exporter turns that into three.js's Y-up, so a Blender point (x, y, z)
lands at (x, z, -y) on the page. The ring sits in Blender's XY plane, centred on the origin.
"""
import math
import os
import random

import bpy  # noqa: I001  (bpy first: as a pip module it is what makes bmesh importable)
import bmesh
from mathutils import Matrix

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public", "models", "ring.glb")

R_ROAD = 32.0  # centre line of the road
ROAD_W = 9.0
R_CHECK = 48.0  # where the checkpoint buildings stand
NEON_SCALE = 0.45  # one knob for the brightness of every neon part
# Checkpoint angles in degrees; the hauler drives anticlockwise, so it meets them in this order.
CHECKPOINTS = {"factory": 210, "warehouse": 300, "retailer": 30, "buyer": 120}

COL = {
    "mint": (0.008, 0.765, 0.604),
    "sea": (0.31, 0.765, 0.97),
    "amber": (0.91, 0.64, 0.24),
    "violet": (0.56, 0.49, 0.77),
    "coral": (0.85, 0.42, 0.42),
    "white": (1.0, 1.0, 1.0),
    "warm": (1.0, 0.82, 0.55),
}

random.seed(7)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ------------------------------------------------------------------ materials

_mats = {}


def mat(name, color=(0.1, 0.1, 0.1), rough=0.6, metal=0.0, emit=None, strength=0.0, alpha=1.0):
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    if emit is not None:
        p.inputs["Emission Color"].default_value = (*emit, 1)
        p.inputs["Emission Strength"].default_value = strength
    if alpha < 1:
        p.inputs["Alpha"].default_value = alpha
        m.blend_method = "BLEND"
    _mats[name] = m
    return m


def neon(name, c, s=6.0):
    # Strengths are tuned for the page's bloom: about 1 glows softly, 3 and up blooms hard.
    return mat("neon_" + name, color=c, rough=0.3, emit=c, strength=s * NEON_SCALE)


HULL = mat("hull", (0.05, 0.06, 0.08), rough=0.35, metal=0.85)
HULL_LIGHT = mat("hull_light", (0.55, 0.6, 0.66), rough=0.3, metal=0.9)
CONCRETE = mat("concrete", (0.09, 0.1, 0.12), rough=0.85)
ASPHALT = mat("asphalt", (0.025, 0.028, 0.035), rough=0.55, metal=0.2)
GLASS = mat("glass_dark", (0.02, 0.05, 0.08), rough=0.05, metal=0.6)
RUBBER = mat("rubber", (0.02, 0.02, 0.02), rough=0.9)
CARDBOARD = mat("cardboard", (0.72, 0.38, 0.14), rough=0.75)

# ------------------------------------------------------------------ mesh helpers


def link(obj, parent=None):
    scene.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def empty(name, loc=(0, 0, 0), rot_z=0.0, parent=None):
    e = bpy.data.objects.new(name, None)
    e.location = loc
    e.rotation_euler = (0, 0, rot_z)
    return link(e, parent)


def from_bmesh(name, bm, material, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), smooth=False):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    if smooth:
        for poly in me.polygons:
            poly.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    ob.rotation_euler = rot
    return link(ob, parent)


def box(name, size, loc, material, parent=None, rot=(0, 0, 0), bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=min(bevel, min(size) / 2.2), segments=2, affect="EDGES")
    return from_bmesh(name, bm, material, parent, loc, rot)


def cyl(name, r, h, loc, material, parent=None, rot=(0, 0, 0), seg=32, r2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    return from_bmesh(name, bm, material, parent, loc, rot, smooth=True)


def torus(name, R, r, loc, material, parent=None, rot=(0, 0, 0), seg=96, rseg=12):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=seg, minor_segments=rseg, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.append(material)
    for poly in ob.data.polygons:
        poly.use_smooth = True
    if parent is not None:
        ob.parent = parent
    return ob


def annulus(name, r_in, r_out, z, material, parent=None, seg=192, thick=0.0):
    """A flat ring (optionally with thickness), UV u around the ring, v across it."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    ring_in, ring_out = [], []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        ring_in.append(bm.verts.new((r_in * math.cos(a), r_in * math.sin(a), z)))
        ring_out.append(bm.verts.new((r_out * math.cos(a), r_out * math.sin(a), z)))
    for i in range(seg):
        j = (i + 1) % seg
        f = bm.faces.new((ring_in[i], ring_out[i], ring_out[j], ring_in[j]))
        u0, u1 = i / seg * 40, (i + 1) / seg * 40
        for loop, (u, v) in zip(f.loops, ((u0, 0), (u0, 1), (u1, 1), (u1, 0))):
            loop[uv].uv = (u, v)
    if thick > 0:
        geom = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
        verts = [g for g in geom["geom"] if isinstance(g, bmesh.types.BMVert)]
        bmesh.ops.translate(bm, vec=(0, 0, -thick), verts=verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return from_bmesh(name, bm, material, parent)


def polar(r, deg, z=0.0):
    a = math.radians(deg)
    return (r * math.cos(a), r * math.sin(a), z)


def join(name, objs):
    objs = [o for o in objs if o is not None]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = name
    return objs[0]


# ------------------------------------------------------------------ the ring road


def build_road():
    parts = []
    parts.append(annulus("road_surface", R_ROAD - ROAD_W / 2, R_ROAD + ROAD_W / 2, 0.12, ASPHALT, thick=0.4))
    # neon edges: mint inside, cyan outside
    parts.append(torus("road_edge_in", R_ROAD - ROAD_W / 2 - 0.15, 0.14, (0, 0, 0.3), neon("mint", COL["mint"], 8), seg=192, rseg=8))
    parts.append(torus("road_edge_out", R_ROAD + ROAD_W / 2 + 0.15, 0.14, (0, 0, 0.3), neon("sea", COL["sea"], 8), seg=192, rseg=8))
    # dashed centre line
    dash_mat = neon("dash", COL["white"], 2.5)
    for i in range(72):
        deg = i * 5
        a = math.radians(deg)
        parts.append(box(f"dash{i}", (0.22, 1.6, 0.04), polar(R_ROAD, deg, 0.34), dash_mat, rot=(0, 0, a)))
    # curbs
    parts.append(annulus("curb_in", R_ROAD - ROAD_W / 2 - 0.6, R_ROAD - ROAD_W / 2 - 0.3, 0.45, HULL_LIGHT, thick=0.45))
    parts.append(annulus("curb_out", R_ROAD + ROAD_W / 2 + 0.3, R_ROAD + ROAD_W / 2 + 0.6, 0.45, HULL_LIGHT, thick=0.45))
    road = join("Road", parts)
    # the inner plaza: dark disc with concentric light rings and spokes to each checkpoint (the graph)
    plaza = [annulus("plaza", 0.0001, R_ROAD - ROAD_W / 2 - 0.7, 0.05, CONCRETE, seg=128)]
    for r, c in ((9, "coral"), (16, "mint"), (22, "sea")):
        plaza.append(torus(f"plaza_ring{r}", r, 0.07, (0, 0, 0.1), neon(c + "_soft", COL[c], 3), seg=128, rseg=6))
    join("Plaza", plaza)
    return road


def build_arch(key, deg, color):
    """A scanner gantry across the road. Its local X runs across the road, so the hauler drives along local Y."""
    g = empty(f"Arch_{key}", polar(R_ROAD, deg), math.radians(deg))
    span = ROAD_W / 2 + 1.4
    parts = [
        box(f"arch_{key}_l", (0.9, 1.1, 8.5), (-span, 0, 4.25), HULL, bevel=0.15),
        box(f"arch_{key}_r", (0.9, 1.1, 8.5), (span, 0, 4.25), HULL, bevel=0.15),
        box(f"arch_{key}_top", (2 * span + 0.9, 1.4, 1.2), (0, 0, 8.6), HULL, bevel=0.2),
        # neon outline on both faces
        box(f"arch_{key}_glow_a", (2 * span - 0.9, 0.12, 0.18), (0, -0.75, 7.9), neon(key, color, 10)),
        box(f"arch_{key}_glow_b", (2 * span - 0.9, 0.12, 0.18), (0, 0.75, 7.9), neon(key, color, 10)),
        box(f"arch_{key}_glow_l", (0.14, 0.12, 7.4), (-span + 0.55, -0.6, 4.0), neon(key, color, 10)),
        box(f"arch_{key}_glow_r", (0.14, 0.12, 7.4), (span - 0.55, -0.6, 4.0), neon(key, color, 10)),
        # the scanner head that fires the beam
        box(f"arch_{key}_head", (2.2, 0.9, 0.5), (0, 0, 7.8), HULL_LIGHT, bevel=0.1),
        box(f"arch_{key}_lens", (1.8, 0.6, 0.08), (0, 0, 7.52), neon(key + "_lens", COL["white"], 12)),
    ]
    j = join(f"Arch_{key}_mesh", parts)
    j.parent = g
    return g


# ------------------------------------------------------------------ checkpoints
# Each is built around its own origin with the front facing local -X (towards the ring's centre).


def windows_row(prefix, x, y0, y1, z, n, size, material, out):
    for i in range(n):
        y = y0 + (y1 - y0) * (i + 0.5) / n
        out.append(box(f"{prefix}{i}", (0.08, size[0], size[1]), (x, y, z), material))


def build_factory(g):
    c = COL["mint"]
    p = []
    p.append(box("f_base", (16, 22, 0.6), (0, 0, 0.3), CONCRETE))
    p.append(box("f_hall", (12, 18, 7), (1, 0, 4.1), HULL, bevel=0.25))
    # saw-tooth roof
    for i in range(5):
        y = -7.2 + i * 3.6
        bm = bmesh.new()
        v = [bm.verts.new(q) for q in ((-6, y - 1.8, 0), (6, y - 1.8, 0), (6, y + 1.8, 0), (-6, y + 1.8, 0), (-6, y + 1.8, 2.6), (6, y + 1.8, 2.6))]
        for f in ((0, 1, 2, 3), (3, 2, 5, 4), (0, 4, 5, 1), (0, 3, 4), (1, 5, 2)):
            bm.faces.new([v[k] for k in f])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        p.append(from_bmesh(f"f_saw{i}", bm, HULL_LIGHT, loc=(1, 0, 7.6)))
        p.append(box(f"f_sawglow{i}", (11.6, 0.1, 2.3), (1, y + 1.75, 8.9), neon("warm", COL["warm"], 2.2)))
    windows_row("f_win", -5.05, -8, 8, 4.2, 6, (2.0, 2.6), neon("warm", COL["warm"], 2.2), p)
    p.append(box("f_band", (0.1, 18.2, 0.35), (-5.1, 0, 6.6), neon("mint", c, 8)))
    # chimneys with glowing rings
    for k, (y, h) in enumerate(((5.5, 20), (8.2, 16))):
        p.append(cyl(f"f_stack{k}", 1.0, h, (4.5, y, h / 2 + 0.6), HULL_LIGHT, r2=0.8))
        for z in (h * 0.55, h * 0.8, h - 0.4):
            p.append(torus(f"f_stack{k}_ring{z:.0f}", 1.0 - 0.18 * z / h, 0.12, (4.5, y, z + 0.6), neon("mint", c, 8), seg=32, rseg=6))
    # loading bay conveyor towards the road with cartons
    p.append(box("f_belt", (8, 2.2, 0.5), (-9, -3, 1.4), HULL, bevel=0.1))
    p.append(box("f_belt_glow", (8, 0.12, 0.12), (-9, -1.85, 1.45), neon("mint", c, 8)))
    for i in range(3):
        p.append(box(f"f_box{i}", (1.3, 1.3, 1.1), (-6.5 - i * 2.4, -3, 2.2), CARDBOARD, bevel=0.06))
    join("Factory_mesh", p).parent = g


def build_warehouse(g):
    c = COL["sea"]
    p = []
    p.append(box("w_base", (18, 26, 0.6), (0, 0, 0.3), CONCRETE))
    p.append(box("w_walls", (13, 22, 5), (1.5, 0, 3.1), HULL, bevel=0.2))
    # half-cylinder roof along local Y
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=48, radius1=6.5, radius2=6.5, depth=22)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, 0), plane_no=(1, 0, 0), clear_inner=True)
    bmesh.ops.contextual_create(bm, geom=[e for e in bm.edges if e.is_boundary])
    p.append(from_bmesh("w_roof", bm, HULL_LIGHT, loc=(1.5, 0, 5.6), rot=(0, math.radians(-90), math.radians(90)), smooth=True))
    # roof light strips following the arc
    for y in (-10.9, 10.9):
        p.append(torus(f"w_arc{y:.0f}", 6.55, 0.1, (1.5, y, 5.6), neon("sea", c, 8), rot=(math.radians(90), 0, 0), seg=64, rseg=6))
    # three glowing dock doors
    for i, y in enumerate((-6.5, 0, 6.5)):
        p.append(box(f"w_door{i}", (0.1, 4.2, 3.6), (-5.05, y, 2.4), neon("sea_door", (0.15, 0.45, 0.6), 3)))
        p.append(box(f"w_doorframe{i}", (0.3, 4.8, 0.3), (-5.1, y, 4.4), neon("sea", c, 8)))
    # shipping containers
    cols = [(0.75, 0.2, 0.18), (0.1, 0.35, 0.6), (0.85, 0.6, 0.15), (0.2, 0.55, 0.45)]
    for i in range(6):
        x = -2 + (i % 2) * 3.0
        z = 1.95 + (i // 4) * 2.7
        y = 13.5 + (i % 3)
        col = cols[i % 4]
        p.append(box(f"w_cont{i}", (2.6, 6.2, 2.6), (x + 3, 15.2 if i < 4 else 15.2, z if i < 4 else 4.65), mat(f"container{i % 4}", col, rough=0.5, metal=0.5), bevel=0.05))
    join("Warehouse_mesh", p).parent = g


def build_retailer(g):
    c = COL["amber"]
    p = []
    p.append(box("r_base", (14, 18, 0.6), (0, 0, 0.3), CONCRETE))
    p.append(box("r_body", (9, 14, 6), (1, 0, 3.6), HULL, bevel=0.25))
    p.append(box("r_glass", (0.1, 12, 3.6), (-3.55, 0, 2.6), neon("shopglass", (1.0, 0.75, 0.45), 2.2)))
    # striped awning
    for i in range(8):
        y = -6 + 12 * (i + 0.5) / 8
        m = neon("amber", c, 5) if i % 2 == 0 else mat("awning_white", (0.9, 0.88, 0.84), rough=0.6)
        p.append(box(f"r_awn{i}", (2.4, 1.5, 0.15), (-4.5, y, 4.9), m, rot=(0, math.radians(-18), 0)))
    # rooftop sign frame and a floating price-tag shape
    p.append(box("r_sign", (0.6, 10, 2.6), (1, 0, 8.2), HULL_LIGHT, bevel=0.1))
    p.append(box("r_sign_glow", (0.12, 9, 1.8), (0.65, 0, 8.2), neon("amber", c, 9)))
    p.append(box("r_sign_glow2", (0.12, 9, 1.8), (1.35, 0, 8.2), neon("amber", c, 9)))
    # shelves visible inside
    for i in range(3):
        p.append(box(f"r_shelf{i}", (0.6, 10.5, 0.12), (-2.8, 0, 1.4 + i * 1.0), neon("warm", COL["warm"], 2.2)))
    join("Retailer_mesh", p).parent = g
    # the spinning logo cube above the shop (animated on the page)
    cube = box("Retailer_spin", (2.2, 2.2, 2.2), (1, 0, 12.2), neon("amber_cube", c, 4), parent=g, bevel=0.25)
    cube.rotation_euler = (math.radians(35), math.radians(45), 0)


def build_buyer(g):
    c = COL["violet"]
    p = []
    p.append(cyl("b_plinth", 7.5, 1.2, (0, 0, 0.6), CONCRETE, seg=64))
    p.append(torus("b_plinth_ring", 7.5, 0.14, (0, 0, 1.2), neon("violet", c, 8), seg=96, rseg=8))
    join("Buyer_base", p).parent = g
    # the giant phone, screen facing the ring (local -X)
    phone = empty("Buyer_phone", (0, 0, 1.2), 0, g)
    q = []
    q.append(box("b_body", (1.0, 7.4, 14.5), (0, 0, 7.6), HULL, bevel=0.9))
    q.append(box("b_bezel", (0.1, 6.6, 13.4), (-0.52, 0, 7.6), mat("screen_black", (0.0, 0.0, 0.0), rough=0.1, metal=0.2)))
    q.append(box("b_cam", (0.12, 1.4, 0.3), (-0.53, 0, 13.8), HULL_LIGHT))
    q.append(box("b_edge", (1.06, 0.1, 13.2), (0, 3.68, 7.6), neon("violet", c, 6)))
    q.append(box("b_edge2", (1.06, 0.1, 13.2), (0, -3.68, 7.6), neon("violet", c, 6)))
    join("Buyer_phone_mesh", q).parent = phone
    # the screen: a plane the page paints with a live QR and verdict (UVs cover it once)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    v = [bm.verts.new(xyz) for xyz in ((-0.58, 3.1, 1.5), (-0.58, -3.1, 1.5), (-0.58, -3.1, 13.4), (-0.58, 3.1, 13.4))]
    f = bm.faces.new(v)
    for loop, uvc in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uv].uv = uvc
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    from_bmesh("PhoneScreen", bm, mat("phone_screen", (0.05, 0.05, 0.08), emit=(1, 1, 1), strength=1.0), parent=phone)


def build_regulator():
    c = COL["coral"]
    g = empty("Regulator", (0, 0, 0))
    p = []
    p.append(cyl("t_base", 6, 1.2, (0, 0, 0.6), CONCRETE, seg=64, r2=5.2))
    p.append(cyl("t_shaft", 2.2, 30, (0, 0, 16), HULL, seg=48, r2=1.3))
    for z in (6, 12, 18, 24):
        p.append(torus(f"t_band{z}", 2.25 - 0.9 * z / 30 + 0.05, 0.1, (0, 0, z), neon("coral", c, 8), seg=48, rseg=6))
    p.append(cyl("t_deck", 4.2, 1.0, (0, 0, 28), HULL_LIGHT, seg=48, r2=3.4))
    p.append(cyl("t_deck_glass", 3.3, 2.2, (0, 0, 29.6), neon("coral_glass", (1.0, 0.55, 0.5), 2.5), seg=48, r2=3.0))
    p.append(cyl("t_cap", 3.4, 0.6, (0, 0, 31), HULL_LIGHT, seg=48, r2=2.2))
    p.append(cyl("t_spire", 0.35, 9, (0, 0, 35.8), HULL_LIGHT, seg=16, r2=0.05))
    join("Regulator_mesh", p).parent = g
    beacon = cyl("Regulator_beacon", 0.55, 0.9, (0, 0, 40.5), neon("beacon", (1.0, 0.25, 0.2), 25), parent=g, seg=16)
    # two halo rings the page spins around the tower
    torus("Halo_a", 7.5, 0.16, (0, 0, 26), neon("coral", c, 8), parent=g, seg=128, rseg=8)
    torus("Halo_b", 10, 0.1, (0, 0, 22), neon("coral_soft", c, 4), parent=g, seg=128, rseg=6)
    return g


# ------------------------------------------------------------------ skyline


def window_image():
    size, cells = 256, 8
    img = bpy.data.images.new("windows", size, size, alpha=False)
    px = [0.0] * (size * size * 4)
    cs = size // cells
    for cy in range(cells):
        for cx in range(cells):
            r = random.random()
            if cx == 0 and cy == 0 or r < 0.45:
                col = (0.0, 0.0, 0.0)
            elif r < 0.8:
                col = (1.0, 0.78, 0.5)
            elif r < 0.93:
                col = (0.45, 0.85, 1.0)
            else:
                col = (0.3, 1.0, 0.8)
            for y in range(cy * cs + 6, cy * cs + cs - 6):
                for x in range(cx * cs + 8, cx * cs + cs - 8):
                    i = (y * size + x) * 4
                    px[i : i + 4] = (*col, 1.0)
    for i in range(3, len(px), 4):
        px[i] = 1.0
    img.pixels = px
    img.pack()
    return img


def skyline_material():
    m = bpy.data.materials.new("skyline")
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = window_image()
    tex.interpolation = "Closest"
    p.inputs["Base Color"].default_value = (0.03, 0.035, 0.05, 1)
    p.inputs["Roughness"].default_value = 0.4
    p.inputs["Metallic"].default_value = 0.6
    nt.links.new(tex.outputs["Color"], p.inputs["Emission Color"])
    p.inputs["Emission Strength"].default_value = 1.3
    return m


def build_skyline():
    m = skyline_material()
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    n = 0
    tries = 0
    while n < 220 and tries < 3000:
        tries += 1
        r = random.uniform(100, 215)
        deg = random.uniform(0, 360)
        w = random.uniform(5, 11)
        d = random.uniform(5, 11)
        h = random.uniform(10, 30) * (1.0 + (r - 100) / 110)
        if random.random() < 0.08:
            h *= 1.8
        cx, cy, _ = polar(r, deg)
        geom = bmesh.ops.create_cube(bm, size=1.0)
        verts = geom["verts"]
        bmesh.ops.scale(bm, vec=(w, d, h), verts=verts)
        bmesh.ops.rotate(bm, verts=verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(random.uniform(0, 90)), 3, "Z"))
        bmesh.ops.translate(bm, vec=(cx, cy, h / 2), verts=verts)
        n += 1
    bm.faces.ensure_lookup_table()
    off = {}
    for f in bm.faces:
        nrm = f.normal
        key = f.index // 6
        if key not in off:
            off[key] = (random.randint(0, 7) / 8, random.randint(0, 7) / 8)
        ou, ov = off[key]
        for loop in f.loops:
            co = loop.vert.co
            if abs(nrm.z) > 0.5:
                loop[uv].uv = (0.01, 0.01)  # roof: the dark cell
            else:
                along = co.x * -nrm.y + co.y * nrm.x
                loop[uv].uv = (along / 24 + ou, co.z / 22 + ov)
    from_bmesh("Skyline", bm, m)
    # a few antenna lights on the tallest towers are done on the page as twinkles


# ------------------------------------------------------------------ the hauler (local +X is forward)


def build_hauler():
    g = empty("Hauler", (0, 0, 0))
    cyan = neon("hauler_under", COL["sea"], 14)
    mint = neon("mint", COL["mint"], 8)
    p = []
    # chassis
    p.append(box("h_chassis", (11.6, 2.2, 0.5), (-0.6, 0, 1.0), HULL, bevel=0.1))
    # cab: a low wedge with a raked windscreen
    bm = bmesh.new()
    prof = [(-1.6, 0.0), (1.4, 0.0), (2.0, 0.6), (1.8, 1.3), (0.4, 2.5), (-1.6, 2.6)]
    vs_l = [bm.verts.new((x, -1.3, z)) for x, z in prof]
    vs_r = [bm.verts.new((x, 1.3, z)) for x, z in prof]
    bm.faces.new(vs_l)
    bm.faces.new(list(reversed(vs_r)))
    for i in range(len(prof)):
        j = (i + 1) % len(prof)
        bm.faces.new((vs_l[i], vs_l[j], vs_r[j], vs_r[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.bevel(bm, geom=bm.edges[:], offset=0.08, segments=2, affect="EDGES")
    p.append(from_bmesh("h_cab", bm, HULL_LIGHT, loc=(3.6, 0, 1.25)))
    # windscreen and side windows
    a = math.atan2(1.2, 1.4)
    p.append(box("h_wind", (0.06, 2.3, 1.75), (4.72, 0, 3.15), GLASS, rot=(0, -a + math.radians(0), 0)))
    p.append(box("h_wind_glow", (0.04, 2.0, 0.08), (5.3, 0, 2.55), neon("white", COL["white"], 6)))
    for s in (-1, 1):
        p.append(box(f"h_side{s}", (1.6, 0.05, 0.9), (3.0, s * 1.33, 3.2), GLASS))
    # headlights: a light bar across the nose
    p.append(box("h_lightbar", (0.1, 2.2, 0.16), (5.62, 0, 1.95), neon("head", COL["white"], 30)))
    p.append(box("h_lightbar2", (0.1, 1.2, 0.1), (5.45, 0, 2.6), neon("mint", COL["mint"], 12)))
    # tail lights
    p.append(box("h_tail", (0.1, 2.2, 0.14), (-6.45, 0, 1.4), neon("tail", (1.0, 0.1, 0.12), 18)))
    # flatbed trailer with side rails
    p.append(box("h_bed", (8.6, 2.6, 0.35), (-2.1, 0, 1.45), HULL, bevel=0.08))
    for s in (-1, 1):
        p.append(box(f"h_rail{s}", (8.6, 0.12, 0.12), (-2.1, s * 1.3, 1.7), mint))
        p.append(box(f"h_under{s}", (10.5, 0.08, 0.08), (-0.6, s * 1.05, 0.68), cyan))
    # wheels
    for x in (4.2, 2.6, -3.4, -4.8, -6.0):
        for s in (-1, 1):
            p.append(cyl(f"h_wheel{x}{s}", 0.62, 0.45, (x if x > -6 else -5.9, s * 1.2, 0.62), RUBBER, rot=(math.radians(90), 0, 0), seg=20))
            p.append(cyl(f"h_hub{x}{s}", 0.3, 0.47, (x if x > -6 else -5.9, s * 1.2, 0.62), neon("hub", COL["sea"], 5), rot=(math.radians(90), 0, 0), seg=12))
    join("Hauler_mesh", p).parent = g
    # cargo: a stack of cartons and one big master carton with its QR on both sides
    cargo = []
    for i, (x, y, z) in enumerate(((-5.1, -0.6, 2.2), (-5.1, 0.6, 2.2), (-3.9, -0.6, 2.2), (-3.9, 0.6, 2.2), (-4.5, 0, 3.3))):
        cargo.append(box(f"h_c{i}", (1.1, 1.1, 1.05), (x, y, z), CARDBOARD, bevel=0.05))
    cargo.append(box("h_master", (3.2, 2.3, 2.2), (-0.6, 0, 2.75), CARDBOARD, bevel=0.08))
    cargo.append(box("h_tape", (3.24, 0.4, 2.24), (-0.6, 0, 2.75), mat("tape", (0.75, 0.6, 0.35), rough=0.3)))
    join("Hauler_cargo", cargo).parent = g
    for s, nm in ((-1, "CartonQR_a"), (1, "CartonQR_b")):
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.new()
        y = s * 1.17
        pts = ((-1.55, y, 1.85), (0.35, y, 1.85), (0.35, y, 3.75), (-1.55, y, 3.75))
        if s > 0:
            pts = tuple(reversed(pts))
        v = [bm.verts.new(q) for q in pts]
        f = bm.faces.new(v)
        uvs = ((0, 0), (1, 0), (1, 1), (0, 1)) if s < 0 else ((0, 1), (1, 1), (1, 0), (0, 0))
        for loop, uvc in zip(f.loops, uvs):
            loop[uvl].uv = uvc
        from_bmesh(nm, bm, mat("carton_qr", (1, 1, 1), rough=0.6, emit=(1, 1, 1), strength=0.6), parent=g)
    return g


# ------------------------------------------------------------------ assemble and export

build_road()
for key, deg in CHECKPOINTS.items():
    g = empty(f"CP_{key}", polar(R_CHECK, deg), math.radians(deg))
    {"factory": build_factory, "warehouse": build_warehouse, "retailer": build_retailer, "buyer": build_buyer}[key](g)
    build_arch(key, deg, {"factory": COL["mint"], "warehouse": COL["sea"], "retailer": COL["amber"], "buyer": COL["violet"]}[key])
build_regulator()
build_skyline()
build_hauler()

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_apply=True,
    export_yup=True,
    export_extras=False,
    export_lights=False,
    export_cameras=False,
)
tris = sum(len(o.data.loop_triangles) if o.type == "MESH" and (o.data.calc_loop_triangles() or True) else 0 for o in scene.objects)
print(f"wrote {os.path.abspath(OUT)} ({os.path.getsize(OUT) / 1024:.0f} KB, {tris} triangles, {len(scene.objects)} objects)")
