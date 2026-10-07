# OpenPlotFont migration verification

Completed 2026-10-07 against the local OpenPlotFont repository at `c6ec987`,
the merge of PR #4 containing requested commit `242fde9`. Reviewed the format,
layout and consumer documentation. Plot-it retains its application name,
document format and plotter behavior.

## Changes

- Renamed the TypeScript workspace to `@thierryc/openplotfont`, including public
  APIs, types, imports, npm scripts, lockfile, configuration and package docs.
- Migrated messages, UI labels, SVG intent attributes, document font records,
  font IDs, browser-storage records, research scripts, notices and project links.
- Renamed 101 bundled/fixture JSON files to `.opf.json`, with `OpenPlotFont`
  format identifiers and `org.openplotfont` metadata. Updated catalog hashes
  and regenerated all 92 static previews and corresponding source archive.
- Added `.opf` and `.opf.json` loading, including case-insensitive suffixes.
  Draft 0.2 geometry and draft 0.3 geometry/optional layout are supported.
  Invalid identifiers and versions fail explicitly; no runtime aliases exist.
- Added an offline converter for font JSON and Plot-it documents with embedded
  fonts. It defaults fonts to `.opf.json`, validates before writing, refuses
  overwriting output, detects metadata conflicts and updates embedded font
  hashes and document references without regenerating artwork.
- Repository: https://github.com/thierryc/OpenPlotFont
  Website: https://thierryc.github.io/OpenPlotFont/. Custom domain remains deferred.

## Evidence

- Full app/workspace suite: **718 passed, 10 skipped**, 83 test files passed.
  Socket tests required execution outside the restricted sandbox; their rerun
  passed. The initial preview hash failure was resolved by regenerating assets.
- Reusable font package suite: **17 passed**.
- Production build, TypeScript checking and server build passed.
- All 101 font files retain their geometry, curves, stroke boundaries/order,
  metrics, advances, kerning, anchors, connection data and layout mappings,
  compared with the pre-migration files.
- OpenPlotFont's own semantic validator passed all 101 migrated font files,
  including embedded layout integrity and bindings.
- Embedded demo binaries use upstream renamed naming records. Byte comparisons
  confirm unchanged shaping tables; native CFF charstring programs and glyph
  order also match. Binary digests and authoring-source bindings were updated.
- Tests cover both extensions, both draft versions, layout/shaping, physical
  scaling, SVG/Canvas adapters, independent strokes, curves, fills/holes,
  ordered plot preparation, document embedding/export and explicit conversion.
- Migration CLI produces `.opf.json` by default and refuses a second write to
  the same destination.
- Asset scans cover public assets, built application files, the npm package
  and source archive, including decoded layout binaries and archive filenames.
  No obsolete identity or links remain in runtime/bundled data. Old literals
  occur only in the explicit converter and negative/migration tests.

## Compatibility limits

Pre-rename fonts and documents require explicit conversion; old browser records
are not silently restored as new fonts. Reimport converted files or documents.
Refresh installed caches to receive renamed assets. Custom fonts must be
embedded before converting a document; unresolved old custom IDs are rejected.

The existing layout limits remain: one horizontal script/direction per line,
no paragraph bidi segmentation, automatic wrapping, multi-font fallback,
variable OpenPlotFont geometry or deliberate pen-down joining. Tabs and missing
characters fail explicitly. Geometry-only layout does not position combining
marks from anchors. The native demo still lacks the exporter’s Latin cursive
feature; the portable fixture covers cursive positioning. Physical fill paths
require a selected fill mode and tool width. Hardware plotting was not tested.

See [integration and conversion instructions](OPENPLOTFONT_INTEGRATION.md).
