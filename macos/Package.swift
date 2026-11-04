// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "PlotItMCP", platforms: [.macOS(.v14)], products: [
    .executable(name: "PlotItMCP", targets: ["PlotItApp"]),
    .executable(name: "plotit-mcp", targets: ["MCPLauncher"])
], dependencies: [.package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.1")], targets: [
    .executableTarget(name: "PlotItApp", dependencies: [.product(name: "Sparkle", package: "Sparkle")], resources: [.process("Resources")], linkerSettings: [.unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"])]),
    .executableTarget(name: "MCPLauncher"),
    .testTarget(name: "PlotItAppTests", dependencies: ["PlotItApp"])
])
