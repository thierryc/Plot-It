import SwiftUI

struct MenuPanel: View {
    let model: CompanionModel
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 10) {
                Image(systemName: "pencil.tip.crop.circle.fill").font(.system(size: 30)).foregroundStyle(.teal)
                VStack(alignment: .leading, spacing: 2) {
                    Text("PlotIt MCP").font(.headline)
                    Text(model.statusText).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Circle().fill(model.armed ? .green : model.connected ? .orange : .secondary).frame(width: 8, height: 8).accessibilityHidden(true)
            }
            if let job = model.status?.lastJob { JobCard(job: job, active: model.active, elapsedMs: model.status?.runner?.elapsedMs) }
            else {
                VStack(alignment: .leading, spacing: 6) {
                    Label("Your next drawing starts here", systemImage: "square.and.pencil").font(.subheadline.weight(.medium))
                    Text("Connect your plotter and an agent app, then ask it to draw.").font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }.padding(14).frame(maxWidth: .infinity, alignment: .leading).background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))
            }
            Toggle(isOn: Binding(get: { model.armed }, set: { enabled in Task { await model.perform("arm", ["enabled": enabled]) } })) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Agent control").font(.subheadline.weight(.medium))
                    Text(model.armed ? "Agents can start prepared drawings." : "Enable for this session when ready.").font(.caption).foregroundStyle(.secondary)
                }
            }.toggleStyle(.switch).disabled(model.busy || !model.serviceAvailable || model.status?.ready != true)
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
        }
        .padding(18).frame(width: 350)
    }
}

struct JobCard: View {
    let job: Job
    let active: Bool
    let elapsedMs: Double?
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let path = job.previewPath, let image = NSImage(contentsOfFile: path) {
                Image(nsImage: image).resizable().scaledToFit().frame(maxWidth: .infinity).frame(height: 140).background(.white).clipShape(RoundedRectangle(cornerRadius: 7))
                    .accessibilityLabel("Prepared drawing preview")
            }
            HStack {
                Text(active ? "Drawing in progress" : job.status.capitalized).font(.subheadline.weight(.medium))
                Spacer()
                if let duration = job.durationMs { Text(Duration.seconds(duration / 1000).formatted(.time(pattern: .minuteSecond))).font(.caption.monospacedDigit()).foregroundStyle(.secondary) }
            }
            if active, let duration = job.durationMs, duration > 0 {
                ProgressView(value: min(1, max(0, (elapsedMs ?? 0) / duration)))
                    .accessibilityLabel("Estimated drawing progress")
                Text("Estimated progress · completion follows the plotter’s settled state").font(.caption2).foregroundStyle(.secondary)
            }
            if let error = job.error { Text(error).font(.caption).foregroundStyle(.red) }
        }.padding(12).background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))
    }
}
