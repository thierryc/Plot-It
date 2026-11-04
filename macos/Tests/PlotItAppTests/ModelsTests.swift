import XCTest
@testable import PlotItApp

final class ModelsTests: XCTestCase {
    @MainActor
    func testUpdatesWaitForEveryUnsettledStateAndDrafts() {
        let model = CompanionModel(); model.isPreview = true
        let updater = AppUpdater(model: model); updater.start()
        XCTAssertFalse(updater.enabled)
        XCTAssertNotNil(model.updateBlocker)
        model.serviceAvailable = true
        model.status = CompanionStatus(version: "0.1.0", configured: true, config: Machine(), armed: false, agents: [], preparing: false)
        XCTAssertNil(model.updateBlocker)
        for state in ["starting", "running", "pausing", "paused", "tool-change", "returning", "stopping"] {
            model.status?.runner = RunnerSnapshot(connected: true, status: state, origin: "explicit")
            XCTAssertNotNil(model.updateBlocker, state)
        }
        model.status?.runner = nil
        model.status?.preparing = true; XCTAssertNotNil(model.updateBlocker)
        model.status?.preparing = false
        model.busy = true; XCTAssertNotNil(model.updateBlocker); model.busy = false
        model.setupHasChanges = true; XCTAssertNotNil(model.updateBlocker); model.setupHasChanges = false
        XCTAssertNil(model.updateBlocker)
    }

    @MainActor
    func testMachineEditorPreservesDraftAndDetectsConcurrentChanges() {
        let editor = MachineEditor()
        var status = CompanionStatus(version: "0.1.0", configured: true, config: Machine(), armed: false, agents: [], preparing: false)
        status.configDigest = "first"
        editor.receive(status)
        editor.draft.penUp = 42
        editor.receive(status)
        XCTAssertEqual(editor.draft.penUp, 42)
        XCTAssertTrue(editor.hasChanges)
        status.config.penUp = 35; status.configDigest = "second"
        editor.receive(status)
        XCTAssertEqual(editor.draft.penUp, 42)
        XCTAssertTrue(editor.remoteChanged)
        XCTAssertEqual(editor.configDigest, "first")
        editor.receive(status, force: true)
        XCTAssertEqual(editor.draft.penUp, 35)
        XCTAssertFalse(editor.hasChanges)
        XCTAssertFalse(editor.remoteChanged)
    }
    @MainActor
    func testUnconfiguredSetupNeedsSaveAndCustomValidationSurvivesStatusUpdates() {
        let editor = MachineEditor()
        let status = CompanionStatus(version: "0.1.0", configured: false, config: Machine(), armed: false, agents: [], preparing: false)
        editor.receive(status)
        XCTAssertTrue(editor.needsSave)
        editor.customWidth = ""
        editor.receive(status)
        XCTAssertFalse(editor.validPaper)
        XCTAssertEqual(editor.customWidth, "")
    }
    func testCustomPaperDimensionsRejectInvalidOrIncompleteInput() {
        XCTAssertEqual(PaperDimension.parse("215.9"), 215.9)
        XCTAssertEqual(PaperDimension.parse(" 297 "), 297)
        for value in ["", "-1", "0", "1001", "nan", "inf", "210 mm", "210 297"] { XCTAssertNil(PaperDimension.parse(value), value) }
    }
    func testPaperPresetMatchesDimensionsWithoutSwappingOrientation() {
        let preset = PaperPreset(name: "A4 portrait", width: 210, height: 297)
        var machine = Machine()
        XCTAssertTrue(preset.matches(machine))
        machine.widthMm = 297; machine.heightMm = 210
        XCTAssertFalse(preset.matches(machine))
        machine.widthMm = 215.9; machine.heightMm = 279.4
        XCTAssertFalse(preset.matches(machine))
    }
    func testReadinessRequiresConfigurationConnectionAndOrigin() {
        let json = """
        {"version":"0.1.0","configured":true,"config":{"profile":"axidraw","rotation":90,"servo":"standard","penUp":50,"penDown":60,"speed":35,"travelSpeed":60,"widthMm":210,"heightMm":297,"firmware":"2.8.1","device":""},"armed":false,"runner":{"connected":true,"status":"idle","origin":"unset"},"agents":[],"preparing":false}
        """
        var status = try! JSONDecoder().decode(CompanionStatus.self, from: Data(json.utf8))
        XCTAssertFalse(status.ready)
        status.runner?.origin = "explicit"
        XCTAssertTrue(status.ready)
        status.runner?.connected = false
        XCTAssertFalse(status.ready)
    }
    func testAcceptedAndSettledStatesAreDistinct() {
        var runner = RunnerSnapshot(connected: true, status: "pausing", origin: "explicit")
        var status = CompanionStatus(version: "0.1.0", configured: true, config: Machine(), armed: false, runner: runner, agents: [], preparing: false)
        XCTAssertTrue(status.active)
        runner.status = "finished"; status.runner = runner
        XCTAssertFalse(status.active)
    }
}
