# Font menus and specimens

The Add Text dialog and the selection inspector share the same font picker in
all three builds: local/Pi, standalone browser, and hosted site. Search matches
font names, collections, styles, and drawing types. Style, Drawing, and Collection
filters combine with the search. Clear filters resets all four fields.

Browsing or filtering does not modify the drawing or download full font files.
Click a result, or use the search field's arrow keys and Enter, to select it.
Escape cancels and returns focus to the font button. Selection retains the
existing font loading, document IDs, attribution, and undo behavior.

Style categories are curated browsing aids in `scripts/font-styles.mjs`.
Imported fonts appear under Your fonts and Other / unclassified; appearance is
not inferred from their filenames. Drawing type comes from actual PlotFont
operations, including older operations with an implicit stroke type. Ordinary
OpenType fonts are outlines. A mixed PlotFont contains both strokes and filled
shapes. Limited/private-use mapping warnings remain visible.

## Preview generation

Run `scripts/node-lts.sh --npm run build:font-previews` to regenerate bundled
specimens. Every production build also regenerates them before packaging the
source archive. The generator reads local font assets, uses the existing text
renderer and HarfBuzz, and writes SVG path geometry to `public/fonts/previews/`
and metadata to `src/fonts/previews.json`. No font files are fetched from another
website. Each filename includes the geometry's SHA-256 digest. Source licenses
and attribution remain alongside the fonts; a preview grants no new font rights.

The 92 bundled thumbnails total about 274 KiB. The picker assigns image sources
only near the visible portion of its scroll area. Browsing the library does not
initialize or parse all bundled fonts in the browser.

An imported font receives an on-demand specimen from its already loaded font.
Rendering is queued one at a time between event-loop turns, with at most 12
pending requests. Results are reused by content-based font ID and preview
version, with at most 32 entries each in memory and IndexedDB. Each SVG is
limited to 128,000 characters. Storage failures leave font selection working;
a missing preview leaves the font name available. Extremely complex individual
fonts may still take time to render; this queue limits repeated work, not the
cost of an individual font. No new rendering dependency is used.
