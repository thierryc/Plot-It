import type { ArtworkItem, TextOptions } from "./model";
import { makeId } from "./model";

type Stroke = number[];
type Glyph = Stroke[];

// An intentionally small, original single-line font. Coordinates are on a 1 × 1.4 grid.
const G: Record<string, Glyph> = {
  "A": [[0,1.4,.5,0,1,1.4],[.2,.85,.8,.85]], "B": [[0,1.4,0,0,.62,0,1,.3,.62,.7,0,.7],[.62,.7,1,.95,.62,1.4,0,1.4]],
  "C": [[1,.15,.75,0,.25,0,0,.25,0,1.15,.25,1.4,.75,1.4,1,1.25]], "D": [[0,1.4,0,0,.55,0,1,.35,1,1.05,.55,1.4,0,1.4]],
  "E": [[1,0,0,0,0,1.4,1,1.4],[0,.7,.75,.7]], "F": [[0,1.4,0,0,1,0],[0,.7,.75,.7]],
  "G": [[1,.2,.75,0,.25,0,0,.3,0,1.1,.25,1.4,.75,1.4,1,1.15,1,.82,.6,.82]], "H": [[0,0,0,1.4],[1,0,1,1.4],[0,.7,1,.7]],
  "I": [[0,0,1,0],[.5,0,.5,1.4],[0,1.4,1,1.4]], "J": [[.1,0,1,0,1,1.1,.75,1.4,.25,1.4,0,1.15]],
  "K": [[0,0,0,1.4],[1,0,0,.78,1,1.4]], "L": [[0,0,0,1.4,1,1.4]],
  "M": [[0,1.4,0,0,.5,.7,1,0,1,1.4]], "N": [[0,1.4,0,0,1,1.4,1,0]],
  "O": [[.25,0,.75,0,1,.25,1,1.15,.75,1.4,.25,1.4,0,1.15,0,.25,.25,0]], "P": [[0,1.4,0,0,.65,0,1,.3,1,.55,.65,.75,0,.75]],
  "Q": [[.25,0,.75,0,1,.25,1,1.15,.75,1.4,.25,1.4,0,1.15,0,.25,.25,0],[.6,1,1.1,1.5]], "R": [[0,1.4,0,0,.65,0,1,.3,1,.55,.65,.75,0,.75],[.55,.75,1,1.4]],
  "S": [[1,.18,.75,0,.25,0,0,.25,.1,.62,.9,.78,1,1.15,.75,1.4,.25,1.4,0,1.22]], "T": [[0,0,1,0],[.5,0,.5,1.4]],
  "U": [[0,0,0,1.1,.25,1.4,.75,1.4,1,1.1,1,0]], "V": [[0,0,.5,1.4,1,0]], "W": [[0,0,.2,1.4,.5,.75,.8,1.4,1,0]],
  "X": [[0,0,1,1.4],[1,0,0,1.4]], "Y": [[0,0,.5,.7,1,0],[.5,.7,.5,1.4]], "Z": [[0,0,1,0,0,1.4,1,1.4]],
  "0": [[.25,0,.75,0,1,.25,1,1.15,.75,1.4,.25,1.4,0,1.15,0,.25,.25,0],[.2,1.2,.8,.2]],
  "1": [[.2,.25,.5,0,.5,1.4],[.2,1.4,.8,1.4]], "2": [[0,.25,.25,0,.75,0,1,.25,1,.55,0,1.4,1,1.4]],
  "3": [[0,.15,.25,0,.75,0,1,.25,.65,.7,1,1.05,.75,1.4,.25,1.4,0,1.25]], "4": [[.8,1.4,.8,0,0,1,.98,1]],
  "5": [[1,0,0,0,0,.65,.75,.65,1,.9,1,1.15,.75,1.4,.25,1.4,0,1.2]], "6": [[.9,.15,.7,0,.3,0,0,.4,0,1.15,.25,1.4,.75,1.4,1,1.1,1,.85,.75,.65,0,.65]],
  "7": [[0,0,1,0,.25,1.4]], "8": [[.25,.7,0,.45,.1,.15,.35,0,.7,0,1,.25,.9,.55,.65,.7,.25,.7,0,.95,.1,1.25,.35,1.4,.7,1.4,1,1.15,.9,.85,.65,.7]],
  "9": [[1,.75,.25,.75,0,.5,0,.25,.25,0,.75,0,1,.25,1,1.1,.7,1.4,.25,1.4,.05,1.25]],
  "-": [[.15,.7,.85,.7]], "+": [[.15,.7,.85,.7],[.5,.35,.5,1.05]], ".": [[.48,1.35,.52,1.4]],
  ",": [[.55,1.3,.4,1.55]], "!": [[.5,0,.5,1],[.5,1.35,.5,1.4]], "?": [[0,.25,.25,0,.7,0,1,.25,1,.5,.5,.85,.5,1],[.5,1.35,.5,1.4]],
  "/": [[0,1.4,1,0]], "(": [[.7,0,.35,.35,.25,.7,.35,1.05,.7,1.4]], ")": [[.3,0,.65,.35,.75,.7,.65,1.05,.3,1.4]],
  ":": [[.5,.4,.5,.45],[.5,1.05,.5,1.1]], " ": []
};

export function textToItem(text: string, sizeMm: number, options?: TextOptions): ArtworkItem {
  if (!Number.isFinite(sizeMm) || sizeMm <= 0) throw new Error("Text size must be positive.");
  const lines = text.replace(/\r/g, "").split("\n");
  const advance = 1.25;
  const lineHeight = (options?.lineHeight ?? 1.25) * 1.4;
  const tracking = (options?.letterSpacing ?? 0) * 1.4;
  const wordSpacing = (options?.wordSpacing ?? 0) * 1.4;
  const widths = lines.map(line => Math.max(1, [...line].length * (advance + tracking) - advance - tracking + 1 + [...line].filter(c => c === " ").length * wordSpacing));
  const widest = Math.max(...widths);
  const commands: string[] = [];
  let minX = 0, minY = 0, maxX = widest, maxY = Math.max(1.4, (lines.length - 1) * lineHeight + 1.4);
  
  lines.forEach((line, row) => {
    let cursor = (widest - widths[row]!) * (options?.align === "right" ? 1 : options?.align === "center" ? .5 : 0);
    [...line].forEach((raw) => {
      const glyph = G[raw.toUpperCase()] ?? G["?"]!;
      glyph.forEach((stroke) => {
        const points: string[] = [];
        for (let i = 0; i < stroke.length; i += 2) {
          const x = (stroke[i] ?? 0) + cursor;
          const y = (stroke[i + 1] ?? 0) + row * lineHeight;
          if (options) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
          points.push(`${points.length ? "L" : "M"}${x.toFixed(3)},${y.toFixed(3)}`);
        }
        commands.push(points.join(" "));
      });
      cursor += advance + tracking + (raw === " " ? wordSpacing : 0);
    });
  });
  const localWidth = maxX - minX;
  const localHeight = maxY - minY;
  return {
    id: makeId("text"), name: text.trim().slice(0, 24) || "Plot text",
    markup: options ? commands.map(d => `<path d="${d}"/>`).join("") : `<path d="${commands.join(" ")}"/>`, viewBox: [minX, minY, localWidth, localHeight],
    x: 20, y: 20, width: localWidth * (sizeMm / 1.4), height: localHeight * (sizeMm / 1.4),
    rotation: 0, stroke: "#000000", text: options ? { content: text, options: { ...options } } : { content: text }
  };
}

/** Keep placement and independent X/Y scaling when changing the copy. */
export function editPlotText(item: ArtworkItem, content: string, capHeightMm?: number): void {
  if (!content.trim()) throw new Error("Enter some text.");
  const sx = item.width / item.viewBox[2];
  const sy = item.height / item.viewBox[3];
  const replacement = textToItem(content, capHeightMm ?? sy * 1.4);
  item.markup = replacement.markup;
  item.width = replacement.viewBox[2] * (capHeightMm === undefined ? sx : capHeightMm / 1.4);
  item.height = replacement.height;
  item.viewBox = replacement.viewBox;
  item.text = { content };
}

/** Only recover old text if its complete stored name exactly reproduces its paths. */
export function recoverPlotText(item: ArtworkItem): void {
  if (item.text || !item.id.startsWith("text-")) return;
  if (textToItem(item.name, 12).markup === item.markup) item.text = { content: item.name };
}

export function supportedCharacters(): string {
  return "A–Z, 0–9 and common punctuation";
}
