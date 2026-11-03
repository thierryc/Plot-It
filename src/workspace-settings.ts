import type { PlotSettings } from './model';
import type { PlotDestination } from './plot-destination';
import { supportsHardwareProfile, restoreNextDrawModel } from './machine-profiles';
import { coreOptions } from './core-settings';
import { setupModel } from './plotter-setup';

/** Shared setting semantics for Canvas setup and Plot preparation. */
export function updateWorkspaceSetting(settings: PlotSettings, key: keyof PlotSettings | 'continuousCopies', input: HTMLInputElement | HTMLSelectElement, plotter: PlotDestination): void {
  const next = key === 'profile' || key === 'reorderMode' || key === 'axidrawModel' || key === 'nextdrawModel' || key === 'closedPathStart' || key==='drawingMode' || key==='motionPreference' || key==='motionStrategy' || key==='workloadMode' || key==='handling'||key==='nextdrawServo'||key==='previewFilter'||key==='axidrawHardwareModel' ? input.value : ['returnToOrigin','repeatRequireContinue','continuousCopies','automaticPlacement','pageClipping','hiddenLineRemoval','strictOrder','synchronizedB3','varyClosedStarts'].includes(key) ? (input as HTMLInputElement).checked : Number(input.value);
  if (key!=='continuousCopies'&&settings[key] === next) { return; }
  if (plotter.connected && ['machineRotation','nextdrawModel','axidrawModel'].includes(key)) plotter.invalidateOrigin();
  if (key === 'profile') {
    if (input.value !== settings.profile && plotter.connected) plotter.invalidateOrigin();
    settings.profile = input.value as PlotSettings['profile'];
  } else if (key === 'reorderMode') settings.reorderMode = input.value as PlotSettings['reorderMode'];
  else if(key==='motionPreference')settings.motionPreference=input.value as PlotSettings['motionPreference'];
  else if(key==='workloadMode')settings.workloadMode=input.value as PlotSettings['workloadMode'];
  else if(key==='motionStrategy'){
    settings.motionStrategy=input.value as PlotSettings['motionStrategy'];
    if(settings.motionStrategy==='dynamic'){
      settings.dynamicCurveAcceleration??=Math.min(100,settings.drawAcceleration/2);
      settings.dynamicAnticipationMm??=3;
    }
  }
  else if(key==='handling'){if(plotter.connected)plotter.invalidateOrigin();settings.handling=input.value as PlotSettings['handling'];const resolved=coreOptions(settings);Object.assign(settings,{speed:resolved.speed,resolution:resolved.profile.motorMode===1?16:8,curveToleranceMm:resolved.curveToleranceMm,drawingJerk:resolved.drawingJerk,travelJerk:resolved.travelJerk});}
  else if(key==='axidrawHardwareModel'){settings.axidrawHardwareModel=input.value as PlotSettings['axidrawHardwareModel'];if(plotter.connected)plotter.invalidateOrigin();}
  else if(key==='nextdrawServo'){settings.nextdrawServo=input.value as PlotSettings['nextdrawServo'];if(plotter.connected)plotter.invalidateOrigin();}
  else if(key==='previewFilter')settings.previewFilter=input.value as PlotSettings['previewFilter'];
  else if(['automaticPlacement','pageClipping','hiddenLineRemoval','strictOrder','synchronizedB3','varyClosedStarts'].includes(key))(settings as unknown as Record<string,boolean>)[key]=(input as HTMLInputElement).checked;
  else if(key==='continuousCopies')settings.copies=(input as HTMLInputElement).checked?'continuous':1;
  else if(key==='repeatRequireContinue')settings.repeatRequireContinue=(input as HTMLInputElement).checked;
  else if(key==='drawingMode')settings.drawingMode=input.value as PlotSettings['drawingMode'];
  else if(key==='resolution'){if(plotter.connected)plotter.invalidateOrigin();settings.resolution=Number(input.value) as 8|16;}
  else if (key === 'closedPathStart') settings.closedPathStart = input.value as PlotSettings['closedPathStart'];
  else if (key === 'nextdrawModel') settings.nextdrawModel = restoreNextDrawModel(input.value);
  else if (key === 'axidrawModel') settings.axidrawModel = setupModel(input.value);
  else if (key === 'returnToOrigin') settings.returnToOrigin = (input as HTMLInputElement).checked;
  else (settings as unknown as Record<string, number>)[key] = Number(input.value);
  if(key==='drawAcceleration'&&settings.dynamicCurveAcceleration!==undefined)settings.dynamicCurveAcceleration=Math.min(settings.dynamicCurveAcceleration,settings.drawAcceleration);
  if(['speed','drawingJerk','travelJerk','curveToleranceMm','resolution'].includes(key))settings.handling='custom';
  if (supportsHardwareProfile(settings.profile) && ['penUp','penDown','penRateRaise','penRateLower','penDelayUpMs','penDelayDownMs','penReloadWaitMs'].includes(key)) plotter.configurePen(settings);

}
