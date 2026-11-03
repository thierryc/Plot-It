import {expect,it} from 'vitest';
import {Feeder} from './feeder.js';
import {firmwareFromReply,type EbbProtocol} from './protocol.js';
import {VirtualClock} from './virtual/index.js';
import type {MotorRecord} from './types.js';
function record(id:number,durationMs:number,stationary=false):MotorRecord{return{id,kind:'motor',startMs:id*durationMs,durationMs,tool:'black',penDown:true,from:{x:id,y:0},to:{x:id+1,y:0},fromSteps:{m1:id*100,m2:id*100},toSteps:stationary?{m1:id*100,m2:id*100}:{m1:(id+1)*100,m2:(id+1)*100},restBefore:false};}
function fixture(firmware:string){
 const clock=new VirtualClock(),written:Array<{at:number;command:string}>=[];
 const protocol={request:async(command:string)=>{written.push({at:clock.now(),command});return'OK';}} as unknown as EbbProtocol;
 return{clock,written,feeder:new Feeder(protocol,clock,firmwareFromReply(`EBB Firmware Version ${firmware}`))};
}
it('includes the next 100 ms SM move in the 500 ms planned host lead',async()=>{
 const {feeder,written}=fixture('3.1.7');
 for(let i=0;i<20;i++)await feeder.motion(record(i,100));
 written.forEach((entry,i)=>expect((i+1)*100-entry.at).toBeLessThanOrEqual(500));
 expect(written[4]!.at).toBe(0);expect(written[5]!.at).toBe(350);
});
it('retains the previous legacy-firmware scheduling policy',async()=>{
 const {feeder,written}=fixture('2.8.1');for(let i=0;i<7;i++)await feeder.motion(record(i,100));
 expect(written[5]!.at).toBe(0);expect(written[6]!.at).toBe(350);
});
it('retains scheduling of existing long stationary waits',async()=>{
 const {feeder,written}=fixture('3.1.7');for(let i=0;i<7;i++)await feeder.motion(record(i,100,true));
 expect(written[5]!.at).toBe(0);expect(written[6]!.at).toBe(350);
});
