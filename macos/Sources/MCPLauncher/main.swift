import AppKit
import Foundation
import Darwin

// This executable is the stable MCP command registered with agent apps.
// It never owns hardware, starts a drawing, or writes diagnostics to stdout.
let executable = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
let contents = executable.deletingLastPathComponent().deletingLastPathComponent()
let bundle = contents.deletingLastPathComponent()
let resources = contents.appendingPathComponent("Resources")
let node = resources.appendingPathComponent("runtime/node").path
let script = resources.appendingPathComponent("runtime/stdio.mjs").path
let socket = "/tmp/plotit-mcp-\(getuid())/mcp.sock"
if NSRunningApplication.runningApplications(withBundleIdentifier: "cx.ap.plotit.mcp").isEmpty || !FileManager.default.fileExists(atPath: socket) {
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.activates = false
    NSWorkspace.shared.openApplication(at: bundle, configuration: configuration)
    let deadline = Date().addingTimeInterval(18)
    while !FileManager.default.fileExists(atPath: socket) && Date() < deadline {
        RunLoop.current.run(until: Date().addingTimeInterval(0.1))
    }
}
guard FileManager.default.fileExists(atPath: socket) else {
    fputs("Open PlotIt MCP.app and finish setup before connecting the agent.\n", stderr)
    exit(1)
}
setenv("PLOTIT_RESOURCES", resources.path, 1)
let arguments = [node, script]
let pointers = arguments.map { strdup($0) } + [nil]
defer { pointers.forEach { free($0) } }
execv(node, pointers)
fputs("Could not launch the bundled PlotIt MCP runtime. Reinstall the app.\n", stderr)
exit(1)
