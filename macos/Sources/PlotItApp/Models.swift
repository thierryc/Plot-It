import Foundation

struct Machine: Codable, Equatable {
    var profile = "axidraw"
    var rotation = 90
    var servo = "standard"
    var penUp = 50.0
    var penDown = 60.0
    var speed = 35.0
    var travelSpeed = 60.0
    var widthMm = 210.0
    var heightMm = 297.0
    var firmware = "2.8.1"
    var device = ""
    static let profiles: [(String, String)] = [("axidraw", "AxiDraw A4"), ("axidraw-a3", "AxiDraw A3"), ("xylodraw", "XyloDraw"), ("nextdraw-8511", "NextDraw 8511"), ("nextdraw-1117", "NextDraw 1117"), ("nextdraw-2234", "NextDraw 2234")]
    var displayName: String { Self.profiles.first { $0.0 == profile }?.1 ?? profile }
}
struct PaperPreset: Decodable, Equatable, Identifiable {
    let name: String
    let width: Double
    let height: Double
    var id: String { name }
    func matches(_ machine: Machine) -> Bool { abs(width - machine.widthMm) < 0.005 && abs(height - machine.heightMm) < 0.005 }
}
enum PaperDimension {
    static func parse(_ text: String) -> Double? {
        let scanner = Scanner(string: text.trimmingCharacters(in: .whitespacesAndNewlines))
        scanner.locale = Locale.current
        guard let value = scanner.scanDouble(), scanner.isAtEnd, value.isFinite, (1...1000).contains(value) else { return nil }
        return value
    }
}
struct RunnerSnapshot: Decodable, Equatable {
    var connected: Bool
    var firmware: String?
    var jobId: String?
    var status: String
    var origin: String
    var error: String?
    var elapsedMs: Double?
    var progress: ProgressSnapshot?
}
struct ProgressSnapshot: Decodable, Equatable {
    var completed: Double?
    var total: Double?
    var fraction: Double?
    var progress: Double?
    var remainingMs: Double?
    var copy: Int?
    var copies: Int?
}
struct Job: Decodable, Equatable {
    var id: String
    var status: String
    var previewPath: String?
    var durationMs: Double?
    var drawingMm: Double?
    var error: String?
}
struct ConnectedAgent: Decodable, Identifiable, Equatable { var id: String; var name: String }
struct CompanionStatus: Decodable, Equatable {
    var version: String
    var configured: Bool
    var config: Machine
    var armed: Bool
    var runner: RunnerSnapshot?
    var agents: [ConnectedAgent]
    var lastJob: Job?
    var preparing: Bool
    var paperPresets: [PaperPreset]?
    var controlBlocker: String?
    var configDigest: String?
    var active: Bool { guard let runner else { return false }; return !["idle", "pending", "finished", "stopped", "failed", "interrupted"].contains(runner.status) }
    var ready: Bool { configured && runner?.connected == true && ["automatic", "explicit"].contains(runner?.origin ?? "unset") }
}
struct AgentInstallation: Decodable, Identifiable, Equatable {
    var id: String; var path: String; var configured: Bool; var cli: String?; var error: String?
    var name: String { ["codex": "Codex", "claude-code": "Claude Code", "claude-desktop": "Claude Desktop"][id] ?? id }
    var symbol: String { id == "claude-code" ? "terminal" : "bubble.left.and.text.bubble.right" }
    func matches(clientName: String) -> Bool {
        let name = clientName.lowercased()
        switch id {
        case "codex": return name.contains("codex")
        case "claude-code": return name.contains("claude-code") || name.contains("claude code")
        case "claude-desktop": return !name.contains("code") && (name.contains("claude-desktop") || name.contains("claude desktop") || name == "claude-ai")
        default: return false
        }
    }
}
struct AgentChange: Decodable, Identifiable {
    var id: String; var agent: String; var operation: String; var path: String; var before: String; var after: String; var conflict: Bool
    var entry: ServerEntry
    var command: [String]?
}
struct ServerEntry: Codable { var command: String; var args: [String] }
struct Device: Decodable, Identifiable {
    var path: String; var manufacturer: String?; var vendorId: String?; var productId: String?; var id: String { path }
    var compatible: Bool { vendorId?.lowercased() == "04d8" && productId?.lowercased() == "fd92" }
}

enum CompanionError: LocalizedError {
    case message(String)
    var errorDescription: String? { switch self { case .message(let text): return text } }
}
