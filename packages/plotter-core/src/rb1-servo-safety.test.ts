import {describe,expect,it} from 'vitest';
import {Feeder} from './feeder.js';
import {EbbProtocol,ascii,text,firmwareFromReply} from './protocol.js';
import {compileJob,defaultPen,machineProfile,PlotterSession,servoPulse,type PlotOptions} from './index.js';
import {VirtualClock,VirtualEbb} from './virtual/index.js';

const profile=machineProfile('xylodraw',90,16),pen={...defaultPen,up:30,down:60};
// Inject only the independently observed failure. It is not a claim about all
// 3.1.7 firmware: S2 corrupts counters and subsequent Down is acknowledged as Up.
function fixture(firmware:'3.1.6'|'3.1.7'='3.1.7',futureReplies=false){
 const clock=new VirtualClock(),board=new VirtualEbb(clock,{firmware,futureReplies,fragmentBytes:1}),bytes=board.createTransport();
 let contaminated=false;
 const transport={...bytes,write:async(data:Uint8Array)=>{
  const command=text(data);
  if(command.startsWith('S2,')){contaminated=true;board.position.m2--;}
  await bytes.write(contaminated&&command.startsWith('SP,0,')?ascii(command.replace('SP,0,','SP,1,')):data);
 }};
 const protocol=new EbbProtocol(transport,clock),extensions:Array<{minimumMs:number;durationMs:number;extensionMs:number}>=[];
 const feeder=new Feeder(protocol,clock,firmwareFromReply(`EBB Firmware Version ${firmware}`),undefined,e=>extensions.push(e));
 return {clock,board,transport,protocol,feeder,extensions};
}
const noMotion=(commands:readonly string[])=>expect(commands.filter(c=>/^(SM|XM|T3|TD|EM|CS),?/.test(c))).toEqual([]);
describe('3.1.7 standard RB1 eight-channel S2 avoidance',()=>{
 it('the independent fault injector exposes the old initialization sequence',async()=>{
  const f=fixture('3.1.6');await f.feeder.pen(pen.up,pen,profile);
  await expect(f.feeder.pen(pen.down,pen,profile)).rejects.toThrow(/pen state/);
  expect(f.board.position).not.toEqual({m1:0,m2:0});expect(f.board.commands).toContain('S2,0,4');
 });
 it.each([false,true])('initializes Up before unknown Down, waits full bounds and retains counters (future=%s)',async future=>{
  const f=fixture('3.1.7',future);await f.feeder.pen(pen.down,pen,profile,398);
  expect(f.clock.now()).toBe(548+244);expect(f.extensions).toEqual([{minimumMs:398,durationMs:792,extensionMs:394}]);
  expect(f.board.commands.filter(c=>c.startsWith('SP,'))).toEqual(['SP,2,0,1','SP,0,244,1']);
  const initialize=f.board.commands.indexOf('SP,2,0,1');
  expect(f.board.commands.slice(0,initialize)).toContain('SC,4,21850');expect(f.board.commands.slice(0,initialize)).toContain('SC,11,0');
  expect(f.board.commands.slice(initialize)).toContain('SC,11,1845');
  expect(f.board.penUp).toBe(false);expect(f.board.pulse).toBe(15700);expect(f.feeder.settledHeight).toBe(60);
  expect(f.board.commands.some(c=>c.startsWith('S2,'))).toBe(false);expect(f.board.position).toEqual({m1:0,m2:0});noMotion(f.board.commands);
 });
 it('validates an unknown Down before performing its initialization prelude',async()=>{
  for(const [target,minimum]of [[101,0],[60,-1],[60,65536]]){const f=fixture();await expect(f.feeder.pen(target!,pen,profile,minimum!)).rejects.toThrow();expect(f.board.commands.filter(c=>/^(SP|S2|SC|SR),/.test(c))).toEqual([]);}
 });
 it('waits the unknown Up startup bound despite immediate SP2 acknowledgement',async()=>{
  const f=fixture();await f.feeder.pen(pen.up,pen,profile);
  expect(f.clock.now()).toBe(548);expect(f.board.servo.get(11)).toBe(1845);expect(f.board.pulse).toBe(21850);
  expect(f.feeder.settledHeight).toBe(30);noMotion(f.board.commands);
 });
 it('rearms an exact temporary manual pulse even after configured endpoints change',async()=>{
  const f=fixture();await f.feeder.pen(73,pen,profile);
  const pulse=servoPulse(73,profile);expect(f.board.pulse).toBe(pulse);
  await f.feeder.configure({...pen,down:59},profile);const start=f.board.commands.length;
  await f.feeder.holdServo();await f.feeder.releaseServo(1000);
  expect(f.board.commands.slice(start).filter(c=>c.startsWith('SP,'))).toEqual(['SP,0,1,1','SP,0,1,1']);
  expect(f.board.commands.slice(start)).toContain(`SC,5,${pulse}`);expect(f.board.pulse).toBe(pulse);
  await f.feeder.pen(pen.down,pen,profile);expect(f.board.pulse).toBe(15700);expect(f.board.servo.get(5)).toBe(15700);
  await f.feeder.relaxServo(pen,profile);expect(f.board.commands.at(-1)).toBe('SR,60000,0');
  expect(f.board.commands.some(c=>c.startsWith('S2,'))).toBe(false);expect(f.board.position).toEqual({m1:0,m2:0});noMotion(f.board.commands);
 });
 it('does not hide stale Down calibration or an invalidated pose',async()=>{
  const f=fixture();await f.feeder.pen(pen.up,pen,profile);f.board.servo.set(5,21850);
  await expect(f.feeder.pen(pen.down,pen,profile)).rejects.toThrow(/pen state/);expect(f.feeder.settledHeight).toBeNull();
  const start=f.board.commands.length;await f.feeder.pen(pen.down,pen,profile);
  expect(f.board.commands.slice(start)).toContain('SP,2,0,1');expect(f.board.pulse).toBe(15700);
 });
 it.each(['standard','dynamic'] as const)('keeps complete %s node execution free of S2 on the affected profile',async motionStrategy=>{
  const f=fixture(),session=new PlotterSession(f.transport,f.clock,profile);
  const options:PlotOptions={profile,pen,speed:35,travelSpeed:80,acceleration:200,travelAcceleration:400,cornering:.127,maxPenDownMm:2,returnToOrigin:true,drawingMode:'profiled',backend:'t3',firmware:'3.1.7',motionStrategy};
  await session.connect();await session.setPen(pen.down);await session.setPen(pen.up);
  noMotion(f.board.commands);
  const plan=compileJob([{tool:'black',points:[{x:2,y:2},{x:8,y:2},{x:8,y:5}]}],options);
  expect(await session.run(plan)).toBe('finished');expect(f.board.position).toEqual({m1:0,m2:0});expect(f.board.penUp).toBe(true);
  expect(f.board.commands.some(c=>c.startsWith('S2,'))).toBe(false);await session.disconnect();
 });
 it.each([{...profile,servoChannels:1},machineProfile('nextdraw-8511')])('retains the established initialization outside the qualified profile',async other=>{
  const clock=new VirtualClock(),board=new VirtualEbb(clock,{firmware:'3.1.7'}),protocol=new EbbProtocol(board.createTransport(),clock),feeder=new Feeder(protocol,clock,firmwareFromReply('EBB Firmware Version 3.1.7'));
  await feeder.pen(pen.up,pen,other);expect(board.commands).toContain('S2,0,4');expect(board.commands).toContain('S2,0,5');expect(board.commands).not.toContain('SP,2,0,1');
 });
});
