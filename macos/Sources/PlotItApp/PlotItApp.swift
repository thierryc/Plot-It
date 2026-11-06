import AppKit
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.setActivationPolicy(.accessory)
        CompanionModel.shared.start()
        AppUpdater.shared.start()
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
            MenuPanel(model: model, updater: AppUpdater.shared)
        } label: {
            Image(nsImage: PlotItIcons.menuBar(connected: model.connected, plotting: model.active))
                .accessibilityLabel("PlotIt: \(model.connected ? model.active ? "Drawing" : "Connected" : "Disconnected")")
        }
        .menuBarExtraStyle(.window)

        Window("Set up PlotIt MCP", id: "setup") {
            SetupWindow(model: model)
        }
        .defaultSize(width: 800, height: 720)
        .windowResizability(.contentMinSize)

        Window("About PlotIt MCP", id: "about") { AboutView(updater: AppUpdater.shared) }
            .windowResizability(.contentSize)
    }
}

struct AboutView: View {
    var updater: AppUpdater? = nil
    private var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "Development" }
    private var build: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "local" }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 14) {
                Image(nsImage: NSApplication.shared.applicationIconImage).resizable().frame(width: 64, height: 64).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 5) { Text("PlotIt MCP").font(.title2.weight(.semibold)); Text("Version \(version) · build \(build)").font(.caption).foregroundStyle(.secondary) }
            }
            Text("A local bridge between your agent and your USB pen plotter. macOS 14 or later.").font(.callout)
            Text("PlotIt stores settings, drawings and logs on this Mac. Your chosen agent receives the tool results and previews you request. No PlotIt account is required.").font(.caption).foregroundStyle(.secondary)
            if let updater { UpdateControls(updater: updater) }
            Link("Setup and troubleshooting", destination: URL(string: "https://github.com/thierryc/Plot-It/blob/main/docs/PLOTIT_MCP.md")!)
            Link("Report an issue", destination: URL(string: "https://github.com/thierryc/Plot-It/issues")!)
            Button("Open Local Data Folder", systemImage: "folder") { NSWorkspace.shared.open(FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/PlotIt MCP")) }
            Text("Apache License 2.0. Source and third-party notices are included in the application bundle. Hardware profiles remain experimental pending physical acceptance.").font(.caption2).foregroundStyle(.secondary)
        }.padding(26).frame(width: 430)
    }
}
