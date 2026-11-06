import AppKit
import Observation
import SwiftUI

/// Owns the outer window, rather than rounding content inside MenuBarExtra's older frame.
@MainActor
final class StatusPanel: NSPanel {
    static let surfaceRadius: CGFloat = 16
    private let scrollView = NSScrollView()
    private var hostedView: NSView?
    private(set) var contentSize = NSSize(width: 336, height: 120)
    var dismiss: (() -> Void)?

    init() {
        super.init(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        title = "PlotIt"
        isReleasedWhenClosed = false
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        isMovable = false
        hidesOnDeactivate = false
        level = .statusBar
        collectionBehavior = [.transient, .moveToActiveSpace, .fullScreenAuxiliary]
        animationBehavior = .utilityWindow
        scrollView.drawsBackground = false
        scrollView.borderType = .noBorder
        scrollView.contentView.drawsBackground = false
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.scrollerStyle = .overlay
        scrollView.autoresizingMask = [.width, .height]
        contentView = Self.makeSurface(content: scrollView)
    }
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
    override func cancelOperation(_ sender: Any?) { dismiss?() }
    override func performClose(_ sender: Any?) { dismiss?() }

    static func makeSurface(content: NSView, legacy: Bool = false) -> NSView {
        if #available(macOS 26, *), !legacy {
            let glass = NSGlassEffectView()
            glass.style = .regular
            glass.cornerRadius = surfaceRadius
            glass.wantsLayer = true
            glass.layer?.cornerRadius = surfaceRadius
            glass.layer?.cornerCurve = .continuous
            glass.layer?.masksToBounds = true
            glass.contentView = content
            return glass
        } else {
            let material = NSVisualEffectView()
            material.material = .popover
            material.blendingMode = .behindWindow
            material.state = .active
            material.wantsLayer = true
            material.layer?.cornerRadius = surfaceRadius
            material.layer?.cornerCurve = .continuous
            material.layer?.masksToBounds = true
            content.autoresizingMask = [.width, .height]
            material.addSubview(content)
            return material
        }
    }

    func host<Content: View>(_ content: Content) {
        let hosting = NSHostingView(rootView: content.fixedSize(horizontal: false, vertical: true))
        hosting.sizingOptions = [.intrinsicContentSize]
        hosting.frame = NSRect(origin: .zero, size: contentSize)
        hostedView = hosting
        scrollView.documentView = hosting
    }
    func resizeContent(_ size: NSSize, anchor: NSRect, visibleFrame: NSRect) {
        guard size.width.isFinite, size.height.isFinite, size.width > 0, size.height > 0 else { return }
        contentSize = NSSize(width: ceil(size.width), height: ceil(size.height))
        hostedView?.setFrameSize(contentSize)
        let target = Self.placement(size: contentSize, anchor: anchor, visibleFrame: visibleFrame)
        if frame != target { setFrame(target, display: true) }
        scrollView.frame = NSRect(origin: .zero, size: target.size)
        invalidateShadow()
    }
    func measuredContentSize() -> NSSize {
        hostedView?.layoutSubtreeIfNeeded()
        return hostedView?.fittingSize ?? contentSize
    }
    nonisolated static func placement(size: NSSize, anchor: NSRect, visibleFrame: NSRect) -> NSRect {
        let inset = visibleFrame.insetBy(dx: 8, dy: 0)
        let width = min(size.width, max(1, inset.width))
        let top = min(anchor.minY - 3, inset.maxY)
        let height = min(size.height, max(1, top - inset.minY - 8))
        return NSRect(x: min(max(anchor.midX - width / 2, inset.minX), inset.maxX - width),
                      y: top - height, width: width, height: height)
    }
}

private struct PanelContentSize: PreferenceKey {
    static var defaultValue = CGSize.zero
    static func reduce(value: inout CGSize, nextValue: () -> CGSize) { value = nextValue() }
}

private struct StatusPanelContent: View {
    let model: CompanionModel
    let updater: AppUpdater
    let openSetup: () -> Void
    let openAbout: () -> Void
    let resize: (CGSize) -> Void
    var body: some View {
        MenuPanel(model: model, updater: updater, openSetup: openSetup, openAbout: openAbout)
            .environment(\.controlActiveState, .active)
            .background { GeometryReader { proxy in Color.clear.preference(key: PanelContentSize.self, value: proxy.size) } }
            .onPreferenceChange(PanelContentSize.self, perform: resize)
    }
}

@MainActor
final class StatusItemController: NSObject {
    private let model: CompanionModel
    private let updater: AppUpdater
    private let openSetup: () -> Void
    private let openAbout: () -> Void
    private(set) var item: NSStatusItem?
    let panel = StatusPanel()
    private var localMonitor: Any?
    private var globalMonitor: Any?
    private var observers: [NSObjectProtocol] = []
    private var anchor = NSRect.zero
    private var availableFrame = NSRect.zero

    init(model: CompanionModel, updater: AppUpdater, openSetup: @escaping () -> Void, openAbout: @escaping () -> Void) {
        self.model = model; self.updater = updater
        self.openSetup = openSetup; self.openAbout = openAbout
        super.init()
        panel.dismiss = { [weak self] in self?.dismiss() }
        panel.host(StatusPanelContent(model: model, updater: updater,
            openSetup: { [weak self] in guard let self else { return }; self.dismiss(); self.openSetup() },
            openAbout: { [weak self] in guard let self else { return }; self.dismiss(); self.openAbout() },
            resize: { [weak self] size in Task { @MainActor in self?.resize(size) } }))
        observePresentation()
    }
    func start() {
        guard item == nil else { return }
        let status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        status.autosaveName = "PlotIt"
        item = status
        if #available(macOS 27, *) { status.expandedInterfaceDelegate = self }
        else { status.button?.target = self; status.button?.action = #selector(toggle) }
        updateIcon()
    }
    func stop() {
        dismiss()
        if let item { NSStatusBar.system.removeStatusItem(item) }
        item = nil
    }
    private func observePresentation() {
        withObservationTracking {
            _ = model.status; _ = model.serviceAvailable; _ = model.error
            _ = model.waitingToQuit; _ = model.connectionChanging
            _ = updater.readyVersion; _ = updater.message
        } onChange: { [weak self] in Task { @MainActor in
            guard let self else { return }
            self.updateIcon()
            if self.panel.isVisible { self.resize(self.panel.measuredContentSize()) }
            self.observePresentation()
        } }
    }
    private func updateIcon() {
        let connected = model.connected, plotting = model.active
        item?.button?.image = PlotItIcons.menuBar(connected: connected, plotting: plotting)
        let state = connected ? plotting ? "Drawing" : "Connected" : "Disconnected"
        item?.button?.toolTip = "PlotIt · \(state)"
        item?.button?.setAccessibilityLabel("PlotIt: \(state)")
    }
    @objc private func toggle() { if panel.isVisible { dismiss() } else { show() } }
    func show() {
        guard let button = item?.button, let window = button.window, let screen = window.screen else { return }
        show(anchor: window.convertToScreen(button.convert(button.bounds, to: nil)), visibleFrame: screen.visibleFrame)
    }
    func show(anchor: NSRect, visibleFrame: NSRect) {
        self.anchor = anchor; availableFrame = visibleFrame
        resize(panel.measuredContentSize())
        panel.makeKeyAndOrderFront(nil)
        if #unavailable(macOS 27) { item?.button?.state = .on }
        monitorDismissal()
    }
    private func resize(_ size: CGSize) {
        guard availableFrame.width > 0 else { return }
        panel.resizeContent(size, anchor: anchor, visibleFrame: availableFrame)
    }
    func dismiss() {
        hide()
        if #available(macOS 27, *) { item?.expandedInterfaceSession?.cancel() }
    }
    private func hide() {
        if let localMonitor { NSEvent.removeMonitor(localMonitor); self.localMonitor = nil }
        if let globalMonitor { NSEvent.removeMonitor(globalMonitor); self.globalMonitor = nil }
        for observer in observers { NotificationCenter.default.removeObserver(observer); NSWorkspace.shared.notificationCenter.removeObserver(observer) }
        observers.removeAll()
        panel.orderOut(nil)
        if #unavailable(macOS 27) { item?.button?.state = .off }
    }
    private func monitorDismissal() {
        guard localMonitor == nil else { return }
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .keyDown]) { [weak self] event in
            guard let self else { return event }
            // Allow the More menu to track its own items and Escape before dismissing its parent.
            if let window = event.window, window.level.rawValue >= NSWindow.Level.popUpMenu.rawValue { return event }
            if event.type == .keyDown, event.keyCode == 53 { self.dismiss(); return nil }
            if event.type != .keyDown, event.window !== self.panel, event.window !== self.item?.button?.window { self.dismiss() }
            return event
        }
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            Task { @MainActor in self?.dismiss() }
        }
        for name in [NSApplication.didChangeScreenParametersNotification, NSApplication.didResignActiveNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.dismiss() }
            })
        }
        observers.append(NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.activeSpaceDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.dismiss() }
        })
    }
}

@available(macOS 27, *)
extension StatusItemController: @preconcurrency NSStatusItemExpandedInterfaceDelegate {
    func statusItem(_ statusItem: NSStatusItem, didBegin session: NSStatusItemExpandedInterfaceSession) { show() }
    func statusItemDidEndExpandedInterfaceSession(_ statusItem: NSStatusItem, animated: Bool) { hide() }
}
