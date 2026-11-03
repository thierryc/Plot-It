import {penTimingSettings} from './pen-settings';
import {machineProfile,applyHandling,DEFAULT_WORKLOAD_CHECKPOINTS,type PlotOptions} from '@thierryc/plotter-core';
import type {PlotSettings} from './model';
import {DEFAULT_MACHINE_ROTATION} from './model';
/** The editor owns persistence/default migration; the core owns only physical units. */
export function coreOptions(settings:PlotSettings):PlotOptions {
  const timing=penTimingSettings(settings);
  const options:PlotOptions={profile:machineProfile(settings.profile==='nextdraw'?`nextdraw-${settings.nextdrawModel??'8511'}`:settings.profile==='axidraw'&&settings.axidrawHardwareModel==='v3-a3'?'axidraw-a3':settings.profile,settings.machineRotation??DEFAULT_MACHINE_ROTATION,settings.resolution??8,settings.nextdrawServo??'brushless'),
    pen:{timingModel:timing.penTimingModel,servoTimeoutMs:settings.servoTimeoutMs??60000,synchronizedB3:settings.synchronizedB3||undefined,up:settings.penUp,down:settings.penDown,raiseRate:timing.penRateRaise,lowerRate:timing.penRateLower,
      upDelayMs:timing.penDelayUpMs,downDelayMs:timing.penDelayDownMs,reloadWaitMs:timing.penReloadWaitMs},
    speed:settings.speed,travelSpeed:settings.travelSpeed,acceleration:settings.drawAcceleration,travelAcceleration:settings.travelAcceleration,
    cornering:settings.cornering,maxPenDownMm:settings.maxPenDownMm,returnToOrigin:settings.returnToOrigin,drawingMode:settings.drawingMode??'profiled',backend:settings.motionPreference==='scurve'?'t3':'sm',firmware:settings.motionFirmware??(settings.motionPreference==='scurve'||settings.profile==='nextdraw'?'3.1.7':undefined),drawingJerk:settings.drawingJerk,travelJerk:settings.travelJerk,curveToleranceMm:settings.curveToleranceMm};
  if(settings.workloadMode==='periodic')options.workloadCheckpoints={...(settings.workloadLimits??DEFAULT_WORKLOAD_CHECKPOINTS)};
  if(settings.motionStrategy==='dynamic')Object.assign(options,{motionStrategy:'dynamic',dynamicCurveAcceleration:settings.dynamicCurveAcceleration,dynamicAnticipationMm:settings.dynamicAnticipationMm});
  return applyHandling(options,settings.handling??'custom');
}
