import { nativeEqual } from './profiles.js';
import { Feeder } from './feeder.js';
import { PlotterError, type MachineProfile, type NativePoint } from './types.js';
/** Coordinate confidence and motor setup, independent of pen and path planning. */
export class Origin {
  source:'unset'|'automatic'|'explicit'='unset';profile:MachineProfile|null=null;steps:NativePoint={m1:0,m2:0};motorsOn=false;
  recoveryRequired=false;
  invalidate(requireRecovery=true):void{this.source='unset';this.profile=null;if(requireRecovery)this.recoveryRequired=true;}
  matches(profile:MachineProfile):boolean{const p=this.profile;return this.source!=='unset'&&!!p&&p.id===profile.id&&p.stepsPerMm===profile.stepsPerMm&&p.motorMode===profile.motorMode&&p.rotation===profile.rotation;}
  async capture(feeder:Feeder,profile:MachineProfile,source:'automatic'|'explicit'):Promise<void> {
    if(source==='automatic'&&this.recoveryRequired)throw new PlotterError('origin','Restore the physical origin and explicitly set it before plotting.');
    await feeder.drain();await feeder.protocol.request(`EM,${profile.motorMode},${profile.motorMode}`);await feeder.protocol.request('CS');
    this.steps={m1:0,m2:0};this.profile={...profile};this.source=source;this.motorsOn=true;this.recoveryRequired=false;
  }
  async release(feeder:Feeder):Promise<void>{this.invalidate(!this.isAtOrigin());this.motorsOn=false;await feeder.protocol.request('EM,0,0');}
  async engage(feeder:Feeder,profile:MachineProfile):Promise<void>{if(this.motorsOn)return;await feeder.protocol.request(`EM,${profile.motorMode},${profile.motorMode}`);this.motorsOn=true;}
  isAtOrigin():boolean{return nativeEqual(this.steps,{m1:0,m2:0});}
  require(profile:MachineProfile):void{if(!this.matches(profile))throw new PlotterError('origin','Set the carriage at your origin and click Set origin first.');}
}
