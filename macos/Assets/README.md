# App icon

`AppIcon.icon` is the editable Apple Icon Composer document. Its white foreground is `litsquare.plot-it` from the **Regular-S** master of LitSquare Icons, on vivid magenta (`#FF00A6`). Liquid Glass effects are enabled. Packaging compiles the document to `Assets.car` and a legacy `AppIcon.icns` with Apple's `actool`.

The menu-bar templates use `litsquare.plot-it` normally and `litsquare.plot-it.ploting` during an active plot. Both are vector PDFs in `Sources/PlotItApp/Resources`, rendered as macOS template images.

**Resolve Glyphs masks before export.** Raw `layer.paths`, `copyDecomposedLayer()` or ordinary SVG export can retain mask contours as visible shapes or lose their effect. Use the native Glyphs draw stack with unsupported masks baked into the resulting geometry. `Glyphs/resolved-outlines.json` retains the resolved vector commands, drawing order and master identity. `Glyphs/regular-outlines.json` is a frozen verification fixture with body contours, one subtraction mask and the final lightning bolt for each symbol; it is never used directly as artwork.

`scripts/export-glyphs-icons.py` runs through the authorized Glyphs scripting workflow, without editing or saving the font. `swift scripts/generate-mac-icon-vectors.swift` regenerates the mask-free SVGs and menu PDFs from the resolved commands. `scripts/node-lts.sh scripts/verify-mac-icon-masks.mjs` compares their coverage with an independent subtraction-mask rendering and writes the results under `output/icon-review`.

Alternative icon inputs are:

- `AppIcon.icns`, or
- `AppIcon.png`: a square image at least 1024 × 1024 pixels. Transparency is preserved.

Packaging generates the complete macOS icon set from a PNG. Alternatively set `PLOTIT_APP_ICON` to an absolute `.icon`, `.icns` or PNG path. A supplied environment path takes precedence over this directory. Signed release packaging refuses to use the provisional icon.

Do not add certificate files, private keys, signing passwords or notarization credentials here. Rebuild the app after changing its icon, because changing a signed bundle invalidates its signature.

The full-color in-app identity is `Sources/PlotItApp/Resources/PlotItAppIcon.png`, supplied by the designer. Setup and menu-panel views use this bundled image. MCP setup/progress cards embed the same PNG as a data URL during `build:companion`, so branding never depends on an internet request. Website and favicon PNGs retain the same bytes. Menu-bar templates remain the separate monochrome idle/plotting symbols.
