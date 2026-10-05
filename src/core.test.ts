import { describe, expect, it, vi } from "vitest";
import { clipPlotPaths, optimizePaths, optimizePlotPaths, splitPlotPaths, splitPathByLength } from "./svg";
import { textToItem } from "./plot-font";
import { profileStepsPerMm, quantizeAbsoluteMove } from "./motion";

vi.stubGlobal("crypto", { randomUUID: () => "test-id" });

describe("optimizePaths", () => {
  it("orders paths from the origin and reverses the nearer endpoint", () => {
    const paths = [
      [{ x: 20, y: 0 }, { x: 10, y: 0 }],
      [{ x: 2, y: 0 }, { x: 4, y: 0 }]
    ];
    expect(optimizePaths(paths)).toEqual([
      [{ x: 2, y: 0 }, { x: 4, y: 0 }],
      [{ x: 10, y: 0 }, { x: 20, y: 0 }]
    ]);
  });

  it("does not mutate its input", () => {
    const paths = [[{ x: 3, y: 0 }, { x: 1, y: 0 }]];
    optimizePaths(paths);
    expect(paths[0]?.[0]?.x).toBe(3);
  });
});

describe("Plot Sans", () => {
  it("creates pen-ready path geometry at the requested cap height", () => {
    const item = textToItem("AB", 14);
    expect(item.markup).toContain("<path d=");
    expect(item.height).toBe(14);
    expect(item.width).toBeGreaterThan(14);
    expect(item.name).toBe("AB");
  });

  it("supports multiline copy and gracefully substitutes unknown glyphs", () => {
    const item = textToItem("A\n♥", 10);
    expect(item.viewBox[3]).toBeGreaterThan(1.4);
    expect(item.markup.length).toBeGreaterThan(20);
  });
});

describe("plot preparation", () => {
  it("retains physical stroke widths through ordering, clipping, and line breaks", () => {
    const source = [
      { points: [{x:20,y:5},{x:10,y:5}], tool:"black", width:.5 },
      { points: [{x:2,y:3},{x:4,y:3}], tool:"black", width:1.2 }
    ];
    const ordered = optimizePlotPaths(source, true);
    expect(ordered.map(path=>path.width)).toEqual([1.2,.5]);
    const clipped = clipPlotPaths(ordered,{minX:0,minY:0,maxX:15,maxY:10});
    const split = splitPlotPaths(clipped,2);
    expect(split.map(path=>path.width)).toEqual([1.2,.5,.5,.5]);
  });

  it("adds exact artificial pen lifts at the configured distance", () => {
    const segments = splitPathByLength([{ x: 0, y: 0 }, { x: 25, y: 0 }], 10);
    expect(segments).toHaveLength(3);
    expect(segments.map((segment) => segment.at(-1)?.x)).toEqual([10, 20, 25]);
    expect(segments[1]?.[0]?.x).toBe(10);
  });

  it("clips drawing motion to the paper's safe bounds", () => {
    const result = clipPlotPaths([
      { tool: "black", points: [{ x: -5, y: 5 }, { x: 15, y: 5 }] }
    ], { minX: 0, minY: 0, maxX: 10, maxY: 10 });
    expect(result[0]?.points).toEqual([{ x: 0, y: 5 }, { x: 10, y: 5 }]);
  });
});

describe("EBB motion quantization", () => {
  it("uses the calibrated eighth-step resolution for each machine", () => {
    expect(profileStepsPerMm("axidraw")).toBe(40);
    expect(profileStepsPerMm("xylodraw")).toBe(50);
  });

  it("targets absolute step positions so rounding cannot accumulate", () => {
    const steps = { x: 0, y: 0 };
    const first = quantizeAbsoluteMove({ x: 0, y: 0 }, { x: 0.014, y: 0 }, steps, 10, 40);
    Object.assign(steps, first.targetSteps);
    const second = quantizeAbsoluteMove({ x: 0.014, y: 0 }, { x: 1, y: 0 }, steps, 10, 40);
    expect(second.targetSteps).toEqual({x:0,y:40});
    expect(first.deltaSteps.y + second.deltaSteps.y).toBe(40);
    const home = quantizeAbsoluteMove({ x: 1, y: 0 }, { x: 0, y: 0 }, second.targetSteps, 10, 40);
    expect(home.deltaSteps.y).toBe(-40);
    expect(home.targetSteps).toEqual({ x: 0, y: 0 });
  });
});
