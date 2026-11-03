import XCTest
import AppKit
import SwiftUI
@testable import PlotItApp

final class UISnapshotTests: XCTestCase {
    @MainActor
    func testNativeViewsRenderAtTheirSupportedSizes() throws {
        _ = NSApplication.shared
        let model = CompanionModel(); model.isPreview = true; model.serviceAvailable = true
        model.status = CompanionStatus(version: "0.1.0", configured: false, config: Machine(), armed: false, agents: [], preparing: false)
        model.agents = [
            AgentInstallation(id: "codex", path: "~/.codex/config.toml", configured: true),
            AgentInstallation(id: "claude-code", path: "~/.claude.json", configured: false),
            AgentInstallation(id: "claude-desktop", path: "~/Library/Application Support/Claude/claude_desktop_config.json", configured: false)
        ]
        model.entry = ServerEntry(command: "/Applications/PlotIt MCP.app/Contents/MacOS/plotit-mcp", args: [])
        for step in 0...2 {
            try capture(SetupWindow(model: model, initialStep: step), name: "setup-\(step)", size: NSSize(width: 746, height: 680))
        }
        try capture(MenuPanel(model: model), name: "menu", size: NSSize(width: 350, height: 360))
    }
    @MainActor
    private func capture<Content: View>(_ content: Content, name: String, size: NSSize) throws {
        let view = NSHostingView(rootView: content.environment(\.colorScheme, .light).background(Color.white))
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: .aqua)
        window.contentView = view; view.frame = NSRect(origin: .zero, size: size)
        view.layoutSubtreeIfNeeded(); view.displayIfNeeded()
        guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return XCTFail("Cannot render \(name)") }
        view.cacheDisplay(in: view.bounds, to: bitmap)
        let flattened = NSImage(size: size)
        flattened.lockFocus()
        NSColor.white.setFill()
        NSBezierPath(rect: NSRect(origin: .zero, size: size)).fill()
        bitmap.draw(in: NSRect(origin: .zero, size: size))
        flattened.unlockFocus()
        let representation = try XCTUnwrap(NSBitmapImageRep(data: try XCTUnwrap(flattened.tiffRepresentation)))
        let data = try XCTUnwrap(representation.representation(using: .png, properties: [:]))
        XCTAssertGreaterThan(data.count, 1000)
        if let path = ProcessInfo.processInfo.environment["PLOTIT_CAPTURE_DIR"] {
            try FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: true)
            try data.write(to: URL(fileURLWithPath: path).appendingPathComponent("\(name).png"))
        }
        window.close()
    }
}
