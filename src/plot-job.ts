import {visiblePlotGeometry} from './plot-geometry';
import {coreOptions} from './core-settings';
import type { TaskProgress } from './task-progress';
import { WorkSlice } from './cooperative';
import { awaitFills, fillPlotPaths } from './fill-dom';
import { flattenPlotPathsAsync,readSourceLayers } from './svg';
import type { Paper, PlotSettings, PenPreferences } from './model';
import { canonicalColor, restorePens } from './pens';
import type { MotionPlan } from './motion-plan';
export function prepareJob(svg: SVGSVGElement, paper: Paper, settings: PlotSettings, onProgress?: (progress: TaskProgress) => void, preferences?: PenPreferences): { promise: Promise<MotionPlan>; cancel: () => void } {
  const snapshot=structuredClone(settings);
  const paperSnapshot=structuredClone(paper), penSnapshot=restorePens(structuredClone(preferences));
  let worker: Worker | undefined;
  let settled = false;
  let rejectJob: (reason: Error) => void = () => {};
  const promise = new Promise<MotionPlan>((resolve, reject) => {
    const cleanup = () => {
      if (!worker) return;
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
      worker.terminate();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true; cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    rejectJob = fail;
    void awaitFills(svg).then(async () => {
      if (settled) return;
      onProgress?.({label: 'Reading plot paths'});
      const work=new WorkSlice(()=>settled); await work.yield();
      let paths=await flattenPlotPathsAsync(svg,work,fillPlotPaths(svg),coreOptions(snapshot).curveToleranceMm??.05); work.check();
      if(snapshot.hiddenLineRemoval||svg.querySelector('[clip-path]'))paths=visiblePlotGeometry(svg,paths,coreOptions(snapshot).curveToleranceMm??.05,!!snapshot.hiddenLineRemoval);
      for (const path of paths) path.tool=canonicalColor(path.tool);
      worker=new Worker(new URL('./planner.worker.ts',import.meta.url),{type:'module'});
      worker.onmessage = event => {
        if (settled) return;
        try {
          const data = event.data;
          if (data?.progress && typeof data.progress.label === 'string') { onProgress?.(data.progress); return; }
          if (typeof data?.error === 'string' && data.error) { fail(new Error(data.error)); return; }
          const plan = data?.plan;
          if (!plan || !Array.isArray(plan.events) || !Array.isArray(plan.passes) || !Array.isArray(plan.pens)
            || !Number.isFinite(plan.duration) || plan.duration < 0 || !plan.settings) {
            fail(new Error('Motion planning returned an invalid response. Choose Prepare again to retry.')); return;
          }
          settled = true; cleanup(); resolve(plan);
        } catch (error) { fail(error); }
      };
      worker.onerror = event => {
        event.preventDefault();
        const detail = event.message?.trim();
        fail(new Error(`Motion planning failed${detail ? `: ${detail}` : '. The planning worker could not load or stopped unexpectedly.'} Choose Prepare again to retry.`));
      };
      worker.onmessageerror = () => fail(new Error('Motion planning could not read the worker response. Choose Prepare again to retry.'));
      worker.postMessage({paths,layers:readSourceLayers(svg),settings:snapshot,paper:paperSnapshot,preferences:penSnapshot});
    }).catch(fail);
  });
  return {promise,cancel:()=>rejectJob(new Error('Planning cancelled.'))};
}
