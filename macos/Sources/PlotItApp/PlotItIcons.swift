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

/// Regular-S outlines from LitSquare Icons. Template rendering follows the menu bar appearance.
@MainActor
enum PlotItIcons {
    private static let idle = load("PlotItIdle")
    private static let plotting = load("PlotItPlotting")

    static func menuBar(plotting isPlotting: Bool) -> NSImage {
        isPlotting ? plotting : idle
    }

    private static func load(_ name: String) -> NSImage {
        guard let url = Bundle.module.url(forResource: name, withExtension: "pdf"),
              let image = NSImage(contentsOf: url) else {
            preconditionFailure("Missing bundled menu-bar icon: \(name)")
        }
        image.size = NSSize(width: 24, height: 18)
        image.isTemplate = true
        return image
    }
}
