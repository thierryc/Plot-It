import SwiftUI

struct MenuPanel: View {
    let model: CompanionModel
    var updater: AppUpdater? = nil
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 10) {
                PlotItAppIcon().frame(width: 32, height: 32)
                VStack(alignment: .leading, spacing: 2) {
                    Text("PlotIt MCP").font(.headline)
                    Text(model.statusText).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Circle().fill(model.armed ? .green : model.connected ? .orange : .secondary).frame(width: 8, height: 8).accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 7) {
                Label(model.connected ? "Plotter connected" : "Plotter not connected", systemImage: "cable.connector")
                Label(model.status?.agents.isEmpty == false ? model.status!.agents.map(\.name).joined(separator: ", ") : "Waiting for an agent app", systemImage: "bubble.left.and.text.bubble.right")
            }.font(.caption).foregroundStyle(.secondary).accessibilityElement(children: .combine)
            if let job = model.status?.lastJob { JobCard(job: job, active: model.active, elapsedMs: model.status?.runner?.jobId == job.id ? model.status?.runner?.elapsedMs : nil, progress: model.status?.runner?.jobId == job.id ? model.status?.runner?.progress : nil) }
            else {
                VStack(alignment: .leading, spacing: 6) {
                    Label("Your next drawing starts here", systemImage: "square.and.pencil").font(.subheadline.weight(.medium))
                    Text("Connect your plotter and an agent app, then ask it to draw.").font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }.padding(14).frame(maxWidth: .infinity, alignment: .leading).background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))
            }
            Toggle(isOn: Binding(get: { model.agentControlEnabled }, set: { enabled in Task { await model.perform("arm", ["enabled": enabled]) } })) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Allow agent control when ready").font(.subheadline.weight(.medium))
                    Text(model.controlDetail).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }.toggleStyle(.switch).disabled(model.busy || !model.serviceAvailable)
            if !model.active && model.serviceAvailable {
                if model.status?.configured != true {
                    Button("Set Up Your Plotter…", systemImage: "checklist") { model.setupTab = 0; openWindow(id: "setup"); NSApplication.shared.activate(ignoringOtherApps: true) }
                } else if !model.connected {
                    Button("Connect Plotter", systemImage: "cable.connector") { Task { await model.perform("connect") } }.disabled(model.busy)
                } else if model.status?.ready != true {
                    Button("Set Drawing Origin…", systemImage: "scope") { model.setupTab = 0; openWindow(id: "setup"); NSApplication.shared.activate(ignoringOtherApps: true) }
                } else if model.status?.agents.isEmpty != false {
                    Button("Configure Agent Apps…", systemImage: "bubble.left.and.text.bubble.right") { model.setupTab = 1; openWindow(id: "setup"); NSApplication.shared.activate(ignoringOtherApps: true) }
                }
            }
            if model.active {
                HStack {
                    let state = model.status?.runner?.status ?? ""
                    Button(state == "tool-change" ? "Continue · pen loaded" : state == "paused" ? "Resume" : "Pause", systemImage: state == "paused" || state == "tool-change" ? "play.fill" : "pause.fill") {
                        Task { await model.perform("control", ["action": state == "tool-change" ? "continue" : state == "paused" ? "resume" : "pause"]) }
                    }.disabled(model.busy)
                    Spacer()
                    Button("Stop", systemImage: "stop.fill", role: .destructive) { Task { await model.perform("control", ["action": "stop"]) } }.disabled(model.busy)
                }
            }
            if let error = model.error { Label(error, systemImage: "exclamationmark.circle").font(.caption).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
            if model.waitingToQuit { Label("Will quit when motion has settled", systemImage: "clock").font(.caption).foregroundStyle(.secondary) }
            Divider()
            HStack {
                Button("Set Up…", systemImage: "slider.horizontal.3") { openWindow(id: "setup"); NSApplication.shared.activate(ignoringOtherApps: true) }
                Spacer()
                Button("Quit") { NSApplication.shared.terminate(nil) }.buttonStyle(.borderless).foregroundStyle(.secondary)
            }
            HStack {
            Button("About & Help…") { openWindow(id: "about"); NSApplication.shared.activate(ignoringOtherApps: true) }.buttonStyle(.borderless).font(.caption).foregroundStyle(.secondary)
                Spacer()
                if let updater {
                    Button(updater.readyVersion == nil ? "Check for Updates…" : "Update Ready…") { updater.check() }
                        .disabled(!updater.enabled || (!updater.canCheck && !updater.installationRequested))
                        .buttonStyle(.borderless).font(.caption)
                }
            }

        }
        .padding(18).frame(width: 350)
    }
}

struct JobCard: View {
    let job: Job
    let active: Bool
    let elapsedMs: Double?
    var progress: ProgressSnapshot?
    private var fraction: Double? {
        guard let completed = progress?.completed, let total = progress?.total, completed.isFinite, total.isFinite, total > 0 else { return nil }
        let copies = max(1, progress?.copies ?? 1)
        let copy = max(1, progress?.copy ?? 1)
        return min(0.99, max(0, (Double(copy - 1) + min(1, completed / total)) / Double(copies)))
    }
    private var title: String {
        switch job.status {
        case "pending": return "Ready to draw"
        case "running": return "Drawing in progress"
        case "tool-change": return "Load the next pen"
        case "returning": return "Returning to origin"
        case "finished": return "Drawing complete"
        default: return job.status.replacingOccurrences(of: "-", with: " ").capitalized
        }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let path = job.previewPath, let image = NSImage(contentsOfFile: path) {
                Image(nsImage: image).resizable().scaledToFit().frame(maxWidth: .infinity).frame(height: 140).background(.white).clipShape(RoundedRectangle(cornerRadius: 7))
                    .accessibilityLabel("Prepared drawing preview")
            }
            HStack {
                Text(title).font(.subheadline.weight(.medium))
                Spacer()
                if let duration = job.durationMs { Text(Duration.seconds(duration / 1000).formatted(.time(pattern: .minuteSecond))).font(.caption.monospacedDigit()).foregroundStyle(.secondary) }
            }
            if active {
                if let fraction {
                    ProgressView(value: fraction).accessibilityLabel("Estimated drawing progress")
                    HStack {
                        Text(fraction, format: .percent.precision(.fractionLength(0)))
                        Spacer()
                        if let elapsedMs { Text("\(Duration.seconds(elapsedMs / 1000).formatted(.time(pattern: .minuteSecond))) elapsed") }
                    }.font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                } else { ProgressView("Waiting for plotter progress…").controlSize(.small) }
                Text(fraction == 0.99 ? "Finishing · waiting for motion to settle" : "Estimated from commands sent to the plotter").font(.caption2).foregroundStyle(.secondary)
            }
            if let error = job.error { Text(error).font(.caption).foregroundStyle(.red) }
        }.padding(12).background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))
    }
}
