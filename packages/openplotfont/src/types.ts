export type { OpenPlotFontData, PlotGlyph, PlotContour, PlotOperation, PlotCommand } from './reader.js';
import type { OpenPlotFontData } from './reader.js';

export interface Point { x: number; y: number }
export interface PathCommand { type: 'M' | 'L' | 'Q' | 'C' | 'Z'; values: number[] }
export interface Contour { closed: boolean; commands: PathCommand[] }
export type GeometryOperation =
  | { kind: 'stroke'; contour: Contour }
  | { kind: 'fill'; fillRule: 'evenodd' | 'nonzero'; contours: Contour[] };

/** Prepared by createOpenPlotFont or loadOpenPlotFont; shaping internals are private. */
export interface OpenPlotFont {
  readonly data: Readonly<OpenPlotFontData>;
  readonly features: readonly string[];
  readonly hasOpenTypeLayout: boolean;
}
export interface LayoutOptions {
  /** Cap height in caller-chosen units, default 1. No implicit DPI conversion. */
  capHeight?: number;
  /** Additional spacing in em units. */
  letterSpacing?: number;
  wordSpacing?: number;
  /** Baseline distance as a cap-height multiplier; defaults to font metrics. */
  lineHeight?: number;
  align?: 'left' | 'center' | 'right';
  kerning?: boolean;
  ligatures?: boolean;
  contextual?: boolean;
  /** OpenType feature syntax, e.g. "ss01=1, liga[0:3]=0". */
  features?: string;
  direction?: 'auto' | 'ltr' | 'rtl';
  language?: string;
  script?: string;
}
export interface TextGeometry {
  operations: GeometryOperation[];
  /** Conservative bounds including metrics, advances, and curve controls. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  viewBox: [number, number, number, number];
  lineAdvances: number[];
  capHeight: number;
}
export type SVGPath =
  | { kind: 'stroke'; d: string }
  | { kind: 'fill'; d: string; fillRule: 'evenodd' | 'nonzero' };
export interface SVGOptions {
  color?: string;
  /** In geometry output units, default 2% of cap height. */
  strokeWidth?: number;
  width?: number;
  height?: number;
  /** Dimension suffix; does not convert geometry or infer a DPI. */
  unit?: 'px' | 'mm' | 'cm' | 'in';
}
