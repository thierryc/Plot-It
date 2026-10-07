# Third-party notices

Plot-it is distributed under AGPL-3.0-only; see LICENSE.

## Plotting protocol references

The current trajectory planner and timed EBB command compiler are original
TypeScript implementations. No Saxi module is included in the current source or
runtime. The earlier Saxi-based version and its notices are retained in a local
workspace archive, excluded from distribution.

Protocol behavior is specified by the public EBB command documentation:
https://evil-mad.github.io/EggBot/ebb2.html
Pen configuration, separate raise/lower rates, timing estimates, host pacing,
short-move policies, step/rate correction, and path optimization behavior
were checked against Evil Mad Scientist's AxiDraw Python driver, revision
`a0df054f41f8e3ae8d408e08e7b2656968e375f1`, and Plotink revision
`4976b86080c25a10a9f979b870669dc62a1741fa`. Those reference implementations
remain under their own licenses; they are not vendored in this application.
https://github.com/evil-mad/axidraw
https://github.com/evil-mad/plotink

Plot-it's existing AGPL-3.0-only application license is unchanged. The SVG editor
remains the project's own implementation; fill geometry uses Clipper-lib below.

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

Lucide: ISC license; https://github.com/lucide-icons/lucide.
HarfBuzz.js / HarfBuzz: MIT license; https://github.com/harfbuzz/harfbuzzjs.
Font test fixtures retain their OFL licenses in src/test-fonts.
Dependency packages retain their upstream license notices.

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
AGPL or OpenPlotFont's MIT license. Preserve the full upstream acknowledgements
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
Plot-it remains AGPL-3.0-only; no Saxi planner or Clipper code is included in
the standalone package. Font assets remain in the app under the terms above.

## Complete font-menu library

`public/fonts/library` bundles the 87-source OpenPlotFont stroke library. The JSON
retains each source revision, SHA-256, attribution, full available license notices,
and conversion metadata. Accompanying files retain complete upstream notices,
ancestor licenses, and original font sources. Font-menu attribution links point to
these local files. Hershey terms, SIL OFL, Apache ancestry, CC0, and LibreCAD GPL
v2-or-later notices remain distinct from the application's AGPL license.

Inter Regular and Italic are the original variable TTF files from
https://github.com/google/fonts/tree/main/ofl/inter, copyright The Inter Project
Authors, designed by Rasmus Andersson, under SIL OFL 1.1. Full notices accompany
each file. Square Bot Sans is the original three-axis TTF from AP.CX's 2.009
release, https://ap.cx/fonts/squarebot/, copyright The Square Bot Sans Project
Authors, derived from Hubot Sans. Its complete OFL and release README accompany
the font. Font names, geometry, and layout are preserved.

The menu manifest `src/fonts/catalog.json` pins every bundled asset by SHA-256.
`scripts/bundle-font-library.py` recreates the bundle from these reviewed sources.

## Plotter Core reference adaptations

The independent TypeScript motion planner/compiler does not import Saxi or Python.
The discrete EBB math in `packages/plotter-core/src/ebb-math.ts` is adapted from
Plotink `ebb_calc.py` under MIT; the complete notice is in
`packages/plotter-core/reference/PLOTINK-LICENSE`. The NextDraw homing procedure
is adapted from NextDraw 1.7.4 `homing.py`, also MIT; its complete notice is in
`packages/plotter-core/reference/NEXTDRAW-NOTICE`. Pinned revisions, archive and
wheel hashes are recorded alongside those notices. The virtual ISR implementation
and TypeScript motion/geometry services are independently authored.
