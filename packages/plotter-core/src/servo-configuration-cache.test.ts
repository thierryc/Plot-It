import {describe,expect,it} from 'vitest';
import {Feeder} from './feeder.js';
import {defaultPen,planPenTransition,servoCommands,servoPulse} from './pen.js';
import {machineProfile} from './profiles.js';
import {ascii,EbbProtocol,firmwareFromReply,text} from './protocol.js';
import {VirtualClock,VirtualEbb} from './virtual/index.js';
import type {ByteTransport,MachineProfile,PenSettings} from './types.js';

const profile=machineProfile('xylodraw',0),pen={...defaultPen,up:30,down:52};
function fixture(firmware:'2.8.1'|'3.0.2'|'3.1.0'|'3.1.6'|'3.1.7'='3.1.7',wrap?:(transport:ByteTransport)=>ByteTransport){
 const clock=new VirtualClock(),board=new VirtualEbb(clock,{firmware,fragmentBytes:1}),transport=board.createTransport();
 const protocol=new EbbProtocol(wrap?wrap(transport):transport,clock);
 return{clock,board,protocol,feeder:new Feeder(protocol,clock,firmwareFromReply(`EBB Firmware Version ${firmware}`))};
}
const initializedSetup=(settings:PenSettings,p:MachineProfile=profile)=>[...servoCommands(settings,p),'SC,11,0',`SC,11,${Math.round(settings.raiseRate*p.servoRateScale)}`];
const setup=(commands:readonly string[])=>commands.filter(c=>/^SC,(4|5|8|9|11|12),/.test(c));

describe('acknowledged modern servo configuration',()=>{
 it.each(['3.0.2','3.1.0','3.1.6','3.1.7'] as const)('reuses only unchanged acknowledged settings on %s',async firmware=>{
  const {feeder,board}=fixture(firmware);
  await feeder.configure(pen,profile);const start=board.commands.length;
  await feeder.configure({...pen},structuredClone(profile));
  expect(setup(board.commands.slice(start))).toEqual([]);
  expect(setup(board.commands)).toEqual(servoCommands(pen,profile));
 });
 it('retains the legacy setup path',async()=>{
  const {feeder,board}=fixture('2.8.1');await feeder.configure(pen,profile);await feeder.configure(pen,profile);
  expect(setup(board.commands)).toEqual([...servoCommands(pen,profile),...servoCommands(pen,profile)]);
 });
 it.each([['up',31,4],['down',53,5],['raiseRate',76,11],['lowerRate',51,12]] as const)('writes a changed %s while retaining other confirmed registers',async(key,value,register)=>{
  const {feeder,board}=fixture();await feeder.configure(pen,profile);const start=board.commands.length;
  const changed={...pen,[key]:value};await feeder.configure(changed,profile);
  expect(setup(board.commands.slice(start))).toEqual(servoCommands(changed,profile).filter(c=>c.startsWith(`SC,${register},`)));
 });
 it('compares rounded wire values and restores temporary manual Down',async()=>{
  const {feeder,board}=fixture();await feeder.configure(pen,profile);let start=board.commands.length;
  await feeder.configure({...pen,up:pen.up+.000001},profile);
  expect(setup(board.commands.slice(start))).toEqual([]);
  await feeder.configure(pen,profile,70);start=board.commands.length;
  await feeder.configure(pen,profile);
  expect(setup(board.commands.slice(start))).toEqual([`SC,5,${servoPulse(pen.down,profile)}`]);
 });
 it.each([
  ['channel',{...profile,servoChannels:1}],['period',{...profile,servoPeriod:4}],
  ['calibration',{...profile,servoMax:7600}],['brushless',machineProfile('nextdraw-8511',0)],
 ] as const)('reapplies the full setup after a %s identity change',async(_,next)=>{
  const {feeder,board}=fixture();await feeder.configure(pen,profile);const start=board.commands.length;
  await feeder.configure(pen,next as MachineProfile);
  expect(setup(board.commands.slice(start))).toEqual(servoCommands(pen,next as MachineProfile));
 });
 it.each(['SP,3','SC,5,21850','SR,1000,0','ES,0'])('invalidates after an out-of-band %s',async command=>{
  const {feeder,board,protocol}=fixture();await feeder.configure(pen,profile);await protocol.request(command);const start=board.commands.length;
  await feeder.configure(pen,profile);
  expect(setup(board.commands.slice(start))).toEqual(servoCommands(pen,profile));
 });
 it('does not turn a pending write into an acknowledged cache hit',async()=>{
  let unblock!:()=>void,entered!:()=>void;
  const gate=new Promise<void>(resolve=>{unblock=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});let blocked=false;
  const {feeder,board}=fixture('3.1.7',bytes=>({...bytes,write:async data=>{
   if(!blocked&&text(data).startsWith('SC,4,')){blocked=true;entered();await gate;}await bytes.write(data);
  }}));
  const first=feeder.configure(pen,profile);await started;
  const second=feeder.configure(pen,profile),results=Promise.allSettled([first,second]);unblock();
  expect((await results).some(result=>result.status==='rejected')).toBe(true);
  expect(board.commands.filter(c=>c===`SC,4,${servoPulse(pen.up,profile)}`)).toHaveLength(2);
 });
 it('does not let an owned late ACK hide an interleaved raw write',async()=>{
  let unblock!:()=>void,entered!:()=>void;
  const gate=new Promise<void>(resolve=>{unblock=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});let blocked=false;
  const {feeder,board,protocol}=fixture('3.1.7',bytes=>({...bytes,write:async data=>{
   if(!blocked&&text(data).startsWith('SC,4,')){blocked=true;entered();await gate;}await bytes.write(data);
  }}));
  const configuring=feeder.configure(pen,profile);await started;
  const external=protocol.request('SC,5,21850'),outcome=expect(configuring).rejects.toThrow(/changed during/);
  unblock();await outcome;await external;
  const start=board.commands.length;await feeder.configure(pen,profile);
  expect(setup(board.commands.slice(start))).toEqual(servoCommands(pen,profile));
 });
 it('reapplies all settings after a partial acknowledged setup is rejected',async()=>{
  let reject=true;
  const {feeder,board}=fixture('3.1.7',bytes=>({...bytes,write:async data=>{
   if(reject&&text(data).startsWith('SC,12,')){reject=false;await bytes.write(ascii('SC,999,1\r'));}else await bytes.write(data);
  }}));
  await expect(feeder.configure(pen,profile)).rejects.toThrow(/rejected/);
  const start=board.commands.length;await feeder.configure(pen,profile);
  expect(setup(board.commands.slice(start))).toEqual(servoCommands(pen,profile));
 });
 it.each(['malformed','disconnect'] as const)('refuses cached success after %s during a setting acknowledgement',async fault=>{
  let corrupt=false;
  const {feeder,protocol}=fixture('3.1.7',bytes=>({...bytes,write:async data=>{if(text(data).startsWith('SC,12,'))corrupt=true;await bytes.write(data);},read:async()=>{
   if(corrupt){corrupt=false;return fault==='disconnect'?null:ascii('unexpected\r');}return bytes.read();
  }}));
  await expect(feeder.configure(pen,profile)).rejects.toThrow();expect(protocol.healthy).toBe(false);
  await expect(feeder.configure(pen,profile)).rejects.toThrow(/reconnect/);
 });
 it('does not carry confirmed settings into a new connection',async()=>{
  const first=fixture();await first.feeder.configure(pen,profile);await first.protocol.close();
  const next=fixture();await next.feeder.configure(pen,profile);
  expect(setup(next.board.commands)).toEqual(servoCommands(pen,profile));
 });
 it('invalidates confirmed setup after a rejected non-setting exchange',async()=>{
  const {feeder,board,protocol}=fixture();await feeder.configure(pen,profile);
  await expect(protocol.request('UNKNOWN')).rejects.toThrow(/rejected/);
  const start=board.commands.length;await feeder.configure(pen,profile);
  expect(setup(board.commands.slice(start))).toEqual(servoCommands(pen,profile));
 });
 it.each(['position','power'] as const)('invalidates setup after a protocol-valid but out-of-range %s reply',async query=>{
  const {feeder,board}=fixture();await feeder.configure(pen,profile);
  if(query==='position')board.position.m1=2147483648;else board.supplyAdc=1024;
  await expect(feeder[query]()).rejects.toThrow(/Invalid/);
  board.position.m1=0;board.supplyAdc=300;
  const start=board.commands.length;await feeder.configure(pen,profile);
  expect(setup(board.commands.slice(start))).toEqual(servoCommands(pen,profile));
 });
});

describe('cache preserves pen timing and power operations',()=>{
 it.each([false,true])('preserves manual Up/Down after same-pulse rearming (future replies=%s)',async futureReplies=>{
  const clock=new VirtualClock(),board=new VirtualEbb(clock,{firmware:'3.1.7',futureReplies}),protocol=new EbbProtocol(board.createTransport(),clock),feeder=new Feeder(protocol,clock,firmwareFromReply('EBB Firmware Version 3.1.7'));
  const settings={...pen,down:60,upDelayMs:150,downDelayMs:0};
  await feeder.pen(settings.up,settings,profile);const start=board.commands.length;
  await feeder.pen(settings.down,settings,profile);
  expect(board.commands.slice(start)).toContain('SP,1,1,1');
  expect(board.commands.slice(start)).toContain('SP,0,244,1');
  expect(board.penUp).toBe(false);expect(board.pulse).toBe(15700);
  await feeder.purge(true);await feeder.pen(settings.up,settings,profile);await feeder.pen(settings.down,settings,profile);
  expect(board.penUp).toBe(false);expect(board.pulse).toBe(15700);
 });
 it('rejects a Down whose controller endpoint silently equals Up',async()=>{
  const {feeder,board}=fixture();await feeder.pen(pen.up,pen,profile);
  // Device-side corruption is invisible to the acknowledged host cache.
  board.servo.set(5,board.servo.get(4)!);
  await expect(feeder.pen(pen.down,pen,profile)).rejects.toThrow(/pen state differs/);
  expect(board.penUp).toBe(true);expect(feeder.settledHeight).toBeNull();
  await feeder.pen(pen.up,pen,profile);await feeder.pen(pen.down,pen,profile);
  expect(board.penUp).toBe(false);expect(board.pulse).toBe(servoPulse(pen.down,profile));
 });
 it('retains the rearm pulse snapshot when an ACK observer notices expiry during delayed SR',async()=>{
  const clock=new VirtualClock(),board=new VirtualEbb(clock,{firmware:'3.1.7',fragmentBytes:1}),bytes=board.createTransport();
  let feeder:Feeder,delay=false,expired=false;
  const protocol=new EbbProtocol({...bytes,write:async data=>{if(delay&&text(data).startsWith('SR,'))clock.advance(30);await bytes.write(data);}},clock,event=>{
   if(delay&&event.kind==='exchange'&&event.phase==='acknowledged'&&event.command?.startsWith('SR,'))expired ||= feeder.settledHeight===null;
  });
  feeder=new Feeder(protocol,clock,firmwareFromReply('EBB Firmware Version 3.1.7'));
  const settings={...pen,servoTimeoutMs:1};await feeder.pen(settings.up,settings,profile);delay=true;const start=board.commands.length;
  await feeder.pen(settings.up,settings,profile);
  const commands=board.commands.slice(start);expect(expired).toBe(true);expect(protocol.healthy).toBe(true);
  expect(commands).toContain('SP,1,1,1');expect(commands).toContain('SC,11,0');
  expect(commands).toContain('SP,2,0,1');
 });
 it('allows a read-only pose observer while owned mutations await their ACK',async()=>{
  const clock=new VirtualClock(),board=new VirtualEbb(clock,{firmware:'3.1.7',fragmentBytes:1});let feeder:Feeder;
  const observations:Array<number|null>=[];
  const protocol=new EbbProtocol(board.createTransport(),clock,event=>{if(event.kind==='exchange'&&event.phase==='requested')observations.push(feeder.settledHeight);});
  feeder=new Feeder(protocol,clock,firmwareFromReply('EBB Firmware Version 3.1.7'));
  await feeder.holdServo();await feeder.pen(pen.up,pen,profile);await feeder.pen(pen.down,pen,profile);
  expect(observations.length).toBeGreaterThan(0);expect(feeder.settledHeight).toBe(pen.down);
  expect(setup(board.commands)).toEqual(initializedSetup(pen));
 });
 it.each(Array.from({length:80},(_,i)=>i))('rejects or reinitializes an interleaved raw Down at microtask %i',async turns=>{
  const {feeder,board,protocol}=fixture(),settings={...pen,synchronizedB3:true};await feeder.holdServo();await feeder.pen(pen.up,settings,profile);
  const start=board.commands.length,operation=feeder.pen(pen.up,settings,profile),observed=Promise.allSettled([operation]);
  for(let i=0;i<turns;i++)await Promise.resolve();
  const raw='SP,0,500,1';await protocol.request(raw);
  const [result]=await observed,commands=board.commands.slice(start),down=commands.indexOf(raw),up=commands.findIndex(c=>/^SP,[12],/.test(c));
  if(result!.status==='fulfilled'&&up>down){
   expect(commands.slice(down+1,up)).toContain('SC,11,0');
   expect(commands[up]).toBe('SP,2,0,1');
  }
  const height=feeder.settledHeight;
  if(up>down&&result!.status==='fulfilled')expect(height).toBe(pen.up);else expect(height).toBe(null);
 });
 it('completes emergency Up and B3-off under a latched power fault without trusting pose or setup',async()=>{
  const {feeder,board}=fixture(),settings={...pen,synchronizedB3:true};
  await feeder.holdServo();await feeder.pen(pen.down,settings,profile);board.losePower();await feeder.status();
  await feeder.pen(pen.up,settings,profile,0,false,true,true);
  expect(board.commands.at(-1)).toBe('PO,B,3,0');expect(feeder.settledHeight).toBe(null);
  board.supplyAdc=300;feeder.clearFaults();const start=board.commands.length;
  await feeder.pen(pen.up,settings,profile);
  expect(setup(board.commands.slice(start))).toEqual(initializedSetup(settings));
  expect(board.commands.slice(start)).toContain('SP,2,0,1');
 });
 it.each(['SP,0,500,1','S2,16000,4,0,1'])('invalidates pose before choosing dwell after raw %s',async command=>{
  const {feeder,board,protocol}=fixture();await feeder.holdServo();await feeder.pen(pen.up,pen,profile);
  await protocol.request(command);const start=board.commands.length;
  await feeder.pen(pen.up,pen,profile);
  expect(board.commands.slice(start)).toContain('SP,2,0,1');
  expect(board.commands.slice(start)).toContain('SC,11,0');
 });
 it('keeps every SP target/duration and caches held-power policy only while power is known',async()=>{
  const {feeder,board}=fixture();await feeder.holdServo();
  await feeder.pen(pen.up,pen,profile);await feeder.pen(pen.down,pen,profile);await feeder.pen(pen.up,pen,profile,0,true);
  const durations=[planPenTransition(null,pen.up,true,pen,profile),planPenTransition(servoPulse(pen.up,profile),pen.down,false,pen,profile),planPenTransition(servoPulse(pen.down,profile),pen.up,true,pen,profile,true)].map(t=>t.durationMs);
  expect(board.commands.filter(c=>c.startsWith('SP,'))).toEqual(durations.map((d,i)=>i===0?'SP,2,0,1':`SP,${i===1?0:1},${d},1`));
  expect(board.commands.filter(c=>c.startsWith('SR,'))).toEqual(['SR,0,1']);
  expect(setup(board.commands)).toEqual(initializedSetup(pen));
  feeder.invalidatePen();const start=board.commands.length;await feeder.pen(pen.up,pen,profile);
  expect(board.commands.slice(start)).toContain('SR,0,1');
  expect(board.commands.slice(start)).toContain('SP,2,0,1');
 });
 it('uses same-target SP live-timer rearming on cache hits',async()=>{
  const {feeder,board}=fixture();const finite={...pen,servoTimeoutMs:1000};
  await feeder.pen(pen.up,finite,profile);const start=board.commands.length;
  await feeder.holdServo();await feeder.holdServo();await feeder.releaseServo(1000);
  const commands=board.commands.slice(start);
  expect(commands.filter(c=>c.startsWith('SP,'))).toEqual(Array(3).fill('SP,1,1,1'));
  expect(commands.filter(c=>c.startsWith('SR,'))).toEqual(['SR,0,1','SR,0,1','SR,1000,1']);
  expect(commands.some(c=>c.startsWith('S2,'))).toBe(false);
 });
 it.each(['status','supply'] as const)('reinitializes and rewrites setup after a %s power fault',async via=>{
  const {feeder,board}=fixture();await feeder.holdServo();await feeder.pen(pen.up,pen,profile);board.losePower();
  if(via==='status')await feeder.status();else{await feeder.power();await feeder.status();}
  board.supplyAdc=300;feeder.clearFaults();const start=board.commands.length;
  await feeder.pen(pen.up,pen,profile,0,false,undefined,true);
  expect(setup(board.commands.slice(start))).toEqual(initializedSetup(pen));
  expect(board.commands.slice(start)).toContain('SP,2,0,1');
  expect(board.commands.slice(start)).toContain('SR,0,1');
 });
 it('preserves synchronized B3 writes and does not add SR for brushless',async()=>{
  const {feeder,board}=fixture(),p=machineProfile('nextdraw-8511',0),settings:PenSettings={...pen,synchronizedB3:true};
  await feeder.pen(settings.up,settings,p);await feeder.pen(settings.down,settings,p);
  expect(board.commands.filter(c=>c.startsWith('SR,'))).toEqual([]);
  expect(board.commands.filter(c=>c.startsWith('PO,'))).toEqual(['PO,B,3,0','PO,B,3,1']);
  expect(setup(board.commands)).toEqual(servoCommands(settings,p));
 });
});
