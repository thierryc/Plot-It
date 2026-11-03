import Foundation
import Observation

@Observable @MainActor
final class MachineEditor {
    var draft = Machine()
    var paperFormat = "custom"
    var customWidth = "210"
    var customHeight = "297"
    private(set) var baseline: Machine?
    private(set) var configDigest: String?
    private(set) var configured = false
    private(set) var remoteChanged = false
    var validPaper: Bool { paperFormat != "custom" || (PaperDimension.parse(customWidth) != nil && PaperDimension.parse(customHeight) != nil) }
    var validationMessage: String? {
        if !validPaper { return "Enter paper dimensions between 1 and 1,000 mm." }
        if !draft.speed.isFinite || !(1...100).contains(draft.speed) { return "Drawing speed must be between 1 and 100 mm/s." }
        if !draft.travelSpeed.isFinite || !(1...150).contains(draft.travelSpeed) { return "Travel speed must be between 1 and 150 mm/s." }
        if draft.firmware.range(of: "^\\d+\\.\\d+\\.\\d+$", options: .regularExpression) == nil { return "Use a firmware version such as 2.8.1." }
        return nil
    }
    var hasChanges: Bool { baseline != nil && (draft != baseline || !validPaper) }
    var needsSave: Bool { baseline != nil && (!configured || hasChanges) }

    func receive(_ status: CompanionStatus, force: Bool = false) {
        if !force, baseline == status.config { configured = status.configured; configDigest = status.configDigest; return }
        if !force, baseline != nil, hasChanges, draft != status.config { remoteChanged = true; return }
        draft = status.config
        baseline = status.config
        configured = status.configured
        configDigest = status.configDigest
        paperFormat = status.paperPresets?.first { $0.matches(status.config) }?.id ?? "custom"
        customWidth = status.config.widthMm.formatted(.number.grouping(.never))
        customHeight = status.config.heightMm.formatted(.number.grouping(.never))
        remoteChanged = false
    }
    func selectPaper(_ papers: [PaperPreset]) {
        if let paper = papers.first(where: { $0.id == paperFormat }) { draft.widthMm = paper.width; draft.heightMm = paper.height }
        else { applyCustomPaper() }
    }
    func applyCustomPaper() {
        if paperFormat == "custom", let width = PaperDimension.parse(customWidth), let height = PaperDimension.parse(customHeight) { draft.widthMm = width; draft.heightMm = height }
    }
}
