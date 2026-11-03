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
    @ObservationIgnored var isPreview = false
    @ObservationIgnored private let client = NativeClient()
    @ObservationIgnored private var polling: Task<Void, Never>?
    @ObservationIgnored private var activity: NSObjectProtocol?

    var connected: Bool { serviceAvailable && status?.runner?.connected == true }
    var armed: Bool { status?.armed == true }
    var active: Bool { status?.active == true }
    var statusText: String {
        if status == nil { return "Starting companion…" }
        if !serviceAvailable { return "Reconnecting to companion…" }
        if active { return status?.runner?.status.replacingOccurrences(of: "-", with: " ").capitalized ?? "Drawing" }
        return connected ? (armed ? "Ready for your agent" : "Connected · control disabled") : "No plotter connected"
    }
    var preview: NSImage? { guard let path = status?.lastJob?.previewPath else { return nil }; return NSImage(contentsOfFile: path) }
    var configurationJSON: String {
        let dict: [String: Any] = ["mcpServers": ["plotit": ["command": entry.command, "args": entry.args]]]
        guard let data = try? JSONSerialization.data(withJSONObject: dict, options: [.prettyPrinted, .sortedKeys]) else { return "" }
        return String(decoding: data, as: UTF8.self)
    }
    func start() {
        guard polling == nil else { return }
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
                    if self.waitingToQuit && !next.active { await self.finishQuit(); return }
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
    func perform(_ action: String, _ params: [String: Any] = [:], success: String? = nil) async {
        guard !busy else { return }; busy = true; defer { busy = false }
        do { _ = try await client.request(action, params); error = nil; notice = success; await refresh() } catch { self.error = error.localizedDescription }
    }
    func refresh() async { if let data = try? await client.request("status"), let next = try? JSONDecoder().decode(CompanionStatus.self, from: data) { status = next; updateActivity() } }
    func loadAgents() async {
        if isPreview { return }
        do {
            struct Response: Decodable { var agents: [AgentInstallation]; var entry: ServerEntry }
            let result = try JSONDecoder().decode(Response.self, from: await client.request("agent_status")); agents = result.agents; entry = result.entry
        } catch { self.error = error.localizedDescription }
    }
    func loadDevices() async {
        if isPreview { return }
        do { struct Response: Decodable { var devices: [Device] }; devices = try JSONDecoder().decode(Response.self, from: await client.request("devices")).devices } catch { self.error = error.localizedDescription }
    }
    func save(_ config: Machine) async {
        guard let value = try? JSONSerialization.jsonObject(with: JSONEncoder().encode(config)) else { return }
        await perform("save_machine", ["config": value], success: "Machine settings saved.")
    }
    func previewChange(_ agent: AgentInstallation, operation: String, replace: Bool = false) async {
        do {
            if !Bundle.main.bundleURL.path.hasPrefix("/Applications/") && !Bundle.main.bundleURL.path.hasPrefix(FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications").path + "/") { throw CompanionError.message("Move PlotIt MCP.app into Applications before configuring agent apps.") }
            let data = try await client.request("plan_agent", ["agent": agent.id, "operation": operation, "replace": replace]); agentChange = try JSONDecoder().decode(AgentChange.self, from: data)
        } catch { self.error = error.localizedDescription }
    }
    func applyChange(_ change: AgentChange) async {
        busy = true; defer { busy = false }
        do { _ = try await client.request("apply_agent", ["id": change.id]); agentChange = nil; error = nil; notice = change.agent == "claude-desktop" ? "Configuration saved. Restart Claude Desktop to connect." : "Configuration saved. Start a new agent session to connect."; await loadAgents() } catch { self.error = error.localizedDescription }
    }
    func testServer() async {
        do { let data = try await client.request("test_server"); let response = try JSONSerialization.jsonObject(with: data) as? [String: Any]; serverTestPassed = response?["ok"] as? Bool == true; notice = "Server test passed. Open your agent and ask it to check PlotIt’s status." } catch { self.error = error.localizedDescription }
    }
    func locate(_ agent: AgentInstallation) {
        let panel = NSOpenPanel(); panel.message = agent.id == "codex" ? "Choose Codex.app, ChatGPT.app, or the codex executable" : "Choose the claude executable"; panel.canChooseDirectories = false; panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task { await perform("locate_agent", ["agent": agent.id, "path": url.path]); await loadAgents() }
    }
    func chooseCodexConfiguration() {
        let panel = NSOpenPanel(); panel.message = "Choose the Codex configuration directory containing config.toml"; panel.canChooseDirectories = true; panel.canChooseFiles = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task { await perform("codex_config_directory", ["path": url.path]); await loadAgents() }
    }
    func setLogin(_ enabled: Bool) {
        do { if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }; loginEnabled = SMAppService.mainApp.status == .enabled } catch { self.error = error.localizedDescription }
    }
    func copyConfiguration() { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(configurationJSON, forType: .string); notice = "MCP configuration copied." }
    func requestQuit() {
        if !active { Task { await finishQuit() }; return }
        let alert = NSAlert(); alert.messageText = "A drawing is still running"; alert.informativeText = "Keep PlotIt open until it finishes, or stop the drawing before quitting."
        alert.addButton(withTitle: "Wait and Quit"); alert.addButton(withTitle: "Stop and Quit"); alert.addButton(withTitle: "Keep PlotIt Open")
        switch alert.runModal() {
        case .alertFirstButtonReturn: waitingToQuit = true; Task { await perform("arm", ["enabled": false]) }
        case .alertSecondButtonReturn: waitingToQuit = true; Task { await perform("arm", ["enabled": false]); await perform("control", ["action": "stop"]) }
        default: NSApplication.shared.reply(toApplicationShouldTerminate: false)
        }
    }
    private func finishQuit() async {
        do { _ = try await client.request("quit"); polling?.cancel(); client.stop(); NSApplication.shared.reply(toApplicationShouldTerminate: true); exit(0) } catch { waitingToQuit = false; self.error = error.localizedDescription; NSApplication.shared.reply(toApplicationShouldTerminate: false) }
    }
}
