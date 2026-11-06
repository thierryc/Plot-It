// Run on macOS after scripts/export-glyphs-icons.py has resolved masks inside Glyphs.
import Foundation
import CoreGraphics

let source = URL(fileURLWithPath: "macos/Assets/Glyphs/resolved-outlines.json")
let glyphs = try JSONSerialization.jsonObject(with: Data(contentsOf: source)) as! [[String: Any]]
let resources = URL(fileURLWithPath: "macos/Sources/PlotItApp/Resources", isDirectory: true)
try FileManager.default.createDirectory(at: resources, withIntermediateDirectories: true)

for (index, glyph) in glyphs.enumerated() {
    precondition(glyph["sourceMasks"] as! Int > 0, "Expected native mask evidence")
    let commands = glyph["commands"] as! [[String: Any]]
    let sliceCount = glyph["resolvedSlices"] as! Int
    let paths = (0..<sliceCount).map { _ in CGMutablePath() }
    var svgPaths = Array(repeating: "", count: sliceCount)
    for command in commands {
        let slice = command["slice"] as! Int // Never flatten independently painted slices.
        let type = command["type"] as! Int
        let values = command["points"] as! [[Double]]
        let points = values.map { CGPoint(x: $0[0], y: $0[1]) }
        switch type {
        case 0: paths[slice].move(to: points[0])
        case 1: paths[slice].addLine(to: points[0])
        case 2: paths[slice].addCurve(to: points[2], control1: points[0], control2: points[1])
        case 3: paths[slice].closeSubpath()
        default: preconditionFailure("Unsupported native Bezier element")
        }
        svgPaths[slice] += ["M", "L", "C", "Z"][type] + values.map { "\($0[0]),\($0[1])" }.joined(separator: " ")
    }

    var box = CGRect(x: 0, y: 0, width: 24, height: 18)
    let pdf = resources.appendingPathComponent(index == 0 ? "PlotItConnected.pdf" : "PlotItPlotting.pdf")
    let context = CGContext(pdf as CFURL, mediaBox: &box, nil)!
    context.beginPDFPage(nil)
    let scale = 16.0 / 728.180738709688
    context.translateBy(x: 12 - (78.25 + 913.3117626757302 / 2) * scale, y: 1 - 6.8192612903120775 * scale)
    context.scaleBy(x: scale, y: scale)
    context.setFillColor(gray: 0, alpha: 1)
    for path in paths { context.addPath(path); context.fillPath() }
    context.endPDFPage()
    context.closePDF()

    let bounds = glyph["bounds"] as! [Double]
    let appScale = 664.0 / max(bounds[2], bounds[3])
    let transform = "translate(\(512 - appScale * (bounds[0] + bounds[2] / 2)) \(512 + appScale * (bounds[1] + bounds[3] / 2))) scale(\(appScale) \(-appScale))"
    let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1024\" height=\"1024\" viewBox=\"0 0 1024 1024\"><g fill=\"#fff\" transform=\"\(transform)\">" + svgPaths.map { "<path d=\"\($0)\"/>" }.joined() + "</g></svg>\n"
    let name = glyph["name"] as! String
    try svg.write(toFile: "macos/Assets/Glyphs/\(name).svg", atomically: true, encoding: .utf8)
    if index == 0 { try svg.write(toFile: "macos/Assets/AppIcon.icon/Assets/\(name).svg", atomically: true, encoding: .utf8) }
    print("Generated mask-resolved SVG and PDF for \(name)")
}
