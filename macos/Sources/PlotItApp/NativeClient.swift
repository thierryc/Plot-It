import Foundation
import Darwin

/// A persistent bundled Node adapter handles Unix-socket IO off the UI thread.
@MainActor
final class NativeClient {
    private var process: Process?
    private var input: FileHandle?
    private var pending: [String: CheckedContinuation<Data, Error>] = [:]
    private var timeouts: [String: Task<Void, Never>] = [:]
    private var buffer = Data()
    let session = UUID().uuidString

    func start() throws {
        guard process == nil else { return }
        guard let resources = Bundle.main.resourceURL else { throw CompanionError.message("The application resources are missing.") }
        let p = Process(), stdin = Pipe(), stdout = Pipe()
        p.executableURL = resources.appendingPathComponent("runtime/node")
        p.arguments = [resources.appendingPathComponent("runtime/ui-client.mjs").path]
        var env = ProcessInfo.processInfo.environment
        env["PLOTIT_RESOURCES"] = resources.path
        env["PLOTIT_UI_SESSION"] = session
        p.environment = env
        p.standardInput = stdin; p.standardOutput = stdout
        let logDirectory = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/PlotIt MCP")
        try FileManager.default.createDirectory(at: logDirectory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let logURL = logDirectory.appendingPathComponent("native-client.log")
        if !FileManager.default.fileExists(atPath: logURL.path) { FileManager.default.createFile(atPath: logURL.path, contents: nil, attributes: [.posixPermissions: 0o600]) }
        let descriptor = Darwin.open(logURL.path, O_WRONLY | O_APPEND)
        guard descriptor >= 0 else { throw CompanionError.message("Could not open the companion log.") }
        p.standardError = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            Task { @MainActor in self?.receive(data) }
        }
        p.terminationHandler = { [weak self] _ in Task { @MainActor in
            self?.process = nil; self?.input = nil
            self?.failAll("The PlotIt connection ended. Reconnecting…")
        } }
        try p.run(); process = p; input = stdin.fileHandleForWriting
    }
    func request(_ action: String, _ params: [String: Any] = [:]) async throws -> Data {
        if process == nil { try start() }
        guard let input else { throw CompanionError.message("PlotIt is still starting.") }
        let id = UUID().uuidString
        let data = try JSONSerialization.data(withJSONObject: ["id": id, "action": action, "params": params]) + Data([10])
        return try await withCheckedThrowingContinuation { continuation in
            pending[id] = continuation
            timeouts[id] = Task { [weak self] in
                try? await Task.sleep(for: .seconds(35))
                guard !Task.isCancelled, let self else { return }
                self.timeouts.removeValue(forKey: id)
                self.pending.removeValue(forKey: id)?.resume(throwing: CompanionError.message("PlotIt timed out. Check the drawing state before trying again."))
            }
            do { try input.write(contentsOf: data) } catch { timeouts.removeValue(forKey: id)?.cancel(); pending.removeValue(forKey: id)?.resume(throwing: error) }
        }
    }
    private func receive(_ data: Data) {
        guard !data.isEmpty else { failAll("The companion connection closed."); return }
        buffer.append(data)
        if buffer.count > 8 * 1024 * 1024 { failAll("Companion response exceeded its limit."); return }
        while let newline = buffer.firstIndex(of: 10) {
            let line = buffer[..<newline]; buffer.removeSubrange(...newline)
            do {
                guard let reply = try JSONSerialization.jsonObject(with: Data(line)) as? [String: Any], let id = reply["id"] as? String, let continuation = pending.removeValue(forKey: id) else { continue }
                timeouts.removeValue(forKey: id)?.cancel()
                if reply["ok"] as? Bool == true { continuation.resume(returning: try JSONSerialization.data(withJSONObject: reply["value"] ?? [:])) }
                else { continuation.resume(throwing: CompanionError.message(reply["error"] as? String ?? "PlotIt request failed.")) }
            } catch { failAll(error.localizedDescription) }
        }
    }
    private func failAll(_ message: String) {
        let waiting = pending; pending.removeAll(); timeouts.values.forEach { $0.cancel() }; timeouts.removeAll()
        waiting.values.forEach { $0.resume(throwing: CompanionError.message(message)) }
    }
    func stop() { input?.closeFile(); input = nil; process?.terminate(); process = nil; failAll("PlotIt closed.") }
}
