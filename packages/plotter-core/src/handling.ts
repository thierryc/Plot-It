import {machineProfile} from './profiles.js';
import type {PlotOptions} from './types.js';
import {clone} from './identity.js';
/** App recipes in physical units. Never silently applies NextDraw jerk to Xylodraw. */
export function applyHandling(options:PlotOptions,handling:NonNullable<PlotOptions['handling']>):PlotOptions {
 const o=clone(options);o.handling=handling;if(handling==='custom')return o;
 const resolution=handling==='technical'?16:8,id=o.profile.id as Parameters<typeof machineProfile>[0];
 o.profile=machineProfile(id,o.profile.rotation,resolution,o.profile.servoKind);
 o.speed=handling==='handwriting'?45:handling==='sketching'?60:35;
 o.curveToleranceMm=handling==='technical'?.0508:handling==='handwriting'?.2032:.127;
 if(id.startsWith('nextdraw-')){const derate=id.endsWith('1117')?.9:id.endsWith('2234')?.6:1;o.drawingJerk=(handling==='technical'?508000:handling==='handwriting'?2286000:355600)*derate;o.travelJerk=(id.endsWith('2234')?203200:id.endsWith('1117')?304800:330200);}
 return o;
}
