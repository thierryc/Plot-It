import type { ArtworkItem, Point } from "./model";

export const EDITABLE = "path,line,polyline,polygon,rect,circle,ellipse,text";
export const ELEMENT_NAME_ATTRIBUTE = 'data-plot-it-name';
export function elementName(element: Element): string {
  return element.getAttribute(ELEMENT_NAME_ATTRIBUTE)?.trim() || element.localName;
}
export const SHAPE_FIELDS: Record<string, string[]> = {
  rect: ["x", "y", "width", "height", "rx", "ry"], circle: ["cx", "cy", "r"],
  ellipse: ["cx", "cy", "rx", "ry"], line: ["x1", "y1", "x2", "y2"],
  text: ["x", "y", "font-size"]
};
export function elements(root: ParentNode): SVGGraphicsElement[] {
  return [...root.querySelectorAll<SVGGraphicsElement>(EDITABLE)]
    .filter((element) => !element.closest("defs,clipPath,mask,pattern,marker,symbol,[data-generated-fill]"));
}
export function markupRoot(markup: string): SVGSVGElement {
  return new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${markup}</svg>`, "image/svg+xml").documentElement as unknown as SVGSVGElement;
}
export function editElement(item: ArtworkItem, index: number, edit: (element: SVGGraphicsElement) => void): void {
  const root = markupRoot(item.markup);
  const element = elements(root)[index];
  if (!element) throw new Error("The selected element no longer exists.");
  edit(element);
  item.markup = root.innerHTML;
}

export interface PathCommand { type: "M" | "L" | "C" | "Q" | "A" | "Z"; values: number[] }
/** Normalize SVG path syntax without flattening curves or joining subpaths. */
export function* parsePathSteps(source: string): Generator<PathCommand> {
  let offset = 0, command = "", current: Point = { x: 0, y: 0 }, subpath = current;
  let cubic: Point | null = null, quadratic: Point | null = null;
  const result: PathCommand[] = [];
  const skip = () => { while (/[\s,]/.test(source[offset] ?? "") && offset < source.length) offset++; };
  const read = (flag = false): number => {
    skip();
    const token = source.slice(offset).match(flag ? /^[01]/ : /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
    if (!token) throw new Error("Invalid SVG path data.");
    offset += token[0].length;
    const value = Number(token[0]);
    if (!Number.isFinite(value)) throw new Error("Path coordinates must be finite.");
    return value;
  };
  while (true) {
    skip(); if (offset >= source.length) break;
    if (/[a-z]/i.test(source[offset]!)) command = source[offset++]!;
    else if (!command || command.toUpperCase() === "Z") throw new Error("Expected a path command.");
    const type = command.toUpperCase(), relative = command !== type;
    if (!result.length && type !== "M") throw new Error("A path must start with M.");
    const counts: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
    const count = counts[type];
    if (count === undefined) throw new Error(`Unsupported path command: ${command}`);
    const v = Array.from({ length: count }, (_, i) => read(type === "A" && (i === 3 || i === 4)));
    const pair = (i: number): number[] => [v[i]! + (relative ? current.x : 0), v[i + 1]! + (relative ? current.y : 0)];
    let next: PathCommand;
    if (type === "Z") next = { type: "Z", values: [] };
    else if (type === "H") next = { type: "L", values: [v[0]! + (relative ? current.x : 0), current.y] };
    else if (type === "V") next = { type: "L", values: [current.x, v[0]! + (relative ? current.y : 0)] };
    else if (type === "S") next = { type: "C", values: [cubic ? 2 * current.x - cubic.x : current.x, cubic ? 2 * current.y - cubic.y : current.y, ...pair(0), ...pair(2)] };
    else if (type === "T") next = { type: "Q", values: [quadratic ? 2 * current.x - quadratic.x : current.x, quadratic ? 2 * current.y - quadratic.y : current.y, ...pair(0)] };
    else if (type === "A") {
      if (v[0]! < 0 || v[1]! < 0) throw new Error("Arc radii cannot be negative.");
      next = { type: "A", values: [...v.slice(0, 5), ...pair(5)] };
    } else next = { type: type as PathCommand["type"], values: Array.from({ length: count / 2 }, (_, i) => pair(i * 2)).flat() };
    result.push(next);
    yield next;
    if (type === "Z") current = { ...subpath };
    else { const values = next.values; current = { x: values.at(-2)!, y: values.at(-1)! }; }
    if (type === "M") { subpath = { ...current }; command = relative ? "l" : "L"; }
    cubic = next.type === "C" ? { x: next.values[2]!, y: next.values[3]! } : null;
    quadratic = next.type === "Q" ? { x: next.values[0]!, y: next.values[1]! } : null;
  }
}
export function parsePath(source:string):PathCommand[] { return [...parsePathSteps(source)]; }
export function pathData(commands: PathCommand[]): string {
  return commands.map(({ type, values }) => `${type}${values.map((v) => Number(v.toFixed(6))).join(" ")}`).join(" ");
}
export function pathNodes(commands: PathCommand[]): { command: number; pair: number; point: Point; control: boolean }[] {
  return commands.flatMap((cmd, command) => {
    const pairs = cmd.type === "A" ? [5] : Array.from({ length: cmd.values.length / 2 }, (_, i) => i * 2);
    return pairs.map((pair) => ({ command, pair, point: { x: cmd.values[pair]!, y: cmd.values[pair + 1]! }, control: pair < cmd.values.length - 2 }));
  });
}
export function movePathNode(commands: PathCommand[], command: number, pair: number, point: Point): void {
  const cmd = commands[command]; if (!cmd) return;
  const dx = point.x - cmd.values[pair]!, dy = point.y - cmd.values[pair + 1]!;
  // Moving a cubic anchor also moves its adjoining handles, preserving the tangent.
  if (pair === cmd.values.length - 2) {
    if (cmd.type === "C") { cmd.values[2]! += dx; cmd.values[3]! += dy; }
    const next = commands[command + 1];
    if (next?.type === "C") { next.values[0]! += dx; next.values[1]! += dy; }
  }
  cmd.values[pair] = point.x; cmd.values[pair + 1] = point.y;
}

/** Constrain movement in page axes, measured from the gesture's starting point. */
export function constrainedDelta(delta: Point, constrain = false): Point {
  if (!constrain) return delta;
  return Math.abs(delta.x) >= Math.abs(delta.y) ? { x: delta.x, y: 0 } : { x: 0, y: delta.y };
}

export function resizedDimensions(origin: { width: number; height: number }, corner: string, delta: Point, proportional = false, centered = false): { width: number; height: number } {
  const dx = (corner.includes("w") ? -delta.x : delta.x) * (centered ? 2 : 1);
  const dy = (corner.includes("n") ? -delta.y : delta.y) * (centered ? 2 : 1);
  if (proportional && origin.width > 0 && origin.height > 0) {
    // Project the moving corner onto its original diagonal, keeping the anchor fixed.
    const scale = Math.max(.1 / origin.width, .1 / origin.height,
      1 + (origin.width * dx + origin.height * dy) / (origin.width ** 2 + origin.height ** 2));
    return { width: origin.width * scale, height: origin.height * scale };
  }
  return { width: Math.max(.1, origin.width + dx), height: Math.max(.1, origin.height + dy) };
}

export function resizedItem(origin: ArtworkItem, corner: string, delta: Point, proportional = false, centered = false): Pick<ArtworkItem, "x" | "y" | "width" | "height"> {
  const radians = origin.rotation * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
  const local = { x: c * delta.x + s * delta.y, y: -s * delta.x + c * delta.y };
  const west = corner.includes("w"), north = corner.includes("n");
  const { width, height } = resizedDimensions(origin, corner, local, proportional, centered);
  if (centered) return { width, height, x: origin.x + (origin.width - width) / 2, y: origin.y + (origin.height - height) / 2 };
  const cx = (west ? -(width - origin.width) : width - origin.width) / 2;
  const cy = (north ? -(height - origin.height) : height - origin.height) / 2;
  return { width, height, x: origin.x + origin.width / 2 + c * cx - s * cy - width / 2, y: origin.y + origin.height / 2 + s * cx + c * cy - height / 2 };
}
