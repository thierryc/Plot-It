# Plot-it documents (.plit and .plit.json)

**Save** downloads `plot-it-document.plit.json`. **Load** opens one as the current
editable document; Undo restores the previous document. SVG Import adds artwork
to a document and SVG Export produces portable drawing geometry. Load and
drag-and-drop accept both `.plit` and `.plit.json` (case-insensitive). Both
extensions use the same JSON format; Save defaults to `.plit.json`.

The file is UTF-8 JSON, with a versioned envelope:

```json
{
  "format": "plot-it",
  "version": 1,
  "units": "mm",
  "document": {
    "paper": { "name": "A4 portrait", "width": 210, "height": 297 },
    "paperColor": "#ffffff",
    "items": [],
    "settings": {},
    "pens": {
      "assignments": {}, "excluded": [], "order": [], "mode": "group"
    }
  },
  "fonts": []
}
```

`items` retains each object's ID, name, editable SVG `markup`, four-number
`viewBox`, placement (`x`, `y`, `width`, `height`, `rotation`), original pen color
(`stroke`), optional `fillSettings`, and optional `text`. Text stores the full
`content`, `options` (font ID, spacing, alignment, layout features and variable
coordinates), and `format: "plotfont"` for protected PlotFont operations.
Coordinates and dimensions are millimetres except local SVG viewBox coordinates.
Rotation is in degrees. SVG markup preserves imported source colors and per-shape
fill settings; generated preview/fill overlays are regenerated after loading.

`settings` stores the machine profile and orientation, motion settings, pen
heights, safe margin, path ordering, maximum pen-down length and final-return
preference. `pens` stores plot-only assignments, names, included/excluded source
colors, assigned-pen order and group/source ordering. Missing optional fields use
the application's defaults. Legacy orientation values are migrated, and different
pens always pause regardless of a legacy `pauseOnToolChange: false` value.

`fonts` embeds only custom fonts used by the document. Each record has `id`,
`name`, `format` (`opentype` or `plotfont`), `encoding: "base64"` and `data`.
IDs are SHA-256 digests of the original bytes, prefixed with `plotfont-` for
PlotFont JSON. Loading verifies the digest, registers the fonts and saves them in
local font storage. Bundled fonts and Plot Sans are referenced by ID and are not
embedded. SVG outlines remain in the document alongside editable text.

Selection, zoom, tools, theme, USB connection, carriage origin, motor state and
execution progress are session state and are not loaded from the file. Loading
validates all geometry, IDs, dimensions, settings and font records before
replacing artwork; executable SVG content is removed. Unsupported versions and
invalid files report an error and retain the current document. The current file
limit is 100 MB, with 20 MB per embedded font.

## Surface calibration

**More → Calibration sheet** adds one editable object without replacing artwork.
Default spacing is 20 mm; the popover accepts 2–100 mm. Horizontal and vertical
lines cross evenly across the paper, centered within the safe margin with an
additional 0.5 mm clearance. The sheet uses one black source color. Plot it with
consistent pen height and inspect faint/missing sections for uneven contact.
