# Typography and font shaping

Research reviewed 2026-09-30. Implementation uses `harfbuzzjs` 1.6.2 (MIT), loaded on demand. Vite emits a local WASM asset (approximately 434 KB uncompressed); no CDN or font upload is involved.

OpenPlotFont 0.3 also uses this engine for embedded layout while drawing its original
stroke/fill geometry. See [OpenPlotFont integration](OPENPLOTFONT_INTEGRATION.md) for its
separate import, sizing, validation and drawing-order contract. The outline-font
behavior below continues to apply to ordinary TTF/OTF files.

## What the project needed

`plot-font.ts` previously mapped characters to a compact uppercase stroke alphabet with fixed advances. That remains useful for single-line plotting, but it cannot implement loaded-font OpenType layout. Character-to-glyph mapping and individual pair kerning are insufficient: substitutions can change the glyph count, positioning can move glyphs in both axes, and required shaping depends on script and language.

Microsoft's [GSUB specification](https://learn.microsoft.com/en-us/typography/opentype/spec/gsub) describes single, multiple, alternate, ligature, contextual and chained substitutions. The [GPOS specification](https://learn.microsoft.com/en-us/typography/opentype/spec/gpos) covers pair positioning, cursive attachments, marks on bases/ligatures/marks, and contextual positioning. These operations must be handled by a shaping engine before extracting geometry.

## Libraries evaluated

| Library | Relevant capabilities | Decision |
| --- | --- | --- |
| [HarfBuzz / harfbuzzjs](https://github.com/harfbuzz/harfbuzzjs) | OpenType shaping; glyph IDs, clusters, advances and offsets; feature values/ranges; variable axes; glyph paths; feature/axis enumeration | Selected. One engine supplies shaping and outlines. The package has TypeScript declarations and runs in the browser via WASM. |
| [Fontkit](https://github.com/foliojs/fontkit) | TTF/OTF/WOFF/WOFF2/collections; GSUB/GPOS layout, AAT, paths, variations and subsetting | Strong alternative when broad font containers or subsetting are needed. Current needs do not justify a second font engine. Its documented layout feature interface is boolean, whereas HarfBuzz exposes numeric alternate selection and ranges. |
| [opentype.js](https://github.com/opentypejs/opentype.js) | Font parsing/writing, paths, kerning, ligatures, TTF/OTF/WOFF | Useful for font editing. Its documented rendering feature options currently limit substitution features to `liga` and `rlig`, so it does not meet the advanced-feature requirement alone. WOFF2 also needs separate decompression. |
| Native browser text / CSS | Browser shaping, feature settings, variations and text layout | Good for preview, but does not provide the shaped glyph outlines needed for portable SVG and pen plotting. Native SVG text remains an imported-text limitation. |

The recommendation is based on [HarfBuzz's shaping documentation](https://harfbuzz.github.io/shaping-and-shape-plans.html): it applies the font's positioning and substitution rules and aims for OpenType compatibility. Choosing it does not make the whole application a complete text-layout implementation. The [HarfBuzz boundary](https://github.com/harfbuzz/harfbuzz/blob/main/docs/wasm-shaper.md) explicitly leaves run segmentation and line layout to the host.

## Implemented behavior

- Load local `.ttf` or `.otf` fonts with vector outlines, up to 20 MB. Font bytes remain in IndexedDB; the document stores their SHA-256 identity and typography settings. Undo snapshots do not duplicate font binaries. Reloading the identical file restores its identity.
- Choose loaded fonts or the original single-line Plot Sans. Outline fonts trace resolved outer and hole boundaries, with internal component and letter seams removed.
- Edit text, cap height, letter/word spacing in em, line height as a cap-height multiplier, and left/center/right line alignment. Cap height is calibrated from the selected variation's capital H; fonts without a capital H outline are rejected explicitly.
- Toggle `kern`, `liga`/`clig`, and `calt`. Advanced settings accept HarfBuzz feature syntax, such as `smcp=1, c2sc=1`, `dlig=1`, `tnum=1`, `onum=1`, `frac=1`, `ss01=1`, or `salt=2`. Range syntax such as `liga[0:3]=0` is also forwarded. Available GSUB/GPOS feature tags are listed; whether a feature has an effect depends on the current script, language, and glyphs.
- Set available variation coordinates such as `wght=700, wdth=100`. The UI lists axis ranges/defaults and rejects unknown axes or out-of-range values.
- Set language, ISO 15924 script, and LTR/RTL direction, or infer script and direction per line. Default required shaping is retained; a user may override features explicitly.
- Use every shaped glyph's X/Y advance and offset. Font coordinates are inverted into SVG coordinates, converted to normalized geometry, and then scaled to millimetres by the existing artwork transform.
- Apply tracking between shaped clusters, preserving attached marks. Nonzero tracking disables optional ligatures unless a feature override explicitly enables them. Tracking is suppressed in Arabic, Syriac and Mongolian lines to preserve joining. This is a scoped policy inspired by [CSS Text spacing rules](https://www.w3.org/TR/css-text-3/#letter-spacing-property), not a full implementation of CSS typography.
- Store editable contours together in a versioned compound path per glyph. Resolve each glyph using non-zero winding, then union matching glyph regions in page millimetres. Curves are flattened within 0.005 mm; generated boundary loops remain separate pen strokes and share vertices across preview, SVG export, and plotting. Ordinary imported/legacy SVG retains its existing subpath sampling unless a plot fill is enabled.
- Upgrade matching legacy outlines after fonts load on startup or document import. Preserve manual node edits, element overrides, and unavailable-font geometry with a notice. Migration keeps placement and typography options, supports document-load undo, and does not overwrite intervening edits.
- Preserve placement, rotation, pen color and independent X/Y scale during content/settings edits. Explicit cap-height changes reset both scales, matching the previous text tool.
- Report missing glyphs rather than silently substituting an unrelated character. Invalid shaping options leave the previous artwork untouched. Saved outlines remain displayable, exportable and plottable even when a font cannot be restored.

## Limits and follow-up work

This implements horizontal, explicit-newline text with one script/direction per object (inferred per line). It does not implement Unicode bidi paragraph reordering, script run itemization, line wrapping, automatic fallback fonts, vertical text, glyph palettes, named-instance selection, color/bitmap glyph painting, or a full CSS text layout model. Split mixed-script/mixed-direction content into separate text objects. HarfBuzz alone does not provide those missing layout responsibilities.

WOFF/WOFF2 and collections are deliberately rejected rather than passed as if they were uncompressed SFNT fonts. Fontkit or a dedicated decompressor could extend the loader later. The harfbuzzjs distribution is built with `HB_TINY`, so it must not be represented as every optional capability of a full HarfBuzz build. Browser font storage can be cleared or unavailable; existing geometry still works, but editing then requires loading the font again.

Browser checks also verified font loading in development and the production preview, local-font restoration after reload, variable-weight output, and inspector kerning edits. Vite excludes `harfbuzzjs` from dependency prebundling to preserve its relative WASM asset URL in development.

Tests use the SIL Open Font License Roboto and Noto Sans Arabic fixtures, with licenses stored beside the files. Coverage includes real kerning, ligatures and feature overrides, variable outlines/bounds, combining-mark normalization, Arabic shaping, spacing/alignment, contour separation, portable export, missing glyphs, and independent-scale preservation. These tests verify supported workflows; they are not an exhaustive OpenType conformance suite. Hardware plotting still needs device validation.
