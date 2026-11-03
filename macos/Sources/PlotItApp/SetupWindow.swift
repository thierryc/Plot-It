import SwiftUI

struct SetupWindow: View {
    let model: CompanionModel
    @State private var step = 0
    private let steps = [SetupStep(id: 0, title: "Connect plotter", symbol: "cable.connector"), SetupStep(id: 1, title: "Configure agent apps", symbol: "square.stack.3d.up"), SetupStep(id: 2, title: "Test connection", symbol: "checkmark.seal")]
    init(model: CompanionModel, initialStep: Int = 0) { self.model = model; _step = State(initialValue: initialStep) }
    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Image(systemName: "pencil.tip.crop.circle.fill").font(.system(size: 38)).foregroundStyle(.teal)
                    Text("PlotIt MCP").font(.title2.weight(.semibold))
                    Text("A little bridge.\nSomething worth drawing.").font(.subheadline).foregroundStyle(.secondary)
                }.padding(.bottom, 10)
                ForEach(steps) { item in
                    Button { step = item.id } label: {
                        HStack(spacing: 9) {
                            Image(systemName: item.symbol).frame(width: 20)
                            Text(item.title).font(.callout.weight(step == item.id ? .semibold : .regular))
                        }.foregroundStyle(step == item.id ? Color.teal : Color.secondary).padding(10).frame(maxWidth: .infinity, alignment: .leading)
                            .background(step == item.id ? Color.teal.opacity(0.1) : .clear, in: RoundedRectangle(cornerRadius: 8))
                    }.buttonStyle(.plain).accessibilityAddTraits(step == item.id ? .isSelected : [])
                }
                Spacer()
                Text("Local connection\nNo PlotIt account required").font(.caption).foregroundStyle(.secondary)
            }.padding(22).frame(width: 225).background(.quaternary.opacity(0.3))
            Divider()
            VStack(alignment: .leading, spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        switch step {
                        case 0: MachineSetup(model: model)
                        case 1: AgentSetupView(model: model)
                        default: ConnectionTestView(model: model)
                        }
                    }.padding(28).frame(maxWidth: .infinity, alignment: .leading)
                }
                if let error = model.error {
                    Label(error, systemImage: "exclamationmark.circle.fill").font(.callout).foregroundStyle(.red).textSelection(.enabled).padding(.horizontal, 24).padding(.bottom, 12)
                } else if let notice = model.notice {
                    Label(notice, systemImage: "checkmark.circle").font(.callout).foregroundStyle(.secondary).padding(.horizontal, 24).padding(.bottom, 12)
                }
                Divider()
                HStack {
                    if model.busy { ProgressView().controlSize(.small); Text("Working…").font(.caption).foregroundStyle(.secondary) }
                    Spacer()
                    if step > 0 { Button("Back") { step -= 1 } }
                    if step < 2 { Button("Continue") { step += 1 }.buttonStyle(.borderedProminent).tint(.teal) }
                }.padding(18)
            }.frame(width: 520)
        }
        .frame(height: 680)
        .sheet(item: Binding(get: { model.agentChange }, set: { model.agentChange = $0 })) { change in ConfigurationReview(model: model, change: change) }
        .task { await model.loadAgents(); await model.loadDevices() }
    }
}
private struct SetupStep: Identifiable { let id: Int; let title: String; let symbol: String }

struct SectionHeading: View {
    let title: String
    let subtitle: String
    var body: some View { VStack(alignment: .leading, spacing: 8) { Text(title).font(.title2.weight(.semibold)); Text(subtitle).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) } }
}

struct MachineSetup: View {
    let model: CompanionModel
    @State private var draft = Machine()
    @State private var advanced = false
    @State private var captureOrigin = false
    @State private var seeded = false
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SectionHeading(title: "Meet your plotter", subtitle: "Choose the machine connected to this Mac. Set its paper area and pen heights before enabling agent control.")
            Form {
                Picker("Machine", selection: $draft.profile) { ForEach(Machine.profiles, id: \.0) { item in Text(item.1).tag(item.0) } }
                Picker("USB device", selection: $draft.device) {
                    Text("Auto · one EBB connected").tag("")
                    ForEach(model.devices) { device in Text(device.path).tag(device.path) }
                }
                HStack { Text("Paper area"); Spacer(); TextField("Width", value: $draft.widthMm, format: .number).labelsHidden().accessibilityLabel("Paper width in millimetres").frame(width: 65); Text("×"); TextField("Height", value: $draft.heightMm, format: .number).labelsHidden().accessibilityLabel("Paper height in millimetres").frame(width: 65); Text("mm").foregroundStyle(.secondary) }
                HStack { Text("Pen up"); Slider(value: $draft.penUp, in: 0...100); Text(draft.penUp, format: .number.precision(.fractionLength(0))).monospacedDigit().frame(width: 28) }
                HStack { Text("Pen down"); Slider(value: $draft.penDown, in: 0...100); Text(draft.penDown, format: .number.precision(.fractionLength(0))).monospacedDigit().frame(width: 28) }
                DisclosureGroup("Advanced", isExpanded: $advanced) {
                    Picker("Orientation", selection: $draft.rotation) { ForEach([0, 90, 180, 270], id: \.self) { Text("\($0)°").tag($0) } }
                    Picker("Servo", selection: $draft.servo) { Text("Standard").tag("standard"); Text("Brushless").tag("brushless") }
                    TextField("Offline firmware target", text: $draft.firmware)
                    TextField("Drawing speed · mm/s", value: $draft.speed, format: .number)
                    TextField("Travel speed · mm/s", value: $draft.travelSpeed, format: .number)
                }
            }.formStyle(.grouped).scrollDisabled(true).disabled(model.active || model.busy || model.status == nil)
            HStack {
                Button("Save Settings") { Task { await model.save(draft) } }.disabled(model.active || model.busy)
                Spacer()
                Button(model.connected ? "Disconnect" : "Connect Plotter", systemImage: "cable.connector") { Task { await model.perform(model.connected ? "disconnect" : "connect") } }
                    .disabled(model.status?.configured != true || model.active || model.busy)
            }
            if model.connected {
                VStack(alignment: .leading, spacing: 10) {
                    Label("Connected · firmware \(model.status?.runner?.firmware ?? "unknown")", systemImage: "checkmark.circle.fill").foregroundStyle(.teal)
                    HStack {
                        Button("Test Pen Up") { Task { await model.perform("pen", ["down": false]) } }
                        Button("Test Pen Down") { Task { await model.perform("pen", ["down": true]) } }
                    }
                    Text("Pen tests use the saved heights. Position the carriage at your drawing origin, then capture it.").font(.caption).foregroundStyle(.secondary)
                    Button("Set Current Position as Origin", systemImage: "scope") { captureOrigin = true }
                    if model.status?.runner?.origin != "unset" { Label("Origin established", systemImage: "checkmark").font(.caption).foregroundStyle(.teal) }
                }.disabled(model.active || model.busy)
            }
            Text("Hardware profiles are experimental until independently tested on the matching machine.").font(.caption).foregroundStyle(.secondary)
        }
        .onChange(of: model.status?.config, initial: true) { _, config in
            if !seeded, let config { draft = config; seeded = true }
        }
        .confirmationDialog("Use the carriage’s current physical position as the origin?", isPresented: $captureOrigin) {
            Button("Set Origin") { Task { await model.perform("origin", success: "Origin established. You can enable agent control.") } }
        } message: { Text("Make sure the carriage is in the intended starting position and the paper is secured.") }
    }
}

struct AgentSetupView: View {
    let model: CompanionModel
    @State private var advanced = false
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SectionHeading(title: "Bring your agent", subtitle: "Add PlotIt to the apps you use. Review the change before installing; your existing connections stay in place.")
            ForEach(model.agents) { agent in
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 10) {
                        Image(systemName: agent.symbol).font(.title3).foregroundStyle(.teal).frame(width: 26)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(agent.name).font(.headline)
                            let live = model.serviceAvailable && model.status?.agents.contains { agent.matches(clientName: $0.name) } == true
                            Text(live ? "Agent connected" : agent.configured ? "Configured · open a new agent session" : "Ready to configure").font(.caption).foregroundStyle(live ? .teal : .secondary)
                        }
                        Spacer()
                        if agent.configured { Image(systemName: "checkmark.circle.fill").foregroundStyle(.teal).accessibilityLabel("Configured") }
                    }
                    HStack {
                        Button(agent.configured ? "Remove…" : "Install…") { Task { await model.previewChange(agent, operation: agent.configured ? "remove" : "install") } }
                        Button("Test Server") { Task { await model.testServer() } }
                        if agent.id != "claude-desktop" && agent.cli == nil { Button(agent.id == "codex" ? "Locate App…" : "Locate CLI…") { model.locate(agent) } }
                    }.disabled(model.busy)
                    if let error = agent.error { Text(error).font(.caption).foregroundStyle(.red) }
                }.padding(16).frame(maxWidth: .infinity, alignment: .leading).background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 10))
            }
            DisclosureGroup("Other clients & advanced setup", isExpanded: $advanced) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Use this standard stdio MCP configuration in another local agent app.").font(.caption).foregroundStyle(.secondary)
                    Text(model.configurationJSON).font(.system(.caption, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                    Button("Copy Configuration", systemImage: "doc.on.doc") { model.copyConfiguration() }
                    Button("Choose Codex Configuration Folder…") { model.chooseCodexConfiguration() }
                }.padding(.top, 8)
            }
        }
    }
}

struct ConnectionTestView: View {
    let model: CompanionModel
    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            SectionHeading(title: "Make the first connection", subtitle: "Check the local server, then open an agent app and ask it to find your plotter.")
            VStack(alignment: .leading, spacing: 16) {
                CheckRow(title: "Companion running", detail: model.serviceAvailable ? "Local service is available" : "Waiting for the local service", done: model.serviceAvailable)
                CheckRow(title: "MCP server tested", detail: "Checks initialization and the advertised tools", done: model.serverTestPassed)
                CheckRow(title: "Agent connected", detail: model.status?.agents.map(\.name).joined(separator: ", ").nilIfEmpty ?? "Waiting for an agent to load PlotIt", done: model.status?.agents.isEmpty == false)
            }.padding(18).background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 10))
            Button("Run Server Test", systemImage: "checkmark.seal") { Task { await model.testServer() } }.buttonStyle(.borderedProminent).tint(.teal)
            VStack(alignment: .leading, spacing: 10) {
                Text("Try this in your agent").font(.headline)
                Text("“Use PlotIt to list the stroke fonts, then prepare a small hello-world drawing and show me the preview.”").font(.callout).textSelection(.enabled)
                Text("Preparation and simulation work without hardware. Enable agent control when the plotter, paper and pen are ready.").font(.caption).foregroundStyle(.secondary)
            }
            Toggle("Enable agent control for this session", isOn: Binding(get: { model.armed }, set: { enabled in Task { await model.perform("arm", ["enabled": enabled]) } }))
                .disabled(!model.serviceAvailable || model.status?.ready != true || model.busy)
            Toggle("Open PlotIt MCP at login", isOn: Binding(get: { model.loginEnabled }, set: model.setLogin))
        }
    }
}

struct CheckRow: View {
    let title: String; let detail: String; let done: Bool
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: done ? "checkmark.circle.fill" : "circle.dashed").foregroundStyle(done ? .teal : .secondary).font(.title3)
            VStack(alignment: .leading, spacing: 3) { Text(title).font(.subheadline.weight(.medium)); Text(detail).font(.caption).foregroundStyle(.secondary) }
        }.accessibilityElement(children: .combine)
    }
}

struct ConfigurationReview: View {
    let model: CompanionModel
    let change: AgentChange
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SectionHeading(title: change.conflict && change.id.isEmpty ? "A PlotIt connection already exists" : change.operation == "remove" ? "Remove this connection?" : "Add PlotIt to your agent", subtitle: change.conflict && change.id.isEmpty ? "This entry points to a different server. Review it before replacing." : "Only the PlotIt entry will change. Existing configuration is backed up before saving.")
            Text(change.path).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
            ScrollView {
                Text(change.id.isEmpty ? change.before : change.operation == "remove" ? "Remove mcpServers.plotit / mcp_servers.plotit" : "Server: plotit\nCommand: \(change.entry.command)\nArguments: []\n\n" + (change.command?.joined(separator: " ") ?? "Update the PlotIt entry in the configuration file."))
                    .font(.system(.callout, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(14)
            }.frame(maxHeight: 220).background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
            if let error = model.error { Text(error).font(.caption).foregroundStyle(.red) }
            HStack {
                Button("Cancel") { model.agentChange = nil }.keyboardShortcut(.cancelAction)
                Spacer()
                if change.id.isEmpty {
                    Button("Replace Existing Entry…", role: .destructive) { if let agent = model.agents.first(where: { $0.id == change.agent }) { Task { await model.previewChange(agent, operation: change.operation, replace: true) } } }
                } else {
                    Button(change.operation == "remove" ? "Remove Connection" : "Install Connection") { Task { await model.applyChange(change) } }.buttonStyle(.borderedProminent).tint(.teal).keyboardShortcut(.defaultAction).disabled(model.busy)
                }
            }
        }.padding(28).frame(width: 570)
    }
}
private extension String { var nilIfEmpty: String? { isEmpty ? nil : self } }
