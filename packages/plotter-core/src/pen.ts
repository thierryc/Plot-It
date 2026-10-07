import { checked, type MachineProfile, type PenSettings } from './types.js';
export const defaultPen:PenSettings={up:50,down:60,raiseRate:75,lowerRate:50,upDelayMs:150,downDelayMs:0,reloadWaitMs:0,servoTimeoutMs:60000};
export function validatePen(pen:PenSettings):void {
  if(pen.servoTimeoutMs!==undefined&&(!Number.isInteger(pen.servoTimeoutMs)||pen.servoTimeoutMs<0||pen.servoTimeoutMs>65535))throw new Error('Invalid servo timeout.');
  if(pen.synchronizedB3!==undefined&&typeof pen.synchronizedB3!=='boolean')throw new Error('Invalid synchronized tool output.');
  checked(pen.up,0,100,'pen up');checked(pen.down,0,100,'pen down');
  checked(pen.raiseRate,1,100,'raise rate');checked(pen.lowerRate,1,100,'lower rate');
  checked(pen.upDelayMs,-500,10000,'up wait');checked(pen.downDelayMs,-500,10000,'down wait');checked(pen.reloadWaitMs,0,10000,'reload wait');
  for(const value of [pen.raiseRate,pen.lowerRate,pen.upDelayMs,pen.downDelayMs,pen.reloadWaitMs])if(!Number.isInteger(value))throw new Error('Invalid pen timing integer.');
}
export function servoPulse(percent:number,profile:MachineProfile):number {
  return Math.round(profile.servoMin+(profile.servoMax-profile.servoMin)*checked(percent,0,100,'pen height')/100);
}
export function servoCommands(pen:PenSettings,profile:MachineProfile,temporaryDown=pen.down):string[] {
  validatePen(pen);
  const rateScale=profile.servoSweepMs?Math.abs(profile.servoMax-profile.servoMin)*profile.servoChannels*profile.servoPeriod/(100*profile.servoSweepMs):24.6;
  return [`SC,4,${servoPulse(pen.up,profile)}`,`SC,5,${servoPulse(temporaryDown,profile)}`,
    `SC,11,${Math.round(rateScale*pen.raiseRate)}`,`SC,12,${Math.round(rateScale*pen.lowerRate)}`,
    `SC,8,${profile.servoChannels}`,`SC,9,${profile.servoPeriod}`];
}
export function penDuration(from:number|null,target:number,up:boolean,pen:PenSettings,reload=false,profile?:MachineProfile):number {
  validatePen(pen);
  const d=from===null?100:Math.abs(from-target),mechanical=d<.9?0:(profile?.servoMoveMinMs??45)+(profile?.servoMoveSlopeMs??2.69)*d,sweep=d<.9?0:(profile?.servoSweepMs??200)*d/(up?pen.raiseRate:pen.lowerRate);
  return Math.max(1,Math.max(1,Math.ceil(Math.sqrt(Math.hypot(mechanical**2,sweep**2))))+(up?pen.upDelayMs:50+pen.downDelayMs)+(reload?pen.reloadWaitMs:0));
}
