import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";

// Frozen Regular-S fixtures: body contours, one subtraction mask, then the bolt.
// Compare Glyphs' baked geometry with independent SVG mask composition.
const originals = JSON.parse(await readFile("macos/Assets/Glyphs/regular-outlines.json", "utf8"));
const results = [];
await mkdir("output/icon-review", { recursive: true });
function pathData(path) {
  const start = path.nodes.findIndex(node => node.type !== "offcurve");
  assert(start >= 0);
  const nodes = [...path.nodes.slice(start), ...path.nodes.slice(0, start)];
  let data = `M${nodes[0].x},${nodes[0].y}`, controls = [];
  for (const node of [...nodes.slice(1), nodes[0]]) {
    if (node.type === "offcurve") { controls.push(node); continue; }
    if (node.type === "curve") {
      assert.equal(controls.length, 2);
      data += `C${controls.map(point => `${point.x},${point.y}`).join(" ")} ${node.x},${node.y}`;
    } else { assert.equal(controls.length, 0); data += `L${node.x},${node.y}`; }
    controls = [];
  }
  return data + "Z";
}
for (const glyph of originals) {
  const [x, y, width, height] = glyph.bounds, scale = 664 / Math.max(width, height);
  const transform = `translate(${512 - scale * (x + width / 2)} ${512 + scale * (y + height / 2)}) scale(${scale} ${-scale})`;
  const mask = glyph.paths.at(-2), body = glyph.paths.slice(0, -2), bolt = glyph.paths.at(-1);
  const reference = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
    <defs><mask id="cut" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
      <rect width="1024" height="1024" fill="white"/>
      <path fill="black" transform="${transform}" d="${pathData(mask)}"/>
    </mask></defs>
    <g mask="url(#cut)"><path fill="white" transform="${transform}" d="${body.map(pathData).join("")}"/></g>
    <path fill="white" transform="${transform}" d="${pathData(bolt)}"/>
  </svg>`;
  const svg = await readFile(`macos/Assets/Glyphs/${glyph.name}.svg`, "utf8");
  assert(!/<(?:mask|clipPath)\b/.test(svg), "Final artwork must contain resolved contours");
  const expected = new Resvg(reference).render(), actual = new Resvg(svg).render();
  const expectedPixels = expected.pixels, actualPixels = actual.pixels;
  let union = 0, intersection = 0, difference = 0;
  for (let offset = 3; offset < expectedPixels.length; offset += 4) {
    const a = expectedPixels[offset], b = actualPixels[offset];
    union += Math.max(a, b); intersection += Math.min(a, b); difference += Math.abs(a - b);
  }
  const overlap = intersection / union;
  assert(overlap > 0.998, `Mask geometry mismatch for ${glyph.name}: ${overlap}`);
  results.push({ glyph: glyph.name, alphaOverlap: overlap, averageAlphaDifference: difference / (1024 * 1024 * 255), sourceMasks: 1, method: "Original contour subtraction versus Glyphs-native baked contours" });
  await writeFile(`output/icon-review/${glyph.name}-verified.png`, actual.asPng());
}
await writeFile("output/icon-review/mask-verification.json", JSON.stringify(results, null, 2) + "\n");
console.info(JSON.stringify(results, null, 2));
