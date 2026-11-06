import SwiftUI

struct MenuPanel: View {
    let model: CompanionModel
    var updater: AppUpdater? = nil
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        ConnectionGlassGroup {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 10) {
                    PlotItConnectionMark(connected: model.connected, plotting: model.active)
                        .frame(width: 36, height: 36)
                    Text("PlotIt").font(.headline)
                    Spacer(minLength: 12)
                    PlotterConnectionToggle(model: model)
                }
                if let job = model.status?.lastJob {
                    JobCard(job: job, active: model.active,
                            elapsedMs: model.status?.runner?.jobId == job.id ? model.status?.runner?.elapsedMs : nil,
                            progress: model.status?.runner?.jobId == job.id ? model.status?.runner?.progress : nil)
                }
                if model.connected && model.status?.ready != true && !model.active {
                    Button("Set Drawing Origin…", systemImage: "scope") { showSetup() }
                        .buttonStyle(.borderless).font(.callout)
                }
                if model.active { PlotControls(model: model) }
                if let error = model.error {
                    HStack(alignment: .top, spacing: 8) {
                        Label(error, systemImage: "exclamationmark.circle").font(.caption)
                            .foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                        Button("Dismiss", systemImage: "xmark") { model.error = nil }
                            .labelStyle(.iconOnly).buttonStyle(.borderless).help("Dismiss error")
                    }
                }
                if model.waitingToQuit {
                    Label("Quitting after the drawing finishes", systemImage: "clock").font(.caption).foregroundStyle(.secondary)
                }
                HStack(spacing: 10) {
                    Button(model.status?.configured == true ? "Settings…" : "Set Up…", systemImage: "slider.horizontal.3") { showSetup() }
                        .labelStyle(.titleAndIcon)
                        .modifier(ConnectionGlassButton()).help("Plotter and agent settings")
                    Spacer()
                    if let updater, updater.readyVersion != nil {
                        Button("Update Ready", systemImage: "arrow.down.circle") { updater.check() }
                            .disabled(!updater.enabled || (!updater.canCheck && !updater.installationRequested))
                            .modifier(ConnectionGlassButton())
                    }
                    Menu {
                        Button("About & Help…", systemImage: "info.circle") {
                            openWindow(id: "about")
                            NSApplication.shared.activate(ignoringOtherApps: true)
                        }
                        if let updater {
                            Button("Check for Updates…", systemImage: "arrow.clockwise") { updater.check() }
                                .disabled(!updater.enabled || (!updater.canCheck && !updater.installationRequested))
                        }
                        Divider()
                        Button("Quit PlotIt") { NSApplication.shared.terminate(nil) }
                            .keyboardShortcut("q")
                    } label: { Label("More", systemImage: "ellipsis") }
                        .labelStyle(.iconOnly).menuIndicator(.hidden)
                        .modifier(ConnectionGlassButton()).help("About, updates and Quit")
                }.controlSize(.regular)
            }.padding(18).frame(width: 336)
        }
    }

    private func showSetup() {
        model.setupTab = 0
        openWindow(id: "setup")
        NSApplication.shared.activate(ignoringOtherApps: true)
    }
}

struct PlotterConnectionToggle: View {
    let model: CompanionModel
    var body: some View {
        Toggle(isOn: Binding(get: { model.connected }, set: { connected in
            Task { await model.setConnection(connected) }
        })) {
            HStack(spacing: 6) {
                if model.connectionChanging { ProgressView().controlSize(.mini) }
                Text(model.connected ? "Disconnect" : "Connect")
            }
        }
        .toggleStyle(.button).tint(.plotItMagenta)
        .modifier(ConnectionGlassButton(prominent: model.connected))
        .disabled(!model.canChangeConnection)
        .accessibilityLabel("Plotter connection")
        .accessibilityValue(model.connected ? "Connected" : "Disconnected")
        .help(model.connectionHelp)
    }
}

private struct PlotControls: View {
    let model: CompanionModel
    private var state: String { model.status?.runner?.status ?? "" }
    private var paused: Bool { ["paused", "tool-change"].contains(state) }
    var body: some View {
        HStack(spacing: 10) {
            Button(state == "tool-change" ? "Pen Loaded" : paused ? "Resume" : "Pause", systemImage: paused ? "play.fill" : "pause.fill") {
                Task { await model.perform("control", ["action": state == "tool-change" ? "continue" : paused ? "resume" : "pause"]) }
            }
            .labelStyle(.titleAndIcon)
            .disabled(model.busy || !["running", "paused", "tool-change"].contains(state))
            .modifier(ConnectionGlassButton())
            Spacer()
            Button("Stop", systemImage: "stop.fill", role: .destructive) {
                Task { await model.perform("control", ["action": "stop"]) }
            }.labelStyle(.titleAndIcon).foregroundStyle(.red)
                .disabled(model.busy || state == "stopping").modifier(ConnectionGlassButton())
        }
    }
}

struct ConnectionGlassGroup<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        if #available(macOS 26, *) { GlassEffectContainer(spacing: 10) { content } }
        else { content }
    }
}

struct ConnectionGlassButton: ViewModifier {
    var prominent = false
    func body(content: Content) -> some View {
        if #available(macOS 26, *) {
            if prominent { content.buttonStyle(.glassProminent) }
            else { content.buttonStyle(.glass) }
        } else { content.buttonStyle(.bordered) }
    }
}

extension Color {
    static let plotItMagenta = Color(red: 1, green: 0, blue: 0.65)
}

struct JobCard: View {
    let job: Job
    let active: Bool
    let elapsedMs: Double?
    var progress: ProgressSnapshot?
    private var fraction: Double? {
        guard let completed = progress?.completed, let total = progress?.total, completed.isFinite, total.isFinite, total > 0 else { return nil }
        let copies = max(1, progress?.copies ?? 1), copy = max(1, progress?.copy ?? 1)
        return min(0.99, max(0, (Double(copy - 1) + min(1, completed / total)) / Double(copies)))
    }
    private var title: String {
        switch job.status {
        case "pending": return "Ready to Draw"
        case "running": return "Drawing"
        case "tool-change": return "Change Pen"
        case "returning": return "Returning to Origin"
        case "finished": return "Complete"
        default: return job.status.replacingOccurrences(of: "-", with: " ").capitalized
        }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let path = job.previewPath { DrawingPreview(path: path).equatable() }
            HStack {
                Label(title, systemImage: job.status == "finished" ? "checkmark.circle" : "pencil.tip")
                    .font(.subheadline.weight(.medium))
                Spacer()
                if !active, let duration = job.durationMs {
                    Text(Duration.seconds(duration / 1000).formatted(.time(pattern: .minuteSecond)))
                        .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
            }
            if active {
                if let fraction {
                    ProgressView(value: fraction).tint(.plotItMagenta)
                        .accessibilityLabel("Estimated drawing progress")
                    HStack {
                        Text(fraction, format: .percent.precision(.fractionLength(0)))
                        Spacer()
                        if let remaining = progress?.remainingMs, remaining.isFinite, remaining >= 0 {
                            Text("\(Duration.seconds(remaining / 1000).formatted(.time(pattern: .minuteSecond))) left")
                        } else if let elapsedMs {
                            Text("\(Duration.seconds(elapsedMs / 1000).formatted(.time(pattern: .minuteSecond))) elapsed")
                        }
                    }.font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    .help("Progress is estimated until the plotter finishes moving.")
                    if fraction == 0.99 { Text("Finishing…").font(.caption).foregroundStyle(.secondary) }
                } else { ProgressView().controlSize(.small).accessibilityLabel("Waiting for drawing progress") }
            }
            if let error = job.error { Text(error).font(.caption).foregroundStyle(.red) }
        }
    }
}

private struct DrawingPreview: View, Equatable {
    let path: String
    var body: some View {
        if let image = NSImage(contentsOfFile: path) {
            Image(nsImage: image).resizable().scaledToFit()
                .frame(maxWidth: .infinity).frame(height: 150).background(.white)
                .clipShape(.rect(cornerRadius: 12))
                .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(.secondary.opacity(0.12), lineWidth: 1) }
                .accessibilityLabel("Drawing preview")
        }
    }
}
