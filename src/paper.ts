import { PAPERS, type Paper } from "./model";

export const MIN_CANVAS_MM = 0.1;
export const MAX_CANVAS_MM = 10000;

export function paperPresetIndex(paper: Pick<Paper, "width" | "height">): number {
  return PAPERS.findIndex((preset) => preset.width === paper.width && preset.height === paper.height);
}

export function canvasPaper(width: number, height: number): Paper {
  if (![width, height].every((dimension) => Number.isFinite(dimension) && dimension >= MIN_CANVAS_MM && dimension <= MAX_CANVAS_MM)) {
    throw new Error(`Canvas dimensions must be between ${MIN_CANVAS_MM} and ${MAX_CANVAS_MM} mm.`);
  }
  const index = paperPresetIndex({ width, height });
  return index >= 0 ? { ...PAPERS[index]! } : { name: "Custom", width, height };
}

/** Preserve saved custom dimensions as well as known paper presets. */
export function restorePaper(value: unknown): Paper {
  if (value && typeof value === "object" && "width" in value && "height" in value
    && typeof value.width === "number" && typeof value.height === "number") {
    try { return canvasPaper(value.width, value.height); } catch { /* Fall back for invalid saved dimensions. */ }
  }
  return { ...PAPERS[0]! };
}
