"""Generate Cyco Modeler toolbar icons.

Style: 32x32 transparent PNG, white monoline strokes (matches the legacy
UModeler icon set so the Cyco Modeler UI looks familiar).

Source of truth for which icons exist: editor/src/panels/CenterPanel.js.
If you add a new icon reference there, add an entry to ICONS below.

Drawing primitives (space-separated tokens per line):
    c cx cy r        outline circle
    C cx cy r        filled dot
    r x0 y0 x1 y1    outline rect
    R x0 y0 x1 y1 radius   rounded rect
    l x0 y0 x1 y1    line
    p x y x y ...    polyline (open)
    a x0 y0 x1 y1 s e   arc (degrees)
    e x0 y0 x1 y1    ellipse outline
"""
from __future__ import annotations
import os
from PIL import Image, ImageDraw

OUT = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "editor", "src", "CycoModeler", "Icons"))

SIZE = 32
STROKE = 1
COLOR = (255, 255, 255, 255)

ICONS: dict[str, str] = {}

# ── Elements ──────────────────────────────────────────────────────────────────
ICONS["Icon_Elements_Object.png"] = "r 6 7 26 25\nl 6 12 26 12\nl 6 19 26 19"
ICONS["Icon_Elements_Vertex.png"]  = "C 9 9 2\nC 23 11 2\nC 12 23 2\nl 9 9 23 11\nl 23 11 12 23\nl 12 23 9 9"
ICONS["Icon_Elements_Edge.png"]    = "C 7 7 2\nC 25 25 2\nl 7 7 25 25\nl 25 7 7 25"
ICONS["Icon_Elements_Polygon.png"] = "p 5 20 16 6 27 20 16 26 5 20"

# ── Groups ────────────────────────────────────────────────────────────────────
ICONS["Icon_Group_Elements.png"]        = ICONS["Icon_Elements_Vertex.png"]
ICONS["Icon_Group_PrimitiveShapes.png"] = "r 4 12 16 24\nc 22 18 6"
ICONS["Icon_Group_Drawing.png"]         = "l 4 24 28 8\nC 4 24 1.5\nC 28 8 1.5"
ICONS["Icon_Group_Selection.png"]       = "r 7 7 25 25\nC 12 12 1.5\nC 20 12 1.5\nC 12 20 1.5\nC 20 20 1.5"
ICONS["Icon_Group_Add.png"]             = "l 16 4 16 28\nl 4 16 28 16"
ICONS["Icon_Group_Remove.png"]          = "l 5 16 27 16"
ICONS["Icon_Group_Tweak.png"]           = "l 6 26 26 6\np 22 6 26 6 26 10"
ICONS["Icon_Group_Surface.png"]         = "r 5 9 27 23\nl 5 14 27 14\nl 5 19 27 19"
ICONS["Icon_Group_Misc.png"]            = "C 16 16 3\nl 16 4 16 9\nl 16 23 16 28\nl 4 16 9 16\nl 23 16 28 16"
ICONS["Icon_Group_Creation.png"]        = "r 5 5 15 15\nr 17 17 27 27\nl 13 13 19 19"

# ── Primitive shapes ──────────────────────────────────────────────────────────
ICONS["Icon_PrimitiveShapes_Box.png"] = "r 5 9 22 25\np 22 9 27 5 10 5 5 9\nl 10 5 10 21\nl 27 5 27 21"
ICONS["Icon_PrimitiveShapes_Room.png"] = ICONS["Icon_PrimitiveShapes_Box.png"]
ICONS["Icon_PrimitiveShapes_Stair.png"] = "p 4 26 4 22 10 22 10 18 16 18 16 14 22 14 22 10 28 10 28 6"
ICONS["Icon_PrimitiveShapes_Cylinder.png"] = "e 6 5 26 11\nl 6 5 6 27\nl 26 5 26 27\na 6 21 26 27 0 180"
ICONS["Icon_PrimitiveShapes_Cone.png"] = "p 16 4 5 26 27 26 16 4\na 5 22 27 30 0 180"
ICONS["Icon_PrimitiveShapes_Sphere.png"] = "c 16 16 11\ne 5 16 27 16\ne 16 5 16 27"
ICONS["Icon_PrimitiveShapes_Capsule.png"] = "a 6 4 26 16 180 360\na 6 16 26 28 0 180\nl 6 10 6 22\nl 26 10 26 22"
ICONS["Icon_PrimitiveShapes_Torus.png"] = "c 16 16 11\nc 16 16 5"
ICONS["Icon_PrimitiveShapes_SpiralStair.png"] = "a 4 6 28 10 180 0\na 6 10 26 14 180 0\na 4 14 28 18 180 0\na 6 18 26 22 180 0\na 4 22 28 26 180 0"
ICONS["Icon_PrimitiveShapes_Icosahedron.png"] = "p 16 4 28 14 22 27 10 27 4 14 16 4\nl 4 14 22 27\nl 28 14 10 27\nl 16 4 16 27"

# ── Drawing ───────────────────────────────────────────────────────────────────
ICONS["Icon_Drawing_Line.png"]            = ICONS["Icon_Group_Drawing.png"]
ICONS["Icon_Drawing_Arc.png"]             = "a 4 4 28 28 200 340"
ICONS["Icon_Drawing_Disk.png"]            = "c 16 16 11\nC 16 16 2"
ICONS["Icon_Drawing_Parallel.png"]        = "l 4 10 28 10\nl 4 22 28 22"
ICONS["Icon_Drawing_RoundedRectangle.png"] = "R 4 8 28 24 6"
ICONS["Icon_Drawing_SideStair.png"]       = ICONS["Icon_PrimitiveShapes_Stair.png"]

# ── Selection ─────────────────────────────────────────────────────────────────
ICONS["Icon_Selection_AllSelect.png"]      = "r 5 5 27 27\np 11 16 15 20 22 12"
ICONS["Icon_Selection_NoneSelect.png"]     = "r 5 5 27 27\nl 9 9 23 23\nl 23 9 9 23"
ICONS["Icon_Selection_InvertSelect.png"]   = "r 5 5 27 27\np 19 9 24 14 19 19 14 14 19 9"
ICONS["Icon_Selection_GrowSelect.png"]     = "r 8 8 24 24\nr 4 4 28 28\np 11 16 15 20 22 12"
ICONS["Icon_Selection_ShrinkSelect.png"]   = "r 4 4 28 28\nr 10 10 22 22\np 13 16 16 19 20 13"
ICONS["Icon_Selection_LoopSelect.png"]     = "c 16 16 11\nC 27 16 1.5\nC 16 27 1.5\nC 5 16 1.5\nC 16 5 1.5"
ICONS["Icon_Selection_RingSelect.png"]     = "c 16 16 11\nC 16 5 2\nC 27 16 2\nC 16 27 2\nC 5 16 2"
ICONS["Icon_Selection_IsolatedSelect.png"] = "C 16 16 2\nc 16 16 6\nc 16 16 10"

# ── Add ───────────────────────────────────────────────────────────────────────
ICONS["Icon_Add_PushPull.png"]       = "r 5 14 22 27\np 5 14 10 9 27 9 27 14 22 14\nl 10 9 10 14\nC 24 9 1.5"
ICONS["Icon_Add_MultiPushPull.png"]  = "r 4 18 14 27\nr 18 14 28 23\nr 11 9 21 18"
ICONS["Icon_Add_ExtrudeEdge.png"]    = "l 4 24 14 14\nl 14 14 24 24\np 14 14 20 6 28 14\nl 14 14 28 14"
ICONS["Icon_Add_Inset.png"]          = "r 4 4 28 28\nr 10 10 22 22"
ICONS["Icon_Add_Bevel.png"]          = "p 5 16 10 6 22 6 27 16 22 26 10 26 5 16"
ICONS["Icon_Add_LoopSlice.png"]      = "r 5 5 27 27\nl 5 16 27 16\nl 16 5 16 27"
ICONS["Icon_Add_Subdivide.png"]      = "r 5 5 27 27\nl 16 5 16 27\nl 5 16 27 16\nl 5 5 27 27\nl 5 27 27 5"
ICONS["Icon_Add_Bridge.png"]         = "r 4 6 12 26\nr 20 6 28 26\nl 12 12 20 12\nl 12 20 20 20"
ICONS["Icon_Add_Clone.png"]          = "r 5 5 18 18\nr 14 14 27 27"
ICONS["Icon_Add_Duplicate.png"]      = "r 3 6 17 20\nr 15 12 29 26"
ICONS["Icon_Add_Mirror.png"]         = "l 16 4 16 28\np 4 12 10 6 16 12\np 4 20 10 26 16 20"
ICONS["Icon_Add_Boolean.png"]        = "c 12 14 7\nc 20 18 7"
ICONS["Icon_Add_MirrorObject.png"]   = ICONS["Icon_Add_Mirror.png"]

# ── Remove ────────────────────────────────────────────────────────────────────
ICONS["Icon_Remove_Eraser.png"]          = "p 5 22 11 16 27 16 27 22 21 28 5 22"
ICONS["Icon_Remove_Cut.png"]             = "l 4 16 28 16\np 22 12 26 16 22 20"
ICONS["Icon_Remove_Clip.png"]            = "r 4 6 18 26\nl 18 12 28 12\nl 28 12 28 26"
ICONS["Icon_Remove_Collapse.png"]        = "l 4 16 28 16\np 8 10 14 16 8 22\np 18 10 24 16 18 22"
ICONS["Icon_Remove_Detach.png"]          = "r 4 4 14 14\nr 18 18 28 28\nl 14 14 18 18"
ICONS["Icon_Remove_Combine.png"]         = "c 11 14 7\nc 21 14 7\nc 16 20 7"
ICONS["Icon_Remove_CombineVertices.png"] = "C 10 10 2\nC 22 10 2\nC 10 22 2\nC 22 22 2\nl 10 10 22 10\nl 22 10 22 22\nl 22 22 10 22\nl 10 22 10 10"
ICONS["Icon_Remove_CombinePolygons.png"] = "p 5 12 12 5 19 12 12 19 5 12\np 13 20 20 13 27 20 20 27 13 20"
ICONS["Icon_Remove_RemoveDoubles.png"]   = "c 12 16 6\nc 20 16 6\nl 18 14 26 6"
ICONS["Icon_Remove_CombineObjects.png"]  = ICONS["Icon_Remove_Combine.png"]

# ── Tweak / Deform ────────────────────────────────────────────────────────────
ICONS["Icon_Tweak_Flatten.png"]       = "l 4 26 28 6\nl 4 22 28 22"
ICONS["Icon_Tweak_Align.png"]         = "l 4 10 28 10\nl 4 16 22 16\nl 4 22 16 22"
ICONS["Icon_Tweak_SnapMove.png"]      = "C 8 16 2\nC 24 16 2\nl 8 16 24 16\np 20 12 24 16 20 20"
ICONS["Icon_Tweak_AxisFlip.png"]      = "l 4 16 28 16\np 24 12 28 16 24 20\np 4 12 8 16 4 20"
ICONS["Icon_Tweak_Flip.png"]          = "p 4 16 16 4 16 16 28 16\np 4 16 16 28 16 16 28 16"
ICONS["Icon_Tweak_Pivot.png"]         = "c 16 16 3\nl 16 6 16 4\nl 16 26 16 28\nl 6 16 4 16\nl 26 16 28 16"
ICONS["Icon_Tweak_PivotToCenter.png"] = "c 16 16 4\nC 16 16 2"

# ── Surface ───────────────────────────────────────────────────────────────────
ICONS["Icon_Surface_Material.png"]       = "r 5 5 27 27\nC 11 11 2\nC 21 11 2\nC 11 21 2\nC 21 21 2"
ICONS["Icon_Surface_UV.png"]             = "r 5 5 27 27\nr 9 9 23 23\nl 5 16 27 16\nl 16 5 16 27"
ICONS["Icon_Surface_VertexColor.png"]    = "r 5 5 27 27\nC 16 16 3"
ICONS["Icon_Surface_PolygonColor.png"]   = "r 5 5 27 27\nC 16 16 4"
ICONS["Icon_Surface_SmoothingGroup.png"] = "r 5 5 27 27\nl 5 16 27 16\nl 16 5 16 27\nl 5 5 27 27"
ICONS["Icon_Surface_HotspotLayout.png"]  = "r 5 5 27 27\nc 16 16 4\nC 16 16 1.5"

# ── Misc ──────────────────────────────────────────────────────────────────────
ICONS["Icon_Misc_NewCycoModelerObject.png"] = "r 4 4 28 28\nl 16 4 16 28\nl 4 16 28 16"
ICONS["Icon_Misc_Cursor.png"]               = "p 8 6 8 24 14 20 18 26 20 18 24 18 8 6"
ICONS["Icon_Misc_Settings.png"]             = "c 16 16 4\nl 16 6 16 6\nl 16 26 16 28\nl 6 16 4 16\nl 26 16 28 16"
ICONS["Icon_Misc_LocalSettings.png"]        = "c 16 16 4\nr 22 4 28 10\nr 4 22 10 28"
ICONS["Icon_Misc_PolygonGroup.png"]         = "p 4 8 12 4 20 8 16 16 12 24 4 20 4 8"
ICONS["Icon_Misc_Collider.png"]             = "c 16 16 11\nC 16 16 2"
ICONS["Icon_Misc_Export.png"]               = "r 5 12 27 26\nl 16 12 16 6\nl 16 6 22 12\nl 16 6 10 12"
ICONS["Icon_Misc_RefreshObject.png"]        = "a 4 4 28 28 30 330\np 24 4 28 8 24 12"
ICONS["Icon_Misc_RefreshAll.png"]           = "a 4 4 28 28 30 330\np 24 4 28 8 24 12\nC 6 6 2\nC 26 6 2\nC 6 26 2\nC 26 26 2"
ICONS["Icon_Misc_BakeTransform.png"]        = "c 16 16 8\nC 16 16 3"


# ── Renderer ──────────────────────────────────────────────────────────────────
def new_img():
    return Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))


def get(d: ImageDraw.ImageDraw):
    return d


def _nums(tokens, n):
    out = []
    for i in range(0, n):
        out.append(float(tokens[i]))
    return out


def render(recipe: str):
    img = new_img()
    d = ImageDraw.Draw(img, "RGBA")
    for raw in recipe.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        tokens = line.split()
        op = tokens[0]
        args = tokens[1:]
        if op == "c":
            cx, cy, r = _nums(args, 3)
            d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=COLOR, width=STROKE)
        elif op == "C":
            cx, cy, r = _nums(args, 3)
            d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=COLOR)
        elif op == "r":
            x0, y0, x1, y1 = _nums(args, 4)
            d.rectangle((x0, y0, x1, y1), outline=COLOR, width=STROKE)
        elif op == "R":
            x0, y0, x1, y1, rad = _nums(args, 5)
            d.rounded_rectangle((x0, y0, x1, y1), radius=rad, outline=COLOR, width=STROKE)
        elif op == "l":
            x0, y0, x1, y1 = _nums(args, 4)
            d.line((x0, y0, x1, y1), fill=COLOR, width=STROKE)
        elif op == "p":
            coords = _nums(args, len(args))
            pts = [(coords[i], coords[i + 1]) for i in range(0, len(coords), 2)]
            d.line(pts, fill=COLOR, width=STROKE, joint="curve")
        elif op == "a":
            x0, y0, x1, y1, s, e = _nums(args, 6)
            d.arc((x0, y0, x1, y1), start=s, end=e, fill=COLOR, width=STROKE)
        elif op == "e":
            x0, y0, x1, y1 = _nums(args, 4)
            d.ellipse((x0, y0, x1, y1), outline=COLOR, width=STROKE)
        else:
            raise ValueError(f"Unknown op: {op}")
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    n = 0
    for name, recipe in ICONS.items():
        if recipe is None:
            continue
        render(recipe).save(os.path.join(OUT, name), "PNG")
        n += 1
    print(f"Wrote {n} icons to {OUT}")


if __name__ == "__main__":
    main()