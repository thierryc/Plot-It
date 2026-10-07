# Bundled OpenPlotFonts

All five assets are copied verbatim from the OpenPlotFont repository's current
`output/` OpenPlotFont 0.3 exports. Their glyph geometry, advances, metrics,
Unicode mappings and provenance are preserved.

| Font | Upstream export | Layout |
| --- | --- | --- |
| Hershey Roman Simplex Regular (default) | HersheyRomanSimplex.opf.json | Geometry only |
| Hershey Roman Duplex Regular | HersheyRomanDuplex.opf.json | Geometry only |
| Hershey Roman Triplex Regular | HersheyRomanTriplex.opf.json | Geometry only |
| Hershey Script Simplex Regular | HersheyScriptSimplex.opf.json | Geometry only |
| OpenPlotFont Layout Demo Regular | OpenPlotFontLayoutDemo.opf.json | Embedded OpenType |

The four Hershey faces preserve all 95 printable ASCII mappings and use their
declared metrics for line spacing. No kerning or script joins are invented.
Pinned Hershey upstream revision: `1356bf2f83d380fcef68c887e88675eb9d445d86`.
Source and conversion details: https://github.com/thierryc/OpenPlotFont/tree/main/fonts

The Layout Demo is the native export, identical to the repository's
`examples/layout-demo-native.opf.json`. Its repertoire is A, f, i, n, u,
0, space/NBSP and combining acute/dot, plus unencoded alternates/ligatures.
It includes kern, liga, calt, locl, mark, mkmk, salt, ss01 and tnum.
The native compiler omitted the Latin curs rule, as recorded in its metadata;
that tag is unavailable. It is a conformance demo, rather than a full alphabet.
The embedded payload is validated and shaped with HarfBuzz before selecting
its original OpenPlotFont drawings.

Hershey data retains its own terms. Preserve the complete upstream notice at
[HERSHEY_NOTICE.txt](../../public/fonts/HERSHEY_NOTICE.txt). The original
Layout Demo retains OpenPlotFont's [MIT license](../../public/fonts/OPENPLOTFONT_LICENSE.txt).
Both notices ship with the production app and source archive.

## Complete menu catalog

`catalog.json` describes 87 reviewed OpenPlotFont library entries plus Inter Regular,
Inter Italic, and Square Bot Sans. Five overlap the existing immediate fonts; the
Layout Demo is additional, yielding 91 bundled menu entries plus Plot Sans.
Defaults and existing font IDs remain compatible. The shared font picker filters by style, drawing type, and collection.
Only selected assets load from `public/fonts/library`; all notices, ancestor
licenses, source SVG/JHF/LFF files, and original JSON metadata are retained. JSON
is compacted without changing its geometry. The catalog records original-export
and bundled-asset SHA-256 digests. Native default Hershey exports remain unchanged.

Reproduce the assets with `scripts/bundle-font-library.py --help`, using the
reviewed OpenPlotFont library and official Inter TTFs/OFL plus AP.CX's Square Bot Sans
2.009 release ZIP. Inter comes from `google/fonts/ofl/inter` (Inter project authors
/Rasmus Andersson); Square Bot Sans comes from https://ap.cx/fonts/squarebot/ and
retains its Hubot Sans ancestry notices. Both are original variable outline fonts;
no centerline conversion is inferred.

Fourteen Hershey JHF collections explicitly use private-use mappings. These
drawings may be addressed by their declared private-use Unicode scalar; ordinary
Greek/Cyrillic/Japanese text mappings are not qualified. Simple layout supports
those explicit symbols, while complex scripts still require OpenType layout.

The font picker uses locally generated SVG specimens and loads only thumbnails
near the visible rows. See [Font menus and specimens](../../docs/FONT_PICKER.md)
for generation, imported-font caching, keyboard interaction, and filter metadata.
