import AppKit
import SwiftUI
import XCTest
@testable import PlotItApp

final class StatusPanelTests: XCTestCase {
    func testPanelPlacementStaysBelowTheItemAndInsideEitherDisplay() {
        let size = NSSize(width: 336, height: 320)
        for screen in [NSRect(x: 0, y: 0, width: 1440, height: 880), NSRect(x: -1920, y: 200, width: 1920, height: 1000)] {
            for x in [screen.minX, screen.midX, screen.maxX - 20] {
                let anchor = NSRect(x: x, y: screen.maxY, width: 24, height: 24)
                let frame = StatusPanel.placement(size: size, anchor: anchor, visibleFrame: screen)
                XCTAssertTrue(screen.contains(frame))
                XCTAssertLessThan(frame.maxY, anchor.minY)
                XCTAssertEqual(frame.size, size)
            }
        }
    }
    func testTallPanelFitsAvailableHeightForScrolling() {
        let screen = NSRect(x: 0, y: 40, width: 1024, height: 700)
        let frame = StatusPanel.placement(size: NSSize(width: 336, height: 1600), anchor: NSRect(x: 800, y: 740, width: 24, height: 24), visibleFrame: screen)
        XCTAssertTrue(screen.contains(frame))
        XCTAssertEqual(frame.minY, screen.minY + 8)
        XCTAssertLessThan(frame.height, 1600)
    }
    @MainActor
    func testNativeGlassAndLegacyMaterialHaveOneTransparentWindowBoundary() {
        _ = NSApplication.shared
        let panel = StatusPanel()
        defer { panel.close() }
        XCTAssertFalse(panel.isOpaque)
        XCTAssertEqual(panel.backgroundColor.alphaComponent, 0)
        XCTAssertTrue(panel.hasShadow)
        XCTAssertTrue(panel.canBecomeKey)
        if #available(macOS 26, *) {
            let glass = panel.contentView as? NSGlassEffectView
            XCTAssertNotNil(glass)
            XCTAssertEqual(glass?.cornerRadius, 16)
            XCTAssertEqual(glass?.layer?.masksToBounds, true)
            XCTAssertNotNil(glass?.contentView as? NSScrollView)
        }
        let fallback = StatusPanel.makeSurface(content: NSView(), legacy: true) as? NSVisualEffectView
        XCTAssertEqual(fallback?.material, .popover)
        XCTAssertEqual(fallback?.layer?.cornerRadius, 16)
        XCTAssertEqual(fallback?.layer?.masksToBounds, true)
    }
    @MainActor
    func testPanelMeasuresItsContentAndEscapeDismissesWithoutHardware() {
        _ = NSApplication.shared
        let model = previewModel()
        let controller = StatusItemController(model: model, updater: AppUpdater(model: model), openSetup: {}, openAbout: {})
        defer { controller.stop() }
        let anchor = NSRect(x: 500, y: 800, width: 24, height: 24)
        controller.show(anchor: anchor, visibleFrame: NSRect(x: 0, y: 0, width: 1400, height: 800))
        XCTAssertTrue(controller.panel.isVisible)
        XCTAssertEqual(controller.panel.frame.height, ceil(controller.panel.measuredContentSize().height))
        XCTAssertGreaterThan(controller.panel.frame.height, 100)
        let previousHeight = controller.panel.frame.height, previousTop = controller.panel.frame.maxY
        model.error = "Example connection error"
        RunLoop.main.run(until: Date().addingTimeInterval(0.1))
        XCTAssertGreaterThan(controller.panel.frame.height, previousHeight)
        XCTAssertEqual(controller.panel.frame.maxY, previousTop)
        XCTAssertNil(controller.item)
        controller.panel.cancelOperation(nil)
        XCTAssertFalse(controller.panel.isVisible)
        XCTAssertTrue(model.isPreview)
        XCTAssertFalse(controller.panel.isOpaque)
    }
    @MainActor
    func testSetupWindowReopensOnceAndClosingClearsDraftPresence() {
        _ = NSApplication.shared
        let model = previewModel()
        let windows = CompanionWindows(model: model, updater: AppUpdater(model: model))
        windows.showSetup(); windows.showSetup()
        let matching = NSApp.windows.filter { $0.title == "Set up PlotIt MCP" && $0.isVisible }
        XCTAssertEqual(matching.count, 1)
        model.setupHasChanges = true
        matching.first?.close()
        XCTAssertFalse(model.setupHasChanges)
    }
    @MainActor
    func testAboutWindowGrowsWithReadyUpdateInformation() {
        _ = NSApplication.shared
        let model = previewModel(), updater = AppUpdater(model: previewModel())
        let windows = CompanionWindows(model: model, updater: updater)
        windows.showAbout()
        RunLoop.main.run(until: Date().addingTimeInterval(0.1))
        guard let window = NSApp.windows.first(where: { $0.title == "About PlotIt MCP" && $0.isVisible }) else { return XCTFail("About window did not open") }
        defer { window.close() }
        let height = window.contentLayoutRect.height
        updater.readyVersion = "0.1.0 (99)"
        updater.message = "An example update is ready to install."
        RunLoop.main.run(until: Date().addingTimeInterval(0.1))
        XCTAssertGreaterThan(window.contentLayoutRect.height, height)
    }
    @MainActor
    func testRealPanelWindowCanBeCapturedInLightAndDarkAppearance() throws {
        guard let directory = ProcessInfo.processInfo.environment["PLOTIT_CAPTURE_DIR"],
              let helper = ProcessInfo.processInfo.environment["PLOTIT_SCREENSHOT_HELPER"] else { return }
        _ = NSApplication.shared
        NSApp.setActivationPolicy(.regular)
        let model = previewModel()
        let controller = StatusItemController(model: model, updater: AppUpdater(model: model), openSetup: {}, openAbout: {})
        let backdrop = NSWindow(contentRect: NSRect(x: 200, y: 100, width: 600, height: 600), styleMask: [.borderless], backing: .buffered, defer: false)
        backdrop.isReleasedWhenClosed = false
        backdrop.backgroundColor = .windowBackgroundColor
        backdrop.orderFrontRegardless()
        defer { controller.stop(); backdrop.close() }
        try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
        for (name, appearance) in [("modern-panel-light", NSAppearance.Name.aqua), ("modern-panel-dark", .darkAqua)] {
            controller.panel.appearance = NSAppearance(named: appearance)
            backdrop.appearance = NSAppearance(named: appearance)
            backdrop.backgroundColor = appearance == .aqua ? .white : .black
            controller.show(anchor: NSRect(x: 480, y: 650, width: 24, height: 24), visibleFrame: NSRect(x: 200, y: 100, width: 600, height: 600))
            NSApp.activate(ignoringOtherApps: true)
            RunLoop.main.run(until: Date().addingTimeInterval(0.4))
            let path = URL(fileURLWithPath: directory).appendingPathComponent("\(name).png").path
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
            process.arguments = [helper, "--window-id", String(controller.panel.windowNumber), "--path", path]
            try process.run(); process.waitUntilExit()
            XCTAssertEqual(process.terminationStatus, 0)
            XCTAssertGreaterThan(try Data(contentsOf: URL(fileURLWithPath: path)).count, 1000)
            if let originScreen = NSScreen.screens.first {
                // Screen capture includes our neutral backdrop, rather than substituting a black backdrop for glass.
                let frame = controller.panel.frame.insetBy(dx: -16, dy: -16)
                let region = "\(Int(frame.minX)),\(Int(originScreen.frame.maxY - frame.maxY)),\(Int(frame.width)),\(Int(frame.height))"
                let contextCapture = Process()
                contextCapture.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
                contextCapture.arguments = [helper, "--region", region, "--path", URL(fileURLWithPath: directory).appendingPathComponent("\(name)-context.png").path]
                try contextCapture.run(); contextCapture.waitUntilExit()
                XCTAssertEqual(contextCapture.terminationStatus, 0)
            }
            controller.dismiss()
        }
    }
    @MainActor
    private func previewModel() -> CompanionModel {
        let model = CompanionModel(); model.isPreview = true; model.serviceAvailable = true
        model.status = CompanionStatus(version: "0.1.0", configured: true, config: Machine(), armed: false, agents: [], preparing: false)
        model.status?.lastJob = Job(id: "native-window-preview", status: "finished", previewPath: ProcessInfo.processInfo.environment["PLOTIT_PREVIEW_PATH"], durationMs: 518962)
        return model
    }
}
