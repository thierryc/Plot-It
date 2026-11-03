import {COMPILER_VERSION} from './version.js';
import {PlotterError,type Firmware} from './types.js';
export type MotionPreference='auto'|'compatibility'|'scurve';
export interface Capabilities {firmware:string;sm:boolean;t3:boolean;td:boolean;futureReplies:boolean;testedModern:boolean;physicalModernAccepted:boolean;fingerprint:string}
export function capabilities(f:Firmware):Capabilities {
  const t3=f.major===3&&(f.minor>0||f.patch>=2),testedModern=f.version==='3.1.7';
  return{firmware:f.version,sm:true,t3,td:t3,futureReplies:f.modern,testedModern,physicalModernAccepted:false,fingerprint:`ebb:${f.version}:${COMPILER_VERSION}:sm${t3?':t3:td':''}`};
}
/** Modern Auto stays conservative until the user's hardware acceptance. */
export function selectBackend(f:Firmware,preference:MotionPreference='auto',virtual=false):'sm'|'t3' {
  const c=capabilities(f);
  if(preference==='scurve'){if(!c.testedModern)throw new PlotterError('unsupported-firmware','S-curve requires the validated EBB 3.1.7 target.');return't3';}
  return preference==='auto'&&virtual&&c.testedModern?'t3':'sm';
}
