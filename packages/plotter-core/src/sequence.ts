import {PlotterSession} from './session.js';
import {compileJob,validatePlan,withRaisedReturn} from './compiler.js';
import {checked,PlotterError,type Clock,type ExecutablePlan,type Path,type PlotOptions} from './types.js';
import {clone} from './identity.js';
export interface RepeatSettings {copies:number|'continuous';intervalMs:number;requireContinue:boolean;seed?:number;varyClosedStarts?:boolean}
export const singleCopy:RepeatSettings={copies:1,intervalMs:0,requireContinue:false};
export function validateRepeat(s:RepeatSettings):void {
 if(s.copies!=='continuous'&&(!Number.isInteger(s.copies)||s.copies<1||s.copies>100000))throw new PlotterError('invalid-plan','Invalid copy count.');
 checked(s.intervalMs,0,86400000,'inter-copy interval');if(!Number.isInteger(s.intervalMs)||typeof s.requireContinue!=='boolean')throw new PlotterError('invalid-plan','Invalid repeat timer.');
 if(s.seed!==undefined&&(!Number.isInteger(s.seed)||s.seed<0||s.seed>4294967295))throw new PlotterError('invalid-plan','Invalid copy seed.');
}
export function copyBoundary(repeat:RepeatSettings,copy:number){return{more:repeat.copies==='continuous'||copy<repeat.copies,intervalMs:repeat.intervalMs,requireContinue:repeat.requireContinue};}
export interface SequenceSegment {id:string;plan?:ExecutablePlan;delayMs?:number;pause?:boolean}
export interface SequenceStatus {state:'idle'|'drawing'|'waiting'|'paused'|'continue'|'finished'|'stopped'|'cancelled'|'failed';copy:number;copies:number|'continuous';segment:number;remainingMs:number;elapsedMs:number}
/** Lazy copy/layer scheduling. Acknowledgements never advance its completion cursor. */
export class JobSequence {
 private paused=false;private stopped=false;private cancelled=false;private waiter:(()=>void)|null=null;private continueRequested=false;private continuePending=false;
 private startedAt=0;status:SequenceStatus={state:'idle',copy:0,copies:1,segment:0,remainingMs:0,elapsedMs:0};busy=false;
  onStatus:(status:SequenceStatus)=>void=()=>{};
 onProgram:(plan:ExecutablePlan,copy:number,segment:number)=>void=()=>{};
  get elapsedMs():number{return this.busy?this.clock.now()-this.startedAt:this.status.elapsedMs;}
 constructor(readonly session:PlotterSession,private clock:Clock){}
 private publish(state=this.status.state):void{this.status={...this.status,state,elapsedMs:this.clock.now()-this.startedAt};try{this.onStatus({...this.status});}catch{/* observer isolation */}}
 pause():void{if(!this.busy)return;this.paused=true;if(this.session.busy)this.session.pause();else this.publish('paused');}
 resume():void{this.paused=false;this.session.resume();this.waiter?.();this.waiter=null;}
 continue():void{if(this.continuePending){this.continueRequested=true;this.waiter?.();this.waiter=null;}else this.resume();}
 stop():void{this.stopped=true;this.session.stop();this.resume();}
 cancel():void{this.cancelled=true;this.session.cancel();this.resume();}
 private get ended():boolean{return this.stopped||this.cancelled;}
 private async poll():Promise<void>{const status=await this.session.pollStatus();if(status.button)this.pause();}
 private async pauseWait():Promise<void>{while(this.paused&&!this.ended){this.publish('paused');if(!this.paused||this.ended)break;await this.clock.sleep(100);await this.poll();}}
 private async wait(ms:number,gate=false):Promise<void>{
  this.status.remainingMs=ms;
  while(this.status.remainingMs>0&&!this.ended){await this.pauseWait();if(this.ended)break;this.publish('waiting');if(this.paused||this.ended)continue;const duration=Math.min(100,this.status.remainingMs),before=this.clock.now();await this.clock.sleep(duration);this.status.remainingMs=Math.max(0,this.status.remainingMs-(this.clock.now()-before));await this.poll();}
  if(gate&&!this.ended){this.continuePending=true;this.continueRequested=false;while(!this.continueRequested&&!this.ended){await this.pauseWait();this.publish('continue');if(this.continueRequested||this.ended)break;await this.clock.sleep(100);await this.poll();}this.continuePending=false;}
 }
 async run(segments:readonly SequenceSegment[],repeat:RepeatSettings=singleCopy,variant?:(copy:number)=>readonly SequenceSegment[]):Promise<SequenceStatus['state']>{
  if(this.busy||this.session.busy)throw new PlotterError('busy','A sequence is already active.');validateRepeat(repeat);
  if(!segments.length||segments.length>100000)throw new PlotterError('invalid-plan','Invalid sequence segments.');
  for(const segment of segments){if(segment.plan)validatePlan(segment.plan);if(segment.delayMs!==undefined)checked(segment.delayMs,0,86400000,'layer delay');}
  if(repeat.varyClosedStarts&&!variant)throw new PlotterError('invalid-plan','Varied copies require a deterministic geometry factory.');
  this.busy=true;this.paused=this.stopped=this.cancelled=false;this.startedAt=this.clock.now();this.status={state:'drawing',copy:1,copies:repeat.copies,segment:0,remainingMs:0,elapsedMs:0};
  let result:SequenceStatus['state']='finished';
  try{
   for(let copy=1;repeat.copies==='continuous'||copy<=repeat.copies;copy++){
    if(this.ended)break;this.status.copy=copy;
    const items=variant?variant(copy):segments,more=copyBoundary(repeat,copy).more;
    for(const [index,segment]of items.entries()){
     if(this.ended)break;await this.pauseWait();this.status.segment=index;this.publish('drawing');
     if(segment.plan){
      // Inter-copy/layer returns are mandatory; final-copy return preference survives.
      const notFinal=more||items.slice(index+1).some(s=>!!s.plan);
      const plan=notFinal&&!segment.plan.options.returnToOrigin?withRaisedReturn(segment.plan):segment.plan;
      this.onProgram(plan,copy,index);const state=await this.session.run(plan,{keepMotors:true});if(state!=='finished'){if(state==='cancelled')this.cancelled=true;else this.stopped=true;break;}
     }
     await this.wait(segment.delayMs??0,!!segment.pause);
    }
    if(this.ended||!more)break;await this.wait(repeat.intervalMs,repeat.requireContinue);
   }
   result=this.cancelled?'cancelled':this.stopped?'stopped':'finished';
  }catch(error){result='failed';throw error;}
  finally{this.busy=false;this.status.remainingMs=0;if(this.session.connected&&this.session.origin.motorsOn)await this.session.release().catch(()=>{this.session.origin.invalidate();});this.publish(result);}
  return result;
 }
}
export interface Layer {id:string;sourceLayerId?:string;sourceOrder?:number;name:string;paths:readonly Path[];included?:boolean;hidden?:boolean;documentation?:boolean;delayMs?:number;pause?:boolean;speedPercent?:number;controls?:import('./layer-controls.js').LayerControls;options?:PlotOptions;overrides?:Partial<Pick<PlotOptions,'speed'|'drawingJerk'|'drawingMode'|'cornering'>> & {penDown?:number}}
export function compileLayers(layers:readonly Layer[],options:PlotOptions):SequenceSegment[]{
 const seen=new Set<string>();return layers.filter(layer=>layer.included!==false&&!layer.hidden&&!layer.documentation).flatMap(layer=>{
  if(!layer.id||seen.has(layer.id))throw new PlotterError('invalid-plan','Invalid or duplicate layer identity.');seen.add(layer.id);
  const base=layer.options?{...clone(layer.options),returnToOrigin:options.returnToOrigin}:options;
  const {penDown,...override}=layer.overrides??{},resolved={...clone(base),...(layer.speedPercent===undefined?{}:{speed:base.speed*checked(layer.speedPercent,1,110,'layer speed percent')/100}),...override,pen:{...base.pen,...(penDown===undefined?{}:{down:penDown})}};
  const wait={id:`${layer.id}:before`,delayMs:layer.delayMs??0,pause:!!layer.pause};
  if(!layer.paths.some(p=>p.points.length>1))return[wait];
  return[...(wait.delayMs||wait.pause?[wait]:[]),{id:layer.id,plan:compileJob(layer.paths,resolved)}];
 });
}
