import { describe, expect, it } from "vitest";
import { PAPERS } from "./model";
import { canvasPaper, paperPresetIndex, restorePaper } from "./paper";
import { serializeDocument } from "./svg";

describe("canvas dimensions", () => {
  it("identifies preset sizes and their orientations without changing presets", () => {
    expect(canvasPaper(210, 148)).toEqual({ name: "A5 landscape", width: 210, height: 148 });
    expect(canvasPaper(148, 210).name).toBe("A5 portrait");
    const paper = canvasPaper(210, 297);
    paper.width = 250;
    expect(PAPERS[0]?.width).toBe(210);
  });
  it("supports custom sizes with decimal millimetre precision", () => {
    const custom = canvasPaper(123.456, 234.567);
    expect(custom).toEqual({ name: "Custom", width: 123.456, height: 234.567 });
    expect(paperPresetIndex(custom)).toBe(-1);
    expect(restorePaper(JSON.parse(JSON.stringify(custom)))).toEqual(custom);
  });
  it("rejects zero, negative, nonfinite and impractically large dimensions", () => {
    for (const invalid of [0, -1, .01, NaN, Infinity, 10001]) {
      expect(() => canvasPaper(invalid, 210)).toThrow();
      expect(() => canvasPaper(210, invalid)).toThrow();
    }
  });
  it("falls back safely for invalid saved dimensions", () => {
    for (const invalid of [undefined, null, {}, { width: "210", height: 297 }, { name: "A4 portrait", width: 0, height: 297 }]) {
      expect(restorePaper(invalid)).toEqual(PAPERS[0]);
    }
    expect(restorePaper({ name: "Custom", width: 210, height: 297 })).toEqual(PAPERS[0]);
  });
  it("uses custom physical dimensions in SVG export", () => {
    const paper = canvasPaper(160.5, 100.25);
    const svg = serializeDocument([], paper.width, paper.height);
    expect(svg).toContain('width="160.5mm" height="100.25mm"');
    expect(svg).toContain('viewBox="0 0 160.5 100.25"');
  });
});
