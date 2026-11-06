# MenuTitle: Export PlotIt Connection Icons
# Run through Glyphs MCP against the exact LitSquare Icons document.
# Export only: the source font is never changed or saved.
import json, os
from AppKit import NSBezierPath

def value(obj, name):
    result = getattr(obj, name)
    return result() if callable(result) else result

def fingerprint(layer):
    return [(int(value(shape, "maskType")), [(float(n.position.x), float(n.position.y), str(n.type)) for n in shape.nodes]) for shape in layer.shapes]

sources = {}
for name, counts in [("litsquare.plot-it", [8, 10, 36, 27]), ("litsquare.plot-it.ploting", [62, 36, 27])]:
    glyph = font.glyphs[name]
    if glyph is None: raise ValueError("Missing icon glyph: " + name)
    layer = glyph.layers[params["master"]]
    if layer is None or layer.name != "Regular-S": raise ValueError("Expected exact Regular-S master")
    if [len(shape.nodes) for shape in layer.shapes] != counts: raise ValueError("Icon structure changed; inspect before exporting")
    if int(value(layer.shapes[-2], "maskType")) == 0: raise ValueError("Expected subtraction mask before the bolt")
    if int(value(layer.shapes[-1], "maskType")) != 0: raise ValueError("Expected painted lightning bolt")
    sources[name] = (layer, fingerprint(layer))

results = []
for role, name in [("disconnected", "litsquare.plot-it"), ("connected", "litsquare.plot-it"), ("plotting", "litsquare.plot-it.ploting")]:
    source, original = sources[name]
    layer = source.copy()
    if role == "disconnected":
        # Remove the painted bolt AND its subtraction mask on the detached copy.
        del layer.shapes[len(layer.shapes)-1]
        del layer.shapes[len(layer.shapes)-1]
        if any(int(value(shape, "maskType")) for shape in layer.shapes): raise ValueError("Unexpected remaining mask")
    stack = layer.drawStackForGroup_supporting_penClass_secondaryPen_extraHandles_(value(layer, "rootGroup"), 0, NSBezierPath, None, None)
    commands = []
    for slice_index, item in enumerate(stack):
        if not hasattr(item, "pen") or value(item, "masks"): raise ValueError("Glyphs did not resolve the mask")
        path = value(item, "pen").copy()
        transform = value(item, "transform")
        if transform is not None: path.transformUsingAffineTransform_(transform)
        for i in range(path.elementCount()):
            element, points = path.elementAtIndex_associatedPoints_(i)
            count = {0:1, 1:1, 2:3, 3:0}[int(element)]
            commands.append({"slice":slice_index,"type":int(element),"points":[[float(points[j].x),float(points[j].y)] for j in range(count)]})
    b = layer.bounds
    results.append({"role":role,"sourceGlyph":name,"master":params["master"],"bounds":[float(b.origin.x),float(b.origin.y),float(b.size.width),float(b.size.height)],"resolvedSlices":len(stack),"sourceMasks":1,"boltRemoved":role=="disconnected","maskRemoved":role=="disconnected","commands":commands})
for name, (layer, original) in sources.items():
    if fingerprint(layer) != original: raise ValueError("Source glyph changed unexpectedly")
with open(os.path.join(params["directory"], "connection-outlines.json"), "w") as handle:
    json.dump(results, handle, indent=2)
print(json.dumps([{"role":r["role"],"slices":r["resolvedSlices"],"bounds":r["bounds"],"boltRemoved":r["boltRemoved"]} for r in results]))
