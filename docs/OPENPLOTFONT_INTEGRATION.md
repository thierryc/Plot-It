# OpenPlotFont in Plot-It

Updated 2026-10-07. Plot-It accepts OpenPlotFont draft **0.2 and 0.3** files
with `.opf` or `.opf.json` extensions. Both contain UTF-8 JSON. The identifier
must be `OpenPlotFont`; other identifiers and versions are rejected. The OpenPlotFont repository
now contains the embedded OpenType layout profile proposed during the initial
research, so the app consumes that contract directly.

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

## Library choice and evidence

[harfbuzzjs](https://github.com/harfbuzz/harfbuzzjs) remains the browser engine,
already used by Plot-It for ordinary fonts. [Fontkit](https://github.com/foliojs/fontkit)
is a credible alternative but offers no necessary capability for this integration.
[opentype.js](https://github.com/opentypejs/opentype.js) is useful for font construction;
its documented rendering feature interface is too limited to replace HarfBuzz for
this requirement. Export-side [fontTools/feaLib](https://fonttools.readthedocs.io/en/latest/feaLib/index.html)
can compile feature source; it is not needed in the PWA.

OpenPlotFont's `docs/OPENPLOTFONT_LAYOUT.md` and 0.3 examples define the consumed profile.
The app tests use original MIT OpenPlotFont fixtures, preserving their license. They
cover validation, payload corruption, ligatures, alternates, localized forms,
contextual rules, kerning once, marks, cursive offsets, multiline sizing/alignment,
curves, mixed fills, ordered trajectories, and atomic text editing. Existing
OpenType-font tests continue to cover their original behavior.

The OpenPlotFont repository's 23 layout tests passed during integration review.
Both its portable and native 0.3 examples also shaped ligatures and alternates
correctly with Plot-It's installed harfbuzzjs 1.6.2. The native demo omits its Latin
`curs` feature; that is an exporter limitation reported by the font's metadata.
Use the portable layout demo to exercise cursive positioning.

The earlier export feasibility scripts remain in `docs/research/` as historical
experiments. They are not the application importer or a production exporter.

Browser verification passed for local file loading, multiline insertion, live
ligature changes, IndexedDB restoration and editing after reload. The actual
native Glyphs 0.3 export loaded successfully, and the earlier 0.2 rejection has been replaced by explicit compatibility
coverage in the naming migration. Mixed text retained stroke/fill/stroke/fill order in asynchronous plot
preparation and placed each generated fill block beside its source in exported
SVG. The app suite passed 123 tests and the production build succeeded. Hardware
plotting was not performed.

## Reusable JavaScript package

The parser, embedded-layout verification, shaping, geometry output, SVG
serialization, and curve flattening now live in the MIT-licensed
[`@thierryc/openplotfont` workspace](../packages/openplotfont/README.md). Plot-it imports
its public API; `src/openplotfont-layout.ts` only adapts returned geometry to
editor items and preserves the established 1.4 cap-height normalization.
Font assets, IndexedDB, SVG ordering metadata, physical fill generation, and
plotter hardware remain app responsibilities.

## Explicit identity migration

The naming contract comes from the local OpenPlotFont repository and its
[format](https://github.com/thierryc/OpenPlotFont/blob/main/docs/OPENPLOTFONT_FORMAT.md),
[layout](https://github.com/thierryc/OpenPlotFont/blob/main/docs/OPENPLOTFONT_LAYOUT.md), and
[consumer](https://github.com/thierryc/OpenPlotFont/blob/main/docs/USING_OPENPLOTFONT.md) documentation.
The public website is https://thierryc.github.io/OpenPlotFont/. The custom domain is deferred.
Python imports and CLI calls use `openplotfont`; Glyphs authoring keys use `org.openplotfont`.

There are no runtime aliases. To convert an old font or an exported Plot-it
document containing embedded fonts, run:

```sh
scripts/node-lts.sh --npm run build:lib
scripts/node-lts.sh scripts/migrate-openplotfont.mjs INPUT [OUTPUT]
```

The converter validates converted fonts before writing, refuses to overwrite
output, defaults standalone fonts to `.opf.json`, retains the draft version,
and migrates metadata keys without overwriting collisions. Document conversion
updates embedded font digests, referenced IDs and SVG intent attributes while
retaining copy, coordinates, transforms and paths. Custom fonts must be embedded
in the exported document. Browser font records are not silently migrated: load
the converted files or document explicitly. Previously cached assets require
refreshing to receive the renamed files.

The bundled library and fixtures have been migrated in place. Their catalog
digests and generated previews use the new bytes. Layout demos use the upstream
renamed binary and source bindings; glyph order, advances and GSUB/GPOS rules
are unchanged. The app keeps its own Plot-it identity and `.plit.json` format.
