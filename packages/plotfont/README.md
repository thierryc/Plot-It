# @thierryc/plotfont

Load PlotFont **0.3** and convert single- or multiline text into ordered vector
geometry, SVG paths, or Canvas `Path2D` objects. TypeScript types are included.
The library is MIT licensed and independent of Plot-it's editor and hardware.

```sh
npm install @thierryc/plotfont
```

ES modules only. Supports Node.js 22+ and modern browsers with Web Crypto.
Font files are supplied by your app; this package contains no font assets.

## Load a font and create SVG

```js
import { loadPlotFont, layoutText, toSVG, toSVGPaths } from '@thierryc/plotfont';

const response = await fetch('/fonts/my-font.plotfont.json');
if (!response.ok) throw new Error(`Font download failed: ${response.status}`);
const font = await loadPlotFont(await response.arrayBuffer());
const geometry = layoutText(font, 'Hello\nPlotFont', {
  capHeight: 12, // 12 output units: mm when the SVG unit below is mm
  letterSpacing: 0.02, // additional spacing in em units
  align: 'left',
});
const svg = toSVG(geometry, { unit: 'mm', strokeWidth: 0.3, color: '#111111' });
// svg is a standalone SVG string. Insert it or save it as an .svg file.
// For your existing SVG document, use the ordered path records instead:
const paths = toSVGPaths(geometry);
```

A stroke record has `{ kind: 'stroke', d }`; a fill record has
`{ kind: 'fill', d, fillRule }`. Set `fill="none"` on strokes, and `stroke="none"`
on fills. Use the supplied fill rule. Keep record order and independent moves.
Do not merge compound fills with separate strokes into a single painted path.

For Node.js, supply file contents using your own filesystem code:

```js
import { readFile, writeFile } from 'node:fs/promises';
import { loadPlotFont, layoutText, toSVG } from '@thierryc/plotfont';

const font = await loadPlotFont(await readFile('my-font.plotfont.json'));
const geometry = layoutText(font, 'Hello', { capHeight: 48 });
await writeFile('hello.svg', toSVG(geometry));
```

## Canvas

```js
import { loadPlotFont, layoutText } from '@thierryc/plotfont';
import { toCanvasPaths } from '@thierryc/plotfont/canvas';

const font = await loadPlotFont(await (await fetch('/fonts/my-font.plotfont.json')).text());
const geometry = layoutText(font, 'Hello\nCanvas', { capHeight: 48 }); // pixels
const ctx = document.querySelector('canvas').getContext('2d');
ctx.save();
ctx.translate(16 - geometry.viewBox[0], 16 - geometry.viewBox[1]);
ctx.strokeStyle = ctx.fillStyle = '#111111';
ctx.lineWidth = 1;
ctx.lineCap = ctx.lineJoin = 'round';
for (const operation of toCanvasPaths(geometry)) {
  if (operation.kind === 'stroke') ctx.stroke(operation.path);
  else ctx.fill(operation.path, operation.fillRule);
}
ctx.restore();
```

Importing the main library or Canvas adapter does not access DOM globals.
Calling `toCanvasPaths` requires a browser/runtime providing `Path2D`.

## API and units

- `parsePlotFont(json: string)` validates JSON, geometry and metadata synchronously.
  Embedded binary integrity is verified by `loadPlotFont`, not by this parser.
- `createPlotFont(data)` revalidates and snapshots a geometry-only font
  synchronously. Fonts with embedded OpenType layout must use `loadPlotFont`.
- `loadPlotFont(string | ArrayBuffer | Uint8Array)` prepares a validated font.
  Geometry-only fonts do not initialize WASM. Embedded layout lazily loads
  HarfBuzz.js after validating its digest, mappings, metrics and feature manifest.
- `layoutText(font, text, options?)` returns `TextGeometry` synchronously from
  a prepared font. The result has `operations`, `bounds`, `viewBox`,
  `lineAdvances`, and `capHeight`. Stroke operations contain one `contour`;
  fill operations contain `contours` and `fillRule`.
- `toSVGPaths(geometry)` returns path records, rounded to six decimal places.
  Structured geometry keeps full numeric precision.
- `toSVG(geometry, options?)` creates standalone SVG. Options are `color`,
  `strokeWidth`, `width`, `height`, and `unit` (`px`, `mm`, `cm`, `in`). Stroke
  width defaults to 2% of cap height; the viewport includes stroke padding.
- `flattenContour(commands, tolerance = 0.005)` returns points in caller units.
  Apply output scaling first, then select the required tolerance. Plot-it uses
  a tolerance of 0.005 mm after transformation to physical page coordinates.

Coordinates use downward Y; the first baseline is at zero. `capHeight` defaults
to 1 in caller-chosen units. No DPI or unit conversion is inferred. Bounds include
font metrics, advances, and curve control points, so they are conservative.
The geometry viewBox is independent of appearance; `toSVG` adds stroke padding.

Layout options include `letterSpacing` and `wordSpacing` (additional em units),
`lineHeight` (baseline distance as a cap-height multiplier), `align`, `kerning`,
`ligatures`, `contextual`, `features`, `direction`, `language`, and `script`.
Line height defaults to `(ascender - descender + lineGap) / capHeight` from the
font metrics. Kerning, standard ligatures, and contextual forms default to on.
Feature syntax follows HarfBuzz, e.g. `ss01=1, liga[0:3]=0`. Available feature tags
are exposed as `font.features`; `font.hasOpenTypeLayout` reports shaping support.
`font.data` is a frozen snapshot and must not be changed.

## Drawing intent and supported scope

Original curves, closure, stroke starts, direction and operation order are
preserved. Independent strokes are never joined. Compound fills keep their
holes and winding rules. Canvas/SVG can paint these fills; generating physical
hatching or cutter/plotter toolpaths is the consuming application's job.

Geometry-only fonts support simple Latin layout, explicitly mapped private-use
symbols, advances and stored pair kerning. Private-use mappings do not imply
Unicode coverage for a script. Embedded static OpenType fonts additionally support their declared
substitutions and positioning, including marks and cursive offsets. Cursive
positioning does not authorize connecting separate pen strokes. Nonzero tracking
suppresses optional ligatures unless explicitly enabled in `features`.

Only PlotFont 0.3 is supported. No variable font axes, font fallback, automatic
line wrapping, mixed-script/bidirectional segmentation, or machine control is
included. Use one script and direction per text block. Missing characters,
unavailable features, malformed fonts, non-scalar text, tabs, non-finite spacing,
and excessive input fail explicitly. Text must contain drawable geometry.

Limits include 32 MiB JSON/byte input, 64 JSON nesting levels, 100,000 input text
code units, one million font/text drawing commands, 8 MiB embedded layout, and
100,000 points per flattened contour. UTF-8 decoding is strict. JSON duplicate
keys and unsupported versions are rejected.

## Bundler setup and local development

HarfBuzz.js ships its own WASM asset. Keep its import-relative WASM location
intact. Vite applications should use this existing integration setting:

```js
export default {
  optimizeDeps: { exclude: ['harfbuzzjs'] },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('vite/preload-helper')) return 'preload-helper';
        },
      },
    },
  },
};
```

The separate preload-helper chunk prevents a production import cycle when
a browser entry uses top-level `await loadPlotFont(...)`. HarfBuzz remains
lazy, and the helper itself does not initialize WASM. Merge this rule into
any existing `manualChunks` function. This setup is tested with Vite 7.

In the Plot-it workspace:

```sh
npm install
npm run build:lib
npm test
npm run build
npm run dev
# In a second terminal while editing library code:
npm run dev:lib
```

Plot-it imports the package's public API via the npm workspace link. The font
library owns validation, layout and geometry; the app owns font persistence,
font assets, editor metadata, physical fill planning and device control.

## Release

```sh
npm run test --workspace=@thierryc/plotfont
npm pack --workspace=@thierryc/plotfont --dry-run
npm pack --workspace=@thierryc/plotfont --pack-destination=/tmp
# Test that tarball in a separate Node and browser application, then:
npm publish /tmp/thierryc-plotfont-0.1.0.tgz --access public
```

The package includes compiled ESM, declarations, source maps and their original
TypeScript sources, README, MIT license and notices. Test fixtures and Plot-it's
bundled fonts are excluded. Font data retains its own license and attribution.

Format specification: https://github.com/thierryc/PlotFont/blob/main/docs/PLOTFONT_FORMAT.md
