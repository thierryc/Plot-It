import { checked, PlotterError, type ExecutablePlan, type MachineProfile, type PenSettings } from './types.js';
import {PEN_TIMING_MODEL} from './version.js';
/** Separate operator dwell policy retained for interactive/manual actions. */
export const MANUAL_PEN_MINIMUM_MS=120;
export const defaultPen:PenSettings={timingModel:PEN_TIMING_MODEL,up:50,down:60,raiseRate:75,lowerRate:50,upDelayMs:150,downDelayMs:0,reloadWaitMs:0,servoTimeoutMs:60000};
export function validatePen(pen:PenSettings):void {
  if(pen.timingModel!==PEN_TIMING_MODEL)throw new PlotterError('invalid-plan','Unsupported pen timing model; migrate settings and prepare again.');
  if(pen.servoTimeoutMs!==undefined&&(!Number.isInteger(pen.servoTimeoutMs)||pen.servoTimeoutMs<0||pen.servoTimeoutMs>65535))throw new Error('Invalid servo timeout.');
  if(pen.synchronizedB3!==undefined&&typeof pen.synchronizedB3!=='boolean')throw new Error('Invalid synchronized tool output.');
  checked(pen.up,0,100,'pen up');checked(pen.down,0,100,'pen down');
  checked(pen.raiseRate,1,100,'raise rate');checked(pen.lowerRate,1,100,'lower rate');
  checked(pen.upDelayMs,0,10000,'up wait');checked(pen.downDelayMs,0,10000,'down wait');checked(pen.reloadWaitMs,0,10000,'reload wait');
  for(const value of [pen.raiseRate,pen.lowerRate,pen.upDelayMs,pen.downDelayMs,pen.reloadWaitMs])if(!Number.isInteger(value))throw new Error('Invalid pen timing integer.');
}
export function validateServoProfile(profile:MachineProfile):void {
  if(![1,2].includes(profile.servoPin)||![1,8].includes(profile.servoChannels)||!Number.isInteger(profile.servoPeriod)||profile.servoPeriod<1||profile.servoPeriod>6)throw new PlotterError('invalid-plan','Invalid servo channel timing.');
  const maximum=Math.min(65535,profile.servoPeriod*12000);
  for(const pulse of [profile.servoMin,profile.servoMax])if(!Number.isInteger(pulse)||pulse<1||pulse>maximum)throw new PlotterError('invalid-plan','Servo calibration exceeds the unclipped pulse domain.');
  if(Math.abs(profile.servoMax-profile.servoMin)>32767)throw new PlotterError('invalid-plan','Servo calibration exceeds the supported signed pulse delta.');
  checked(profile.servoRateScale,0,327.67,'servo rate scale');
  for(const value of [profile.servoSettleUpMs,profile.servoSettleDownMs,profile.servoStartupMs])if(!Number.isInteger(value)||value<0||value>10000)throw new PlotterError('invalid-plan','Invalid servo settling allowance.');
}
export function servoPulse(percent:number,profile:MachineProfile):number {
  validateServoProfile(profile);
  return Math.round(profile.servoMin+(profile.servoMax-profile.servoMin)*checked(percent,0,100,'pen height')/100);
}
export function servoRate(rate:number,profile:MachineProfile):number {
  validateServoProfile(profile);checked(rate,1,100,'pen rate');
  return Math.round(profile.servoRateScale*rate);
}
/** Only changes affecting pulse knowledge are included; rate/dwell edits do not
 * change the last completed electrical position. */
export function servoIdentity(profile:MachineProfile):string {
  return [profile.id,profile.servoPin,profile.servoMin,profile.servoMax,profile.servoChannels,profile.servoPeriod,profile.servoKind??'standard'].join(':');
}
export function servoCommands(pen:PenSettings,profile:MachineProfile,temporaryDown=pen.down):string[] {
  validatePen(pen);validateServoProfile(profile);
  return [`SC,4,${servoPulse(pen.up,profile)}`,`SC,5,${servoPulse(temporaryDown,profile)}`,
    `SC,11,${servoRate(pen.raiseRate,profile)}`,`SC,12,${servoRate(pen.lowerRate,profile)}`,
    `SC,8,${profile.servoChannels}`,`SC,9,${profile.servoPeriod}`];
}
export interface PenTransition {
  model:typeof PEN_TIMING_MODEL;fromPulse:number|null;targetPulse:number;rate:number;
  initialize:boolean;refreshMs:number;refreshSteps:number;electricalMs:number;
  settlingMs:number;startupMs:number;reloadMs:number;durationMs:number;
}
/** Protocol-derived electrical bound, with separately identified engineering
 * allowances. Unknown state requires explicit initialization before trusting the target.
 * SC rates are pulse units per refresh, not a total transition duration. */
export function planPenTransition(fromPulse:number|null,target:number,up:boolean,pen:PenSettings,profile:MachineProfile,reload=false,minimumMs=0):PenTransition {
  validatePen(pen);validateServoProfile(profile);checked(minimumMs,0,65535,'pen settling time');
  const targetPulse=servoPulse(target,profile),rate=servoRate(up?pen.raiseRate:pen.lowerRate,profile),refreshMs=profile.servoChannels*profile.servoPeriod,initialize=fromPulse===null;
  if(fromPulse!==null&&(!Number.isInteger(fromPulse)||fromPulse<1||fromPulse>Math.min(65535,profile.servoPeriod*12000)||Math.abs(fromPulse-targetPulse)>32767))throw new PlotterError('invalid-plan','Invalid known servo pulse.');
  const unchanged=fromPulse===targetPulse;
  const refreshSteps=unchanged?0:initialize||rate===0?1:Math.ceil(Math.abs(targetPulse-fromPulse!)/rate);
  // A target update happens before that cycle's output pulse. One extra full
  // refresh bounds scheduling phase and the end of the last target pulse.
  const electricalMs=unchanged?0:(refreshSteps+1)*refreshMs;
  const settlingMs=(up?profile.servoSettleUpMs:profile.servoSettleDownMs)+(up?pen.upDelayMs:pen.downDelayMs);
  const startupMs=initialize?profile.servoStartupMs:0,reloadMs=reload?pen.reloadWaitMs:0;
  const durationMs=Math.max(1,Math.ceil(minimumMs),Math.ceil(electricalMs+settlingMs+startupMs+reloadMs));
  if(durationMs>65535)throw new PlotterError('invalid-plan','Pen settling time exceeds the supported queue duration.');
  return{model:PEN_TIMING_MODEL,fromPulse,targetPulse,rate,initialize,refreshMs,refreshSteps,electricalMs,settlingMs,startupMs,reloadMs,durationMs};
}
/** Compatibility duration adapter; all timing comes from the shared transition. */
export function penDuration(from:number|null,target:number,up:boolean,pen:PenSettings,reload=false,profile:MachineProfile):number {
  return planPenTransition(from===null?null:servoPulse(from,profile),target,up,pen,profile,reload).durationMs;
}
/** Retain reload intent even when runtime startup extends the prepared minimum. */
export function penRecordReload(plan:ExecutablePlan,index:number):boolean {
  const record=plan.records[index];
  return record?.kind==='pen'&&!record.penDown&&(record.reload===true||!record.workloadCheckpoint&&plan.options.maxPenDownMm>0&&plan.records[index+1]?.kind==='pen'&&plan.records[index+1]?.penDown===true);
}
