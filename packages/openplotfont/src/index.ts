export { parseOpenPlotFont } from './reader.js';
export { createOpenPlotFont, loadOpenPlotFont } from './loader.js';
export { layoutText } from './layout.js';
export { toSVGPaths, toSVG } from './svg.js';
export { flattenContour } from './curves.js';
export type * from './types.js';

export type { OpenPlotFontReadOptions } from './reader.js';

export { validateFeatureRanges, sliceFeatureRanges, setFeatureRange, remapFeatureRanges } from './features.js';
