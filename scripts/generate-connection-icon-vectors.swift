// Run after export-connection-icons.py has resolved Glyphs masks on detached copies.
import Foundation
import CoreGraphics

let source = URL(fileURLWithPath: "macos/Assets/Glyphs/connection-outlines.json")
let glyphs = try JSONSerialization.jsonObject(with: Data(contentsOf: source)) as! [[String: Any]]
let resources = URL(fileURLWithPath: "macos/Sources/PlotItApp/Resources", isDirectory: true)
try FileManager.default.createDirectory(at: resources, withIntermediateDirectories: true)

for glyph in glyphs {
    let role = glyph["role"] as! String
    let resourceName = ["disconnected": "PlotItDisconnected", "connected": "PlotItConnected", "plotting": "PlotItPlotting"][role]!
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
    let pdf = resources.appendingPathComponent(resourceName + ".pdf")
    let context = CGContext(pdf as CFURL, mediaBox: &box, nil)!
    context.beginPDFPage(nil)
    let scale = 16.0 / 728.180738709688
    context.translateBy(x: 12 - (78.25 + 913.3117626757302 / 2) * scale, y: 1 - 6.8192612903120775 * scale)
    context.scaleBy(x: scale, y: scale)
    context.setFillColor(gray: 0, alpha: 1)
    for path in paths { context.addPath(path); context.fillPath() }
    context.endPDFPage()
    context.closePDF()

    let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"18\" viewBox=\"0 0 24 18\"><g fill=\"#000\" transform=\"translate(\(12 - (78.25 + 913.3117626757302 / 2) * scale) \(17 + 6.8192612903120775 * scale)) scale(\(scale) \(-scale))\">" + svgPaths.map { "<path d=\"\($0)\"/>" }.joined() + "</g></svg>\n"
    try svg.write(toFile: "macos/Assets/Glyphs/\(resourceName).svg", atomically: true, encoding: .utf8)
    print("Generated connection symbol: \(resourceName)")
}
