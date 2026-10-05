export type Tool = "select" | "draw";

export interface Point {
  x: number;
  y: number;
}

export interface ArtworkItem {
  id: string;
  name: string;
  markup: string;
  viewBox: [number, number, number, number];
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  stroke: string;
  fillSettings?: FillSettings;
  text?: { content: string; options?: TextOptions; format?: 'plotfont' };
}

export interface Paper {
  name: string;
  width: number;
  height: number;
}

export interface PlotSettings {
  profile: "axidraw" | "xylodraw";
  /** Physical size of the decorative AxiDraw setup; never changes travel limits. */
  axidrawModel?: 'v3-a4' | 'v3-a3';
  /** Rotation from canvas coordinates into the machine's mixed axes. */
  machineRotation?: 0 | 90 | 180 | 270;
  /** Distinguishes the former zero-degree default from an intentional override. */
  machineOrientationVersion?: 2;
  speed: number;
  travelSpeed: number;
  drawAcceleration: number;
  travelAcceleration: number;
  cornering: number;
  penUp: number;
  penDown: number;
  margin: number;
  reorderMode: "preserve" | "nearest" | "reversible";
  /** Legacy storage compatibility; execution always pauses for different pens. */
  pauseOnToolChange: boolean;
  maxPenDownMm: number;
  returnToOrigin: boolean;
}

export const DEFAULT_MACHINE_ROTATION = 90;
export const MACHINE_ORIENTATION_VERSION = 2;

export interface AppState {
  documentName: string;
  items: ArtworkItem[];
  selectedId: string | null;
  paper: Paper;
  paperColor: string;
  tool: Tool;
  zoom: number;
  settings: PlotSettings;
  pens?: PenPreferences;
}

/** Plot-only assignments. Source artwork colors are never rewritten. */
export interface PenPreferences {
  assignments: Record<string, { color: string; name: string }>;
  excluded: string[];
  order: string[];
  mode: "group" | "source";
}

const inches = (value: number): number => Math.round(value * 25.4 * 100) / 100;
const orientations = (name: string, width: number, height: number): Paper[] => [
  { name: `${name} portrait`, width: Math.min(width, height), height: Math.max(width, height) },
  { name: `${name} landscape`, width: Math.max(width, height), height: Math.min(width, height) }
];

// Matches the practical paper set offered by Saxi, expressed in millimetres.
export const PAPERS: Paper[] = [
  ...orientations("A4", 210, 297),
  ...orientations("A3", 297, 420),
  ...orientations("A5", 148, 210),
  ...orientations("A6", 105, 148),
  ...orientations("US Letter", inches(8.5), inches(11)),
  ...orientations("US Legal", inches(8.5), inches(14)),
  ...orientations("Arch A", inches(9), inches(12)),
  ...orientations("6 × 8 in", inches(6), inches(8)),
  ...orientations("5 × 7 in", inches(5), inches(7)),
  ...orientations("11 × 14 in", inches(11), inches(14)),
  { name: "380 × 380 mm", width: 380, height: 380 },
  { name: "400 × 400 mm", width: 400, height: 400 }
];

export const initialState: AppState = {
  documentName: 'Untitled plot',
  items: [],
  selectedId: null,
  paper: PAPERS[0]!,
  paperColor: "#ffffff",
  tool: "select",
  zoom: 1,
  settings: {
    profile: "axidraw",
    axidrawModel: 'v3-a4',
    machineRotation: DEFAULT_MACHINE_ROTATION,
    machineOrientationVersion: MACHINE_ORIENTATION_VERSION,
    speed: 35,
    travelSpeed: 80,
    drawAcceleration: 200,
    travelAcceleration: 400,
    cornering: 0.127,
    penUp: 50,
    penDown: 60,
    margin: 10,
    reorderMode: "reversible",
    pauseOnToolChange: true,
    maxPenDownMm: 0,
    returnToOrigin: true
  }
};

export function makeId(prefix = "item"): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function itemTransform(item: ArtworkItem): string {
  const [vx, vy, vw, vh] = item.viewBox;
  const sx = item.width / Math.max(vw, 0.0001);
  const sy = item.height / Math.max(vh, 0.0001);
  return [
    `translate(${item.x} ${item.y})`,
    `rotate(${item.rotation} ${item.width / 2} ${item.height / 2})`,
    `scale(${sx} ${sy})`,
    `translate(${-vx} ${-vy})`
  ].join(" ");
}

export interface TextOptions {
  fontId: string;
  /** Additional spacing in font em units; lineHeight is a cap-height multiplier. */
  letterSpacing: number;
  wordSpacing: number;
  lineHeight: number;
  align: "left" | "center" | "right";
  kerning: boolean;
  ligatures: boolean;
  contextual: boolean;
  features: string;
  variations: string;
  direction: "auto" | "ltr" | "rtl";
  language: string;
  script: string;
}

export interface FillSettings {
  mode: "none" | "solid" | "hatch" | "crosshatch";
  width: number;
  angle: number;
  overlap: number;
  gap: number;
  outline: boolean;
  connect: boolean;
}
export const defaultFillSettings: FillSettings = {
  mode: "none", width: 1, angle: 45, overlap: .15, gap: 1, outline: false, connect: true
};
