import {machineProfile,defaultPen,applyHandling,type PlotOptions} from '@thierryc/plotter-core';
import type {PlotSettings} from './model';
import {DEFAULT_MACHINE_ROTATION} from './model';
/** The editor owns persistence/default migration; the core owns only physical units. */
export function coreOptions(settings:PlotSettings):PlotOptions {
  const options:PlotOptions={profile:machineProfile(settings.profile==='nextdraw'?`nextdraw-${settings.nextdrawModel??'8511'}`:settings.profile==='axidraw'&&settings.axidrawHardwareModel==='v3-a3'?'axidraw-a3':settings.profile,settings.machineRotation??DEFAULT_MACHINE_ROTATION,settings.resolution??8,settings.nextdrawServo??'brushless'),
    pen:{servoTimeoutMs:settings.servoTimeoutMs??60000,synchronizedB3:settings.synchronizedB3||undefined,up:settings.penUp,down:settings.penDown,raiseRate:settings.penRateRaise??defaultPen.raiseRate,lowerRate:settings.penRateLower??defaultPen.lowerRate,
      upDelayMs:settings.penDelayUpMs??defaultPen.upDelayMs,downDelayMs:settings.penDelayDownMs??0,reloadWaitMs:settings.penReloadWaitMs??0},
    speed:settings.speed,travelSpeed:settings.travelSpeed,acceleration:settings.drawAcceleration,travelAcceleration:settings.travelAcceleration,
    cornering:settings.cornering,maxPenDownMm:settings.maxPenDownMm,returnToOrigin:settings.returnToOrigin,drawingMode:settings.drawingMode??'profiled',backend:settings.motionPreference==='scurve'?'t3':'sm',firmware:settings.motionFirmware??(settings.motionPreference==='scurve'||settings.profile==='nextdraw'?'3.1.7':undefined),drawingJerk:settings.drawingJerk,travelJerk:settings.travelJerk,curveToleranceMm:settings.curveToleranceMm};
  return applyHandling(options,settings.handling??'custom');
}
