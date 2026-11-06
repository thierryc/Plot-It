import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';
const originals = JSON.parse(await readFile('macos/Assets/Glyphs/regular-outlines.json', 'utf8'));
const exported = JSON.parse(await readFile('macos/Assets/Glyphs/connection-outlines.json', 'utf8'));
function pathData(path) {
  const start = path.nodes.findIndex(n => n.type !== 'offcurve');
  const nodes = [...path.nodes.slice(start), ...path.nodes.slice(0, start)];
  let data = `M${nodes[0].x},${nodes[0].y}`, controls = [];
  for (const node of [...nodes.slice(1), nodes[0]]) {
    if (node.type === 'offcurve') { controls.push(node); continue; }
    if (node.type === 'curve') { assert.equal(controls.length, 2); data += `C${controls.map(p => `${p.x},${p.y}`).join(' ')} ${node.x},${node.y}`; }
    else { assert.equal(controls.length, 0); data += `L${node.x},${node.y}`; }
    controls = [];
  }
  return data + 'Z';
}
const scale = 16 / 728.180738709688;
const transform = `translate(${12 - (78.25 + 913.3117626757302 / 2) * scale} ${17 + 6.8192612903120775 * scale}) scale(${scale} ${-scale})`;
await mkdir('output/connection-icons', { recursive: true });
const report = [];
for (const glyph of exported) {
  const original = originals.find(item => item.name === glyph.sourceGlyph);
  const body = original.paths.slice(0, -2).map(pathData).join('');
  const mask = pathData(original.paths.at(-2)), bolt = pathData(original.paths.at(-1));
  const off = glyph.role === 'disconnected';
  assert.equal(glyph.boltRemoved, off); assert.equal(glyph.maskRemoved, off);
  const reference = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="18"><defs><mask id="cut" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="18"><rect width="24" height="18" fill="white"/><path fill="black" transform="${transform}" d="${mask}"/></mask></defs><g ${off ? '' : 'mask="url(#cut)"'}><path transform="${transform}" d="${body}"/></g>${off ? '' : `<path transform="${transform}" d="${bolt}"/>`}</svg>`;
  const name = { disconnected: 'PlotItDisconnected', connected: 'PlotItConnected', plotting: 'PlotItPlotting' }[glyph.role];
  const svg = await readFile(`macos/Assets/Glyphs/${name}.svg`, 'utf8');
  assert(!/<(?:mask|clipPath)\b/.test(svg));
  const render = source => new Resvg(source, { fitTo: { mode: 'width', value: 960 } }).render();
  const expected = render(reference), actual = render(svg);
  const expectedPixels = expected.pixels, actualPixels = actual.pixels;
  let intersection = 0, union = 0;
  for (let i = 3; i < actualPixels.length; i += 4) { intersection += Math.min(expectedPixels[i], actualPixels[i]); union += Math.max(expectedPixels[i], actualPixels[i]); }
  const overlap = intersection / union;
  assert(overlap > 0.998, `${glyph.role} mask geometry differs: ${overlap}`);
  report.push({ role: glyph.role, alphaOverlap: overlap, boltRemoved: off, maskRemoved: off });
  await writeFile(`output/connection-icons/${name}.png`, actual.asPng());
}
assert.equal(exported.length, 3);
await writeFile('output/connection-icons/verification.json', JSON.stringify(report, null, 2) + '\n');
console.info(JSON.stringify(report));
