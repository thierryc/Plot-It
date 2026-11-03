import type {PlotterJobTrace} from './plotter-core';

/** Serialization runs off the UI thread and is only requested while execution is idle. */
export function machineLogBlob(input: Record<string, unknown> & {job: PlotterJobTrace | null}): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./machine-log.worker.ts', import.meta.url), {type: 'module'});
    worker.onmessage = event => { worker.terminate(); if(event.data.error) reject(new Error(event.data.error)); else resolve(event.data.blob); };
    worker.onerror = event => {worker.terminate(); reject(new Error(event.message));};
    worker.postMessage(input);
  });
}
