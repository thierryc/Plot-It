import SwiftUI

struct SetupWindow: View {
    let model: CompanionModel
    @State private var step = 0
    @State private var editor = MachineEditor()
    @State private var pendingStep: Int?
    @State private var reviewUnsavedChanges = false
    @Environment(\.dismiss) private var dismiss
    private let steps = [SetupStep(id: 0, title: "Connect plotter", symbol: "cable.connector"), SetupStep(id: 1, title: "Configure agent apps", symbol: "square.stack.3d.up"), SetupStep(id: 2, title: "Test connection", symbol: "checkmark.seal")]
    init(model: CompanionModel, initialStep: Int? = nil) { self.model = model; _step = State(initialValue: initialStep ?? model.setupTab) }
    private func requestStep(_ target: Int) {
        guard target != step else { return }
        if editor.hasChanges { pendingStep = target; reviewUnsavedChanges = true }
        else { step = target }
    }
    private func saveAndAdvance(to target: Int) async {
        guard editor.validationMessage == nil, !editor.remoteChanged, model.serviceAvailable else { return }
        editor.applyCustomPaper()
        if editor.needsSave {
            guard await model.save(editor.draft, expectedDigest: editor.configDigest) else { return }
            if let status = model.status { editor.receive(status, force: true) }
        }
        step = target
    }
    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    PlotItAppIcon().frame(width: 48, height: 48)
                    Text("PlotIt MCP").font(.title2.weight(.semibold))
                    Text("A little bridge.\nSomething worth drawing.").font(.subheadline).foregroundStyle(.secondary)
                }.padding(.bottom, 10)
                ForEach(steps) { item in
                    Button { requestStep(item.id) } label: {
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
                        case 0: MachineSetup(model: model, editor: editor)
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
                    if step > 0 { Button("Back") { requestStep(step - 1) }.disabled(model.busy) }
                    if step < 2 {
                        Button(editor.needsSave ? "Save & Continue" : "Continue") { Task { await saveAndAdvance(to: step + 1) } }
                            .buttonStyle(.borderedProminent).tint(.teal).keyboardShortcut(.defaultAction)
                            .disabled(model.busy || !model.serviceAvailable || editor.validationMessage != nil || editor.remoteChanged)
                    } else { Button("Done") { dismiss() }.buttonStyle(.borderedProminent).tint(.teal).keyboardShortcut(.defaultAction).disabled(model.busy) }
                }.padding(18)
            }.frame(minWidth: 520, maxWidth: .infinity)
        }
        .frame(minWidth: 746, minHeight: 680)
        .sheet(item: Binding(get: { model.agentChange }, set: { model.agentChange = $0 })) { change in ConfigurationReview(model: model, change: change) }
        .task { await model.loadAgents(); await model.loadDevices() }
        .onChange(of: model.status, initial: true) { _, status in if let status { editor.receive(status) } }
        .onChange(of: editor.hasChanges, initial: true) { _, value in model.setupHasChanges = value }
        .onDisappear { model.setupHasChanges = false }
        .onChange(of: step) { _, value in model.setupTab = value }
        .onChange(of: model.setupTab) { _, value in requestStep(value) }
        .confirmationDialog("Save your machine changes before continuing?", isPresented: $reviewUnsavedChanges) {
            Button("Save & Continue") { if let target = pendingStep { Task { await saveAndAdvance(to: target) } } }.disabled(editor.validationMessage != nil || editor.remoteChanged || model.busy)
            Button("Discard Changes", role: .destructive) { if let status = model.status { editor.receive(status, force: true) }; if let target = pendingStep { step = target } }
            Button("Keep Editing", role: .cancel) { model.setupTab = step }
        } message: { Text("Your paper, pen calibration and machine settings have unsaved changes.") }
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
    @Bindable var editor: MachineEditor
    @State private var advanced = false
    @State private var captureOrigin = false
    private var papers: [PaperPreset] { model.status?.paperPresets ?? [] }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            SectionHeading(title: "Meet your plotter", subtitle: "Choose your machine, paper format and pen heights. Agent control becomes available automatically once the plotter is connected and its origin is set.")
            if editor.remoteChanged {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Settings changed in another window or agent.", systemImage: "arrow.triangle.2.circlepath").font(.callout)
                    Text("Reload the saved settings before making further changes.").font(.caption).foregroundStyle(.secondary)
                    Button("Reload Saved Settings") { if let status = model.status { editor.receive(status, force: true) } }
                }.padding(12).background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
            }
            Form {
                Section {
                    Picker("Machine", selection: $editor.draft.profile) { ForEach(Machine.profiles, id: \.0) { item in Text(item.1).tag(item.0) } }
                    Picker("USB device", selection: $editor.draft.device) {
                        Text("Auto-detect one EBB plotter").tag("")
                        ForEach(model.devices) { device in Text(device.path).tag(device.path) }
                        if !editor.draft.device.isEmpty && !model.devices.contains(where: { $0.path == editor.draft.device }) { Text("\(editor.draft.device) · unavailable").tag(editor.draft.device) }
                    }
                    HStack {
                        Text(model.deviceHint).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        Spacer()
                        Button("Refresh Devices", systemImage: "arrow.clockwise") { Task { await model.loadDevices() } }.disabled(model.loadingDevices)
                    }
                }
                Section {
                    Picker("Paper format", selection: $editor.paperFormat) {
                        ForEach(papers) { paper in Text(paper.name).tag(paper.id) }
                        Divider()
                        Text("Custom…").tag("custom")
                    }.pickerStyle(.menu)
                    if editor.paperFormat == "custom" {
                        HStack {
                            TextField("Width · mm", text: $editor.customWidth).accessibilityLabel("Paper width in millimetres")
                            Text("×").foregroundStyle(.secondary)
                            TextField("Height · mm", text: $editor.customHeight).accessibilityLabel("Paper height in millimetres")
                        }
                        if !editor.validPaper { Text("Enter a width and height between 1 and 1,000 mm.").font(.caption).foregroundStyle(.red) }
                    } else {
                        LabeledContent("Paper dimensions") { Text("\(editor.draft.widthMm.formatted()) × \(editor.draft.heightMm.formatted()) mm").foregroundStyle(.secondary) }
                    }
                    Picker("Machine orientation", selection: $editor.draft.rotation) { ForEach([0, 90, 180, 270], id: \.self) { Text("\($0)°").tag($0) } }
                    PaperOriginDiagram(rotation: editor.draft.rotation)
                }
                Section {
                    HStack { Text("Pen up"); Slider(value: $editor.draft.penUp, in: 0...100); Text(editor.draft.penUp, format: .number.precision(.fractionLength(0))).monospacedDigit().frame(width: 28) }
                    HStack { Text("Pen down"); Slider(value: $editor.draft.penDown, in: 0...100); Text(editor.draft.penDown, format: .number.precision(.fractionLength(0))).monospacedDigit().frame(width: 28) }
                    DisclosureGroup("Advanced calibration", isExpanded: $advanced) {
                        Picker("Servo", selection: $editor.draft.servo) { Text("Standard").tag("standard"); Text("Brushless").tag("brushless") }
                        TextField("Offline firmware target", text: $editor.draft.firmware)
                        TextField("Drawing speed · mm/s", value: $editor.draft.speed, format: .number)
                        TextField("Travel speed · mm/s", value: $editor.draft.travelSpeed, format: .number)
                    }
                }
            }.formStyle(.grouped).scrollDisabled(true).disabled(model.active || model.busy || !model.serviceAvailable || editor.remoteChanged)
            HStack {
                Button("Save Settings") { editor.applyCustomPaper(); Task { await model.save(editor.draft, expectedDigest: editor.configDigest) } }
                    .disabled(model.active || model.busy || !model.serviceAvailable || editor.validationMessage != nil || editor.remoteChanged || !editor.needsSave)
                Spacer()
                Button(model.connected ? "Disconnect" : "Connect Plotter", systemImage: "cable.connector") { Task { await model.perform(model.connected ? "disconnect" : "connect") } }
                    .disabled(model.status?.configured != true || model.active || model.busy || (!model.connected && (editor.needsSave || !editor.validPaper || editor.remoteChanged)))
            }
            if editor.hasChanges { Text("Save your changes before connecting. Saving new settings disconnects the plotter and requires a new origin.").font(.caption).foregroundStyle(.secondary) }
            if let validation = editor.validationMessage { Label(validation, systemImage: "exclamationmark.circle").font(.caption).foregroundStyle(.red) }
            if model.connected {
                VStack(alignment: .leading, spacing: 10) {
                    Label("Connected · firmware \(model.status?.runner?.firmware ?? "unknown")", systemImage: "checkmark.circle.fill").foregroundStyle(.teal)
                    HStack {
                        Button("Test Pen Up") { Task { await model.perform("pen", ["down": false]) } }
                        Button("Test Pen Down") { Task { await model.perform("pen", ["down": true]) } }
                    }
                    Text("Pen tests use the saved heights. Position the carriage at your drawing origin, then capture it.").font(.caption).foregroundStyle(.secondary)
                    Button("Set Current Position as Origin", systemImage: "scope") { captureOrigin = true }
                    if model.status?.ready == true { Label("Origin established", systemImage: "checkmark").font(.caption).foregroundStyle(.teal) }
                }.disabled(model.active || model.busy)
            }
            Text("Hardware profiles are experimental until independently tested on the matching machine.").font(.caption).foregroundStyle(.secondary)
        }
        .onChange(of: editor.paperFormat) { editor.selectPaper(papers) }
        .onChange(of: editor.customWidth) { editor.applyCustomPaper() }
        .onChange(of: editor.customHeight) { editor.applyCustomPaper() }
        .confirmationDialog("Use the carriage’s current physical position as the origin?", isPresented: $captureOrigin) {
            Button("Set Origin") { Task { await model.perform("origin", success: "Origin established. Agent control follows your saved preference.") } }
        } message: { Text("Make sure the carriage is in the intended starting position and the paper is secured.") }
    }
}

struct PaperOriginDiagram: View {
    let rotation: Int
    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 4).stroke(.secondary.opacity(0.4)).frame(width: 48, height: 64)
                Circle().fill(.teal).frame(width: 5, height: 5).offset(x: 7, y: 7)
                Image(systemName: "arrow.right").font(.caption2).foregroundStyle(.teal).offset(x: 16, y: 3)
                Image(systemName: "arrow.down").font(.caption2).foregroundStyle(.teal).offset(x: 4, y: 17)
            }.accessibilityHidden(true)
            Text("Paper origin is the drawing’s starting point. Machine orientation (\(rotation)°) maps drawing coordinates to your plotter; it does not change the paper size.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }.padding(.vertical, 4)
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
                CheckRow(title: "Plotter ready", detail: model.status?.ready == true ? "USB connected and drawing origin established" : model.controlDetail, done: model.status?.ready == true)
            }.padding(18).background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 10))
            Button("Run Server Test", systemImage: "checkmark.seal") { Task { await model.testServer() } }.buttonStyle(.borderedProminent).tint(.teal).disabled(model.busy || !model.serviceAvailable)
            VStack(alignment: .leading, spacing: 10) {
                Text("Try this in your agent").font(.headline)
                Text(CompanionModel.firstPrompt).font(.callout).textSelection(.enabled)
                Button("Copy First Prompt", systemImage: "doc.on.doc") { model.copyFirstPrompt() }
                Text("Preparation and simulation work without hardware. Agent control becomes available when the connected plotter has an established origin.").font(.caption).foregroundStyle(.secondary)
            }
            Toggle("Allow agent control when ready", isOn: Binding(get: { model.agentControlEnabled }, set: { enabled in Task { await model.perform("arm", ["enabled": enabled]) } }))
                .disabled(!model.serviceAvailable || model.busy)
            Text(model.controlDetail).font(.caption).foregroundStyle(.secondary)
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
