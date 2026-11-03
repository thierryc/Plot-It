// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "PlotItMCP", platforms: [.macOS(.v14)], products: [
    .executable(name: "PlotItMCP", targets: ["PlotItApp"]),
    .executable(name: "plotit-mcp", targets: ["MCPLauncher"])
], targets: [
    .executableTarget(name: "PlotItApp"),
    .executableTarget(name: "MCPLauncher"),
    .testTarget(name: "PlotItAppTests", dependencies: ["PlotItApp"])
])
