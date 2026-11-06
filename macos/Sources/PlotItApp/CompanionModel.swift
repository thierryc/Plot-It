import AppKit
import Foundation
import Observation
import ServiceManagement

@Observable @MainActor
final class CompanionModel {
    static let shared = CompanionModel()
    var status: CompanionStatus?
    var agents: [AgentInstallation] = []
    var devices: [Device] = []
    var error: String?
    var notice: String?
    var busy = false
    var serverTestPassed = false
    var serviceAvailable = false
    var entry = ServerEntry(command: "", args: [])
    var agentChange: AgentChange?
    var waitingToQuit = false
    var loginEnabled = SMAppService.mainApp.status == .enabled
    var connectionChanging = false
    var setupHasChanges = false
    var updateReservationGranted = false
    var setupTab = 0
    var loadingDevices = false
    static let firstPrompt = "Use PlotIt to check my setup, list the stroke fonts, and prepare a small hello-world drawing. Show me the preview and simulate it before starting. When I ask you to plot, show the live progress card."
    @ObservationIgnored var isPreview = false
    @ObservationIgnored private let client = NativeClient()
    @ObservationIgnored private var polling: Task<Void, Never>?
    @ObservationIgnored private var activity: NSObjectProtocol?

    var connected: Bool { serviceAvailable && status?.runner?.connected == true }
    var armed: Bool { status?.armed == true }
    var canChangeConnection: Bool {
        serviceAvailable && status?.configured == true && !busy && !connectionChanging && !active && (!setupHasChanges || connected) && !updateReservationGranted && status?.preparing != true && !waitingToQuit
    }
    func setConnection(_ connected: Bool) async {
        guard canChangeConnection, connected != self.connected else { return }
        connectionChanging = true; defer { connectionChanging = false }
        await perform(connected ? "connect" : "disconnect")
    }
    var connectionHelp: String {
        if active { return "Finish or stop the drawing before disconnecting." }
        if setupHasChanges && !connected { return "Save or discard setup changes first." }
        if busy || status?.preparing == true { return "Finishing the current operation." }
        if status?.configured != true { return "Save plotter settings in Set Up before connecting." }
        if !serviceAvailable { return "Waiting for the companion." }
        if updateReservationGranted { return "Installing an update." }
        return connected ? "Disconnect the plotter" : "Connect the plotter"
    }
    var controlDetail: String {
        if !serviceAvailable { return "Waiting for the local service." }
        return status?.controlBlocker ?? (armed ? "Agents can start prepared drawings." : "Waiting for the plotter to be ready.")
    }
    var active: Bool { status?.active == true }
    var updateBlocker: String? {
        if !serviceAvailable { return "Reconnect the companion before installing an update." }
        if active { return "Finish the current drawing before installing an update." }
        if status?.preparing == true || busy { return "Wait until preparation and calibration finish." }
        if setupHasChanges { return "Save or discard your setup changes before updating." }
        if agentChange != nil { return "Finish reviewing the agent configuration first." }
        return nil
    }
    func reserveForUpdate() async throws {
        if let blocker = updateBlocker { throw CompanionError.message(blocker) }
        if updateReservationGranted { return }
        guard !isPreview else { throw CompanionError.message("Updates are unavailable in previews.") }
        _ = try await client.request("prepare_update")
        updateReservationGranted = true
    }
    func cancelUpdateReservation() async {
        guard !isPreview else { return }
        do {
            _ = try await client.request("cancel_update")
            updateReservationGranted = false
        } catch { self.error = error.localizedDescription }
    }

    var compatibleDeviceCount: Int { devices.filter(\.compatible).count }
    var deviceHint: String {
        if loadingDevices { return "Looking for USB devices…" }
        switch compatibleDeviceCount {
        case 0: return "No EBB plotter detected. Connect USB, then refresh devices."
        case 1: return "One compatible EBB plotter detected."
        default: return "Multiple EBB plotters detected. Choose the USB device to use."
        }
    }
    var statusText: String {
        if status == nil { return "Starting companion…" }
        if !serviceAvailable { return "Reconnecting to companion…" }
        if active { return status?.runner?.status.replacingOccurrences(of: "-", with: " ").capitalized ?? "Drawing" }
        return connected ? (armed ? "Ready for your agent" : status?.ready != true ? "Connected · set drawing origin" : "Connected · control disabled") : "No plotter connected"
    }
    var preview: NSImage? { guard let path = status?.lastJob?.previewPath else { return nil }; return NSImage(contentsOfFile: path) }
    var configurationJSON: String {
        let dict: [String: Any] = ["mcpServers": ["plotit": ["command": entry.command, "args": entry.args]]]
        guard let data = try? JSONSerialization.data(withJSONObject: dict, options: [.prettyPrinted, .sortedKeys]) else { return "" }
        return String(decoding: data, as: UTF8.self)
    }
    func start() {
        guard polling == nil, !isPreview else { return }
        do { try client.start() } catch { self.error = error.localizedDescription; return }
        polling = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                do {
                    let data = try await self.client.request("heartbeat")
                    let next = try JSONDecoder().decode(CompanionStatus.self, from: data)
                    self.serviceAvailable = true
                    if next != self.status { self.status = next }
                    self.updateActivity()
                    if self.waitingToQuit && !next.active {
                        await self.finishQuit()
                        if Task.isCancelled { return }
                    }
                } catch { self.serviceAvailable = false; self.status?.armed = false; self.serverTestPassed = false; self.error = error.localizedDescription }
                try? await Task.sleep(for: .seconds(1))
            }
        }
        Task { await loadAgents(); await loadDevices() }
    }
    private func updateActivity() {
        if active && activity == nil { activity = ProcessInfo.processInfo.beginActivity(options: [.idleSystemSleepDisabled, .userInitiated], reason: "Finishing a PlotIt drawing") }
        if !active, let activity { ProcessInfo.processInfo.endActivity(activity); self.activity = nil }
    }
    @discardableResult
    func perform(_ action: String, _ params: [String: Any] = [:], success: String? = nil) async -> Bool {
        guard !busy, !isPreview, !updateReservationGranted else { return false }; busy = true; defer { busy = false }
        do { _ = try await client.request(action, params); error = nil; notice = success; await refresh(); return true } catch { self.error = error.localizedDescription; return false }
    }
    func refresh() async { guard !isPreview else { return }; if let data = try? await client.request("status"), let next = try? JSONDecoder().decode(CompanionStatus.self, from: data) { status = next; updateActivity() } }
    func loadAgents() async {
        if isPreview { return }
        do {
            struct Response: Decodable { var agents: [AgentInstallation]; var entry: ServerEntry }
            let result = try JSONDecoder().decode(Response.self, from: await client.request("agent_status")); agents = result.agents; entry = result.entry
        } catch { self.error = error.localizedDescription }
    }
    func loadDevices() async {
        if isPreview || loadingDevices { return }
        loadingDevices = true; defer { loadingDevices = false }
        do { struct Response: Decodable { var devices: [Device] }; devices = try JSONDecoder().decode(Response.self, from: await client.request("devices")).devices } catch { self.error = error.localizedDescription }
    }
    @discardableResult
    func save(_ config: Machine, expectedDigest: String? = nil) async -> Bool {
        guard let value = try? JSONSerialization.jsonObject(with: JSONEncoder().encode(config)) else { error = "Check the machine settings before saving."; return false }
        var params: [String: Any] = ["config": value]
        if let expectedDigest { params["expectedConfigDigest"] = expectedDigest }
        return await perform("save_machine", params, success: "Machine settings saved.")
    }
    func previewChange(_ agent: AgentInstallation, operation: String, replace: Bool = false) async {
        guard !isPreview, !busy else { return }
        do {
            if !Bundle.main.bundleURL.path.hasPrefix("/Applications/") && !Bundle.main.bundleURL.path.hasPrefix(FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications").path + "/") { throw CompanionError.message("Move PlotIt MCP.app into Applications before configuring agent apps.") }
            let data = try await client.request("plan_agent", ["agent": agent.id, "operation": operation, "replace": replace]); agentChange = try JSONDecoder().decode(AgentChange.self, from: data)
        } catch { self.error = error.localizedDescription }
    }
    func applyChange(_ change: AgentChange) async {
        guard !isPreview, !busy else { return }
        busy = true; defer { busy = false }
        do { _ = try await client.request("apply_agent", ["id": change.id]); agentChange = nil; error = nil; notice = change.agent == "claude-desktop" ? "Configuration saved. Restart Claude Desktop to connect." : "Configuration saved. Start a new agent session to connect."; await loadAgents() } catch { self.error = error.localizedDescription }
    }
    func testServer() async {
        guard !isPreview, !busy else { return }
        busy = true; defer { busy = false }
        do {
            let data = try await client.request("test_server")
            let response = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            guard response?["ok"] as? Bool == true else { throw CompanionError.message("The server test did not pass. Try again after reconnecting the companion.") }
            serverTestPassed = true; error = nil; notice = "Server test passed. Open your agent and ask it to check PlotIt’s status."
        } catch { serverTestPassed = false; self.error = error.localizedDescription }
    }
    func locate(_ agent: AgentInstallation) {
        guard !isPreview else { return }
        let panel = NSOpenPanel(); panel.message = agent.id == "codex" ? "Choose Codex.app, ChatGPT.app, or the codex executable" : "Choose the claude executable"; panel.canChooseDirectories = false; panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task { await perform("locate_agent", ["agent": agent.id, "path": url.path]); await loadAgents() }
    }
    func chooseCodexConfiguration() {
        guard !isPreview else { return }
        let panel = NSOpenPanel(); panel.message = "Choose the Codex configuration directory containing config.toml"; panel.canChooseDirectories = true; panel.canChooseFiles = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task { await perform("codex_config_directory", ["path": url.path]); await loadAgents() }
    }
    func setLogin(_ enabled: Bool) {
        guard !isPreview else { return }
        do { if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }; loginEnabled = SMAppService.mainApp.status == .enabled } catch { self.error = error.localizedDescription }
    }
    func copyConfiguration() { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(configurationJSON, forType: .string); notice = "MCP configuration copied." }
    func copyFirstPrompt() { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(Self.firstPrompt, forType: .string); notice = "First agent prompt copied." }
    func requestQuit() {
        if AppUpdater.shared.installationRequested {
            Task { await finishQuit() }
            return
        }
        if !active { Task { await finishQuit() }; return }
        let alert = NSAlert(); alert.messageText = "A drawing is still running"; alert.informativeText = "Keep PlotIt open until it finishes, or stop the drawing before quitting."
        alert.addButton(withTitle: "Wait and Quit"); alert.addButton(withTitle: "Stop and Quit"); alert.addButton(withTitle: "Keep PlotIt Open")
        switch alert.runModal() {
        case .alertFirstButtonReturn: waitingToQuit = true; Task { await perform("suspend_control") }
        case .alertSecondButtonReturn: waitingToQuit = true; Task { await perform("suspend_control"); await perform("control", ["action": "stop"]) }
        default: NSApplication.shared.reply(toApplicationShouldTerminate: false)
        }
    }
    private func finishQuit() async {
        do { try await reserveForUpdate(); _ = try await client.request("quit"); polling?.cancel(); client.stop(); NSApplication.shared.reply(toApplicationShouldTerminate: true) } catch { await cancelUpdateReservation(); waitingToQuit = false; self.error = error.localizedDescription; NSApplication.shared.reply(toApplicationShouldTerminate: false) }
    }
}
