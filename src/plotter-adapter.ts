import {validateNativePreview} from './native-preview';
import { fromNative, type ExecutablePlan, type MotorRecord, type NativePoint } from '@thierryc/plotter-core';
import {coreOptions} from './core-settings';
import type { MotionPlan } from './motion-plan';
import { compilePlotProcess } from './plot-process';
export function executionFromEditor(input:MotionPlan):{plan:ExecutablePlan;eventIds:number[]} {
  if(input.executable){
    validateNativePreview(input);
    return{plan:structuredClone(input.executable),eventIds:input.events.map((_,i)=>i)};
  }
  const process=compilePlotProcess(input),records:ExecutablePlan['records'][number][]=[],eventIds:number[]=[];
  const options=coreOptions(process.plan.settings);let current:NativePoint={m1:0,m2:0},time=0,drawingMm=0,travelMm=0;
  for(const step of process.steps){const e=step.event;
    if(e.kind==='xy')for(const [i,move]of step.moves.entries()){
      const target={m1:move.targetSteps.x+move.targetSteps.y,m2:move.targetSteps.x-move.targetSteps.y};
      const from=fromNative(current,options.profile),to=fromNative(target,options.profile);
      const r:MotorRecord={id:records.length,kind:'motor',startMs:time,durationMs:move.durationMs,from,to,fromSteps:{...current},toSteps:target,tool:e.tool,penDown:e.penDown,restBefore:i===0&&(!!e.stopBefore||e.initialSpeed<1e-9),width:e.width};
      records.push(r);eventIds.push(step.index);time+=r.durationMs;current={...target};const d=Math.hypot(to.x-from.x,to.y-from.y);if(e.penDown)drawingMm+=d;else travelMm+=d;
    }else{records.push({id:records.length,kind:e.kind,startMs:time,durationMs:Math.round(e.duration*1000),from:{...e.from},to:{...e.to},tool:e.tool,penDown:e.penDown});eventIds.push(step.index);time+=Math.round(e.duration*1000);}
  }
  return{plan:{version:1,backend:'sm',options,records,durationMs:time,drawingMm,travelMm},eventIds};
}
