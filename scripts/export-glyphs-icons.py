import json, os
from AppKit import NSBezierPath, NSImage, NSBitmapImageRep, NSBitmapImageFileTypePNG, NSAffineTransform, NSGraphicsContext
from Foundation import NSClassFromString
def value(obj, name):
    v = getattr(obj, name)
    return v() if callable(v) else v
layers = []
for name in params["glyphs"]:
    glyph = font.glyphs[name]
    if glyph is None: raise ValueError("Missing glyph " + name)
    layer = glyph.layers[params["master"]]
    if layer is None: raise ValueError("Missing Regular-S layer")
    layers.append((name, layer))
result = []
for name, layer in layers:
    # Zero supported features asks Glyphs itself to resolve masks, strokes and groups.
    stack = layer.drawStackForGroup_supporting_penClass_secondaryPen_extraHandles_(value(layer, "rootGroup"), 0, NSBezierPath, None, None)
    commands = []
    slice_count = 0
    for item in stack:
        if not hasattr(item, "pen"): raise ValueError("Unresolved non-path draw slice: " + str(type(item)))
        if value(item, "masks"): raise ValueError("Mask was not baked by Glyphs")
        path = value(item, "pen").copy()
        transform = value(item, "transform")
        if transform is not None: path.transformUsingAffineTransform_(transform)
        for index in range(path.elementCount()):
            element, points = path.elementAtIndex_associatedPoints_(index)
            count = {0:1, 1:1, 2:3, 3:0}.get(int(element))
            if count is None: raise ValueError("Unsupported Bezier element " + str(element))
            commands.append({"slice":slice_count,"type":int(element),"points":[[float(points[i].x),float(points[i].y)] for i in range(count)]})
        slice_count += 1
    b = layer.bounds
    result.append({"name":name,"master":params["master"],"bounds":[float(b.origin.x),float(b.origin.y),float(b.size.width),float(b.size.height)],"commands":commands,"resolvedSlices":slice_count,"sourceMasks":sum(1 for s in layer.shapes if int(value(s,"maskType")) != 0)})
    # Independent reference rendered by the Glyphs draw-stack painter, including masks.
    image = NSImage.alloc().initWithSize_((1024,1024))
    image.lockFocus()
    try:
        NSGraphicsContext.saveGraphicsState()
        transform = NSAffineTransform.transform()
        scale = 664.0 / max(float(b.size.width),float(b.size.height))
        transform.translateXBy_yBy_(512-scale*(float(b.origin.x)+float(b.size.width)/2),512-scale*(float(b.origin.y)+float(b.size.height)/2))
        transform.scaleBy_(scale)
        transform.concat()
        helper = NSClassFromString("GSLayerDrawHelper").alloc().init()
        helper.setScale_(1.0)
        helper.setFactor_(1.0)
        helper.setFillOutline_(True)
        helper.drawDrawStack_(layer.drawStack())
        NSGraphicsContext.restoreGraphicsState()
    finally:
        image.unlockFocus()
    rep = NSBitmapImageRep.imageRepWithData_(image.TIFFRepresentation())
    png = rep.representationUsingType_properties_(NSBitmapImageFileTypePNG,{})
    png.writeToFile_atomically_(os.path.join(params["directory"],name+"-native.png"),True)
with open(os.path.join(params["directory"],"resolved-outlines.json"),"w") as handle:
    json.dump(result,handle,indent=2)
print(json.dumps([{"name":x["name"],"sourceMasks":x["sourceMasks"],"resolvedSlices":x["resolvedSlices"]} for x in result]))
