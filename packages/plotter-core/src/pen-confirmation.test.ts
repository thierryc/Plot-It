import {expect,it} from 'vitest';
import {compileJob,defaultPen,machineProfile,PlotterSession,type PlotOptions,type SessionEvent} from './index.js';
import {VirtualClock,VirtualEbb} from './virtual/index.js';
import {ascii,text} from './protocol.js';
const profile=machineProfile('xylodraw',0,16),pen={...defaultPen,up:30,down:60};
const options:PlotOptions={profile,pen,speed:35,travelSpeed:60,acceleration:200,travelAcceleration:300,cornering:.127,maxPenDownMm:0,returnToOrigin:true,drawingMode:'profiled',backend:'sm',firmware:'3.1.7'};
function fixture(){
 const clock=new VirtualClock(),board=new VirtualEbb(clock,{firmware:'3.1.7'}),bytes=board.createTransport(),events:SessionEvent[]=[];
 let failUp=false;
 const session=new PlotterSession({...bytes,write:async data=>{
  const command=text(data);await bytes.write(failUp&&/^SP,(1|2),/.test(command)?ascii(command.replace(/^SP,(1|2),(\d+),/,(_match,_up,ms)=>`SP,0,${Math.max(1,Number(ms))},`)):data);
 }},clock,profile);
 session.configure(pen);session.subscribe(e=>events.push(e));
 return{session,board,events,failUp:()=>{failUp=true;}};
}
const lastPen=(events:SessionEvent[])=>events.filter(e=>e.kind==='pen-confirmation').at(-1)?.penConfirmation;
it('confirms the internal pause lift before paused and the restored Down before resumed motion',async()=>{
 const {session,board,events}=fixture(),plan=compileJob([{tool:'black',points:[{x:2,y:2},{x:12,y:2}]}],options);
 let requested=false,paused=false,resumed=false;
 session.subscribe(e=>{
  if(e.kind==='record'&&e.phase==='settled'&&plan.records[e.recordId!]!.kind==='pen'&&plan.records[e.recordId!]!.penDown&&!requested){requested=true;session.pause();}
  if(e.kind==='state'&&e.state==='paused'){
   paused=true;expect(lastPen(events)).toEqual({penState:'up',penHeight:30});expect(board.penUp).toBe(true);
   session.resume();
  }
  if(paused&&e.kind==='record'&&e.phase==='started'&&plan.records[e.recordId!]!.kind==='motor'&&plan.records[e.recordId!]!.penDown){resumed=true;expect(lastPen(events)).toEqual({penState:'down',penHeight:60});expect(board.penUp).toBe(false);}
 });
 await session.connect();expect(await session.run(plan)).toBe('finished');expect(paused&&resumed).toBe(true);
 expect(events.filter(e=>e.kind==='record'&&e.phase==='settled').map(e=>e.recordId)).toEqual(plan.records.map(r=>r.id));
});
it.each([false,true])('confirms Stop return Up only when strict controller validation succeeds (fault=%s)',async fault=>{
 const {session,board,events,failUp}=fixture(),plan=compileJob([{tool:'black',points:[{x:2,y:2},{x:12,y:2}]}],options);
 let stoppedAt=-1;
 session.subscribe(e=>{if(stoppedAt<0&&e.kind==='record'&&e.phase==='started'&&plan.records[e.recordId!]!.kind==='motor'&&plan.records[e.recordId!]!.penDown){stoppedAt=events.length;session.stop();if(fault)failUp();}});
 await session.connect();if(fault){await expect(session.run(plan)).rejects.toThrow(/pen state/);expect(lastPen(events)?.penState).toBe('unknown');expect(events.slice(stoppedAt).filter(e=>e.penConfirmation?.penState==='up')).toEqual([]);}
 else{expect(await session.run(plan)).toBe('stopped');expect(lastPen(events)).toEqual({penState:'up',penHeight:30});expect(board.position).toEqual({m1:0,m2:0});}
});
it('reports physical pulse equality for coincident endpoints and temporary manual heights',async()=>{
 const {session,board,events}=fixture();session.configure({...pen,down:30});await session.connect();
 const plan=compileJob([{tool:'black',points:[{x:1,y:1},{x:2,y:1}]}],{...options,pen:{...pen,down:30}});
 session.subscribe(e=>{if(e.kind==='record'&&e.phase==='settled'&&plan.records[e.recordId!]!.kind==='pen'&&plan.records[e.recordId!]!.penDown)expect(lastPen(events)).toEqual({penState:'up',penHeight:30});});
 await session.run(plan);expect(events.some(e=>e.penConfirmation?.penState==='down')).toBe(false);
 await session.setPen(73);expect(lastPen(events)).toEqual({penState:'down',penHeight:73});expect(board.penUp).toBe(false);
});
