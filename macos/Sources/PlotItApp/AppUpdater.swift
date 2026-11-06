import AppKit
import Combine
import Observation
import Sparkle
import SwiftUI

@Observable @MainActor
final class AppUpdater: NSObject, SPUUpdaterDelegate, @preconcurrency SPUStandardUserDriverDelegate {
    static let shared = AppUpdater(model: .shared)
    private let model: CompanionModel
    @ObservationIgnored private var controller: SPUStandardUpdaterController?
    @ObservationIgnored private var observations: [NSKeyValueObservation] = []
    @ObservationIgnored private var resumeInstallation: (() -> Void)?
    @ObservationIgnored private var reserving = false
    var canCheck = false
    var readyVersion: String?
    var message: String?
    private(set) var automaticChecks = true
    private(set) var automaticDownloads = true
    var automaticUpdates: Bool { automaticChecks }
    var installationRequested = false
    var enabled: Bool { controller != nil }
    var blocker: String? { model.updateBlocker }

    init(model: CompanionModel) { self.model = model; super.init() }
    func start() {
        guard controller == nil, !model.isPreview,
              Bundle.main.object(forInfoDictionaryKey: "PlotItUpdatesEnabled") as? Bool == true else { return }
        let controller = SPUStandardUpdaterController(startingUpdater: false, updaterDelegate: self, userDriverDelegate: self)
        self.controller = controller
        observations = [controller.updater.observe(\.canCheckForUpdates, options: [.initial, .new]) { [weak self] updater, _ in
            Task { @MainActor in self?.canCheck = updater.canCheckForUpdates }
        }, controller.updater.observe(\.automaticallyChecksForUpdates, options: [.initial, .new]) { [weak self] updater, _ in
            Task { @MainActor in self?.automaticChecks = updater.automaticallyChecksForUpdates }
        }, controller.updater.observe(\.automaticallyDownloadsUpdates, options: [.initial, .new]) { [weak self] updater, _ in
            Task { @MainActor in self?.automaticDownloads = updater.automaticallyDownloadsUpdates }
        }]
        controller.startUpdater()
        automaticChecks = controller.updater.automaticallyChecksForUpdates
        automaticDownloads = controller.updater.automaticallyDownloadsUpdates
    }
    func check() {
        guard let controller else { return }
        message = nil
        if resumeInstallation != nil { retryInstallation(); return }
        controller.checkForUpdates(nil)
    }
    func setAutomaticUpdates(_ value: Bool) {
        // Sparkle persists explicit choices; Info.plist supplies the first-launch defaults.
        if let controller { Self.setAutomaticUpdates(value, for: controller.updater) }
        automaticChecks = value
        automaticDownloads = value
    }
    static func setAutomaticUpdates(_ value: Bool, for updater: SPUUpdater) {
        // Sparkle only accepts download preferences while automatic checks are allowed.
        if value { updater.automaticallyChecksForUpdates = true }
        updater.automaticallyDownloadsUpdates = value
        if !value { updater.automaticallyChecksForUpdates = false }
    }
    func allowedChannels(for updater: SPUUpdater) -> Set<String> { ["alpha"] }
    var supportsGentleScheduledUpdateReminders: Bool { true }
    func standardUserDriverShouldHandleShowingScheduledUpdate(_ update: SUAppcastItem, andInImmediateFocus immediateFocus: Bool) -> Bool { false }
    func standardUserDriverWillHandleShowingUpdate(_ handleShowingUpdate: Bool, forUpdate update: SUAppcastItem, state: SPUUserUpdateState) {
        readyVersion = "\(update.displayVersionString) (\(update.versionString))"
        message = state.stage == .notDownloaded ? "An update is available." : "Update ready. Install and restart when convenient."
    }
    func updater(_ updater: SPUUpdater, willInstallUpdateOnQuit item: SUAppcastItem, immediateInstallationBlock immediateInstallHandler: @escaping () -> Void) -> Bool {
        readyVersion = "\(item.displayVersionString) (\(item.versionString))"
        message = "Update ready. It can also install when you quit normally."
        return false
    }
    func updater(_ updater: SPUUpdater, shouldPostponeRelaunchForUpdate item: SUAppcastItem, untilInvokingBlock installHandler: @escaping () -> Void) -> Bool {
        installationRequested = true
        resumeInstallation = installHandler
        retryInstallation()
        return true
    }
    private func retryInstallation() {
        guard !reserving, let handler = resumeInstallation else { return }
        reserving = true
        Task {
            defer { reserving = false }
            do {
                try await model.reserveForUpdate()
                resumeInstallation = nil
                message = "Installing update…"
                handler()
            } catch {
                message = error.localizedDescription
                await model.cancelUpdateReservation()
            }
        }
    }
    func updater(_ updater: SPUUpdater, didAbortWithError error: Error) {
        message = error.localizedDescription
        installationRequested = false
        resumeInstallation = nil
        Task { await model.cancelUpdateReservation() }
    }
    func standardUserDriverWillFinishUpdateSession() {
        if !installationRequested { readyVersion = nil }
    }
    func updater(_ updater: SPUUpdater, didFinishUpdateCycleFor updateCheck: SPUUpdateCheck, error: Error?) {
        if let error, (error as NSError).code != SUError.noUpdateError.rawValue { message = error.localizedDescription }
    }
}

struct UpdateControls: View {
    @Bindable var updater: AppUpdater
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let version = updater.readyVersion { Text("Update available · \(version)").font(.subheadline.weight(.medium)) }
            Button(updater.readyVersion == nil ? "Check for Updates…" : "Review Update & Restart…") { updater.check() }
                .disabled(!updater.enabled || (!updater.canCheck && !updater.installationRequested))
            if let message = updater.message { Text(message).font(.caption).foregroundStyle(.secondary) }
            if updater.readyVersion != nil, let blocker = updater.blocker { Text(blocker).font(.caption).foregroundStyle(.secondary) }
            Toggle("Automatic updates", isOn: Binding(get: { updater.automaticUpdates }, set: updater.setAutomaticUpdates))
                .toggleStyle(.switch)
            Text(updater.automaticUpdates ? "Checks daily for signed GitHub releases. Updates wait for drawing, calibration and unsaved settings." : "Automatic checks and downloads are off. You can still check for updates above.")
                .font(.caption).foregroundStyle(.secondary)
        }.disabled(!updater.enabled)
    }
}
