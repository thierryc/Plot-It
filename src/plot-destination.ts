import type { PlotterCore } from './plotter-core';
/** Shared public capabilities; transport internals never escape the executor. */
export type PlotDestination = Pick<PlotterCore, keyof PlotterCore>;
