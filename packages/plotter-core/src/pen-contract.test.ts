import {describe,it,expect} from 'vitest';
import {defaultPen,planPenTransition,servoPulse,servoRate,validateServoProfile} from './pen.js';
import {machineProfile} from './profiles.js';
import {compileJob,validatePlan} from './compiler.js';
import {preparePaths,validatePreparedJob} from './prepared-job.js';
import {Feeder} from './feeder.js';
import {firmwareFromReply,type EbbProtocol} from './protocol.js';
import {VirtualClock} from './virtual/index.js';
import type {MachineProfile,PlotOptions} from './types.js';
const standard=machineProfile('xylodraw',0),brushless=machineProfile('nextdraw-8511');
describe('pulse refresh contract',()=>{
 it('bounds independent discrete PWM phases and target-pulse endings for rounded rates',()=>{
  for(const profile of [standard,machineProfile('nextdraw-8511',90,8,'standard'),brushless])for(const rate of [1,10,50,75,100])for(const from of [0,33.333,100])for(const target of [0,.01,50,100]){
   const pen={...defaultPen,lowerRate:rate},pulse=servoPulse(from,profile),transition=planPenTransition(pulse,target,false,pen,profile);
   for(const phase of [0,.001,transition.refreshMs/2,transition.refreshMs-1e-7]){
    const completion=pwmCompletion(pulse,transition.targetPulse,transition.rate,transition.refreshMs,phase);
    expect(completion).toBeLessThanOrEqual(transition.electricalMs+1e-7);
   }
   expect(transition.durationMs).toBe(transition.electricalMs+profile.servoSettleDownMs);
  }
 });
 it('distinguishes rate zero, unchanged energized pulses, and disabled initialization',()=>{
  const profile={...standard,servoRateScale:0},pen={...defaultPen,upDelayMs:0};
  const rateZero=planPenTransition(servoPulse(0,profile),100,true,pen,profile),same=planPenTransition(servoPulse(50,profile),50,true,pen,profile),disabled=planPenTransition(null,50,true,pen,profile);
  expect(rateZero.rate).toBe(0);expect(rateZero.electricalMs).toBe(48);expect(same.electricalMs).toBe(0);expect(same.startupMs).toBe(0);
  expect(disabled.initialize).toBe(true);expect(disabled.electricalMs).toBe(48);expect(disabled.startupMs).toBe(250);
  for(const phase of [0,12,23.999])expect(pwmCompletion(null,disabled.targetPulse,0,24,phase)).toBeLessThanOrEqual(disabled.electricalMs);
 });
 it('preserves effective rounded rates independently of extra/reload dwell',()=>{
  for(const rate of [1,12,50,75,100]){expect(servoRate(rate,standard)).toBe(Math.round(24.6*rate));expect(servoRate(rate,brushless)).toBe(Math.round(3.085714285714286*rate));}
  const from=servoPulse(30,standard),base=planPenTransition(from,52,false,defaultPen,standard),extra=planPenTransition(from,52,false,{...defaultPen,downDelayMs:700,reloadWaitMs:900},standard,true);
  expect(extra.rate).toBe(base.rate);expect(extra.electricalMs).toBe(base.electricalMs);expect(extra.durationMs-base.durationMs).toBe(1600);
 });
 it('rejects clipped pulses, invalid slots, signed-delta overflow and queue overflow',()=>{
  for(const profile of [{...standard,servoPeriod:7},{...standard,servoPeriod:1},{...standard,servoMax:36001},{...standard,servoMin:1,servoMax:36000}])expect(()=>validateServoProfile(profile)).toThrow();
  expect(()=>planPenTransition(65535,0,true,defaultPen,standard)).toThrow(/known servo pulse/);
  expect(()=>planPenTransition(servoPulse(0,standard),100,true,{...defaultPen,raiseRate:1},{...standard,servoRateScale:1/100})).not.toThrow(); // rounded zero explicitly supported
  expect(()=>planPenTransition(servoPulse(0,standard),100,true,{...defaultPen,raiseRate:1},{...standard,servoRateScale:1})).toThrow(/queue duration/);
 });
 it('rejects missing/old direct plan identities and old prepared identities',()=>{
  const options:PlotOptions={profile:standard,pen:defaultPen,speed:35,travelSpeed:60,acceleration:200,travelAcceleration:300,cornering:.127,maxPenDownMm:0,returnToOrigin:false,drawingMode:'profiled'},paths=[{tool:'black',points:[{x:0,y:0},{x:1,y:0}]}];
  const plan=compileJob(paths,options);for(const key of ['planningModel','timingModel'] as const){const stale={...plan,[key]:undefined};expect(()=>validatePlan(stale as unknown as typeof plan)).toThrow(/model/);}
  expect(()=>validatePreparedJob({...preparePaths(paths,options),compiler:'native-v3'})).toThrow(/identity/);
 });
});
describe('shared feeder timing and output initialization',()=>{
 it('frees boot/default and previously owned channels before a one-slot brushless configuration',async()=>{
  const fixture=channelFixture();await fixture.feeder.pen(defaultPen.up,defaultPen,brushless);
  expect(fixture.slots[0]).toBe(5);expect(fixture.slots.filter(Boolean)).toEqual([5]);
  expect(fixture.commands.indexOf('S2,0,4')).toBeLessThan(fixture.commands.indexOf('SC,8,1'));
  await fixture.feeder.pen(defaultPen.up,defaultPen,standard);await fixture.feeder.pen(defaultPen.up,defaultPen,brushless);
  expect(fixture.slots[0]).toBe(5);expect(fixture.slots.filter(Boolean)).toEqual([5]);
 });
 it('adds reload to a longer runtime startup bound and reports the extension once',async()=>{
  const fixture=channelFixture(),pen={...defaultPen,reloadWaitMs:1000};await fixture.feeder.pen(pen.down,pen,standard);
  const prepared=planPenTransition(servoPulse(pen.down,standard),pen.up,true,pen,standard,true).durationMs;
  fixture.feeder.invalidatePen();const start=fixture.clock.now();await fixture.feeder.pen(pen.up,pen,standard,prepared,true,true);
  const expected=planPenTransition(null,pen.up,true,pen,standard,true,prepared).durationMs;
  expect(fixture.clock.now()-start).toBe(expected);expect(fixture.commands).toContain('SP,2,0,1');
  expect(fixture.extensions.at(-1)).toEqual({minimumMs:prepared,durationMs:expected,extensionMs:expected-prepared});
 });
 it('invalidates after manual power timeout and holds power through short-timeout transitions',async()=>{
  const fixture=channelFixture(),pen={...defaultPen,servoTimeoutMs:1};await fixture.feeder.pen(pen.up,pen,standard);
  const command=fixture.commands.findIndex(c=>c.startsWith('SP,')),duration=planPenTransition(null,pen.up,true,pen,standard).durationMs;expect(fixture.commands.indexOf(`SR,${duration+24},1`)).toBeLessThan(command);
  expect(fixture.powered()).toBe(true);fixture.clock.advance(25);expect(fixture.powered()).toBe(false);
  fixture.clock.advance(70000);const start=fixture.commands.length;await fixture.feeder.pen(pen.up,pen,standard);
  expect(fixture.commands.slice(start)).toContain('SP,2,0,1');expect(fixture.commands.slice(start)).toContain('SC,11,0');
 });
 it('rearms the live timer for both finite-to-held and held-to-finite transitions',async()=>{
  const fixture=channelFixture(),pen={...defaultPen,servoTimeoutMs:1000};await fixture.feeder.pen(pen.up,pen,standard);
  await fixture.feeder.holdServo();fixture.clock.advance(70000);expect(fixture.powered()).toBe(true);
  await fixture.feeder.releaseServo(1000);expect(fixture.commands.at(-2)?.startsWith('SP,')).toBe(true);
  fixture.clock.advance(1000);expect(fixture.powered()).toBe(false);
  expect(fixture.commands.filter(c=>c.startsWith('SP,'))).toHaveLength(3);
 });
 it('does not trust an expired pulse when held policy is requested',async()=>{
  const fixture=channelFixture(),pen={...defaultPen,servoTimeoutMs:1};await fixture.feeder.pen(pen.up,pen,standard);fixture.clock.advance(1000);
  const start=fixture.commands.length;await fixture.feeder.holdServo();expect(fixture.commands.length).toBe(start);
  await fixture.feeder.pen(pen.up,pen,standard);expect(fixture.commands.slice(start)).toContain('SP,2,0,1');expect(fixture.commands.slice(start)).toContain('SR,0,1');
  fixture.clock.advance(70000);expect(fixture.powered()).toBe(true);
 });
 it('holds an energized finite pulse across delayed SC setup before the final SP',async()=>{
  const fixture=channelFixture(),pen={...defaultPen,servoTimeoutMs:1};await fixture.feeder.pen(pen.up,pen,standard);
  fixture.delays.sc=10;const start=fixture.commands.length;await fixture.feeder.pen(pen.up,{...pen,raiseRate:76},standard);
  const commands=fixture.commands.slice(start),rearm=commands.findIndex(c=>/^SP,1,1,1$/.test(c));
  expect(rearm).toBeGreaterThanOrEqual(0);expect(rearm).toBeLessThan(commands.findIndex(c=>c.startsWith('SC,')));
  expect(fixture.powerGaps).toHaveLength(0);expect(commands).toContain('SP,1,250,1');
 });
 it.each(['sr','sp'] as const)('reinitializes when delayed %s rearming crosses the old expiry',async delayed=>{
  const fixture=channelFixture(),pen={...defaultPen,servoTimeoutMs:1};await fixture.feeder.pen(pen.up,pen,standard);
  fixture.delays[delayed]=30;const start=fixture.commands.length;await fixture.feeder.pen(pen.up,pen,standard);
  const commands=fixture.commands.slice(start);expect(fixture.powerGaps.length).toBeGreaterThan(0);
  expect(commands).toContain('SP,2,0,1');expect(commands).toContain('SC,11,0');
 });
 it('retains reliable pulse state but invalidates calibration and pin changes',async()=>{
  const fixture=channelFixture();await fixture.feeder.pen(defaultPen.up,defaultPen,standard);const start=fixture.commands.length;
  await fixture.feeder.pen(defaultPen.up,defaultPen,standard);expect(fixture.commands.slice(start).some(c=>c.startsWith('S2,0,'))).toBe(false);
  const changed={...standard,servoMax:7600},next=fixture.commands.length;await fixture.feeder.pen(defaultPen.up,defaultPen,changed);expect(fixture.commands.slice(next)).toContain('SP,2,0,1');
 });
});
// A discrete refresh model independent of production timing. Updates precede
// each pulse; a pulse's duration is its timer count / 12000 milliseconds.
function pwmCompletion(from:number|null,target:number,rate:number,period:number,phase:number):number {
 if(from===target)return 0;
 let pulse=from??target,time=phase;
 for(let n=0;n<40000;n++,time+=period){pulse=from===null||rate===0?target:pulse+Math.sign(target-pulse)*Math.min(rate,Math.abs(target-pulse));if(pulse===target)return time+target/12000;}
 throw new Error('PWM fixture exceeded bound');
}
// First-free-slot allocator: unlike VirtualEbb, this distinguishes RP ownership
// from the selected SC8 slot count and fails if a new pin cannot be emitted.
function channelFixture(){
 const delays={sc:0,sr:0,s2:0,sp:0},powerGaps:number[]=[];
 const clock=new VirtualClock(),commands:string[]=[],slots:Array<number|null>=[4,null,null,null,null,null,null,null],values=new Map<number,number>(),extensions:Array<{minimumMs:number;durationMs:number;extensionMs:number}>=[];
 let count=8,pulse=0,reloadMs=60000,powerUntil=0,revision=0;
 const energized=()=>powerUntil===Infinity||clock.now()<powerUntil;
 const protocol={healthy:true,get configurationRevision(){return revision;},settled:()=>{},request:async(command:string)=>{commands.push(command);const [name,...parts]=command.split(','),v=parts.map(Number);
  if(['SC','SR','SP','S2'].includes(name!))revision++;
  const delay=name==='SC'?delays.sc:name==='SR'?delays.sr:name==='S2'?delays.s2:name==='SP'?delays.sp:0;
  if(delay){const before=energized();clock.advance(delay);if(before&&!energized())powerGaps.push(clock.now());}
  if(name==='QG')return pulse===values.get(4)?'10':'00';
  if(name==='SR'){reloadMs=v[0]!;if(v[1]===0)powerUntil=0;}
  if(name==='S2'){if(v[0]===0){for(let i=0;i<slots.length;i++)if(slots[i]===v[1])slots[i]=null;}else{if(slots.indexOf(v[1]!)>=count)throw new Error('servo channel not emitted');pulse=v[0]!;if(v[1]===4)powerUntil=reloadMs===0?Infinity:clock.now()+reloadMs;}}
  if(name==='SC'){values.set(v[0]!,v[1]!);if(v[0]===8)count=v[1]!;}
  if(name==='SP'){const pin=v[2]!+3;let index=slots.indexOf(pin);if(index<0){index=slots.indexOf(null);slots[index]=pin;}if(index<0||index>=count)throw new Error('servo channel not emitted');pulse=values.get(v[0]===0?5:4)!;if(pin===4)powerUntil=reloadMs===0?Infinity:clock.now()+reloadMs;}
  return'OK';
 }} as unknown as EbbProtocol;
 return{clock,commands,slots,extensions,delays,powerGaps,powered:energized,feeder:new Feeder(protocol,clock,firmwareFromReply('EBB Firmware Version 3.1.7'),undefined,t=>extensions.push(t))};
}
