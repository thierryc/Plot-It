# Third-party notices

Plot-it is distributed under Apache-2.0; see LICENSE.

## Plotting protocol references

The constant-acceleration planner and shared SM/T3 junction calculation adapt
selected mathematical routines from Michael Fogleman's MIT-licensed axi planner
(2017), revision `a5a12f01633076232be84a4e3321c80c7b9656b5`. The complete notice
is in [AXI-LICENSE](packages/plotter-core/reference/AXI-LICENSE) and ships in browser/site
assets as [public/licenses/axi.txt](public/licenses/axi.txt). The retained
S-curve phase integrator and native command compiler are Plot-it implementations;
their discrete Plotink math is separately attributed below. The retained implementations and mathematical sources are identified below.

The pen timing model uses electrical pulse/refresh constraints from the public
[EBB 2.x command documentation](https://evil-mad.github.io/EggBot/ebb2.html) and
[EBB 3.x command documentation](https://evil-mad.github.io/EggBot/ebb.html), with
explicit provisional engineering settling/startup allowances. Calibration and commanded electrical rates are recorded separately. The [motion and pen provenance record](packages/plotter-core/reference/MOTION-PROVENANCE.md)
identifies the permitted inputs, adaptations, protocol facts, units, limitations
and test origins. It does not claim physical quality has been verified.

The original application and core use Apache-2.0. The SVG editor is the project's own implementation; fill geometry uses Clipper-lib below.

The app's Source link downloads the corresponding source and build instructions.
`npm run dev` and `npm run build` regenerate this archive from the current checkout.
Deploy the archive alongside the app when distributing a build.

## Other dependencies

The network service uses `ws` and Node SerialPort, including its native bindings,
under their MIT licenses. Their license notices ship in installed dependencies.
esbuild is used for the server build under MIT. NVM is installed separately under
MIT; the installer references the upstream release rather than vendoring it.

Clipper-lib 6.4.2: Boost Software License 1.0; https://github.com/junmer/clipper-lib.
Used for SVG winding-rule union, inward offsets, and contained hatch connections.
The [preserved source attributions](public/licenses/clipper.txt) identify Angus
Johnson, the JavaScript translation by Timo, and embedded Tom Wu JSBN code.
The complete [Boost grant](public/licenses/boost-1.0.txt) is included. The [JSBN permission notice](public/licenses/jsbn.txt) is preserved from the JSBN repository linked below. The installed Clipper copyright headers remain intact; the original Stanford endpoint was unavailable.
https://github.com/andyperlitch/jsbn/blob/HEAD/LICENSE

Lucide 1.49.0: ISC, with MIT-licensed Feather ancestry. The complete installed
[Lucide/Feather notice](public/licenses/lucide.txt) is included, covering the
imported icons and the extracted feedback SVGs in `src/ui/design-system/icons`.
https://github.com/lucide-icons/lucide.

HarfBuzz.js 1.6.2: [complete installed MIT notice](public/licenses/harfbuzzjs.txt).
Its upstream `v1.6.2` source pins HarfBuzz revision
`863d3f7787c6df18d20e4535c5906bf3eb803bd5`; that revision's complete
[HarfBuzz Old MIT notice](public/licenses/harfbuzz.txt) is included separately.
The source pin is verified; the npm WASM binary's complete build/toolchain
constituents remain a release follow-up, not a claim established by these notices.
https://github.com/harfbuzz/harfbuzzjs.
Font test fixtures retain their OFL licenses in src/test-fonts.
Dependency packages retain their upstream license notices. The
[distribution notes](docs/LICENSING.md)
records notice sources, remaining evidence work, and artifact checks. Files under
`public/licenses` are build inputs; verify their exact contents in each final
browser/site distribution and corresponding-source archive.

The public site's AP.CX marquee uses `@ap.cx/gl-marquee` 0.1.0 under MIT,
copyright (c) 2026 Thierry C. Its full notice is distributed in
[public/licenses/apcx-gl-marquee.txt](public/licenses/apcx-gl-marquee.txt).
The marquee reuses the bundled Square Bot Sans font with its existing OFL notice.

## Bundled OpenPlotFont fonts

`src/fonts/hershey-*.opf.json` contains Roman Simplex, Roman Duplex,
Roman Triplex, and Script Simplex. The assets are copied unchanged from the
OpenPlotFont repository's current native geometry-only 0.3 exports. They derive
from kamalmostafa/hershey-fonts revision
`1356bf2f83d380fcef68c887e88675eb9d445d86`, files `hershey-fonts/rowmans.jhf`,
`rowmand.jhf`, `rowmant.jhf` and `scripts.jhf` respectively.

The Hershey Fonts were originally created by Dr. A. V. Hershey while working
at the U. S. National Bureau of Standards. The format of the Font data in this
distribution was originally created by James Hurt, Cognition, Inc.,
900 Technology Park Drive, Billerica, MA 01821 (mit-eddie!ci-dandelion!hurt).

The font data has separate Hershey terms; it is not licensed under the app's
Apache-2.0 or OpenPlotFont's MIT license. Preserve the full upstream acknowledgements
and restrictions in [public/fonts/HERSHEY_NOTICE.txt](public/fonts/HERSHEY_NOTICE.txt).

`src/fonts/openplotfont-layout-demo.opf.json` is the original OpenPlotFont Layout
Demo native export, copyright (c) 2026 Thierry Charbonnel, licensed under MIT.
Its complete license is in [public/fonts/OPENPLOTFONT_LICENSE.txt](public/fonts/OPENPLOTFONT_LICENSE.txt).
Both notices are distributed alongside the production app and source archive.

`src/fonts/pf-ems-spacerocks.opf.json` is copied unchanged from the
OpenPlotFont 0.3 converted font library. EMS SpaceRocks was created and converted
to SVG by Trammell Hudson, derived from the Atari Asteroids font designed by
Ed Logg. Its source is `fonts/EMS/EMSSpaceRocks.svg` in
https://gitlab.com/oskay/svg-fonts at revision
`8c71f2d9e1a5292047bb88e5595a766241b82cc6`.
The font retains its upstream SIL Open Font License 1.1 declaration.
Complete attribution, license, and original SVG source are included in
[public/fonts/ems-spacerocks](public/fonts/ems-spacerocks) and distributed
with the app and source archive. The supplied OFL template retains its
unfilled copyright fields unchanged; author credits remain in the attribution
and font metadata.

## Local OpenPlotFont library

`packages/openplotfont` is extracted OpenPlotFont validation, layout, and geometry code
licensed separately under MIT, copyright (c) 2026 Thierry Charbonnel.
See [its license](packages/openplotfont/LICENSE) and [dependency notices](packages/openplotfont/THIRD_PARTY_NOTICES.md).
Plot-it remains Apache-2.0; no plotting planner or Clipper code is included in
the standalone package. Font assets remain in the app under the terms above.

## Complete font-menu library

`public/fonts/library` bundles 85 reviewed OpenPlotFont stroke-library entries. The JSON
retains each source revision, SHA-256, attribution, full available license notices,
and conversion metadata. Accompanying files retain complete upstream notices,
ancestor licenses, and original font sources. Font-menu attribution links point to
these local files. Hershey terms, SIL OFL, Apache ancestry, CC0, and retained
generator credits remain distinct from the application's Apache-2.0 license.

The GPL-v2-or-later `pf-cad-iso3098` and `pf-cad-iso3098-i` fonts are excluded
from the application catalog, public assets, specimens, and release archives.
Users may import separately obtained font files under their own terms; see
[optional font packs](docs/OPTIONAL_FONTS.md). Separate hosting does not change
a font's license or create an exception for embedding/exporting glyph geometry.

Inter Regular and Italic are the original variable TTF files from
https://github.com/google/fonts/tree/main/ofl/inter, copyright The Inter Project
Authors, designed by Rasmus Andersson, under SIL OFL 1.1. Full notices accompany
each file. Square Bot Sans is the original three-axis TTF from AP.CX's 2.009
release, https://ap.cx/fonts/squarebot/, copyright The Square Bot Sans Project
Authors, derived from Hubot Sans. Its complete OFL and release README accompany
the font. Font names, geometry, and layout are preserved.

The menu manifest `src/fonts/catalog.json` pins every bundled asset by SHA-256.
`scripts/bundle-font-library.py` recreates the bundle from these reviewed sources,
subject to `scripts/font-bundle-policy.json`. New license labels require review;
the excluded optional GPL fonts are not copied from the upstream library.

## Plotter Core reference adaptations

The axi planner adaptation is identified above; no Python runtime is imported.
The discrete EBB math in `packages/plotter-core/src/ebb-math.ts` is adapted from
Plotink `ebb_calc.py` under MIT; the complete notice is in
[`packages/plotter-core/reference/PLOTINK-LICENSE`](packages/plotter-core/reference/PLOTINK-LICENSE),
which preserves the adapted file's 2025 notice and the repository's 2026 notice.
The same complete record is in [public/licenses/plotink.txt](public/licenses/plotink.txt).
The NextDraw homing procedure
is adapted from NextDraw 1.7.4 `homing.py`, also MIT; its complete notice is in
[`packages/plotter-core/reference/NEXTDRAW-NOTICE`](packages/plotter-core/reference/NEXTDRAW-NOTICE),
also copied to [public/licenses/nextdraw-homing.txt](public/licenses/nextdraw-homing.txt).
Pinned revisions, archive and
wheel hashes are recorded alongside those notices. The virtual ISR implementation
and retained TypeScript motion/geometry services have the source boundaries
recorded in the motion provenance document; no blanket clean-room assertion is made.

## PlotIt MCP companion dependencies

The optional native companion adds the MCP TypeScript SDK (MIT), smol-toml (MIT), and resvg-js (MPL-2.0). jsdom is also bundled as the companion's headless SVG parser. Their dependency LICENSE/NOTICE files remain in the packaged runtime. The bundled Node.js license is included as `NODE-LICENSE`. The native Swift UI and companion integration code use the parent project's Apache-2.0 license.

resvg-js source (bundled version 2.6.2) is available at https://github.com/yisibl/resvg-js. MCP SDK source is available at https://github.com/modelcontextprotocol/typescript-sdk and smol-toml at https://github.com/squirrelchat/smol-toml. No license of an existing app component or bundled font is changed by adding this companion.
