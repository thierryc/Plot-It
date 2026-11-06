import AppKit
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let model: CompanionModel
    private let updater: AppUpdater
    private var windows: CompanionWindows?
    private var statusItem: StatusItemController?
    override init() { model = .shared; updater = .shared; super.init() }
    init(model: CompanionModel, updater: AppUpdater) { self.model = model; self.updater = updater; super.init() }
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.setActivationPolicy(.accessory)
        model.start()
        updater.start()
        let windows = CompanionWindows(model: model, updater: updater)
        self.windows = windows
        let statusItem = StatusItemController(model: model, updater: updater,
            openSetup: { [weak windows] in windows?.showSetup() },
            openAbout: { [weak windows] in windows?.showAbout() })
        self.statusItem = statusItem
        statusItem.start()
        let mainMenu = NSMenu()
        let application = NSMenuItem()
        let menu = NSMenu(title: "PlotIt")
        for (title, action, key) in [("About PlotIt MCP", #selector(showAbout), ""),
                                     ("Settings…", #selector(showSetup), ","),
                                     ("Quit PlotIt", #selector(quit), "q")] {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
            item.target = self
            menu.addItem(item)
        }
        application.submenu = menu
        mainMenu.addItem(application)
        let editing = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: "Edit")
        for (title, action, key) in [("Undo", Selector(("undo:")), "z"),
                                     ("Redo", Selector(("redo:")), "Z"),
                                     ("Cut", #selector(NSText.cut(_:)), "x"),
                                     ("Copy", #selector(NSText.copy(_:)), "c"),
                                     ("Paste", #selector(NSText.paste(_:)), "v"),
                                     ("Select All", #selector(NSText.selectAll(_:)), "a")] {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: key.lowercased())
            if title == "Redo" { item.keyEquivalentModifierMask = [.command, .shift] }
            editMenu.addItem(item)
        }
        editing.submenu = editMenu
        mainMenu.addItem(editing)
        NSApp.mainMenu = mainMenu
        if model.isPreview { statusItem.show() }
    }
    @objc private func showSetup() { windows?.showSetup() }
    @objc private func showAbout() { windows?.showAbout() }
    @objc private func quit() { NSApp.terminate(nil) }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { windows?.showSetup() }
        return true
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if model.isPreview { return .terminateNow }
        Task { @MainActor in self.model.requestQuit() }
        return .terminateLater
    }
    func applicationWillTerminate(_ notification: Notification) { statusItem?.stop() }
}

@main @MainActor
enum PlotItApplication {
    static func main() {
        let app = NSApplication.shared
        let delegate: AppDelegate
        #if DEBUG
        if ProcessInfo.processInfo.environment["PLOTIT_WINDOW_PREVIEW"] == "1" {
            let model = CompanionModel(); model.isPreview = true; model.serviceAvailable = true
            model.status = CompanionStatus(version: "0.1.0", configured: true, config: Machine(), armed: false, agents: [], preparing: false)
            model.status?.lastJob = Job(id: "window-preview", status: "finished", previewPath: ProcessInfo.processInfo.environment["PLOTIT_PREVIEW_PATH"], durationMs: 518962)
            delegate = AppDelegate(model: model, updater: AppUpdater(model: model))
        } else { delegate = AppDelegate() }
        #else
        delegate = AppDelegate()
        #endif
        app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
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
