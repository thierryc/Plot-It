# Editing and plotting reference

Start with [your first drawing](GETTING_STARTED.md). This page keeps the detailed editing controls; [plot controls](PLOT_CONTROLS.md) covers hardware and advanced settings. Hardware profiles remain experimental; see [compatibility](COMPATIBILITY.md).

## Documents and calibration

Open the top-left menu and double-click the plot name, or choose Rename plot, to rename it; Enter saves and Escape cancels. The name is saved locally, included in document files, and used for download filenames.

**Shapes** in the floating top toolbar inserts a rectangle, ellipse, triangle, or line at the center of the paper. Set equal width and height to make a rectangle square or an ellipse circular. Select it to edit its dimensions, SVG geometry, pen color, and fill.

The top-left menu's **Save** and **Load** use the editable, versioned
**.plit.json** document format (also accepted as **.plit**), including paper, artwork, plotting preferences
and custom fonts. Load replaces the current document and can be undone.
**More → Calibration sheet** adds a grid of crossing lines with adjustable
spacing to check pen contact across the surface. See [Document format](DOCUMENT_FORMAT.md).

## Editing artwork

Drawing tools float above the canvas; zoom, fit, canvas size, and undo/redo sit at the bottom right. Edit/Plot stays at the top right. The inspector stays open at widths of 640px and above; on phones, use the Inspector button to open its drawer.

Choose System, Light, or Dark in the top-left menu to theme the interface. System follows your device appearance; your choice is saved separately from the drawing and does not affect undo history. Paper color is a separate document setting in the Paper panel (white by default), supports undo/redo, and stays unchanged when resizing. Existing pen-color controls remain independent; new text and freehand paths use black. Paper color is a material preview only: SVG export and plot commands contain the artwork, not a filled paper background.

Click the paper-size control at the bottom right of the canvas to choose a preset, enter custom width/height in millimetres, or swap orientation. Apply changes only the canvas, not the artwork or its placement; Cancel leaves the document unchanged. Canvas changes support undo/redo and custom dimensions persist locally. SVG export uses the selected physical size. Canvas dimensions do not override the plotter's physical travel limits.

The paper is fixed at world position (0, 0), measured in millimetres, with X increasing right and Y down. Objects may have negative coordinates and remain visible and editable outside every paper edge. Only the application viewport limits what is visible; selecting an object in the list and choosing **Fit selection** reveals off-screen objects. The paper boundary controls the plot area, not the editing workspace. Panning and zooming never move or resize saved artwork and do not change exported or plotted coordinates.

Artwork stays mounted while you drag, rotate, resize, or edit nodes. The active source and handles update once per animation frame. Moving and rotation retain cached fills; resizing and node edits show outlines until their cleaned geometry is regenerated on release. Escape restores the original geometry, and each completed gesture has one undo entry.

Click an object on the paper or in **Objects** to move it and edit its position, size, rotation, or pen color. Drag a corner to resize. Hold Shift while resizing to preserve proportions, or while dragging to move horizontally or vertically. Constraints also apply to selected SVG elements; pressing or releasing Shift during a gesture updates the constraint. Option/Alt-drag duplicates; Option/Alt can be pressed or released during a drag. For non-text artwork, Option/Alt-resize keeps the center fixed, and Shift + Option/Alt also preserves proportions. Text corners resize the layout frame and reflow at the current font size; Option/Alt-resize stretches the text, and Shift + Option/Alt preserves its proportions. Drag the rotation handle above the selection; Shift snaps to absolute 15° steps. Hold Space before dragging to pan anywhere in the workspace. Wheel or two-finger scrolling also pans; Ctrl/Cmd+wheel or a trackpad pinch zooms around the pointer. Zoom buttons use the viewport center. At 100%, one inch is 96 CSS pixels (a reference scale, not a calibrated ruler). **Fit paper**, **Fit selection**, and **Fit all** recover the paper, selected object, or the whole composition. **Center on paper** moves the selected object without resizing or rotating it. Duplicate or Ctrl/Cmd + D repeats the last copy’s displacement and rotation, including subsequent moves, nudges, and rotation of that copy. Resizing, edits, or selecting another artwork starts a new copy chain with a 5 mm diagonal offset. Dragging an object or handle near a viewport edge automatically pans the camera, including when the pointer stops moving. Escape restores the starting artwork and camera and discards provisional copies. Unexpected capture loss, pointer cancellation, or focus loss saves the last valid artwork transformation in one undo step. Interrupted viewport panning restores its starting position. The camera stays separate from artwork undo history and portable files. Switching to Plot fits the paper; returning to Edit restores the previous editing view. Opening a document starts with Fit paper. Arrow keys nudge by 0.1 mm; Shift + arrow nudges by 1 mm. Change both distances in the top-left menu; these browser-local preferences are independent of plot documents. Holding an arrow key produces one undo entry. Undo is Ctrl/Cmd + Z; redo is Ctrl/Cmd + Shift + Z.

The **Paper**, **Objects**, **Selection**, **SVG elements**, and **Plot fill**
sections collapse independently. Their open state stays in place while editing
or switching between Plot and editing. Every color picker has a neighboring
hex field; Enter or leaving the field applies a valid value, and Escape restores
the picker value. Invalid input shows an inline message.

Double-click an object or SVG element name, or focus its row and press F2, to
rename it. Enter or leaving the field saves; Escape cancels. Element names are
saved as document metadata, preserving SVG IDs and drawing geometry. Choose an
SVG element above its editing fields; the list stays in place during selection.

Plot Font text keeps its full original copy. Edit **Text** or **Cap height** in the inspector; valid edits update live. Enter or Shift+Enter inserts a line break. Double-click text on the paper, or choose **Edit on canvas**, to type in a native editing overlay with a live SVG preview. Click outside, choose **Done**, or press Ctrl/Cmd+Enter to finish in one undo step; Escape cancels the session. The overlay uses the interface font for native selection and input, while the canvas preview retains the chosen plot font. Invalid or empty drafts stay open until corrected or cancelled.

Resize a text frame using its corners or the inspector width/height fields. Width controls automatic wrapping, long words break between whole graphemes, and height grows when needed to keep every line visible. Font size and letter proportions stay fixed during normal resizing. Hold Option/Alt while dragging a corner to stretch the outlines deliberately; add Shift for proportional scaling. Automatic wraps never change the saved source text, so widening the frame joins those lines again. Text frames are preserved in saved Plot-it documents, duplicates, and undo/redo. Older saved text is recoverable only when its stored name exactly reproduces its geometry. Otherwise it remains editable as paths, without guessing missing text.

New text defaults to **Hershey Roman Simplex Regular**. The Font menu groups 85 reviewed OpenPlotFont stroke-library entries into **Hershey**, **EMS**, and **Other stroke fonts**, alongside OpenPlotFont Layout Demo, Plot Sans, and **Outline fonts** (Inter Regular, Inter Italic, and Square Bot Sans from AP.CX). Fonts download when selected; the default works immediately. Saved documents reload their used bundled fonts; matching legacy OpenType outlines automatically gain perimeter cleanup, while manually edited or unverifiable geometry is preserved with a notice. Downloaded fonts are available offline through the installed app's cache. Inter and Square Bot Sans retain original outlines and OpenType features, with variable weight/optical size or width/italic controls under Advanced. Each bundled font links to its attribution and license. Some Hershey symbol/non-Latin collections use temporary private-use codes; the menu help identifies their mapping limitation rather than promising standard language coverage.

Choose **Text**, then **Load a font** to use an OpenPlotFont **0.2 or 0.3** `.opf` or `.opf.json`, OpenType `.otf`, or TrueType `.ttf` file. OpenPlotFont preserves original strokes, curves and mixed fill regions; files with embedded OpenType layout support ligatures, alternates and positioning through HarfBuzz. The format identifier must be `OpenPlotFont`; pre-rename files require the explicit migration described in the integration guide. See [OpenPlotFont integration](OPENPLOTFONT_INTEGRATION.md) for behavior and limits. Loaded fonts are saved locally in this browser. Fonts excluded from the app bundle can be downloaded separately and imported the same way; see [optional font packs](OPTIONAL_FONTS.md) for licensing and recovering documents that used the former bundled ISO3098 faces. Ordinary OpenType fonts retain editable curves grouped by glyph. Preview, SVG export, and plotting use their resolved non-zero boundaries, removing component and letter overlap seams while preserving counters; OpenPlotFont draws its original operations. Mixed OpenPlotFont fills require a physical Plot fill mode before export or plotting. The Text dialog and inspector provide letter/word spacing, line height, alignment, kerning, ligatures, and advanced feature tags (`smcp=1, ss01=1, salt=2`). Variable fonts expose axis ranges and coordinates (`wght=700`). Use one script/direction per object; ordinary OpenType fonts must include capital H for cap-height calibration, while OpenPlotFont uses its declared metrics. See [Typography research and implementation](TYPOGRAPHY.md) for the library comparison, supported behavior and limits.

Double-click an imported shape, or choose it under **SVG elements**, to edit it independently without ungrouping. Its X/Y/width/height controls use page millimetres; **Shape geometry** uses the source SVG units. Choose **Edit path nodes** for square anchors and round Bézier handles, or edit path data directly. Select a node for exact page-coordinate inputs. **Whole object** or Escape leaves element editing.

The sample [editable-elements.svg](../public/examples/editable-elements.svg) includes a nested, rotated Bézier path and six basic shape types. Imported native SVG text can be edited, but must be converted to outlines before plotting; the built-in Text tool already produces plot paths. Selection boxes, hit areas, and node guides are never exported or sent to the plotter.

## Plot workspace and pen passes

Choose **Plot mode** to replace the editing inspector with the Plot sidebar. The
artwork stays visible; zoom and scrolling remain available. If connected, the
sidebar opens hardware preparation directly. Otherwise choose **Simulate** in the footer, or select a hardware destination and click **Connect**. Direct USB opens the browser device picker; network Connect claims control and opens the server EBB when idle. Connection never starts a drawing. Choose **Edit** to return to editing.

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
changing pens. See [Plot workspace architecture](PLOT_WORKSPACE.md).

**Plotter setup** in Edit mode and **Plot settings** in Plot mode include
**Plotter position**: main rail right, above, left, or below the paper. This is
the visual counterpart of the existing machine orientation setting; saved
orientations and the default remain unchanged. The discreet Figma schematic
follows the simulated or reported pen position. It is excluded from Fit,
scroll bounds, artwork exports, and motion planning.

The schematic is illustrative. Choose the actual hardware model in Plotter setup; its physical travel bounds and step resolution are separate from the drawing's paper size. See [compatibility](COMPATIBILITY.md) and [plot controls](PLOT_CONTROLS.md).

## Fills

Choose Solid, Hatch stripes, or Crosshatch in Plot fill. Use the measured mark width on your paper. The calibration swatch compares overlaps without starting hardware. See [fill behavior and limitations](FILLS.md).
