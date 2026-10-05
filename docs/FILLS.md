# Plot fills and release roadmap

## Milestone 1: implemented, awaiting physical release checks

Select an object or one of its SVG elements, then choose **Plot fill**:

- **Solid**: spacing = drawn line width × (1 − overlap).
- **Hatch stripes**: spacing = drawn line width + clear gap.
- **Crosshatch**: two perpendicular hatch passes, each using the chosen gap.

Defaults are 1.0 mm drawn width, 15% Solid overlap, 45° angle, and 1 mm
hatch gap. Solid connects strokes by default; hatch and crosshatch do not.
Connections are retained only when their entire centerline is inside the inset
region. Use the measured mark on your paper rather than the nominal lead size.

**Add calibration swatch** adds four 18 × 12 mm samples at 0%, 10%, 15%, and
20% overlap, with labels. They are placed at the top of the page; move other
artwork out of the way before plotting. Adding a swatch never starts a plot.
After comparing samples, select the artwork and use the preferred overlap button.

**None** displays outline-only linework, including imported shapes with native
SVG interior paint. Existing strokes remain; shapes without strokes use the
object's pen color and the standard linework width. These preview/export changes
do not rewrite editable source markup. Enable **Draw boundary** in None mode
to replace closed outlines with resolved outer and hole boundaries without any
interior fill strokes. Drawn line width controls the boundary width, open
linework remains available, and separate SVG elements remain independent.

Explicit object-level None disables all fills in that object, preserving saved
SVG element settings. Otherwise element settings override the object's setting;
element-level None disables just that element. Objects with only element fills
show **Element fills** in the object selector, so choosing None explicitly turns
them all off. Enable the object fill before editing blocked element fill controls.
Shapes keep their source geometry. Changes to size, nodes, transforms, text, or
settings regenerate physical-mm paths. Undo/redo and local storage preserve
settings, not generated strokes. Removing an element removes its settings as well.

The fill worker unions contours according to the SVG winding rule and insets by
half the physical line width plus a 0.01 mm allowance for curve approximation.
Curves are adaptively sampled in page coordinates. Narrow features and sharp
corners can remain uncovered and produce diagnostics. **Draw boundary** follows
the resolved outer and hole loops, removing internal overlap seams within each
SVG element. It extends half the configured drawn width outside the boundary
and remains available when the region is too narrow to hatch. Separate SVG
elements retain independent boundaries.
Open contours are preserved, including open subpaths within a filled path.

Flat source fill colors are used for generated strokes. If the source has no
fill, its stroke color is used. Native text must be converted to outlines;
the built-in loaded OpenType font tool supplies grouped glyph geometry. Each
glyph is resolved with non-zero winding before matching glyph regions are
merged within the text object. Perimeter-only text uses the original boundaries
without a pen-radius inset; different pens or fill settings remain separate.
Clipping, masking, gradients, and pattern paints are rejected for filled shapes
with an actionable error. Documents without fill settings now display and export outline-only linework.

Preview, export, simulation, and hardware preparation consume the same generated
vertices. SVG export bakes ordinary strokes without source fill settings;
reimported exports are static stroke artwork. Editable settings are kept in the
local document. Plot estimates include paper-margin clipping, path ordering,
maximum continuous line breaks, and acceleration planning. Manual pen-change
waiting time is excluded. Generation and planning run in separate workers;
edits cancel stale generation, and dense jobs are limited to 100,000 fill points.
Heavy tasks show a single progress panel over the canvas.
Fill generation, path ordering, and motion estimation report their current stage
and percentage; geometry preparation uses an animated bar. **Cancel task** stops
the current generation or estimate. Changing a fill setting regenerates a
cancelled fill. Saved explicit widths are preserved when the default changes.
SVG reading and preview construction yield in approximately 8 ms slices.
Unchanged objects reuse their collected geometry and fill paths; selection and
zoom do not regenerate strokes or recalculate plot estimates. During drag,
resize, rotation, and node gestures, the source geometry is shown and fills
regenerate after the gesture ends. Other edits are debounced by 120 ms and
estimates by 200 ms. Planning reads generated stroke arrays directly rather
than parsing the dense SVG preview again.

### Physical release gate (pending)

1. Measure a pencil and a pen mark on the intended paper; set drawn width.
2. Plot the calibration swatches and record the chosen overlap for each tool.
3. Import `public/examples/fill-regions.svg`; plot Solid, Hatch, and Crosshatch.
4. Check the rectangular block, counter, transformed concave path, circle,
   and unchanged open line. Look for boundary spills, missing counters, blobs,
   and gaps; compare against simulation and exported SVG.
5. Repeat after resizing and with outline enabled. Confirm the expected outline
   extension and document useful tool/paper settings.

Automated checks and browser verification do not substitute for these physical
trials. Milestone 2 must wait until this release gate has passed.

## Milestone 2: planned

Concentric inward contours, contained spiral connections, named calibrated tool
profiles, wide stripe bands, consistent drawing order, and highlighted uncovered
slivers. Profiles copy settings into artwork; later profile edits do not change
existing drawings. Contour splitting and bridges around holes require geometry
and physical comparison tests before release.

## Milestone 3: planned

Waves, deterministic rough hatching, stipple with dwell controls, grayscale-driven
hatch density, and experimental Hilbert maze fills. Retain the same containment,
editable settings, and shared output pipeline. Stipple requires hardware trials;
calibrated tonal presets require printed swatches. Pressure automation and
pencil-wear compensation remain outside this roadmap.
