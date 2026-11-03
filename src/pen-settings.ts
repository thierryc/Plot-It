import {PEN_TIMING_MODEL} from '@thierryc/plotter-core';
import type {PlotSettings} from './model';
export const PEN_TIMING_DEFAULTS={penRateRaise:75,penRateLower:50,penDelayUpMs:150,penDelayDownMs:0,penReloadWaitMs:0};
/** Migrate raw saved settings before adding defaults, so a missing marker remains
 * distinguishable from an invalid value under the current model. */
export function penTimingSettings(settings:Partial<PlotSettings>={}) {
  if(settings.penTimingModel!==undefined&&settings.penTimingModel!==PEN_TIMING_MODEL)throw new Error('Unsupported pen timing model.');
  const legacy=settings.penTimingModel===undefined,result={...PEN_TIMING_DEFAULTS};
  for(const key of Object.keys(result) as Array<keyof typeof result>){
    const value=settings[key]??result[key],rate=key==='penRateRaise'||key==='penRateLower';
    const minimum=rate?1:legacy&&key!=='penReloadWaitMs'?-500:0;
    if(typeof value!=='number'||!Number.isInteger(value)||value<minimum||value>(rate?100:10000))throw new Error(`Invalid ${key}.`);
    result[key]=rate?value:Math.max(0,value);
  }
  return{...result,penTimingModel:PEN_TIMING_MODEL};
}
