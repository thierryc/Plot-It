import {validateNativePreview} from './native-preview';
import type {ExecutablePlan} from '@thierryc/plotter-core';
import type {MotionPlan} from './motion-plan';
/** Executable snapshots are versioned; editable geometry must be prepared anew. */
export function executionFromEditor(input:MotionPlan):{plan:ExecutablePlan;eventIds:number[]} {
  if(!input.executable)throw new Error('Legacy event-only plans must be prepared again from source geometry.');
  validateNativePreview(input);
  return{plan:structuredClone(input.executable),eventIds:input.events.map((_,i)=>i)};
}
