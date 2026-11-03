import {validatePlan,digest,type ExecutablePlan} from '@thierryc/plotter-core';
import {coreOptions} from './core-settings';
import type {MotionPlan} from './motion-plan';
/** Reject a stale display snapshot; execution never recompiles an admitted program. */
export function validateNativePreview(input:MotionPlan):ExecutablePlan {
 const plan=input.executable!;validatePlan(plan);if(digest(coreOptions(input.settings))!==digest(plan.options)||input.events.length!==plan.records.length)throw new Error('Preview settings differ from the executable program. Prepare again.');
 let options=plan.options;
 for(const [i,r]of plan.records.entries()){if(r.settings)options=r.settings;const e=input.events[i]!;if(r.kind==='pen'&&Math.abs(e.duration*1000-r.durationMs)>1e-7)throw new Error('Preview pen settling time differs from the executable program.');const kind=r.kind==='motor'||r.kind==='delay'?'xy':r.kind==='pause'?'tool':r.kind;
  if(e.kind!==kind||e.penDown!==r.penDown||e.tool!==r.tool||Math.abs(e.start*1000-r.startMs)>1e-7||Math.abs(e.duration*1000-r.durationMs)>1e-7||Math.hypot(e.from.x-r.from.x,e.from.y-r.from.y)>1e-9||Math.hypot(e.to.x-r.to.x,e.to.y-r.to.y)>1e-9||e.penHeight!==(r.penDown?options.pen.down:options.pen.up)||e.label!==r.label||r.kind==='motor'&&e.stopBefore!==r.restBefore)throw new Error('Preview events differ from the executable program.');
 }
 return plan;
}
