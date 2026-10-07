# Plot-it

Plot-it is a local-first Chrome PWA for preparing SVG artwork and sending it to an EBB-based pen plotter over USB or through a Raspberry Pi on your LAN. It combines a deliberately small SVG editor with single-line and loaded OpenType fonts, so a drawing can go from file or text to paper without installing a desktop driver.

**Beta · Active development.** [Open the browser app](https://plot-it.litsquare.com/app/),
[read the documentation](https://plot-it.litsquare.com/docs/), or
[get support on GitHub](https://github.com/thierryc/Plot-It/issues).
AxiDraw is untested by the author; NextDraw compatibility is not established,
including its different brushless pen-lift configuration. Pi hardware acceptance
remains pending. See the hosted compatibility notes for primary sources.

## Current feature slice

- Installable PWA with local document persistence
- Safe SVG import, drag-and-drop, export, canvas/object-list selection, move, corner resize, rotate, duplicate, and delete
- Live text and cap-height editing; local TTF/OTF font loading with HarfBuzz shaping, spacing, kerning, ligatures, OpenType features, and variable axes
- OpenPlotFont 0.2/0.3 loading with original centerlines, ordered mixed fills, and embedded OpenType layout
- Individual imported SVG element selection, millimetre positioning/sizing, shape attributes, and Bézier anchor/control-handle editing
- Freehand pen tool
- **Plot Sans**, an original single-line A–Z / 0–9 plot font
- A4, A3, and US Letter paper presets with configurable safe margins
- Curve sampling and nearest-neighbor path ordering in the browser
- Direct Web Serial connection for AxiDraw/EBB and Xylodraw profiles
- Network plotter destination served by a Raspberry Pi: isolated EBB runner, live WebSocket controls, and complete multi-pen jobs. See [Pi setup and acceptance](docs/NETWORK_PLOTTER.md).
- Shared acceleration planning, animated simulation, pen-up travel, pause/resume, cancel, pen-height tests, manual origin capture, return to origin, and explicit motor disengagement

## Run locally

For **plot-it.litsquare.com** on GitHub Pages, build locally with
`scripts/node-lts.sh --npm run build:site` and publish **dist-site/**.
The landing page is `/`, the browser editor is `/app/`, and documentation is
under `/docs/`. It offers browser USB and simulation without a Node installation.
See [site hosting and local publication](docs/SITE_HOSTING.md). No custom GitHub
Actions workflow is used. `build:browser` still produces the standalone root
editor in **dist-browser/**; the local/Pi build remains separate.

```sh
scripts/node-lts.sh --npm ci
scripts/node-lts.sh --npm run dev
```

Open the displayed localhost URL in desktop Chrome or Edge. Web Serial requires a secure context; `localhost` qualifies. For an installed copy, deploy the production build over HTTPS:

```sh
scripts/node-lts.sh --npm run build
scripts/node-lts.sh --npm run preview
```

## Documents and calibration

Open the top-left menu and double-click the plot name, or choose Rename plot, to rename it; Enter saves and Escape cancels. The name is saved locally, included in document files, and used for download filenames.

**Shapes** in the floating top toolbar inserts a rectangle, ellipse, triangle, or line at the center of the paper. Set equal width and height to make a rectangle square or an ellipse circular. Select it to edit its dimensions, SVG geometry, pen color, and fill.

The top-left menu's **Save** and **Load** use the editable, versioned
**.plit.json** document format (also accepted as **.plit**), including paper, artwork, plotting preferences
and custom fonts. Load replaces the current document and can be undone.
**More → Calibration sheet** adds a grid of crossing lines with adjustable
spacing to check pen contact across the surface. See [Document format](docs/DOCUMENT_FORMAT.md).

## Verification

```sh
scripts/node-lts.sh --npm test
scripts/node-lts.sh --npm run build
```

For native browser SVG and gesture checks, start `npx vite --host 127.0.0.1 --port 5184 --strictPort`, open `http://127.0.0.1:5184/scripts/fixtures/canvas-modifiers.html`, and click **Run isolated checks**. After its reload, click again to verify preference restoration and document import. The fixture refuses other origins, seeds disposable artwork on port 5184, and leaves the normal editor’s document and preferences untouched.

For incremental rendering checks, open `http://127.0.0.1:5184/scripts/fixtures/incremental-canvas.html` on the same isolated server. **Measure gesture** runs 160 pointer samples over 20 frames on 2,880 curve paths; **Verify behavior** checks mounted node identity, scoped fill reconciliation, cancellation, copies, Inter text, and output agreement. Run builds/tests before starting browser checks, as rebuilding the library reloads the development page.

No plot command is sent during automated tests. Hardware plotting requires the browser’s port picker and an explicit Start in the Plot sidebar. Connecting never starts motion.

Regression tests cover the real planning worker, failed preparation and retry,
cancellation, obsolete job results, sidebar controls, and simulated pen changes.

Both AxiDraw/EBB and Xylodraw use the confirmed 90° clockwise mapping as
**Standard** machine orientation. Saved documents using the former Standard are
upgraded automatically; an existing 90° setting keeps the same physical
direction. **Plot → Advanced → Machine orientation** offers additional rotations
relative to Standard. Hardware motion, live position feedback, and origin returns
share that mapping.

## Editing artwork

Drawing tools float above the canvas; zoom, fit, canvas size, and undo/redo sit at the bottom right. Edit/Plot stays at the top right. The inspector stays open at widths of 640px and above; on phones, use the Inspector button to open its drawer.

Choose System, Light, or Dark in the top-left menu to theme the interface. System follows your device appearance; your choice is saved separately from the drawing and does not affect undo history. Paper color is a separate document setting in the Paper panel (white by default), supports undo/redo, and stays unchanged when resizing. Existing pen-color controls remain independent; new text and freehand paths use black. Paper color is a material preview only: SVG export and plot commands contain the artwork, not a filled paper background.

Click the paper-size control at the bottom right of the canvas to choose a preset, enter custom width/height in millimetres, or swap orientation. Apply changes only the canvas, not the artwork or its placement; Cancel leaves the document unchanged. Canvas changes support undo/redo and custom dimensions persist locally. SVG export uses the selected physical size. Canvas dimensions do not override the plotter's physical travel limits.

Artwork stays mounted while you drag, rotate, resize, or edit nodes. The active source and handles update once per animation frame. Moving and rotation retain cached fills; resizing and node edits show outlines until their cleaned geometry is regenerated on release. Escape restores the original geometry, and each completed gesture has one undo entry.

Click an object on the paper or in **Objects** to move it and edit its position, size, rotation, or pen color. Drag a corner to resize. Hold Shift while resizing to preserve proportions, or while dragging to move horizontally or vertically. Constraints also apply to selected SVG elements; pressing or releasing Shift during a gesture updates the constraint. Option/Alt-drag duplicates; Option/Alt can be pressed or released during a drag. Option/Alt-resize keeps the center fixed, and Shift + Option/Alt also preserves proportions. Drag the rotation handle above the selection; Shift snaps to absolute 15° steps. Hold Space before dragging to pan anywhere on the canvas; Fit to view resets pan and scrolling. Duplicate or Ctrl/Cmd + D repeats the last copy’s displacement and rotation, including subsequent moves, nudges, and rotation of that copy. Resizing, edits, or selecting another artwork starts a new copy chain with a 5 mm diagonal offset. Escape restores the starting artwork and discards provisional copies. Unexpected capture loss, pointer cancellation, or focus loss saves the last valid artwork transformation in one undo step. Interrupted viewport panning restores its starting position. Arrow keys nudge by 0.1 mm; Shift + arrow nudges by 1 mm. Change both distances in the top-left menu; these browser-local preferences are independent of plot documents. Holding an arrow key produces one undo entry. Undo is Ctrl/Cmd + Z; redo is Ctrl/Cmd + Shift + Z.

The **Paper**, **Objects**, **Selection**, **SVG elements**, and **Plot fill**
sections collapse independently. Their open state stays in place while editing
or switching between Plot and editing. Every color picker has a neighboring
hex field; Enter or leaving the field applies a valid value, and Escape restores
the picker value. Invalid input shows an inline message.

Double-click an object or SVG element name, or focus its row and press F2, to
rename it. Enter or leaving the field saves; Escape cancels. Element names are
saved as document metadata, preserving SVG IDs and drawing geometry. Choose an
SVG element above its editing fields; the list stays in place during selection.

Plot Font text keeps its full original copy. Edit **Text** or **Cap height** in the inspector; valid edits update live. Older saved text is recoverable only when its stored name exactly reproduces its geometry. Otherwise it remains editable as paths, without guessing missing text.

New text defaults to **Hershey Roman Simplex Regular**. The Font menu groups the complete 87-entry OpenPlotFont stroke library into **Hershey**, **EMS**, and **Other stroke fonts**, alongside OpenPlotFont Layout Demo, Plot Sans, and **Outline fonts** (Inter Regular, Inter Italic, and Square Bot Sans from AP.CX). Fonts download when selected; the default works immediately. Saved documents reload their used bundled fonts; matching legacy OpenType outlines automatically gain perimeter cleanup, while manually edited or unverifiable geometry is preserved with a notice. Downloaded fonts are available offline through the installed app's cache. Inter and Square Bot Sans retain original outlines and OpenType features, with variable weight/optical size or width/italic controls under Advanced. Each bundled font links to its attribution and license. Some Hershey symbol/non-Latin collections use temporary private-use codes; the menu help identifies their mapping limitation rather than promising standard language coverage.

Choose **Text**, then **Load a font** to use an OpenPlotFont **0.2 or 0.3** `.opf` or `.opf.json`, OpenType `.otf`, or TrueType `.ttf` file. OpenPlotFont preserves original strokes, curves and mixed fill regions; files with embedded OpenType layout support ligatures, alternates and positioning through HarfBuzz. The format identifier must be `OpenPlotFont`; pre-rename files require the explicit migration described in the integration guide. See [OpenPlotFont integration](docs/OPENPLOTFONT_INTEGRATION.md) for behavior and limits. Loaded fonts are saved locally in this browser. Ordinary OpenType fonts retain editable curves grouped by glyph. Preview, SVG export, and plotting use their resolved non-zero boundaries, removing component and letter overlap seams while preserving counters; OpenPlotFont draws its original operations. Mixed OpenPlotFont fills require a physical Plot fill mode before export or plotting. The Text dialog and inspector provide letter/word spacing, line height, alignment, kerning, ligatures, and advanced feature tags (`smcp=1, ss01=1, salt=2`). Variable fonts expose axis ranges and coordinates (`wght=700`). Use one script/direction per object; ordinary OpenType fonts must include capital H for cap-height calibration, while OpenPlotFont uses its declared metrics. See [Typography research and implementation](docs/TYPOGRAPHY.md) for the library comparison, supported behavior and limits.

Double-click an imported shape, or choose it under **SVG elements**, to edit it independently without ungrouping. Its X/Y/width/height controls use page millimetres; **Shape geometry** uses the source SVG units. Choose **Edit path nodes** for square anchors and round Bézier handles, or edit path data directly. Select a node for exact page-coordinate inputs. **Whole object** or Escape leaves element editing.

The sample [editable-elements.svg](public/examples/editable-elements.svg) includes a nested, rotated Bézier path and six basic shape types. Imported native SVG text can be edited, but must be converted to outlines before plotting; the built-in Text tool already produces plot paths. Selection boxes, hit areas, and node guides are never exported or sent to the plotter.

## Motion engine and licensing

Plot-it uses an original polyline acceleration planner and documented timed EBB
commands. Pen control configures explicit Up/Down endpoints and separate rates,
then sends SP commands with settling waits. No Saxi code is used.
The app is AGPL-3.0-only. See LICENSE and THIRD_PARTY_NOTICES.md.
The Source link downloads the corresponding source archive generated before
local development and production builds. Deploy it alongside the built app.

## Plot workspace and pen passes

Choose **Plot mode** to replace the editing inspector with the Plot sidebar. The
artwork stays visible; zoom and scrolling remain available. If connected, the
sidebar opens hardware preparation directly. Otherwise choose **Simulate** or
**Connect plotter**. Connection opens the browser USB picker and never starts
motion. **Back to editing** restores the editor.

**Pens & passes** discovers stroke and generated-fill colors across the whole
artwork. Equivalent RGB colors share a pen, including colors from different
imports. Each pen has a swatch, editable hex value, optional name, include
checkbox, reorder controls, and **Only**. Assignments change the plot preview
and job without recoloring the drawing or SVG export. Assigning colors to the
same pen merges them. **All pens** restores the full selection.

The default **Group by pen** completes each pen together and optimizes paths
within it. Protected OpenPlotFont stroke/fill sequences remain intact and can
require repeated pens; the numbered pass list shows the actual sequence.
**Follow artwork order**, under Advanced, preserves source order. Every pen
change lifts the pen, parks at origin, and waits for **Continue with this pen**.
There is no optional toggle to bypass pen changes.

Hardware **Start with this pen** authorizes the first pen. Without a saved
origin, Start captures the current carriage position automatically; the sidebar
shows a reminder before starting. **Set origin** explicitly saves the current
position. **Return to origin** lifts and returns to that reference. **Engage
motors** preserves an existing reference. **Release motors**, profile changes,
USB removal, and transport errors invalidate it. Origin is session-only.

**Pause** settles at a motion boundary, lifts the pen, and holds XY. **Resume**
restores the planned pen state. **Stop** settles and returns to origin; the
sidebar shows Stopping and Returning until physical motion and cleanup finish.
Completion returns according to the saved final-return setting. Stop and
completion lift the pen, wait for motion to settle, and release the motors before
reporting success. This invalidates the origin; the next Start captures the
current carriage position. Pause and pen changes keep motors engaged to preserve
alignment within the job. Errors never initiate a return move or resume a partial job.

Simulation uses the same planned paths and origin travel. It supports pen-change
waits, pause/resume, scrubbing, replay, and 1×–10× speed. Stop resets the virtual
pen to origin. Estimates count motion and servo time, excluding time spent
changing pens. See [Plot workspace architecture](docs/PLOT_WORKSPACE.md).

**Plotter setup** in Edit mode and **Plot settings** in Plot mode include
**Plotter position**: main rail right, above, left, or below the paper. This is
the visual counterpart of the existing machine orientation setting; saved
orientations and the default remain unchanged. The discreet Figma schematic
follows the simulated or reported pen position. It is excluded from Fit,
scroll bounds, artwork exports, and motion planning.

The model selector scales this illustrative footprint to the overall dimensions
of [AxiDraw V3](https://shop.evilmadscientist.com/productsmenu/846)
(21.5 × 16 in), [V3/A3](https://shop.evilmadscientist.com/productsmenu/890AxiDrawV3)
(26 × 18.5 in), or the supplied XyloDraw dimensions (25 × 22 in). These are
display dimensions; model selection does not change machine travel limits or
motor calibration. The source shape is [Figma frame 13:23](https://www.figma.com/design/GAOU42M7k2V4NPGHwNzd9b/Untitled?node-id=13-23).

## Hardware safety

- Start with conservative speed and the pen physically clear of the page.
- Confirm the correct device profile before plotting. Xylodraw and AxiDraw use different steps-per-millimetre values.
- Place the carriage at your intended physical origin before the first Start, or explicitly use **Set origin**. Changing profiles invalidates the reference. EBB origin is counter-based, not sensor homing.
- The USB transport is implemented but has not been exercised against your specific plotter in this repository.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the module map and next milestones.
The current EBB compatibility and safety decisions are documented in [docs/EBB_PROTOCOL.md](docs/EBB_PROTOCOL.md).

### Pencil-width fills

Select an object or SVG element and use **Plot fill** for Solid, Hatch stripes,
or Crosshatch. Set the actual drawn line width in millimeters; Solid uses
overlap, while hatching uses the clear gap between marks. Fill settings remain
editable and support undo/redo. **Draw boundary** traces resolved outer and hole loops within each SVG element; select **None** for boundary-only output without interior fill. Separate elements remain independent. **Add calibration swatch** creates four overlap
samples without starting the plotter.

See [Fill behavior and release roadmap](docs/FILLS.md) for supported geometry,
limitations, and the pending pencil/pen release checks. Try
[fill-regions.svg](public/examples/fill-regions.svg) for holes, transforms, and
open linework. Concentric/spiral and artistic patterns remain later milestones.

## Reusable OpenPlotFont library

Plot-it consumes the MIT-licensed `@thierryc/openplotfont` package from the local
`packages/openplotfont` npm workspace. See [the library README](packages/openplotfont/README.md)
for loading, text layout, SVG/Canvas adapters, units, and publishing.
`npm run dev`, `npm test`, and `npm run build` build the library first; run
`npm run dev:lib` in a second terminal to rebuild it while editing its source.
The library contains no font assets or editor/device controls. Plot-it keeps
its AGPL license, its bundled fonts and their notices, and its own thin
editor adapter. The corresponding-source download includes the library source.

### Shared Plotter Core and virtual monitor

The fresh native SM / T3 / TD core is in `packages/plotter-core`; browser execution
runs in a dedicated worker and Node/CLI reuse the same library. Firmware 2.8.1–3.x
has the SM compatibility path; explicit S-curve targets 3.1.7. Physical Auto remains
SM until hardware acceptance. See [the candidate checkpoint](docs/CORE_REWRITE_STATUS.md).

Open `/virtual.html` on the local app for position/pen/FIFO/power and a simple path
trail, or run `scripts/node-lts.sh --npm run plot:virtual -- --modern --monitor --trace`.
The monitor cannot open USB. `plot:cli -- --help` describes JSON/SVG preparation,
virtual execution, explicit devices/runner jobs, repeats and checkpoint resume.
