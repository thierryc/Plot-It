# Mac website imagery

- `app-icon.png`: a 512-pixel export of the released Icon Composer icon. The source glyph's subtraction masks are already resolved in the native icon assets; do not replace this with a raw Glyphs SVG export.
- `mac-setup.png` and `agent-connections.png`: native SwiftUI views rendered by `UISnapshotTests`, using the app's preview model and example configuration. The capture does not start a service, connect USB, or change an agent's configuration.
- `plot-progress.png`: the bundled MCP Apps progress card captured inside `scripts/preview-plot-progress.mjs`, using simulated drawing data. This is a component preview, not an assertion that a particular agent client renders cards or that a physical plot has completed.

Native captures can be regenerated with `PLOTIT_CAPTURE_DIR=/tmp/plotit-site-media swift test --package-path macos --filter UISnapshotTests`. Copy `setup-0.png` and `setup-1.png` to the names above. The website captions disclose example/simulated data. Retain readable controls, alt text, and the original aspect ratios.
