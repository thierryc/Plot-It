import { progressReporter } from './task-progress';
import { buildMotionPlan } from './motion-plan';
import { preparePenPaths, defaultPens } from './pens';
import type { PlotSettings, PenPreferences } from './model';
import type { PlotPath } from './svg';
self.onmessage = (event: MessageEvent<{ paths: PlotPath[]; settings: PlotSettings; paper?: {width:number;height:number}; preferences?: PenPreferences }>) => {
  try {
    const report = progressReporter(progress => self.postMessage({progress}));
    report({label: 'Preparing pens and paths'});
    const {settings, paper, preferences} = event.data;
    const { paths, pens } = preparePenPaths(event.data.paths, settings, preferences ?? defaultPens(), paper);
    report({label: 'Estimating plot motion', fraction: 0});
    const plan = buildMotionPlan(paths, settings, fraction => report({label: 'Estimating plot motion', fraction}));
    if (!paths.length) { plan.events = []; plan.duration = 0; }
    plan.pens = pens;
    self.postMessage({ plan });
  }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Planning failed.' }); }
};
