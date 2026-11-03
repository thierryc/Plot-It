# Bundled and optional fonts

The default catalog contains 85 OpenPlotFont stroke faces and three outline fonts. Plot Sans and the Layout Demo are also available. Each font retains its own license and attribution; application licensing does not replace font terms.

## Import a font

Use **Text → Load a font** for `.opf`/`.opf.json`, `.ttf` or `.otf` files. Imported fonts appear under **Your fonts** and stay in that browser's storage. Saved documents can embed font data and SVG exports can contain glyph geometry; check the font's terms before sharing either.

Optional packs should include the original font/source files, exact revisions, attribution and complete licenses. Plot-it loads individual font files, not an executable plugin or a remote catalog. Imported faces have content-based IDs; select the imported face on a text object to regenerate its text. Saved path geometry remains available without the font.

The GPL-v2-or-later `pf-cad-iso3098` and `pf-cad-iso3098-i` faces are excluded from the app bundle. They may be obtained separately under their own terms. Separate hosting does not change the license or create an embedding exception.

## Bundle policy

`scripts/font-bundle-policy.json` lists permitted license labels and excluded IDs. The bundler rejects unknown labels; `scripts/check-bundled-fonts.mjs` checks the catalog, preview metadata and asset paths before source packaging. Preview generation prunes unused specimens.

Keep optional/private fonts outside `public/`, `src/` and package directories. Local private fonts and output are ignored and excluded from source archives. For complete credits and distribution evidence, see [third-party notices](../THIRD_PARTY_NOTICES.md) and [Licensing](LICENSING.md).
