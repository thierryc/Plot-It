import AppKit
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.setActivationPolicy(.accessory)
        CompanionModel.shared.start()
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        Task { @MainActor in CompanionModel.shared.requestQuit() }
        return .terminateLater
    }
}

@main @MainActor
struct PlotItApplication: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var model = CompanionModel.shared
    var body: some Scene {
        MenuBarExtra {
            MenuPanel(model: model)
        } label: {
            Image(systemName: model.active ? "scribble.variable" : "pencil.tip.crop.circle")
                .accessibilityLabel("PlotIt MCP: \(model.statusText)")
        }
        .menuBarExtraStyle(.window)

        Window("Set up PlotIt MCP", id: "setup") {
            SetupWindow(model: model)
        }
        .defaultSize(width: 740, height: 650)
        .windowResizability(.contentSize)
    }
}
