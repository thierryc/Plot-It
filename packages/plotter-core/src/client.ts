import {validatePreparedJob,type PreparedJob} from './prepared-job.js';
import type {Checkpoint,Clock,Point} from './index.js';
export interface RunnerTransport {
 get(path:string):Promise<unknown>;
 post(path:string,value:unknown):Promise<unknown>;
 /** Owns the existing claim/release WebSocket contract and request deadlines. */
 control(request:{version:1;requestId:string;action:string;jobId?:string;[key:string]:unknown}):Promise<unknown>;
}
export interface RunnerState {jobId:string|null;status:string;connected:boolean;elapsedMs?:number;position?:Point|null;progress?:{copy?:number;remainingMs?:number};error?:string}
/** Hosting, socket implementation and authentication belong to the caller. */
export class RunnerJobClient {
 constructor(private transport:RunnerTransport,private requestId:()=>string,private clock:Clock){}
 async status():Promise<RunnerState>{const result=await this.transport.get('/api/v1/status') as {snapshot:RunnerState};if(!result?.snapshot)throw new Error('Runner is unavailable');return result.snapshot;}
 async submit(job:PreparedJob,requestId=this.requestId()):Promise<{id:string;status:string}>{const prepared=validatePreparedJob(job);return await this.transport.post('/api/v1/jobs',{version:2,requestId,prepared}) as {id:string;status:string};}
 async command(action:string,fields:Record<string,unknown>={}):Promise<unknown>{return this.transport.control({version:1,requestId:this.requestId(),action,...fields});}
 async start(id:string){return this.command('start',{jobId:id});}
 async pause(){return this.command('pause');}async resume(){return this.command('resume');}async continue(){return this.command('continue');}async stop(){return this.command('stop');}async cancel(){return this.command('cancel');}
 async job(id:string):Promise<{status:string;checkpoint?:Checkpoint}>{return await this.transport.get(`/api/v1/jobs/${encodeURIComponent(id)}`) as {status:string;checkpoint?:Checkpoint};}
 async wait(id:string,timeoutMs=86400000):Promise<{status:string;checkpoint?:Checkpoint}>{const deadline=this.clock.now()+timeoutMs;for(;;){const job=await this.job(id);if(['finished','stopped','failed','interrupted'].includes(job.status))return job;if(this.clock.now()>deadline)throw new Error('Runner wait timed out; execution has not been cancelled');await this.clock.sleep(500);}}
}
export interface CompletionEvent {version:1;jobDigest:string;state:string;elapsedMs:number;virtual:boolean}
/** Called after execution; detached delivery cannot change success or restart motion. */
export function dispatchCompletion(event:CompletionEvent,deliver:(event:CompletionEvent)=>Promise<void>,onError:(error:unknown)=>void=()=>{}):void {void Promise.resolve().then(()=>deliver({...event})).catch(error=>{try{onError(error);}catch{}});}
