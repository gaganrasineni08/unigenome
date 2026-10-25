"""Builds the home page's 3D centrepiece in Blender and exports it to public/models/ring.glb.

A neon ring road on an island at night. Four checkpoints stand on the outside of the ring
(factory, warehouse, retailer, buyer), each with a scanner arch over the road; the regulator's
tower stands in the middle. Streetlights with pools of light and trees line the road, and a neon
rim edges the island; the page draws the data grid around it. The cargo hauler is exported at the
origin; the page drives it.

Run with Blender:   blender -b -P scripts/blender/build_ring.py
or the bpy module:  python scripts/blender/build_ring.py      (pip install bpy)

Blender is Z-up; the glTF exporter turns that into three.js's Y-up, so a Blender point (x, y, z)
lands at (x, z, -y) on the page. The ring sits in Blender's XY plane, centred on the origin.
Object names the page looks up are kept stable: Hauler, CartonQR_a/b, PhoneScreen, Halo_a/b,
Retailer_spin, Regulator_beacon, LightPools, Arch_<checkpoint>, CP_<checkpoint>.
"""
import math
import os
import random

import bpy  # noqa: I001  (bpy first: as a pip module it is what makes bmesh importable)
import bmesh
from mathutils import Vector

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public", "models", "ring.glb")

R_ROAD = 32.0  # centre line of the road
ROAD_W = 9.0
R_CHECK = 48.0  # where the checkpoint buildings stand
R_ISLAND = 64.0  # the edge of the island everything stands on
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
    "warm": (1.0, 0.8, 0.52),
    "red": (1.0, 0.12, 0.1),
}

random.seed(11)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ------------------------------------------------------------------ materials

_mats = {}


def mat(name, color=(0.1, 0.1, 0.1), rough=0.6, metal=0.0, emit=None, strength=0.0):
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
    _mats[name] = m
    return m


def neon(name, c, s=6.0):
    # Strengths are tuned for the page's bloom: about 1 glows softly, 3 and up blooms hard.
    return mat("neon_" + name, color=c, rough=0.3, emit=c, strength=s * NEON_SCALE)


HULL = mat("hull", (0.045, 0.05, 0.065), rough=0.32, metal=0.85)
PANEL = mat("panel", (0.16, 0.18, 0.21), rough=0.45, metal=0.7)
HULL_LIGHT = mat("hull_light", (0.55, 0.6, 0.66), rough=0.3, metal=0.9)
CHROME = mat("chrome", (0.8, 0.82, 0.85), rough=0.12, metal=1.0)
CONCRETE = mat("concrete", (0.11, 0.115, 0.13), rough=0.85)
CONCRETE_LIGHT = mat("concrete_light", (0.2, 0.21, 0.23), rough=0.8)
ASPHALT = mat("asphalt", (0.022, 0.025, 0.032), rough=0.5, metal=0.25)
GLASS = mat("glass_dark", (0.015, 0.04, 0.06), rough=0.04, metal=0.7)
RUBBER = mat("rubber", (0.02, 0.02, 0.02), rough=0.9)
CARDBOARD = mat("cardboard", (0.72, 0.38, 0.14), rough=0.75)
LEAF = mat("leaf", (0.03, 0.16, 0.1), rough=0.8)
BARK = mat("bark", (0.08, 0.05, 0.03), rough=0.9)
PAINT_LINE = mat("road_paint", (0.75, 0.75, 0.72), rough=0.6, emit=(0.8, 0.8, 0.75), strength=0.25)

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


def box(name, size, loc, material, parent=None, rot=(0, 0, 0), bevel=0.0, seg=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=min(bevel, min(size) / 2.2), segments=seg, affect="EDGES")
    return from_bmesh(name, bm, material, parent, loc, rot, smooth=bevel > 0 and seg > 2)


def cyl(name, r, h, loc, material, parent=None, rot=(0, 0, 0), seg=32, r2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    return from_bmesh(name, bm, material, parent, loc, rot, smooth=True)


def sphere(name, r, loc, material, parent=None, seg=16, rings=10, scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    return from_bmesh(name, bm, material, parent, loc, smooth=True)


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


def lathe(name, profile, loc, material, parent=None, seg=40):
    """A surface of revolution about Z from (radius, z) pairs, bottom to top."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / seg), r * math.sin(2 * math.pi * i / seg), z)) for i in range(seg)])
    for a, b in zip(rings, rings[1:]):
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return from_bmesh(name, bm, material, parent, loc, smooth=True)


def annulus(name, r_in, r_out, z, material, parent=None, seg=192, thick=0.0, u_scale=40):
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
        u0, u1 = i / seg * u_scale, (i + 1) / seg * u_scale
        for loop, (u, v) in zip(f.loops, ((u0, 0), (u0, 1), (u1, 1), (u1, 0))):
            loop[uv].uv = (u, v)
    if thick > 0:
        geom = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
        verts = [g for g in geom["geom"] if isinstance(g, bmesh.types.BMVert)]
        bmesh.ops.translate(bm, vec=(0, 0, -thick), verts=verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return from_bmesh(name, bm, material, parent)


def sector(name, r_in, r_out, a0, a1, z, material, seg=24, thick=0.0):
    """A ring-shaped slice between two angles (degrees)."""
    bm = bmesh.new()
    vi, vo = [], []
    for i in range(seg + 1):
        a = math.radians(a0 + (a1 - a0) * i / seg)
        vi.append(bm.verts.new((r_in * math.cos(a), r_in * math.sin(a), z)))
        vo.append(bm.verts.new((r_out * math.cos(a), r_out * math.sin(a), z)))
    for i in range(seg):
        bm.faces.new((vi[i], vo[i], vo[i + 1], vi[i + 1]))
    if thick > 0:
        geom = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
        bmesh.ops.translate(bm, vec=(0, 0, -thick), verts=[g for g in geom["geom"] if isinstance(g, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return from_bmesh(name, bm, material)


def text(name, body, size, loc, material, parent=None, rot=(math.radians(90), 0, math.radians(-90)), extrude=0.06):
    """Solid letters. By default the text stands upright facing local -X (towards the ring's centre)."""
    bpy.ops.object.text_add(location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.data.body = body
    ob.data.size = size
    ob.data.extrude = extrude
    ob.data.align_x = "CENTER"
    ob.data.align_y = "CENTER"
    bpy.ops.object.convert(target="MESH")
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.clear()
    ob.data.materials.append(material)
    if parent is not None:
        ob.parent = parent
    return ob


def polar(r, deg, z=0.0):
    a = math.radians(deg)
    return (r * math.cos(a), r * math.sin(a), z)


def join(name, objs, parent=None):
    objs = [o for o in objs if o is not None]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = name
    if parent is not None:
        objs[0].parent = parent
    return objs[0]


def ang_dist(a, b):
    return abs((a - b + 180) % 360 - 180)


# ------------------------------------------------------------------ textures


def pool_material():
    """A soft round pool of lamplight on the ground: warm, fading to transparent at the rim."""
    size = 128
    img = bpy.data.images.new("light_pool", size, size, alpha=True)
    px = []
    for y in range(size):
        for x in range(size):
            d = math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) * 2
            a = max(0.0, 1 - d) ** 2.2
            px += [1.0, 0.78, 0.5, a]
    img.pixels = px
    img.pack()
    m = bpy.data.materials.new("light_pool")
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.links.new(tex.outputs["Color"], p.inputs["Base Color"])
    nt.links.new(tex.outputs["Color"], p.inputs["Emission Color"])
    nt.links.new(tex.outputs["Alpha"], p.inputs["Alpha"])
    p.inputs["Emission Strength"].default_value = 0.45
    p.inputs["Roughness"].default_value = 1.0
    m.blend_method = "BLEND"
    try:
        m.surface_render_method = "BLENDED"
    except AttributeError:
        pass
    return m


POOL = pool_material()


# ------------------------------------------------------------------ ground, road and streetlights


def build_ground():
    parts = []
    # sidewalks either side of the ring, and the inner plaza
    parts.append(annulus("walk_in", R_ROAD - ROAD_W / 2 - 3.6, R_ROAD - ROAD_W / 2 - 0.6, 0.2, CONCRETE_LIGHT, thick=0.2))
    parts.append(annulus("walk_out", R_ROAD + ROAD_W / 2 + 0.6, R_ROAD + ROAD_W / 2 + 3.6, 0.2, CONCRETE_LIGHT, thick=0.2))
    # the island the ring and its checkpoints stand on, edged with a neon rim; the page draws the
    # glowing data grid around it
    parts.append(annulus("island", R_ROAD + ROAD_W / 2 + 3.6, R_ISLAND, 0.04, CONCRETE, seg=192))
    parts.append(annulus("island_edge", R_ISLAND - 0.5, R_ISLAND, 0.18, HULL_LIGHT, seg=192, thick=0.3))
    parts.append(torus("island_rim", R_ISLAND + 0.1, 0.16, (0, 0, 0.22), neon("mint", COL["mint"], 8), seg=256, rseg=8))
    join("Ground", parts)


def build_road():
    parts = []
    parts.append(annulus("road_surface", R_ROAD - ROAD_W / 2, R_ROAD + ROAD_W / 2, 0.12, ASPHALT, thick=0.4))
    # neon edges: mint inside, cyan outside
    parts.append(torus("road_edge_in", R_ROAD - ROAD_W / 2 - 0.15, 0.14, (0, 0, 0.3), neon("mint", COL["mint"], 8), seg=192, rseg=8))
    parts.append(torus("road_edge_out", R_ROAD + ROAD_W / 2 + 0.15, 0.14, (0, 0, 0.3), neon("sea", COL["sea"], 8), seg=192, rseg=8))
    # dashed centre line and solid lane edges
    dash_mat = neon("dash", COL["white"], 2.5)
    for i in range(72):
        deg = i * 5
        parts.append(box(f"dash{i}", (0.22, 1.6, 0.04), polar(R_ROAD, deg, 0.34), dash_mat, rot=(0, 0, math.radians(deg))))
    for r in (R_ROAD - ROAD_W / 2 + 0.5, R_ROAD + ROAD_W / 2 - 0.5):
        parts.append(annulus(f"lane_edge{r:.0f}", r - 0.07, r + 0.07, 0.33, PAINT_LINE, seg=192))
    # zebra crossings just before each arch
    for deg in CHECKPOINTS.values():
        for j in range(7):
            r = R_ROAD - ROAD_W / 2 + 0.9 + j * 1.2
            parts.append(box(f"zebra{deg}_{j}", (0.7, 2.6, 0.03), polar(r, deg - 7, 0.34), PAINT_LINE, rot=(0, 0, math.radians(deg))))
    # curbs
    parts.append(annulus("curb_in", R_ROAD - ROAD_W / 2 - 0.6, R_ROAD - ROAD_W / 2 - 0.3, 0.45, HULL_LIGHT, thick=0.45))
    parts.append(annulus("curb_out", R_ROAD + ROAD_W / 2 + 0.3, R_ROAD + ROAD_W / 2 + 0.6, 0.45, HULL_LIGHT, thick=0.45))
    join("Road", parts)
    # the inner plaza: dark stone with concentric light rings, planters and benches
    plaza = [annulus("plaza", 0.0001, R_ROAD - ROAD_W / 2 - 3.6, 0.05, CONCRETE, seg=128)]
    for r, c in ((9, "coral"), (16, "mint"), (22, "sea")):
        plaza.append(torus(f"plaza_ring{r}", r, 0.07, (0, 0, 0.1), neon(c + "_soft", COL[c], 3), seg=128, rseg=6))
    for k in range(12):
        deg = k * 30 + 15
        plaza.append(box(f"bench{k}", (0.6, 2.4, 0.5), polar(19, deg, 0.3), PANEL, rot=(0, 0, math.radians(deg)), bevel=0.08))
        plaza.append(cyl(f"planter{k}", 1.1, 0.8, polar(12.5, deg + 15, 0.45), CONCRETE_LIGHT, seg=20))
        plaza.append(sphere(f"shrub{k}", 1.0, polar(12.5, deg + 15, 1.3), LEAF, seg=10, rings=6, scale=(1, 1, 0.8)))
    join("Plaza", plaza)


def streetlight(prefix, loc, face_deg, parts, glow, pools, arm=1.8, h=6.5):
    """A curved-arm streetlight; its lamp leans over the road. Adds a light pool under the lamp."""
    a = math.radians(face_deg)
    d = Vector((math.cos(a), math.sin(a), 0))
    base = Vector(loc)
    parts.append(cyl(prefix + "_pole", 0.12, h, base + Vector((0, 0, h / 2)), PANEL, seg=10, r2=0.09))
    parts.append(cyl(prefix + "_foot", 0.25, 0.4, base + Vector((0, 0, 0.2)), PANEL, seg=10))
    head = base + d * arm + Vector((0, 0, h - 0.1))
    mid = base + d * (arm / 2) + Vector((0, 0, h + 0.15))
    parts.append(box(prefix + "_arm", (arm + 0.2, 0.12, 0.12), mid, PANEL, rot=(0, 0, a)))
    parts.append(box(prefix + "_head", (1.0, 0.45, 0.2), head, PANEL, rot=(0, 0, a), bevel=0.06))
    glow.append(box(prefix + "_lamp", (0.8, 0.32, 0.06), head - Vector((0, 0, 0.12)), neon("lamp", COL["warm"], 9), rot=(0, 0, a)))
    pools.append((head.x, head.y, 6.0))


def build_streetlights():
    parts, glow, pools = [], [], []
    for k in range(36):
        deg = k * 10 + 5
        if any(ang_dist(deg, c) < 6 for c in CHECKPOINTS.values()):
            continue  # the arches light those stretches
        # outside lamps lean in over the road; inside lamps on alternate posts lean out
        streetlight(f"lo{k}", polar(R_ROAD + ROAD_W / 2 + 1.6, deg), deg + 180, parts, glow, pools)
        if k % 2 == 0:
            streetlight(f"li{k}", polar(R_ROAD - ROAD_W / 2 - 1.6, deg + 5), deg + 5, parts, glow, pools)
    join("Streetlights", parts)
    join("Lamps", glow)
    # pools of light on the ground under every lamp
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new()
    for x, y, r in pools:
        vs = [bm.verts.new((x + dx * r, y + dy * r, 0.36)) for dx, dy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        f = bm.faces.new(vs)
        for loop, uvc in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            loop[uvl].uv = uvc
    from_bmesh("LightPools", bm, POOL)


def build_arch(key, deg, color):
    """A scanner gantry across the road. Its local X runs across the road, so the hauler drives along local Y."""
    g = empty(f"Arch_{key}", polar(R_ROAD, deg), math.radians(deg))
    span = ROAD_W / 2 + 1.4
    lit = neon(key, color, 10)
    parts = []
    for s in (-1, 1):
        x = s * span
        parts.append(box(f"arch_{key}_leg{s}", (1.1, 1.4, 8.6), (x, 0, 4.3), HULL, bevel=0.22, seg=3))
        parts.append(box(f"arch_{key}_foot{s}", (1.8, 2.2, 0.5), (x, 0, 0.25), PANEL, bevel=0.1))
        # vertical light strips on both faces of each leg
        for fy in (-0.72, 0.72):
            parts.append(box(f"arch_{key}_strip{s}{fy}", (0.16, 0.06, 7.0), (x - s * 0.3, fy, 4.4), lit))
        # status lights
        for z in (2.2, 2.9, 3.6):
            parts.append(box(f"arch_{key}_led{s}{z}", (0.3, 0.08, 0.3), (x, -0.73, z), neon("led_" + key, color, 14)))
    parts.append(box(f"arch_{key}_top", (2 * span + 1.1, 1.6, 1.3), (0, 0, 8.7), HULL, bevel=0.3, seg=3))
    for fy in (-0.82, 0.82):
        parts.append(box(f"arch_{key}_band{fy}", (2 * span - 0.6, 0.06, 0.2), (0, fy, 8.95), lit))
    # scanner head with a row of lenses
    parts.append(box(f"arch_{key}_head", (2.6, 1.0, 0.55), (0, 0, 7.8), PANEL, bevel=0.12, seg=3))
    for i in range(5):
        parts.append(cyl(f"arch_{key}_lens{i}", 0.17, 0.08, (-1.0 + i * 0.5, 0, 7.5), neon(key + "_lens", COL["white"], 14), seg=12))
    join(f"Arch_{key}_mesh", parts, g)
    # its name over the road
    text(f"Arch_{key}_label", key.upper(), 0.7, (0, -0.84, 8.75), neon(key, color, 10), parent=g, rot=(math.radians(90), 0, 0), extrude=0.03)
    return g


# ------------------------------------------------------------------ checkpoints
# Each is built around its own origin with the front facing local -X (towards the ring's centre).


def sign(prefix, label, color, loc, size, parts, parent, width):
    """A backlit sign board with solid letters."""
    parts.append(box(prefix + "_board", (0.4, width, size * 1.6), loc, PANEL, bevel=0.08))
    parts.append(box(prefix + "_rim", (0.05, width + 0.3, size * 1.6 + 0.3), (loc[0] + 0.24, loc[1], loc[2]), neon(prefix + "_rim", color, 5)))
    text(prefix + "_text", label, size, (loc[0] - 0.3, loc[1], loc[2]), neon(prefix + "_txt", COL["white"], 3.5), parent=parent)


def fins(prefix, x, y0, y1, z0, z1, n, parts, material=PANEL, depth=0.25):
    """Vertical ribs along a wall, like ribbed metal cladding."""
    for i in range(n):
        y = y0 + (y1 - y0) * i / (n - 1)
        parts.append(box(f"{prefix}{i}", (depth, 0.14, z1 - z0), (x, y, (z0 + z1) / 2), material))


def build_factory(g):
    c = COL["mint"]
    p = []
    p.append(box("f_base", (20, 26, 0.5), (1, 0, 0.25), CONCRETE_LIGHT))
    # main hall: ribbed walls, saw-tooth glass roof
    p.append(box("f_hall", (12, 18, 7), (2, 0, 4.0), HULL, bevel=0.2))
    fins("f_fin", -4.1, -8.6, 8.6, 0.6, 7.2, 30, p)
    for i in range(5):
        y = -7.2 + i * 3.6
        bm = bmesh.new()
        v = [bm.verts.new(q) for q in ((-6, y - 1.8, 0), (6, y - 1.8, 0), (6, y + 1.8, 0), (-6, y + 1.8, 0), (-6, y + 1.8, 2.6), (6, y + 1.8, 2.6))]
        for f in ((0, 1, 2, 3), (3, 2, 5, 4), (0, 4, 5, 1), (0, 3, 4), (1, 5, 2)):
            bm.faces.new([v[k] for k in f])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        p.append(from_bmesh(f"f_saw{i}", bm, PANEL, loc=(2, 0, 7.5)))
        p.append(box(f"f_sawglow{i}", (11.6, 0.08, 2.3), (2, y + 1.76, 8.8), neon("factory_glass", (0.55, 1.0, 0.85), 1.6)))
    # glass office block at the front, with floor lines
    p.append(box("f_office", (5, 9, 9), (-6.5, -6, 4.5), GLASS, bevel=0.15))
    for z in (2.2, 4.4, 6.6, 8.8):
        p.append(box(f"f_floor{z}", (5.1, 9.1, 0.12), (-6.5, -6, z), neon("warm", COL["warm"], 2.2)))
    for y in (-10.4, -8.2, -6, -3.8, -1.6):
        p.append(box(f"f_mull{y}", (5.15, 0.1, 9), (-6.5, y, 4.5), PANEL))
    sign("f_sign", "FACTORY", c, (-9.15, -6, 10.3), 0.95, p, g, 8.6)
    # chimneys with glowing rings and ladders
    for k, (x, y, h) in enumerate(((5.5, 6, 22), (5.5, 9, 17))):
        p.append(cyl(f"f_stack{k}", 1.0, h, (x, y, h / 2 + 0.5), HULL_LIGHT, r2=0.75, seg=24))
        for z in (h * 0.4, h * 0.65, h * 0.9):
            p.append(torus(f"f_stack{k}_ring{z:.0f}", 1.0 - 0.25 * z / h + 0.04, 0.1, (x, y, z + 0.5), neon("mint", c, 8), seg=32, rseg=6))
        p.append(torus(f"f_stack{k}_tip", 0.8, 0.12, (x, y, h + 0.45), neon("red_tip", COL["red"], 14), seg=24, rseg=6))
    # cooling tower (hyperboloid) and storage tanks
    p.append(lathe("f_cooling", [(4.0, 0), (3.2, 4), (2.6, 8), (2.9, 11), (3.3, 12.5), (3.15, 12.5)], (6, -7.5, 0.5), CONCRETE_LIGHT))
    p.append(torus("f_cool_rim", 3.25, 0.1, (6, -7.5, 13.0), neon("mint", c, 8), seg=48, rseg=6))
    for k, y in enumerate((-1.2, 2.4)):
        p.append(cyl(f"f_tank{k}", 1.5, 5, (10.5, y, 3.0), HULL_LIGHT, seg=24))
        p.append(sphere(f"f_tankdome{k}", 1.5, (10.5, y, 5.5), HULL_LIGHT, scale=(1, 1, 0.45)))
        p.append(torus(f"f_tankband{k}", 1.52, 0.06, (10.5, y, 4.2), neon("mint", c, 6), seg=32, rseg=4))
    # pipes along the hall
    for k, z in enumerate((5.6, 6.2)):
        p.append(cyl(f"f_pipe{k}", 0.22, 17, (8.2, 0, z), CHROME, rot=(math.radians(90), 0, 0), seg=12))
    # conveyor coming out towards the road, with cartons and a robot arm
    p.append(box("f_belt", (9, 2.4, 0.5), (-8.5, 4.5, 1.3), PANEL, bevel=0.1))
    p.append(box("f_belt_top", (9, 2.0, 0.08), (-8.5, 4.5, 1.58), RUBBER))
    for s in (-1, 1):
        p.append(box(f"f_belt_glow{s}", (9, 0.08, 0.1), (-8.5, 4.5 + s * 1.25, 1.5), neon("mint", c, 8)))
    for i in range(4):
        p.append(box(f"f_box{i}", (1.2, 1.2, 1.0), (-5.2 - i * 2.3, 4.5, 2.15), CARDBOARD, bevel=0.05))
    p.append(cyl("f_robot_base", 0.7, 0.8, (-9, 7.2, 0.9), PANEL, seg=16))
    p.append(box("f_robot_a", (0.5, 0.5, 3.0), (-9, 7.2, 2.6), HULL_LIGHT, rot=(math.radians(-20), 0, 0), bevel=0.12))
    p.append(box("f_robot_b", (0.4, 0.4, 2.4), (-9, 6.0, 4.2), HULL_LIGHT, rot=(math.radians(60), 0, 0), bevel=0.1))
    p.append(sphere("f_robot_joint", 0.4, (-9, 6.7, 3.9), neon("mint", c, 6), seg=12, rings=8))
    # perimeter fence with lit posts
    for i in range(14):
        y = -12.5 + i * 25 / 13
        p.append(box(f"f_fence{i}", (0.1, 0.1, 1.6), (12, y, 0.8), PANEL))
    p.append(box("f_fence_rail", (0.08, 25, 0.08), (12, 0, 1.5), CHROME))
    join("Factory_mesh", p, g)


def build_warehouse(g):
    c = COL["sea"]
    p = []
    p.append(box("w_base", (22, 30, 0.5), (1.5, 0, 0.25), CONCRETE_LIGHT))
    p.append(box("w_walls", (13, 22, 5), (2.5, 0, 3.0), HULL, bevel=0.2))
    fins("w_fin", -4.05, -10.6, 10.6, 0.6, 5.3, 40, p, depth=0.18)
    # barrel roof along local Y, with ribs
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=48, radius1=6.6, radius2=6.6, depth=22.4)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, 0), plane_no=(1, 0, 0), clear_inner=True)
    bmesh.ops.contextual_create(bm, geom=[e for e in bm.edges if e.is_boundary])
    p.append(from_bmesh("w_roof", bm, PANEL, loc=(2.5, 0, 5.5), rot=(0, math.radians(-90), math.radians(90)), smooth=True))
    for i in range(12):
        y = -10.5 + i * 21 / 11
        p.append(torus(f"w_rib{i}", 6.62, 0.07, (2.5, y, 5.5), HULL_LIGHT, rot=(math.radians(90), 0, 0), seg=48, rseg=4))
    for y in (-11.15, 11.15):
        p.append(torus(f"w_arc{y:.0f}", 6.65, 0.1, (2.5, y, 5.5), neon("sea", c, 8), rot=(math.radians(90), 0, 0), seg=64, rseg=6))
    # loading docks: roll-up doors, canopies, dock lights
    for i, y in enumerate((-7.5, -2.5, 2.5, 7.5)):
        p.append(box(f"w_door{i}", (0.1, 3.6, 3.4), (-4.1, y, 2.2), neon("sea_door", (0.15, 0.42, 0.55), 2.2)))
        for z in range(8):
            p.append(box(f"w_slat{i}_{z}", (0.12, 3.6, 0.04), (-4.15, y, 0.7 + z * 0.42), PANEL))
        p.append(box(f"w_canopy{i}", (1.6, 4.2, 0.15), (-4.8, y, 4.1), PANEL, rot=(0, math.radians(8), 0)))
        p.append(box(f"w_docklight{i}", (0.1, 3.4, 0.1), (-4.18, y, 3.95), neon("sea", c, 8)))
        p.append(box(f"w_bumper{i}", (0.3, 3.0, 0.4), (-4.3, y, 0.8), RUBBER))
    sign("w_sign", "WAREHOUSE", c, (-4.3, 0, 6.8), 0.8, p, g, 9.5)
    # container yard with a gantry crane
    cols = [(0.62, 0.14, 0.1), (0.08, 0.26, 0.5), (0.75, 0.5, 0.1), (0.15, 0.45, 0.36)]
    k = 0
    for row in range(2):
        for col in range(3):
            for lvl in range(2 if (row + col) % 2 == 0 else 1):
                m = mat(f"container{k % 4}", cols[k % 4], rough=0.5, metal=0.55)
                x, y, z = 4.5 + row * 3.0, 13.2 + col * 2.8, 1.8 + lvl * 2.65
                p.append(box(f"w_cont{k}", (2.5, 2.6, 2.55), (x, y, z), m, bevel=0.04))
                for r in range(6):  # corrugation
                    p.append(box(f"w_cont{k}_rib{r}", (2.55, 0.06, 2.3), (x, y - 1.0 + r * 0.4, z), m))
                k += 1
    for s in (-1, 1):
        p.append(box(f"w_crane_leg{s}", (0.5, 0.5, 10), (6, 16 + s * 4.6, 5.5), mat("crane", (0.85, 0.6, 0.1), rough=0.5, metal=0.5)))
    p.append(box("w_crane_beam", (0.8, 10.2, 0.8), (6, 16, 10.6), mat("crane", (0.85, 0.6, 0.1), rough=0.5, metal=0.5)))
    p.append(box("w_crane_cab", (1.4, 1.2, 1.0), (6, 15, 9.8), GLASS, bevel=0.1))
    p.append(box("w_crane_glow", (0.1, 10, 0.1), (5.55, 16, 10.2), neon("amber_soft", COL["amber"], 6)))
    # a forklift by the docks
    p.append(box("w_fork_body", (1.6, 1.0, 0.9), (-7, -5, 0.95), mat("forklift", (0.9, 0.62, 0.08), rough=0.4, metal=0.3), bevel=0.12))
    p.append(box("w_fork_mast", (0.12, 0.9, 2.2), (-7.9, -5, 1.6), PANEL))
    p.append(box("w_fork_tine", (1.0, 0.7, 0.06), (-8.4, -5, 0.6), CHROME))
    # yard light masts
    for y in (-13, 13):
        p.append(cyl(f"w_mast{y}", 0.15, 11, (10.5, y, 6), PANEL, seg=10))
        p.append(box(f"w_mast_lamp{y}", (0.5, 1.6, 0.4), (10.2, y, 11.4), neon("lamp", COL["warm"], 9)))
    join("Warehouse_mesh", p, g)


def build_retailer(g):
    c = COL["amber"]
    p = []
    p.append(box("r_base", (18, 22, 0.5), (1, 0, 0.25), CONCRETE_LIGHT))
    p.append(box("r_body", (9, 15, 6), (2, 0, 3.5), HULL, bevel=0.25))
    # glass front with mullions and a lit interior
    p.append(box("r_glass", (0.08, 13.5, 4.0), (-2.55, 0, 2.6), neon("shopglass", (1.0, 0.82, 0.6), 1.4)))
    for i in range(10):
        p.append(box(f"r_mull{i}", (0.14, 0.1, 4.0), (-2.6, -6.75 + i * 1.5, 2.6), PANEL))
    for i in range(3):
        p.append(box(f"r_shelf{i}", (0.6, 11, 0.1), (-1.3, 0, 1.2 + i * 0.95), PANEL))
        for j in range(16):
            col = random.choice(((0.9, 0.2, 0.2), (0.2, 0.6, 0.9), (0.95, 0.75, 0.2), (0.3, 0.8, 0.4), (0.9, 0.9, 0.9)))
            p.append(box(f"r_prod{i}_{j}", (0.35, 0.45, 0.55), (-1.4, -5.2 + j * 0.7, 1.5 + i * 0.95), mat(f"product{col}", col, rough=0.5)))
    # striped awning
    for i in range(10):
        y = -7 + 14 * (i + 0.5) / 10
        m = neon("awning_amber", c, 3) if i % 2 == 0 else mat("awning_white", (0.85, 0.83, 0.8), rough=0.6)
        p.append(box(f"r_awn{i}", (2.6, 1.4, 0.12), (-3.7, y, 4.95), m, rot=(0, math.radians(-16), 0)))
    p.append(box("r_awn_edge", (0.1, 14, 0.3), (-4.95, 0, 4.55), neon("amber", c, 9)))
    sign("r_sign", "SHOP", c, (-2.4, 0, 7.6), 1.3, p, g, 7)
    # rooftop billboard
    p.append(box("r_bill_post", (0.3, 0.3, 4), (4, 0, 8.5), PANEL))
    p.append(box("r_bill", (0.3, 8, 3.2), (4, 0, 11.6), PANEL, bevel=0.06))
    p.append(box("r_bill_face", (0.05, 7.5, 2.8), (3.82, 0, 11.6), neon("billboard_face", (0.95, 0.4, 0.12), 1.1)))
    text("r_bill_text", "GENUINE?\nSCAN IT", 0.75, (3.75, 0, 11.6), neon("bill_txt", COL["white"], 4), parent=g)
    # parking with two cars
    for i, y in enumerate((-9.5, 9.5)):
        p.append(box(f"r_lot{i}", (6, 3.6, 0.04), (-6.5, y, 0.52), ASPHALT))
        car = mat(f"car{i}", ((0.6, 0.05, 0.08), (0.05, 0.25, 0.6))[i], rough=0.25, metal=0.7)
        p.append(box(f"r_car{i}", (3.6, 1.7, 0.7), (-6.5, y, 0.95), car, bevel=0.25, seg=3))
        p.append(box(f"r_car{i}_top", (1.9, 1.5, 0.55), (-6.7, y, 1.5), GLASS, bevel=0.2, seg=3))
        p.append(box(f"r_car{i}_lights", (0.06, 1.3, 0.12), (-8.32, y, 1.0), neon("head", COL["white"], 10)))
    join("Retailer_mesh", p, g)
    # the spinning logo cube above the shop (animated on the page)
    cube = box("Retailer_spin", (2.0, 2.0, 2.0), (2, 0, 15.6), neon("amber_cube", c, 4), parent=g, bevel=0.3, seg=3)
    cube.rotation_euler = (math.radians(35), math.radians(45), 0)


def tree(prefix, loc, parts, s=1.0):
    x, y, z = loc
    parts.append(cyl(prefix + "_trunk", 0.15 * s, 1.6 * s, (x, y, z + 0.8 * s), BARK, seg=8))
    parts.append(sphere(prefix + "_crown", 1.1 * s, (x, y, z + 2.3 * s), LEAF, seg=10, rings=7, scale=(1, 1, 1.15)))


def build_buyer(g):
    c = COL["violet"]
    p = []
    p.append(cyl("b_plaza", 12, 0.4, (0, 0, 0.2), CONCRETE_LIGHT, seg=64))
    p.append(cyl("b_plinth", 7.5, 1.0, (0, 0, 0.9), CONCRETE, seg=64))
    p.append(torus("b_plinth_ring", 7.5, 0.14, (0, 0, 1.4), neon("violet", c, 8), seg=96, rseg=8))
    p.append(torus("b_plaza_ring", 11.8, 0.08, (0, 0, 0.42), neon("violet_soft", c, 4), seg=96, rseg=6))
    for k in range(10):
        a = k * 36 + 18
        if ang_dist(a, 180) < 40:
            continue  # keep the side facing the ring clear
        tree(f"b_tree{k}", polar(10, a, 0.4), p, 1.0)
        p.append(box(f"b_bench{k}", (0.5, 1.8, 0.45), polar(8.6, a + 18, 0.62), PANEL, rot=(0, 0, math.radians(a + 18)), bevel=0.06))
    join("Buyer_base", p, g)
    # the giant phone, screen facing the ring (local -X)
    phone = empty("Buyer_phone", (0, 0, 1.4), 0, g)
    q = []
    q.append(box("b_body", (1.0, 7.4, 14.5), (0, 0, 7.6), HULL, bevel=0.9, seg=4))
    q.append(box("b_bezel", (0.1, 6.6, 13.4), (-0.52, 0, 7.6), mat("screen_black", (0.0, 0.0, 0.0), rough=0.1, metal=0.2)))
    q.append(box("b_cam", (0.12, 1.4, 0.3), (-0.53, 0, 13.8), HULL_LIGHT))
    q.append(box("b_edge", (1.06, 0.1, 13.2), (0, 3.68, 7.6), neon("violet", c, 6)))
    q.append(box("b_edge2", (1.06, 0.1, 13.2), (0, -3.68, 7.6), neon("violet", c, 6)))
    for i, z in enumerate((11.2, 12.4)):
        q.append(box(f"b_button{i}", (0.4, 0.12, 0.9), (0, 3.75, z), CHROME, bevel=0.04))
    # a hand-sized stand at the back holding it up
    q.append(box("b_stand", (3.5, 2.0, 0.5), (1.8, 0, 0.25), PANEL, bevel=0.15))
    q.append(box("b_strut", (0.4, 1.2, 9), (2.6, 0, 4.2), PANEL, rot=(0, math.radians(-14), 0), bevel=0.1))
    join("Buyer_phone_mesh", q, phone)
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
    # a stepped base with columns
    p.append(cyl("t_step1", 7.2, 0.6, (0, 0, 0.3), CONCRETE_LIGHT, seg=64))
    p.append(cyl("t_step2", 6.2, 0.6, (0, 0, 0.9), CONCRETE_LIGHT, seg=64))
    p.append(cyl("t_hall", 5.2, 3.6, (0, 0, 3.0), GLASS, seg=48))
    for k in range(16):
        p.append(cyl(f"t_col{k}", 0.22, 3.6, polar(5.35, k * 22.5, 3.0), CONCRETE_LIGHT, seg=10))
    p.append(cyl("t_hall_roof", 5.8, 0.5, (0, 0, 5.05), PANEL, seg=48))
    p.append(torus("t_hall_ring", 5.8, 0.08, (0, 0, 5.3), neon("coral", c, 8), seg=64, rseg=6))
    # the shaft: tapered, with vertical fins and light bands
    p.append(cyl("t_shaft", 2.2, 23, (0, 0, 16.8), HULL, seg=48, r2=1.4))
    for k in range(8):
        a = k * 45
        p.append(box(f"t_fin{k}", (0.9, 0.18, 22), polar(2.0, a, 16.8), PANEL, rot=(0, 0, math.radians(a))))
        p.append(box(f"t_fin_glow{k}", (0.06, 0.06, 20), polar(2.45, a, 16.8), neon("coral_soft", c, 5), rot=(0, 0, math.radians(a))))
    for z in (9, 14, 19, 24):
        p.append(torus(f"t_band{z}", 2.2 - 0.8 * (z - 5) / 23 + 0.05, 0.1, (0, 0, z), neon("coral", c, 8), seg=48, rseg=6))
    # observation deck with windows
    p.append(lathe("t_deck", [(1.6, 26.5), (4.4, 27.6), (4.6, 28.4), (4.0, 31.0), (3.0, 31.6)], (0, 0, 0), HULL_LIGHT, seg=48))
    for k in range(24):
        p.append(box(f"t_win{k}", (0.08, 0.7, 1.4), polar(4.32, k * 15, 29.6), neon("coral_glass", (1.0, 0.62, 0.55), 2.2), rot=(0, math.radians(-8), math.radians(k * 15))))
    p.append(cyl("t_cap", 2.8, 0.7, (0, 0, 31.9), PANEL, seg=48, r2=1.6))
    # antennas and dishes
    p.append(cyl("t_spire", 0.32, 7.6, (0, 0, 36.1), HULL_LIGHT, seg=16, r2=0.05))
    for k, a in enumerate((30, 150, 270)):
        x, y, _ = polar(1.8, a)
        p.append(cyl(f"t_ant{k}", 0.06, 3.5, (x, y, 34), CHROME, seg=8))
        p.append(lathe(f"t_dish{k}", [(0.05, 0), (0.6, 0.12), (0.9, 0.32)], (0, 0, 0), HULL_LIGHT, seg=20))
        d = bpy.context.scene.objects[f"t_dish{k}"]
        d.location = polar(3.2, a, 32.6)
        d.rotation_euler = (math.radians(60), 0, math.radians(a + 90))
        p.append(d)
    join("Regulator_mesh", p, g)
    cyl("Regulator_beacon", 0.5, 0.8, (0, 0, 40.5), neon("beacon", (1.0, 0.25, 0.2), 25), parent=g, seg=16)
    text("Regulator_label", "REGULATOR", 0.9, (0, 0, 5.75), neon("coral", c, 8), parent=g, rot=(0, 0, 0), extrude=0.05)
    # two halo rings the page spins around the tower
    torus("Halo_a", 7.5, 0.16, (0, 0, 26), neon("coral", c, 8), parent=g, seg=128, rseg=8)
    torus("Halo_b", 10, 0.1, (0, 0, 22), neon("coral_soft", c, 4), parent=g, seg=128, rseg=6)
    return g


# ------------------------------------------------------------------ trees


def build_trees():
    """Trees along the outer sidewalk, leaving the checkpoint grounds clear."""
    park = []
    for k in range(48):
        deg = k * 7.5 + 3
        if any(ang_dist(deg, c) < 16 for c in CHECKPOINTS.values()):
            continue
        tree(f"st{k}", polar(R_ROAD + ROAD_W / 2 + 4.6, deg), park, 0.8)
    join("Trees", park)


# ------------------------------------------------------------------ the hauler (local +X is forward)


def build_hauler():
    g = empty("Hauler", (0, 0, 0))
    cyan = neon("hauler_under", COL["sea"], 14)
    mint = neon("mint", COL["mint"], 8)
    body = mat("hauler_paint", (0.75, 0.78, 0.82), rough=0.18, metal=0.9)
    p = []
    # chassis rails and fuel tanks
    p.append(box("h_chassis", (11.8, 1.6, 0.45), (-0.6, 0, 0.95), HULL, bevel=0.08))
    for s in (-1, 1):
        p.append(cyl(f"h_tank{s}", 0.45, 1.8, (1.6, s * 1.05, 0.95), CHROME, rot=(0, math.radians(90), 0), seg=20))
    # cab: a rounded wedge (profile extruded across, then bevelled smooth)
    bm = bmesh.new()
    prof = [(-1.7, 0.0), (1.5, 0.0), (2.15, 0.5), (2.1, 1.25), (0.6, 2.55), (-1.7, 2.7)]
    vl = [bm.verts.new((x, -1.3, z)) for x, z in prof]
    vr = [bm.verts.new((x, 1.3, z)) for x, z in prof]
    bm.faces.new(vl)
    bm.faces.new(list(reversed(vr)))
    for i in range(len(prof)):
        j = (i + 1) % len(prof)
        bm.faces.new((vl[i], vl[j], vr[j], vr[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.bevel(bm, geom=bm.edges[:], offset=0.22, segments=4, affect="EDGES")
    p.append(from_bmesh("h_cab", bm, body, loc=(3.5, 0, 1.2), smooth=True))
    # windscreen (raked), side windows, sun visor, roof light bar
    a = math.atan2(1.3, 1.5)
    p.append(box("h_wind", (0.05, 2.3, 1.75), (4.82, 0, 3.1), GLASS, rot=(0, -a, 0)))
    for s in (-1, 1):
        p.append(box(f"h_side{s}", (1.7, 0.05, 0.85), (2.9, s * 1.33, 3.2), GLASS))
        # mirrors on stalks
        p.append(box(f"h_mirror_arm{s}", (0.06, 0.5, 0.06), (4.5, s * 1.5, 3.0), CHROME))
        p.append(box(f"h_mirror{s}", (0.12, 0.25, 0.6), (4.45, s * 1.78, 2.9), HULL, bevel=0.04))
        # chrome exhaust stacks behind the cab
        p.append(cyl(f"h_stack{s}", 0.13, 3.4, (1.5, s * 1.25, 3.0), CHROME, seg=12))
        p.append(torus(f"h_stack_tip{s}", 0.13, 0.03, (1.5, s * 1.25, 4.72), CHROME, seg=12, rseg=4))
        # fenders over the front wheels
        p.append(box(f"h_fender{s}", (1.7, 0.4, 0.15), (4.2, s * 1.2, 1.45), body, bevel=0.06))
    p.append(box("h_visor", (0.6, 2.5, 0.08), (4.25, 0, 3.95), HULL))
    p.append(box("h_roofbar", (0.3, 2.0, 0.14), (3.4, 0, 4.0), PANEL, bevel=0.05))
    p.append(box("h_roofbar_glow", (0.04, 1.8, 0.08), (3.56, 0, 4.0), neon("head", COL["white"], 12)))
    # grille with lit slits, headlights, bumper
    p.append(box("h_grille", (0.1, 1.7, 0.9), (5.68, 0, 1.75), HULL))
    for z in (1.45, 1.65, 1.85, 2.05):
        p.append(box(f"h_slit{z}", (0.04, 1.5, 0.05), (5.74, 0, z), neon("mint", COL["mint"], 6)))
    for s in (-1, 1):
        p.append(box(f"h_headlight{s}", (0.08, 0.5, 0.22), (5.62, s * 0.95, 1.95), neon("head", COL["white"], 30)))
    p.append(box("h_bumper", (0.3, 2.6, 0.35), (5.75, 0, 1.05), CHROME, bevel=0.1))
    # tail lights
    for s in (-1, 1):
        p.append(box(f"h_tail{s}", (0.08, 0.5, 0.2), (-6.55, s * 1.0, 1.3), neon("tail", (1.0, 0.1, 0.12), 18)))
    # flatbed trailer: deck, side rails, stake posts, light strips
    p.append(box("h_bed", (8.6, 2.6, 0.35), (-2.1, 0, 1.45), HULL, bevel=0.08))
    for s in (-1, 1):
        p.append(box(f"h_rail{s}", (8.6, 0.1, 0.1), (-2.1, s * 1.3, 1.72), mint))
        for i in range(6):
            p.append(box(f"h_stake{s}{i}", (0.1, 0.1, 0.7), (-6.0 + i * 1.6, s * 1.27, 1.95), PANEL))
        p.append(box(f"h_under{s}", (10.5, 0.08, 0.08), (-0.6, s * 0.85, 0.66), cyan))
    p.append(box("h_headboard", (0.2, 2.6, 2.0), (2.05, 0, 2.6), PANEL, bevel=0.06))
    # wheels with rims and hubs
    for x in (4.2, 2.4, -3.6, -4.9, -6.0):
        for s in (-1, 1):
            xx = x if x > -6 else -5.95
            p.append(cyl(f"h_wheel{x}{s}", 0.62, 0.45, (xx, s * 1.15, 0.62), RUBBER, rot=(math.radians(90), 0, 0), seg=24))
            p.append(cyl(f"h_rim{x}{s}", 0.38, 0.47, (xx, s * 1.15, 0.62), CHROME, rot=(math.radians(90), 0, 0), seg=16))
            p.append(cyl(f"h_hub{x}{s}", 0.14, 0.5, (xx, s * 1.15, 0.62), neon("hub", COL["sea"], 5), rot=(math.radians(90), 0, 0), seg=10))
    join("Hauler_mesh", p, g)
    # cargo: a stack of cartons, a big master carton with its QR on both sides, and straps
    cargo = []
    for i, (x, y, z) in enumerate(((-5.1, -0.6, 2.2), (-5.1, 0.6, 2.2), (-3.9, -0.6, 2.2), (-3.9, 0.6, 2.2), (-4.5, 0, 3.3))):
        cargo.append(box(f"h_c{i}", (1.1, 1.1, 1.05), (x, y, z), CARDBOARD, bevel=0.05))
    cargo.append(box("h_master", (3.2, 2.3, 2.2), (-0.6, 0, 2.75), CARDBOARD, bevel=0.08))
    cargo.append(box("h_tape", (3.24, 0.4, 2.24), (-0.6, 0, 2.75), mat("tape", (0.75, 0.6, 0.35), rough=0.3)))
    for x in (-2.0, 0.8):
        cargo.append(box(f"h_strap{x}", (0.12, 2.36, 2.26), (x, 0, 2.75), mat("strap", (0.9, 0.55, 0.05), rough=0.5)))
    join("Hauler_cargo", cargo, g)
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

build_ground()
build_road()
build_streetlights()
for key, deg in CHECKPOINTS.items():
    g = empty(f"CP_{key}", polar(R_CHECK, deg), math.radians(deg))
    {"factory": build_factory, "warehouse": build_warehouse, "retailer": build_retailer, "buyer": build_buyer}[key](g)
    build_arch(key, deg, {"factory": COL["mint"], "warehouse": COL["sea"], "retailer": COL["amber"], "buyer": COL["violet"]}[key])
build_regulator()
build_trees()
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
deps = bpy.context.evaluated_depsgraph_get()
tris = 0
for o in scene.objects:
    if o.type == "MESH":
        me = o.evaluated_get(deps).to_mesh()
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
        o.evaluated_get(deps).to_mesh_clear()
print(f"wrote {os.path.abspath(OUT)} ({os.path.getsize(OUT) / 1024:.0f} KB, {tris} triangles, {len(scene.objects)} objects)")
