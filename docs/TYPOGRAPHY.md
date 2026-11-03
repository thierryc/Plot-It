# Typography and font shaping

Local TTF/OTF text uses HarfBuzz.js, loaded on demand with a local WASM asset. Fonts are not uploaded. [OpenPlotFont](OPENPLOTFONT_INTEGRATION.md) preserves its own drawing operations and uses the same engine when embedded layout is present.

## Text settings

- Load local `.ttf` or `.otf` fonts with vector outlines, up to 20 MB. Font bytes remain in IndexedDB; the document stores their SHA-256 identity and typography settings. Undo snapshots do not duplicate font binaries. Reloading the identical file restores its identity.
- Choose loaded fonts or the original single-line Plot Sans. Outline fonts trace resolved outer and hole boundaries, with internal component and letter seams removed.
- Edit text, cap height, letter/word spacing in em, line height as a cap-height multiplier, and left/center/right line alignment. Cap height is calibrated from the selected variation's capital H; fonts without a capital H outline are rejected explicitly.
- Toggle `kern`, `liga`/`clig`, and `calt`. Advanced settings accept HarfBuzz feature syntax, such as `smcp=1, c2sc=1`, `dlig=1`, `tnum=1`, `onum=1`, `frac=1`, `ss01=1`, or `salt=2`. Range syntax such as `liga[0:3]=0` is also forwarded. Available GSUB/GPOS feature tags are listed; whether a feature has an effect depends on the current script, language, and glyphs.
- Set available variation coordinates such as `wght=700, wdth=100`. The UI lists axis ranges/defaults and rejects unknown axes or out-of-range values.
- Set language, ISO 15924 script, and LTR/RTL direction, or infer script and direction per line. Default required shaping is retained; a user may override features explicitly.
- Use every shaped glyph's X/Y advance and offset. Font coordinates are inverted into SVG coordinates, converted to normalized geometry, and then scaled to millimetres by the existing artwork transform.
- Apply tracking between shaped clusters, preserving attached marks. Nonzero tracking disables optional ligatures unless a feature override explicitly enables them. Tracking is suppressed in Arabic, Syriac and Mongolian lines to preserve joining. This is a scoped policy inspired by [CSS Text spacing rules](https://www.w3.org/TR/css-text-3/#letter-spacing-property), not a full implementation of CSS typography.
- Store editable contours together in a versioned compound path per glyph. Resolve each glyph using non-zero winding, then union matching glyph regions in page millimetres. Curves are flattened within 0.005 mm; generated boundary loops remain separate pen strokes and share vertices across preview, SVG export, and plotting. Ordinary imported/legacy SVG retains its existing subpath sampling unless a plot fill is enabled.
- Preserve placement, rotation, pen color and independent X/Y scale during content/settings edits. Explicit cap-height changes reset both scales.
- Report missing glyphs rather than silently substituting an unrelated character. Invalid shaping options leave the previous artwork untouched. Saved outlines remain displayable, exportable and plottable even when a font cannot be restored.


## Limits

This implements horizontal, explicit-newline text with one script/direction per object (inferred per line). It does not implement Unicode bidi paragraph reordering, script run itemization, line wrapping, automatic fallback fonts, vertical text, glyph palettes, named-instance selection, color/bitmap glyph painting, or a full CSS text layout model. Split mixed-script/mixed-direction content into separate text objects. HarfBuzz alone does not provide those missing layout responsibilities.

WOFF/WOFF2 and collections are deliberately rejected rather than passed as if they were uncompressed SFNT fonts. The harfbuzzjs distribution is built with `HB_TINY`, so it must not be represented as every optional capability of a full HarfBuzz build. Browser font storage can be cleared or unavailable; existing geometry still works, but editing then requires loading the font again.
