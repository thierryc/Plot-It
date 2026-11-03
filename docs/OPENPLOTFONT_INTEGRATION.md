# OpenPlotFont in Plot-it

Plot-it accepts OpenPlotFont drafts **0.2 and 0.3** as UTF-8 `.opf` or `.opf.json` files. The identifier must be `OpenPlotFont`.

## Using it

Choose **Text → Load a font**, select a `.opf` or `.opf.json` file, enter one or more
lines, then add it to the canvas. The inspector keeps the complete text editable.
Fonts are stored in IndexedDB under a SHA-256 identity; undo snapshots retain the
copy, settings and derived paths without duplicating font files.

A 0.3 file without `layout` uses Unicode scalar lookup, numeric advances and pair
kerning for simple left-to-right Latin text. A file with `opentype-static-v1`
layout uses the embedded OpenType font for substitutions and positioning. Its
returned glyph IDs select the original OpenPlotFont drawings through `glyphOrder`.
Companion outlines never become the plotted paths.

Both modes support cap height in millimetres, letter and word spacing in em,
explicit newlines, blank lines, and left/center/right alignment. Selecting an
OpenPlotFont initializes line spacing from `ascender - descender + lineGap`, expressed
in the existing cap-height multiplier control. Saved line spacing keeps its
meaning. Capital H is not required: size uses the declared capHeight metric.

Files with layout expose feature tags and script/language/direction settings.
Kerning, standard ligatures and contextual alternates have toggles; advanced
settings accept values such as `ss01=1`, `salt=1`, `tnum=1`, or `curs=1` when the
font provides them. Mark positioning and cursive placement use HarfBuzz offsets.
Typography options override font recommendations; explicit advanced feature
settings override the toggles. Tracking operates between shaped grapheme clusters
and suppresses optional ligatures unless explicitly re-enabled.

## Drawing intent

Independent strokes remain separate paths. Open/closed state, quadratic/cubic
curves, operation order, and direction are retained. Closed centerline loops stay
strokes even when object-level fill settings are enabled.

Filled regions retain their compound contours and fill rules. Select **Solid**,
**Hatch stripes**, or **Crosshatch** under Plot fill to prepare their toolpaths
using the actual drawn width. With None, mixed OpenPlotFont text cannot be exported
or plotted as an outline-only approximation. Generated fill blocks occur at the
source operation position, including SVG export and asynchronous plot preparation.

Travel optimization treats each OpenPlotFont text object as an atomic ordered group.
It may move that group relative to other artwork but cannot reorder or reverse
its glyph strokes. Clipping and maximum continuous-line settings still apply.
Centerline curves are flattened after the physical transform with a 0.005 mm
convex-hull error tolerance; tiny stroke endpoints are not removed by the generic
SVG sampler's minimum-distance filter.

## Validation and persistence

Import rejects duplicate JSON keys, invalid geometry, unsupported versions or
profiles, nonfinite numbers, bad Unicode mappings, broken references and excessive
complexity. Embedded layout verification checks its digest, static SFNT directory,
glyph count, units, advances, Unicode cmap, feature manifest, script/language
manifest, and optional authoring-source digest/binding before handing it to WASM.
The embedded payload must be a static TTF or CFF OTF; variable/AAT data and Unicode
variation-selector cmap are rejected. This is profile validation, not a general
font sanitizer. No new runtime dependency was added.

Reload restores font assets and text editing. If storage disappears, the existing
geometry remains visible and exportable; text editing requires the original
file. Missing characters fail explicitly rather than substituting a different
letter. Invalid edits leave existing geometry unchanged.

## Supported scope

Explicit-newline horizontal text uses one script/direction per line. Automatic
wrapping, mixed-direction paragraph layout, fallback fonts, variable OpenPlotFont
geometry, and deliberate pen-down script joining are not implemented. Cursive
positioning does not authorize a join. Tabs require an explicit layout policy
and are rejected. Geometry-only mode does not execute feature rules or position
combining marks through anchors.

## Reusable JavaScript package

The parser, embedded-layout verification, shaping, geometry output, SVG
serialization, and curve flattening now live in the MIT-licensed
[`@thierryc/openplotfont` workspace](../packages/openplotfont/README.md). Plot-it imports
its public API; `src/openplotfont-layout.ts` only adapts returned geometry to
editor items and preserves the established 1.4 cap-height normalization.
Font assets, IndexedDB, SVG ordering metadata, physical fill generation, and
plotter hardware remain app responsibilities.

## Font conversion utility

The importer does not accept alternate format identifiers. For files that require identifier/key conversion, use:

```sh
scripts/node-lts.sh --npm run build:lib
scripts/node-lts.sh scripts/migrate-openplotfont.mjs INPUT [OUTPUT]
```

The utility validates before writing and refuses to overwrite output. It updates embedded font identities and document references while retaining geometry, placement and draft version. Reload the converted font or document explicitly; browser font storage is not modified by the command.
