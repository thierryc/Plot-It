import XCTest
@testable import PlotItApp

final class ModelsTests: XCTestCase {
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
