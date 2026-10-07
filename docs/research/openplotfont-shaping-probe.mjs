import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as hb from '../../node_modules/harfbuzzjs/dist/index.mjs';
if (process.argv.length !== 3) throw new Error('Usage: node openplotfont-shaping-probe.mjs OUTPUT_DIR');
const root = process.argv[2].replace(/\/$/, '') + '/';
function shape(name, text, features = []) {
  const bytes = fs.readFileSync(root + name + '.ttf');
  const face = new hb.Face(new hb.Blob(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
  const font = new hb.Font(face), buffer = new hb.Buffer();
  const manifest = JSON.parse(fs.readFileSync(root + name + '.json'));
  buffer.addText(text); buffer.guessSegmentProperties();
  hb.shape(font, buffer, features.map(s => hb.Feature.fromString(s)));
  return buffer.getGlyphInfos().map((g, i) => ({name: manifest.gidToName[g.codepoint], cluster: g.cluster, ...buffer.getGlyphPositions()[i]}));
}
for (const file of fs.readdirSync(root).filter(f => f.startsWith('Hershey') && f.endsWith('.json'))) {
  const name = file.slice(0, -5), {openplotfont} = JSON.parse(fs.readFileSync(root + file));
  const byUnicode = new Map(openplotfont.glyphs.flatMap(g => g.unicodes.map(u => [parseInt(u, 16), g])));
  const sample = 'Hello OpenPlotFont!';
  const result = shape(name, sample);
  assert.deepEqual(result.map(g => g.name), [...sample].map(c => byUnicode.get(c.codePointAt(0)).name));
  assert.equal(result.reduce((n, g) => n + g.xAdvance, 0), [...sample].reduce((n, c) => n + byUnicode.get(c.codePointAt(0)).advanceWidth, 0));
  console.log(name, 'mapping + advances PASS');
}
const kern = shape('SyntheticFeatures', 'AV');
assert.equal(kern.reduce((n,g)=>n+g.xAdvance,0),1250);
assert.equal(shape('SyntheticFeatures','AV',['kern=0']).reduce((n,g)=>n+g.xAdvance,0),1300);
assert.deepEqual(shape('SyntheticFeatures','fi').map(g=>g.name),['f_i']);
assert.deepEqual(shape('SyntheticFeatures','fi',['liga=0']).map(g=>g.name),['f','i']);
assert.deepEqual(shape('SyntheticFeatures','A',['ss01=1']).map(g=>g.name),['A.alt']);
const mark = shape('SyntheticFeatures','A\u0301');
assert.equal(mark[1].name,'acutecomb');
assert.equal(mark[1].xOffset,-475);
assert.equal(mark[1].yOffset,600);
assert.equal(mark[1].xAdvance,0);
console.log('Synthetic kern on/off, liga on/off, ss01, mark offsets PASS', JSON.stringify(mark));
