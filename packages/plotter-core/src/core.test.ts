import {describe,it,expect} from 'vitest';
import {compileJob,validatePlan,motorCommand,sampleExecution} from './compiler.js';
import {machineProfile,toNative,fromNative,roundEven} from './profiles.js';
import {defaultPen} from './pen.js';
import {PlotterSession} from './session.js';
import {EbbProtocol,firmwareFromReply} from './protocol.js';
import {VirtualClock,VirtualEbb} from './virtual/index.js';
import type {PlotOptions,MotorRecord} from './types.js';
const settings:PlotOptions={profile:machineProfile('xylodraw',90),pen:{...defaultPen,up:30,down:52},speed:35,travelSpeed:60,acceleration:200,travelAcceleration:300,cornering:.127,maxPenDownMm:0,returnToOrigin:true,drawingMode:'profiled'};
const paths=[{tool:'#000000',points:[{x:55,y:10},{x:80,y:10},{x:80,y:30}]}];
function fixture(firmware:'2.8.1'|'3.1.7'='2.8.1',future=false){const clock=new VirtualClock(),board=new VirtualEbb(clock,{firmware,futureReplies:future,fragmentBytes:1});const session=new PlotterSession(board.createTransport(),clock,settings.profile);session.configure(settings.pen);return{clock,board,session};}
describe('fresh native motion core',()=>{
  it('represents half-XY-step endpoints and uses symmetric ties-even rounding',()=>{
    const profile=machineProfile('axidraw',0);expect(toNative({x:.0125,y:.0125},profile)).toEqual({m1:1,m2:0});
    expect(fromNative({m1:1,m2:0},profile)).toEqual({x:.0125,y:.0125});expect([-.5,-1.5,.5,1.5].map(roundEven)).toEqual([0,-2,0,2]);
  });
  it('compiles native SM, immutable settings and a command-derived preview',()=>{
    const plan=compileJob(paths,settings);validatePlan(plan);const motors=plan.records.filter((r):r is MotorRecord=>r.kind==='motor');
    expect(motors.every(r=>motorCommand(r).startsWith('SM,'))).toBe(true);expect(sampleExecution(plan,plan.durationMs)).toMatchObject({position:{x:0,y:0},penDown:false});
    const o={...settings,pen:{...settings.pen}};const saved=compileJob(paths,o);o.pen.down=1;expect(saved.options.pen.down).toBe(52);
  });
  it('has a distinct constant drawing policy and still ramps raised travel',()=>{
    const smooth=compileJob(paths,settings),constant=compileJob(paths,{...settings,drawingMode:'constant'});
    const drawn=(p:typeof smooth)=>p.records.filter(r=>r.kind==='motor'&&r.penDown).reduce((t,r)=>t+r.durationMs,0);
    expect(drawn(constant)).toBeLessThan(drawn(smooth));expect(constant.records.filter(r=>r.kind==='motor'&&!r.penDown).map(r=>r.durationMs)).toEqual(smooth.records.filter(r=>r.kind==='motor'&&!r.penDown).map(r=>r.durationMs));
  });
  it('splits long drawing before the maximum and reloads without travel',()=>{
    const plan=compileJob([{tool:'#000',points:[{x:10,y:10},{x:40,y:10},{x:40,y:80}]}],{...settings,maxPenDownMm:30,pen:{...settings.pen,reloadWaitMs:777}});validatePlan(plan);
    let drawn=0,count=0;for(const r of plan.records){if(r.kind==='motor'&&r.penDown)drawn+=Math.hypot(r.to.x-r.from.x,r.to.y-r.from.y);if(r.kind==='pen'&&!r.penDown&&drawn){expect(drawn).toBeLessThanOrEqual(30+1e-6);drawn=0;count++;}}expect(count).toBeGreaterThan(3);
  });
  it.each([['2.8.1',false],['3.1.7',false],['3.1.7',true]] as const)('restores the actual Down pulse on the first normal plot after bounds (%s, future=%s)',async(firmware,future)=>{
    const {board,session}=fixture(firmware,future);await session.connect();await session.setPen(52);
    const bounds=compileJob(paths,settings,'bounds');await session.run(bounds);const cut=board.trace.length;
    expect(board.trace.filter(t=>t.phase==='started'&&t.command.startsWith('SM,')).every(t=>t.penUp)).toBe(true);
    await session.run(compileJob(paths,settings));
    const tail=board.trace.slice(cut),firstDown=tail.findIndex(t=>t.command.startsWith('SP,0,')&&t.phase==='completed');
    const drawing=tail.findIndex(t=>t.command.startsWith('SM,')&&t.phase==='started'&&!t.penUp);
    expect(firstDown).toBeGreaterThan(0);expect(drawing).toBeGreaterThan(firstDown);expect(tail[drawing]!.pulse).toBe(17340);
    const cut2=board.trace.length;await session.run(compileJob(paths,settings));expect(board.trace.slice(cut2).some(t=>t.phase==='started'&&t.command.startsWith('SM,')&&!t.penUp)).toBe(true);
    expect(board.commands).not.toContain('R');expect(board.penUp).toBe(true);expect(board.position).toEqual({m1:0,m2:0});await session.disconnect();
  });
  it('waits for full Up/Down completion before motion, and never lowers during travel',async()=>{
    const {board,session}=fixture();await session.connect();await session.run(compileJob(paths,settings));
    let penReady=0;for(const t of board.trace){if(t.phase==='started'&&t.command.startsWith('SP,'))penReady=t.timeMs+Number(t.command.split(',')[2]);if(t.phase==='started'&&t.command.startsWith('SM,'))expect(t.timeMs).toBeGreaterThanOrEqual(penReady);}
    expect(board.trace.some(t=>t.command.startsWith('SM,')&&t.phase==='started'&&!t.penUp)).toBe(true);
    await session.disconnect();
  });
  it('uses one-slot FIFO backpressure and reports accepted separately from completed',async()=>{
    const {board,session}=fixture();await session.connect();await session.run(compileJob(paths,settings));
    const motion=board.trace.filter(t=>t.command.startsWith('SM,'));expect(motion.some(t=>t.phase==='accepted'&&t.queue>1)).toBe(true);
    expect(motion.some(t=>t.phase==='completed')).toBe(true);expect(motion.every(t=>t.queue<=2)).toBe(true);await session.disconnect();
  });
  it('refuses mutated timelines and pen waits before any hardware preparation',async()=>{
    const {board,session}=fixture();await session.connect();const before=board.commands.length,plan=compileJob(paths,settings);
    (plan.records[0]!).durationMs=1;await expect(session.run(plan)).rejects.toThrow('settling');expect(board.commands.length).toBe(before);await session.disconnect();
  });
  it('rejects unknown virtual commands and firmware older than the supported floor',async()=>{
    expect(()=>firmwareFromReply('EBB Firmware Version 2.7.0')).toThrow('requires EBB firmware 2.8.1');
    expect(()=>firmwareFromReply('EBB Firmware Version 4.0.0')).toThrow('requires EBB firmware');
    const {board,clock}=fixture();const protocol=new EbbProtocol(board.createTransport(),clock);await expect(protocol.request('MADEUP')).rejects.toThrow('rejected');
  });
  it('can cancel and start a new job without retaining a queued Down endpoint',async()=>{
    const clock=new VirtualClock();let session!:PlotterSession,requested=false;
    const board=new VirtualEbb(clock,{firmware:'3.1.7',onCommand:command=>{if(command.startsWith('SM,')&&!board.penUp&&!requested){requested=true;session.cancel();}}});
    session=new PlotterSession(board.createTransport(),clock,settings.profile);await session.connect();
    expect(await session.run(compileJob(paths,settings))).toBe('cancelled');expect(session.origin.source).toBe('unset');
    await expect(session.run(compileJob(paths,settings))).rejects.toThrow(/physical origin/);await session.setOrigin();
    const cut=board.trace.length;expect(await session.run(compileJob(paths,settings))).toBe('finished');
    expect(board.trace.slice(cut).some(t=>t.phase==='started'&&t.command.startsWith('SM,')&&!t.penUp&&t.pulse===17340)).toBe(true);await session.disconnect();
  });
  it('does not silently recapture an interrupted motor position as origin',async()=>{
    const {board,session,clock}=fixture();await session.connect();const external=new EbbProtocol(board.createTransport(),clock);
    await external.request('EM,2,2');await external.request('SM,1000,200,0');clock.advance(100);
    const before=board.commands.length;await expect(session.run(compileJob(paths,settings))).rejects.toThrow('Restore the physical origin');
    expect(board.commands.slice(before).some(c=>c.startsWith('SM,')||c==='CS')).toBe(false);expect(session.origin.source).toBe('unset');await session.disconnect();
  });
  it('times out a missing firmware response and closes the byte channel',async()=>{
    const clock=new VirtualClock();let closed=false,finish!:(value:Uint8Array|null)=>void;
    const protocol=new EbbProtocol({write:async()=>{},read:()=>new Promise(resolve=>{finish=resolve;}),close:async()=>{closed=true;finish?.(null);}},clock);
    const pending=protocol.request('V'),observed=expect(pending).rejects.toThrow('timed out');
    for(let i=0;i<4;i++)await Promise.resolve();clock.advance(5001);await observed;expect(closed).toBe(true);
  });
  it('invalidates an idle connection immediately when the transport disconnects',async()=>{
    const clock=new VirtualClock(),board=new VirtualEbb(clock),transport=board.createTransport();
    const session=new PlotterSession(transport,clock,settings.profile);await session.connect();await session.setOrigin();transport.disconnect();
    expect(session.connected).toBe(false);expect(session.origin.source).toBe('unset');await expect(session.run(compileJob(paths,settings))).rejects.toThrow('Connect');
  });
  it('rejects nonnumeric native positions and nonfinite geometry rather than coercing them',()=>{
    for(const corrupt of ['native','geometry']){
      const plan=JSON.parse(JSON.stringify(compileJob(paths,settings))),move=plan.records.find((r:{kind:string})=>r.kind==='motor');
      if(corrupt==='native')move.toSteps.m1=String(move.toSteps.m1);else move.to.x=NaN;
      expect(()=>validatePlan(plan)).toThrow(/native position|geometry/);
    }
  });
});
