import {compileLayerProgram,automaticPlacement,rectangle,prepareScene,resumeAtDistance,orderedLayerRuns,type Layer} from '@thierryc/plotter-core';
import {coreOptions} from './core-settings';
import type {SourceLayer} from './svg';
import { progressReporter } from './task-progress';
import { buildMotionPlan,motionPlanFromProgram } from './motion-plan';
import { preparePenPaths, defaultPens } from './pens';
import type { PlotSettings, PenPreferences } from './model';
import type { PlotPath } from './svg';
self.onmessage = (event: MessageEvent<{ paths: PlotPath[]; layers?:SourceLayer[];settings: PlotSettings; paper?: {width:number;height:number}; preferences?: PenPreferences }>) => {
  try {
    const report = progressReporter(progress => self.postMessage({progress}));
    report({label: 'Preparing pens and paths'});
    const {settings, paper, preferences} = event.data;
    let source=event.data.paths;const profile=coreOptions(settings).profile;const bounds=profile.bounds,swapped=profile.rotation===90||profile.rotation===270;
    if(settings.automaticPlacement&&paper)source=automaticPlacement(source,paper.width,paper.height,settings.margin).paths as PlotPath[];
    if(bounds)source=prepareScene([{id:'drawing',paths:source}],{machine:rectangle(swapped?bounds.height:bounds.width,swapped?bounds.width:bounds.height)}) as PlotPath[];
    const { paths, pens } = preparePenPaths(source, settings, preferences ?? defaultPens(), paper);
    report({label: 'Estimating plot motion', fraction: 0});
    let plan;
    if(event.data.layers?.length){
      let layers:Layer[]=event.data.layers.map(layer=>{
        const override=settings.layerOverrides?.[layer.id]??{},control={...layer.controls,...override},optimization=control.optimization;
        const layerSettings={...settings,...(optimization===4?{reorderMode:'preserve' as const,pathJoinToleranceMm:0,pathSimplifyToleranceMm:0,closedPathStart:'preserve' as const}:optimization===1?{reorderMode:'nearest' as const}:optimization===2||optimization===3?{reorderMode:'reversible' as const}:optimization===0?{reorderMode:'preserve' as const}:{} )};
        const prepared=preparePenPaths(source.filter(path=>path.layerId===layer.id),layerSettings,preferences??defaultPens(),paper);
        return{id:layer.id,sourceOrder:layer.sourceOrder,included:override.included,name:control.label||layer.name,paths:prepared.paths,hidden:layer.hidden,documentation:control.documentation,delayMs:control.delayMs,pause:control.pause,speedPercent:control.speedPercent,controls:control,overrides:control.penDown===undefined?{}:{penDown:control.penDown}};
      });
      const other=preparePenPaths(source.filter(path=>!path.layerId),settings,preferences??defaultPens(),paper).paths;
      if(other.length)layers.push({id:'default',name:'Drawing',paths:other,sourceOrder:0});
      const mapped=new Map(layers.map(l=>[l.sourceLayerId??l.id,l]));const ordered=orderedLayerRuns(source,layers);layers=ordered.map(run=>{const base=mapped.get(run.sourceLayerId??run.id)!,optimization=base.controls?.optimization;const local={...settings,...(optimization===4?{strictOrder:true}:optimization===1?{reorderMode:'nearest' as const}:optimization===2||optimization===3?{reorderMode:'reversible' as const}:optimization===0?{reorderMode:'preserve' as const}:{} )};return{...run,paths:preparePenPaths(run.paths as PlotPath[],local,preferences??defaultPens(),paper).paths,...(base.included===false?{included:false}:{})};});
      const program=compileLayerProgram(layers,coreOptions(settings));plan=motionPlanFromProgram(program,settings,layers.flatMap(layer=>layer.paths),layers);
    }else plan=buildMotionPlan(paths, settings, fraction => report({label: 'Estimating plot motion', fraction}));
    if (!paths.length&&!event.data.layers?.length) { plan.events = []; plan.duration = 0; }
    if(settings.startAtMm&&plan.executable)plan=motionPlanFromProgram(resumeAtDistance(plan.executable,settings.startAtMm),settings,plan.sourcePaths,plan.layers);
    plan.pens = pens;
    self.postMessage({ plan });
  }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Planning failed.' }); }
};
