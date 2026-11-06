import AppKit
import SwiftUI

/// Keeps the setup and help windows independent of the transient status panel.
@MainActor
final class CompanionWindows: NSObject, NSWindowDelegate {
    private let model: CompanionModel
    private let updater: AppUpdater
    private var setup: NSWindow?
    private var about: NSWindow?

    init(model: CompanionModel, updater: AppUpdater) { self.model = model; self.updater = updater }
    func showSetup() {
        if setup == nil {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 800, height: 720),
                                  styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            window.title = "Set up PlotIt MCP"
            window.isReleasedWhenClosed = false
            window.contentMinSize = NSSize(width: 746, height: 680)
            window.contentViewController = NSHostingController(rootView:
                SetupWindow(model: model, updater: updater, onDone: { [weak self] in self?.setup?.close() }))
            window.delegate = self
            window.center()
            setup = window
        }
        setup?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    func showAbout() {
        if about == nil {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 430, height: 520),
                                  styleMask: [.titled, .closable], backing: .buffered, defer: false)
            window.title = "About PlotIt MCP"
            window.isReleasedWhenClosed = false
            let hosting = NSHostingView(rootView: AboutView(updater: updater)
                .fixedSize(horizontal: false, vertical: true)
                .background { GeometryReader { proxy in Color.clear
                    .onChange(of: proxy.size, initial: true) { _, size in
                        Task { @MainActor [weak window] in
                            guard size.width > 0, size.height > 0, let window else { return }
                            if window.contentLayoutRect.size != size { window.setContentSize(size) }
                        }
                    }
                } })
            hosting.frame = NSRect(x: 0, y: 0, width: 430, height: 520)
            window.contentView = hosting
            window.delegate = self
            window.center()
            about = window
        }
        about?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    func windowWillClose(_ notification: Notification) {
        if notification.object as? NSWindow === setup { setup = nil; model.setupHasChanges = false }
        if notification.object as? NSWindow === about { about = nil }
    }
}
