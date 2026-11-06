import AppKit
import SwiftUI

/// The shared full-color Plot-It identity, supplied by the app's designer.
struct PlotItAppIcon: View {
    private static let image: NSImage = {
        guard let url = Bundle.module.url(forResource: "PlotItAppIcon", withExtension: "png"),
              let image = NSImage(contentsOf: url) else {
            preconditionFailure("Missing bundled Plot-It app icon")
        }
        image.isTemplate = false
        return image
    }()

    var body: some View {
        Image(nsImage: Self.image)
            .renderingMode(.original)
            .resizable()
            .scaledToFit()
            .accessibilityHidden(true)
    }
}

/// Native mask-resolved LitSquare Icons. The bolt means USB is connected.
enum PlotItConnectionSymbol: String, CaseIterable {
    case disconnected = "PlotItDisconnected"
    case connected = "PlotItConnected"
    case plotting = "PlotItPlotting"
    init(connected: Bool, plotting: Bool) {
        self = !connected ? .disconnected : plotting ? .plotting : .connected
    }
}

@MainActor
enum PlotItIcons {
    private static let images = Dictionary(uniqueKeysWithValues: PlotItConnectionSymbol.allCases.map { ($0, load($0.rawValue)) })
    static func menuBar(connected: Bool, plotting: Bool) -> NSImage {
        images[PlotItConnectionSymbol(connected: connected, plotting: plotting)]!
    }
    private static func load(_ name: String) -> NSImage {
        guard let url = Bundle.module.url(forResource: name, withExtension: "pdf"), let image = NSImage(contentsOf: url) else {
            preconditionFailure("Missing bundled connection icon: \(name)")
        }
        image.size = NSSize(width: 24, height: 18)
        image.isTemplate = true
        return image
    }
}

struct PlotItConnectionMark: View {
    let connected: Bool
    var plotting = false
    var body: some View {
        Image(nsImage: PlotItIcons.menuBar(connected: connected, plotting: plotting))
            .renderingMode(.template).resizable().scaledToFit()
            .foregroundStyle(.white).padding(6)
            .background(Color.plotItMagenta.gradient, in: .rect(cornerRadius: 10))
            .accessibilityHidden(true)
    }
}
