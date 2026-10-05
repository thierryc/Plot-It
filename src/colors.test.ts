import { describe, expect, it, vi } from "vitest";
import { parseHexColor, restorePaperColor } from "./colors";
import { initialState } from "./model";
import { canvasPaper } from "./paper";
import { textToItem } from "./plot-font";
import { freehandItem, serializeDocument } from "./svg";

vi.stubGlobal("crypto", { randomUUID: () => "test-id" });

describe("independent document colors", () => {
  it('accepts manual RGB hex values without applying invalid input', () => {
    expect(parseHexColor('  #aBc  ')).toBe('#AABBCC');
    expect(parseHexColor('aaBBcc')).toBe('#AABBCC');
    for (const invalid of ['#12', '#12345G', '#12345678', '', 'red', '#FFFFFF;']) {
      expect(() => parseHexColor(invalid)).toThrow('Enter a hex color');
    }
  });
  it("migrates missing and invalid paper colors to white", () => {
    for (const invalid of [undefined, null, "red", "#fff", "#ffffff;", 42]) expect(restorePaperColor(invalid)).toBe("#ffffff");
    expect(restorePaperColor("#AAbBcC")).toBe("#aabbcc");
    expect(initialState.paperColor).toBe("#ffffff");
  });

  it("keeps paper color separate from dimensions and round trips it", () => {
    const state = structuredClone(initialState);
    state.paperColor = "#aabbcc";
    state.paper = canvasPaper(180.5, 120.25);
    const restored = JSON.parse(JSON.stringify(state));
    expect(restorePaperColor(restored.paperColor)).toBe("#aabbcc");
    expect(restored.paper.width).toBe(180.5);
  });

  it("defaults only new text and freehand paths to black", () => {
    expect(textToItem("TEST", 12).stroke).toBe("#000000");
    expect(freehandItem([{ x: 0, y: 0 }, { x: 10, y: 10 }]).stroke).toBe("#000000");
  });

  it("exports only artwork regardless of paper preview color", () => {
    const state = structuredClone(initialState);
    const item = textToItem("TEST", 12); item.stroke = "#aa4400";
    item.markup += '<path stroke="#1122cc" d="M0 0L10 10"/>';
    state.items = [item];
    const before = serializeDocument(state.items, state.paper.width, state.paper.height);
    state.paperColor = "#aabbcc";
    expect(serializeDocument(state.items, state.paper.width, state.paper.height)).toBe(before);
    expect(before).toContain('stroke="#aa4400"');
    expect(before).toContain('stroke="#1122cc"');
    expect(before).not.toContain("#aabbcc");
  });
});
