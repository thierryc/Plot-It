import { describe, expect, it } from "vitest";
import { constrainedDelta, movePathNode, parsePath, pathData, pathNodes, resizedItem } from "./editor";
import { editPlotText, recoverPlotText, textToItem } from "./plot-font";
import { serializeDocument } from "./svg";

describe("editable path geometry", () => {
  it("normalizes relative, implicit, horizontal and vertical commands", () => {
    expect(parsePath("m10 20 5 5 h10 v-5 z m2 3 l4 5")).toEqual([
      { type: "M", values: [10, 20] }, { type: "L", values: [15, 25] },
      { type: "L", values: [25, 25] }, { type: "L", values: [25, 20] },
      { type: "Z", values: [] }, { type: "M", values: [12, 23] }, { type: "L", values: [16, 28] }
    ]);
  });
  it("preserves cubic and quadratic curves, including reflected handles", () => {
    const commands = parsePath("M0 0 C1 2 3 4 5 6 s2 3 4 5 Q20 21 22 23 t2 3");
    expect(commands[2]).toEqual({ type: "C", values: [7, 8, 7, 9, 9, 11] });
    expect(commands[4]).toEqual({ type: "Q", values: [24, 25, 24, 26] });
    expect(parsePath(pathData(commands))).toEqual(commands);
  });
  it("supports compact arc flags and exponent notation without flattening arcs", () => {
    const commands = parsePath("M1e1-.5 a5 6 30 0110-20");
    expect(commands[1]).toEqual({ type: "A", values: [5, 6, 30, 0, 1, 20, -20.5] });
    expect(pathNodes(commands).map((node) => node.pair)).toEqual([0, 5]);
  });
  it("rejects malformed commands, incomplete pairs and invalid flags", () => {
    for (const data of ["L0 0", "M0", "M0 0 X1 2", "M0 0 A1 2 0 2 0 3 4", "M0 0 LInfinity 1", "M0 0 Z1 2"]) {
      expect(() => parsePath(data)).toThrow();
    }
  });
  it("moves an anchor and adjoining cubic handles, but not other anchors", () => {
    const commands = parsePath("M0 0 C1 2 3 4 5 6 C7 8 9 10 11 12");
    movePathNode(commands, 1, 4, { x: 15, y: 26 });
    expect(commands[1]?.values).toEqual([1, 2, 13, 24, 15, 26]);
    expect(commands[2]?.values).toEqual([17, 28, 9, 10, 11, 12]);
    movePathNode(commands, 1, 0, { x: -1, y: -2 });
    expect(commands[1]?.values).toEqual([-1, -2, 13, 24, 15, 26]);
  });
});

describe("editable plot text", () => {
  it("exports edited geometry and page dimensions without any editor markup", () => {
    const item = textToItem("A", 12);
    editPlotText(item, "New text");
    const exported = serializeDocument([item], 210, 297);
    expect(exported).toContain('width="210mm" height="297mm"');
    expect(exported).toContain(item.markup);
    expect(exported).not.toMatch(/selection-ui|editor-hit-layer|data-path-node|data-element-index/);
  });
  it("retains complete original copy and independent scale when revising text", () => {
    const item = textToItem("Very long text\nwith lowercase", 12);
    expect(item.text?.content).toBe("Very long text\nwith lowercase");
    Object.assign(item, { x: 35, y: 42, rotation: 27, stroke: "#ff0000", width: item.width * 2 });
    const id = item.id;
    editPlotText(item, "New\ncopy");
    expect(item.text?.content).toBe("New\ncopy");
    expect(item.width / item.viewBox[2]).toBeCloseTo(24 / 1.4);
    expect(item.height / item.viewBox[3]).toBeCloseTo(12 / 1.4);
    expect([item.id, item.x, item.y, item.rotation, item.stroke]).toEqual([id, 35, 42, 27, "#ff0000"]);
    editPlotText(item, "A", 8);
    expect(item.height).toBe(8);
  });
  it("recovers legacy copy only when the saved name fully matches the geometry", () => {
    const item = textToItem("HELLO", 12); delete item.text;
    recoverPlotText(item); expect(item.text).toEqual({ content: "HELLO" });
    const long = textToItem("A LONG SENTENCE THAT WAS TRUNCATED", 12); delete long.text;
    recoverPlotText(long); expect(long.text).toBeUndefined();
  });
});

describe("corner resizing", () => {
  it('preserves proportions and the opposite corner for every handle and rotation', () => {
    const origin = textToItem('A', 14); Object.assign(origin, { x: 20, y: 30, width: 40, height: 20 });
    const anchor = (item: typeof origin, corner: string) => {
      const x = (corner.includes('w') ? 1 : -1) * item.width / 2;
      const y = (corner.includes('n') ? 1 : -1) * item.height / 2;
      const angle = item.rotation * Math.PI / 180;
      return { x: item.x + item.width / 2 + x * Math.cos(angle) - y * Math.sin(angle),
        y: item.y + item.height / 2 + x * Math.sin(angle) + y * Math.cos(angle) };
    };
    for (const rotation of [0, 37, 90]) for (const corner of ['nw', 'ne', 'sw', 'se']) {
      origin.rotation = rotation;
      const result = { ...origin, ...resizedItem(origin, corner, { x: 13, y: -8 }, true) };
      expect(result.width / result.height).toBeCloseTo(2);
      expect(anchor(result, corner).x).toBeCloseTo(anchor(origin, corner).x);
      expect(anchor(result, corner).y).toBeCloseTo(anchor(origin, corner).y);
    }
    const clamped = resizedItem(origin, 'se', { x: -10000, y: -10000 }, true);
    expect(clamped.width).toBeGreaterThanOrEqual(.1); expect(clamped.height).toBeGreaterThanOrEqual(.1);
    expect(clamped.width / clamped.height).toBeCloseTo(2);
  });
  it('constrains movement in page axes in either direction, leaving free movement available', () => {
    expect(constrainedDelta({ x: -10, y: 4 }, true)).toEqual({ x: -10, y: 0 });
    expect(constrainedDelta({ x: 4, y: -10 }, true)).toEqual({ x: 0, y: -10 });
    expect(constrainedDelta({ x: 4, y: -10 })).toEqual({ x: 4, y: -10 });
  });
  it("keeps the opposite corner fixed for all four handles", () => {
    const origin = textToItem("A", 14); Object.assign(origin, { x: 20, y: 30, width: 40, height: 20 });
    expect(resizedItem(origin, "nw", { x: -5, y: -8 })).toEqual({ x: 15, y: 22, width: 45, height: 28 });
    expect(resizedItem(origin, "ne", { x: 5, y: -8 })).toEqual({ x: 20, y: 22, width: 45, height: 28 });
    expect(resizedItem(origin, "sw", { x: -5, y: 8 })).toEqual({ x: 15, y: 30, width: 45, height: 28 });
    expect(resizedItem(origin, "se", { x: 5, y: 8 })).toEqual({ x: 20, y: 30, width: 45, height: 28 });
  });
  it("resizes in rotated local axes and clamps at a positive size", () => {
    const origin = textToItem("A", 14); Object.assign(origin, { x: 20, y: 30, width: 40, height: 20, rotation: 90 });
    const resized = resizedItem(origin, "nw", { x: 8, y: -5 });
    expect(resized.width).toBeCloseTo(45); expect(resized.height).toBeCloseTo(28);
    expect(resized.x).toBeCloseTo(21.5); expect(resized.y).toBeCloseTo(23.5);
    expect(resizedItem(origin, "se", { x: 100, y: -100 }).width).toBe(.1);
  });
});
