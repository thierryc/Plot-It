import { afterEach, describe, expect, it, vi } from 'vitest';
import { Plotter } from './plotter';
import { PlotterCore } from './plotter-core';
import { buildMotionPlan, compileMotion } from './motion-plan';
import { servoPosition } from './pen-control';
import { initialState } from './model';
const settings={...initialState.settings,returnToOrigin:false};
function mockEBB(version='2.6.2', onCommand?: (command: string) => void | Promise<void>, positionReply: string | string[] = '0,0\r\nOK', replyFor?: (command: string) => string | undefined) {
  const commands:string[]=[]; let input:ReadableStreamDefaultController<Uint8Array>;
  const port={readable:new ReadableStream<Uint8Array>({start(c){input=c;}}),writable:new WritableStream<Uint8Array>({async write(data){
    const command=new TextDecoder().decode(data).trim();commands.push(command); await onCommand?.(command);
    const reply=replyFor?.(command) ?? (command==='V'?`EBB Firmware Version ${version}`:command==='QS'?positionReply:command==='QG'?'00':command==='QM'?'QM,0,0,0,0':command==='ES,1'?'1\r\nOK':'OK');
    for (const chunk of Array.isArray(reply) ? reply : [reply+'\r\n']) input.enqueue(new TextEncoder().encode(chunk));
  }}),open:vi.fn(async()=>{}),close:vi.fn(async()=>{}),getInfo:()=>({usbVendorId:0x04d8,usbProductId:0xfd92})};
  vi.stubGlobal('navigator',{serial:{requestPort:vi.fn(async()=>port)}});
  return commands;
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe('EBB transport and machine controls',()=>{
  it.each([['2.8.1',false],['2.8.1',true],['2.4.6',false],['2.4.6',true]] as const)('waits for a 21-second queued straight move before lifting the pen (%s, precompile=%s)',async(version,precompile)=>{
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout','performance']});
    const plan=buildMotionPlan([{points:[{x:0,y:0},{x:0,y:210}],tool:'#000000'}],{...settings,speed:10,drawAcceleration:75});
    const moves=plan.events.filter(event=>event.kind==='xy');
    let busyUntil=0,index=0;
    const commands=mockEBB(version,command=>{
      if(command.startsWith('LM,'))busyUntil=Math.max(busyUntil,performance.now())+moves[index++]!.duration*1000;
      if(command.startsWith('XM,'))busyUntil=Math.max(busyUntil,performance.now())+Number(command.split(',')[1]);
      if(command.startsWith('S2,17750,')&&busyUntil>performance.now())throw new Error('Pen lifted during queued motion');
      if(command==='ES,1')busyUntil=0;
    },undefined,command=>command==='QG'?(busyUntil>performance.now()?'01':'00'):command==='QM'?(busyUntil>performance.now()?'QM,1,0,0,1':'QM,0,0,0,0'):undefined);
    const p=new PlotterCore({supported:true,requestPort:()=>navigator.serial!.requestPort()},{precompile});await p.connect();
    const assertion=expect(p.plot(plan)).resolves.toBeUndefined();
    await Promise.all([assertion,vi.advanceTimersByTimeAsync(45000)]);
    expect(commands).not.toContain('ES,1');expect(p.progress.state).toBe('finished');expect(p.motorsOn).toBe(false);
    await p.disconnect();
  });
  it('bounds idle waiting when a queued long move never settles',async()=>{
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout','performance']});
    const plan=buildMotionPlan([{points:[{x:0,y:0},{x:0,y:210}],tool:'#000000'}],{...settings,speed:10,drawAcceleration:75});
    let stuck=false,stopTime=0;
    mockEBB('2.8.1',command=>{
      if(command.startsWith('LM,'))stuck=true;
      if(command==='ES,1'){stuck=false;stopTime=performance.now();}
    },undefined,command=>command==='QG'?(stuck?'01':'00'):undefined);
    const p=new Plotter();await p.connect();
    const assertion=expect(p.plot(plan)).rejects.toThrow('did not become idle');
    await Promise.all([assertion,vi.advanceTimersByTimeAsync(45000)]);
    expect(stopTime).toBeGreaterThan(30000);expect(stopTime).toBeLessThan(33000);
    expect(p.originStatus).toBe('unset');expect(p.motorsOn).toBe(false);await p.disconnect();
  });
  it.each(['2.8.1','2.4.6'])('settles queued servo transitions before every travel and drawing section (%s)',async version=>{
    const calibrated={...settings,penUp:50,penDown:65,returnToOrigin:true};
    const plan=buildMotionPlan([
      {points:[{x:10,y:10},{x:20,y:10},{x:20,y:20},{x:10,y:10}],tool:'#000000'},
      {points:[{x:35,y:25},{x:50,y:25}],tool:'#000000'},
      {points:[{x:60,y:30},{x:70,y:40}],tool:'#171714'}
    ],calibrated);
    let cursor={x:0,y:0};
    const expected=plan.events.flatMap(event=>{
      if(event.kind!=='xy')return [];
      const moves=compileMotion(event,calibrated,cursor,version==='2.8.1');
      if(moves.length)cursor=moves.at(-1)!.targetSteps;
      return moves.map(move=>({command:move.command,down:event.penDown}));
    });
    let pending:number|null=null,settled:number|null=null,busyPolls=0,index=0;
    mockEBB(version,command=>{
      if(command.startsWith('S2,')){pending=Number(command.split(',')[1]);busyPolls=1;}
      if(/^(LM|XM),/.test(command)){
        expect(pending).toBeNull();
        expect(command).toBe(expected[index]!.command);
        expect(settled).toBe(servoPosition(expected[index]!.down?65:50));
        index++;
      }
    },'0,0\r\nOK',command=>{
      if(command!=='QG'&&command!=='QM')return undefined;
      // S2's OK means accepted, not physically finished. The first idle poll
      // still reports motion; only the next poll completes the servo delay.
      if(busyPolls-->0)return command==='QG'?'01':'QM,1,0,0,1';
      if(pending!==null){settled=pending;pending=null;}
      return command==='QG'?'00':'QM,0,0,0,0';
    });
    const p=new Plotter();await p.connect();
    p.onProgress=progress=>{if(progress.state==='tool-change')queueMicrotask(()=>p.resume());};
    await p.plot(plan);
    expect(index).toBe(expected.length);expect(settled).toBe(servoPosition(50));
    expect(expected.some(move=>!move.down)).toBe(true);
    await p.disconnect();
  });
  it.each([false,true])('reads split QS line endings without stalling (stop=%s)',async(stop)=>{
    const commands=mockEBB('2.8.1',undefined,['5180,774\n','\rOK\r\n']);
    const p=new Plotter(); await p.connect(); await p.setOrigin();
    const positions: unknown[]=[]; p.onPosition=position=>positions.push(position);
    const states:string[]=[];
    p.onProgress=progress=>{states.push(progress.state);if(stop&&progress.state==='plotting')p.stop();};
    await p.plot(buildMotionPlan([{points:[{x:10,y:10},{x:30,y:20}],tool:'#111'}],settings));
    expect(positions.length).toBeGreaterThan(0);
    expect(positions[0]).toEqual({x:55.075,y:-74.425});
    expect(states).toContain(stop?'stopped':'finished');
    if(stop)expect(commands.some(command=>command.startsWith('HM,'))).toBe(true);
    expect(p.active).toBe(false);
    await p.disconnect();
  });
  it('executes LM jobs, releases motors and invalidates the origin on completion',async()=>{
    const commands=mockEBB();const p=new Plotter();await p.connect();
    await expect(p.plot(buildMotionPlan([],settings))).rejects.toThrow('no paths');
    await p.setOrigin();await p.plot(buildMotionPlan([{points:[{x:10,y:10},{x:30,y:20}],tool:'#111'}],settings));
    expect(commands.some(c=>c.startsWith('LM,'))).toBe(true);
    expect(commands.at(-1)).toBe('EM,0,0'); expect(p.motorsOn).toBe(false); expect(p.originAvailable).toBe(false);
    await expect(p.returnToOrigin(settings)).rejects.toThrow('origin');
  });
  it('uses XM on older firmware and can return using tracked position',async()=>{
    const commands=mockEBB('2.4.6');const p=new Plotter();await p.connect();await p.setOrigin('xylodraw');
    p.onProgress = value => { if (value.state === 'plotting' && value.completed === value.total) p.stop(); };
    await p.plot(buildMotionPlan([{points:[{x:0,y:0},{x:10,y:5}],tool:'#111'}],{...settings,profile:'xylodraw'}));
    expect(commands.some(c=>c.startsWith('LM,'))).toBe(false);
    expect(commands.some(c=>c.endsWith(',250,-500'))).toBe(true);
    await p.setOrigin('xylodraw');
    await expect(p.returnToOrigin(settings)).rejects.toThrow('profile');
  });
  it('sets servo percentages and establishes origin with idle-guarded commands',async()=>{
    const commands=mockEBB();const p=new Plotter();await p.connect();await p.setPen(50);await p.setPen(60);await p.setOrigin();
    expect(commands).toContainEqual(expect.stringMatching(/^S2,17750,4,[1-9]\d*,\d+$/));expect(commands).toContainEqual(expect.stringMatching(/^S2,15700,4,[1-9]\d*,\d+$/));expect(commands).toContain('CS');
  });
  it('drains motion before pause and tool change, resumes and finishes',async()=>{
    const commands=mockEBB();const p=new Plotter();await p.connect();await p.setOrigin();let paused=false,changed=false;
    p.onProgress=progress=>{
      if(progress.state==='paused'){paused=true;expect(commands.at(-1)).toBe('QG');queueMicrotask(()=>p.resume());}
      if(progress.state==='tool-change'){changed=true;expect(commands.at(-1)).toBe('QG');queueMicrotask(()=>p.resume());}
      if(progress.state==='plotting'&&!paused)p.pause();
    };
    await p.plot(buildMotionPlan([{points:[{x:0,y:0},{x:10,y:0}],tool:'#111'},{points:[{x:20,y:0},{x:30,y:0}],tool:'#f00'}],settings));
    expect(paused).toBe(true);expect(changed).toBe(true);expect(p.active).toBe(false);
  });
  it('stops without homing and lifts the pen after cancellation',async()=>{
    const commands=mockEBB();const p=new Plotter();await p.connect();await p.setOrigin();
    p.onProgress=v=>{if(v.state==='plotting')p.cancel();};
    await p.plot(buildMotionPlan([{points:[{x:10,y:0},{x:100,y:0}],tool:'#111'}],settings));
    const stop=commands.indexOf('ES,1');expect(stop).toBeGreaterThan(0);
    expect(commands.slice(stop)).not.toContain('HM,3200');expect(commands.slice(stop)).toContainEqual(expect.stringMatching(/^S2,17750,4,[1-9]\d*,\d+$/));expect(p.originAvailable).toBe(false);
  });
});

function connectionFixture(reply: string | null = 'EBB Firmware Version 2.6.2') {
  let input: ReadableStreamDefaultController<Uint8Array>;
  const commands: string[] = [];
  const port = {
    readable: new ReadableStream<Uint8Array>({ start(c) { input = c; } }),
    writable: new WritableStream<Uint8Array>({ write(data) {
      commands.push(new TextDecoder().decode(data));
      if (reply !== null) input.enqueue(new TextEncoder().encode(reply + "\r\n"));
    } }),
    open: vi.fn(async () => {}), close: vi.fn(async () => {}),
    getInfo: () => ({ usbVendorId: 0x04d8, usbProductId: 0xfd92 }),
  };
  const serial = { requestPort: vi.fn(async () => port), addEventListener: vi.fn() };
  vi.stubGlobal('navigator', { serial });
  return { port, serial, commands };
}

describe('connection recovery', () => {
  it('accepts the actual legacy EBB board identification', async () => {
    const { commands } = connectionFixture('EBBv13_and_above EB Firmware Version 2.8.1');
    const p = new Plotter();
    await expect(p.connect()).resolves.toContain('2.8.1');
    expect(p.connected).toBe(true); expect(commands).toEqual(['V\r']);
    await p.disconnect();
  });
  it('explains opening failures and permits retry', async () => {
    const { port, commands } = connectionFixture();
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
    port.open.mockRejectedValueOnce(new DOMException('Failed to open serial port', 'NetworkError'));
    const p = new Plotter();
    await expect(p.connect()).rejects.toThrow('Another app such as Saxi');
    expect(p.connected).toBe(false); expect(p.connecting).toBe(false);
    expect(port.close).not.toHaveBeenCalled(); expect(diagnostic).toHaveBeenCalled();
    await p.connect(); expect(p.connected).toBe(true); expect(commands).toEqual(['V\r']);
    await p.disconnect(); diagnostic.mockRestore();
  });
  it('preserves picker cancellation without opening the port', async () => {
    const { port, serial } = connectionFixture();
    const cancellation = new DOMException('No port selected', 'NotFoundError');
    serial.requestPort.mockRejectedValueOnce(cancellation);
    const p = new Plotter(); await expect(p.connect()).rejects.toBe(cancellation);
    expect(port.open).not.toHaveBeenCalled(); expect(p.connecting).toBe(false);
  });
  it('closes an opened port with missing streams', async () => {
    const { port } = connectionFixture();
    Object.assign(port, { readable: null });
    const p = new Plotter(); await expect(p.connect()).rejects.toThrow('did not open correctly');
    expect(port.close).toHaveBeenCalledOnce(); expect(p.connected).toBe(false);
  });
  it('cleans malformed firmware and retries with fresh streams', async () => {
    const bad = connectionFixture('unrelated device'); const p = new Plotter();
    await expect(p.connect()).rejects.toThrow('valid EBB firmware');
    expect(bad.port.close).toHaveBeenCalledOnce();
    expect(bad.port.readable.locked).toBe(false); expect(bad.port.writable.locked).toBe(false);
    connectionFixture(); await p.connect(); expect(p.connected).toBe(true); await p.disconnect();
  });
  it('times out a silent board and releases its pending read', async () => {
    vi.useFakeTimers(); const { port } = connectionFixture(null); const p = new Plotter();
    const failure = expect(p.connect()).rejects.toThrow('five seconds');
    await vi.advanceTimersByTimeAsync(5000); await failure;
    expect(p.connected).toBe(false); expect(p.connecting).toBe(false);
    expect(port.close).toHaveBeenCalledOnce();
    expect(port.readable.locked).toBe(false); expect(port.writable.locked).toBe(false);
  });
  it('guards duplicate connects until identification completes', async () => {
    const { serial, port } = connectionFixture(); const p = new Plotter();
    const first = p.connect(); expect(p.connecting).toBe(true); expect(p.connected).toBe(false);
    await expect(p.connect()).rejects.toThrow('already in progress'); await first;
    await p.connect(); expect(serial.requestPort).toHaveBeenCalledOnce();
    expect(port.open).toHaveBeenCalledWith({ baudRate: 9600 });
    expect(serial.requestPort).toHaveBeenCalledWith({ filters: [{ usbVendorId: 0x04d8, usbProductId: 0xfd92 }] });
    await p.disconnect(); expect(p.connected).toBe(false);
    expect(port.readable.locked).toBe(false); expect(port.writable.locked).toBe(false);
  });
  it('resets the connection on removal of the selected USB device', async () => {
    const { serial, port } = connectionFixture(); const p = new Plotter(); await p.connect();
    const listener = serial.addEventListener.mock.calls[0]![1] as unknown as (event: { target: unknown }) => void;
    listener({ target: {} }); expect(p.connected).toBe(true);
    listener({ target: port }); expect(p.connected).toBe(false); expect(p.originAvailable).toBe(false);
    await vi.waitFor(() => expect(port.close).toHaveBeenCalledOnce());
  });
});


describe('interactive plotting controls', () => {
  it.each([false,true])('restores the pen only for resumed drawing, and never after Stop (stop=%s)', async stop => {
    const commands = mockEBB(); const p = new Plotter(); await p.connect();
    const plan = buildMotionPlan([{points:[{x:0,y:0},{x:20,y:0}],tool:'#000000'}],settings);
    let requested = false, resumedAt = 0;
    p.onProgress = progress => {
      const next = plan.events[progress.completed];
      if (!requested && progress.state === 'plotting' && next?.kind === 'xy' && next.penDown) { requested = true; p.pause(); }
      if (progress.state === 'paused') {
        expect(commands.filter(c => c.startsWith('S2,')).at(-1)).toMatch(/^S2,17750,/);
        resumedAt = commands.length; if (stop) p.stop(); else p.resume();
      }
    };
    await p.plot(plan); expect(requested).toBe(true); expect(resumedAt).toBeGreaterThan(0);
    const tail = commands.slice(resumedAt);
    if (stop) { expect(tail.some(c => c.startsWith('S2,15700,'))).toBe(false); expect(tail.some(c => c.startsWith('LM,'))).toBe(false); }
    else {
      const down = tail.findIndex(c => c.startsWith('S2,15700,')), drawing = tail.findIndex(c => c.startsWith('LM,'));
      expect(down).toBeGreaterThanOrEqual(0); expect(drawing).toBeGreaterThan(down);
      expect(tail.slice(down + 1, drawing)).toContain('QG');
    }
  });
  it('does not lower again when Resume is immediately followed by the stroke lift', async () => {
    const commands = mockEBB(); const p = new Plotter(); await p.connect();
    const plan = buildMotionPlan([{points:[{x:10,y:10},{x:20,y:10}],tool:'#000000'}],settings);
    let requested = false, resumedAt = 0;
    p.onProgress = progress => {
      const next = plan.events[progress.completed];
      if (!requested && progress.state === 'plotting' && progress.completed > 1 && next?.kind === 'pen' && !next.penDown) { requested = true; p.pause(); }
      if (progress.state === 'paused') { resumedAt = commands.length; p.resume(); }
    };
    await p.plot(plan);
    expect(requested).toBe(true); expect(resumedAt).toBeGreaterThan(0);
    expect(commands.slice(resumedAt).filter(c => c.startsWith('S2,15700,'))).toEqual([]);
  });
  it('disconnects using the edited pen-up configuration after manual testing', async () => {
    const commands = mockEBB(); const p = new Plotter(); await p.connect();
    p.configurePen({...settings,penUp:30});
    await p.engageMotors(); await p.setPen(30); await p.setPen(60);
    const before = commands.length; await p.disconnect();
    const lifts = commands.slice(before).filter(c => c.startsWith('S2,'));
    expect(lifts).toHaveLength(1); expect(lifts[0]!.split(',')[1]).toBe('21850');
    expect(commands.slice(-2)).toEqual(['EM,0,0','QG']);
  });
  it('stops at a rest boundary, lifts the pen and returns to origin without resetting counters', async () => {
    const commands = mockEBB(); const p = new Plotter(); await p.connect(); await p.setOrigin();
    let beforeStop = 0;
    const states: string[] = [];
    p.onProgress = v => {
      states.push(v.state);
      if (v.state === 'plotting' && commands.some(c => c.startsWith('LM,')) && !beforeStop) {
        beforeStop = commands.length; p.stop();
      }
    };
    await p.plot(buildMotionPlan([{ points: [{x:10,y:0},{x:100,y:0}], tool:'#111' }], settings));
    const tail = commands.slice(beforeStop);
    const home = tail.findIndex(c => c.startsWith('HM,'));
    expect(home).toBeGreaterThan(0);
    expect(commands.slice(0, beforeStop + home).filter(c => c.startsWith('S2,')).at(-1)).toMatch(/^S2,17750,/);
    expect(tail).not.toContain('ES,1'); expect(tail).not.toContain('EM,2,2'); expect(tail.at(-1)).toBe('EM,0,0');
    expect(states).toContain('stopping'); expect(states).toContain('returning'); expect(states).toContain('stopped');
    expect(p.active).toBe(false); expect(p.originAvailable).toBe(false); expect(p.motorsOn).toBe(false);
  });
  it('allows pen changes only after pause settles and restores the job pen before resume', async () => {
    const commands = mockEBB(); const p = new Plotter(); await p.connect(); await p.setOrigin();
    let requested = false, adjusted = false; let adjustment: Promise<void> | undefined;
    p.onProgress = v => {
      if (v.state === 'plotting' && !requested) { requested = true; p.pause(); }
      if (v.state === 'pausing') expect(p.canAdjustPen).toBe(false);
      if (v.state === 'paused') {
        expect(p.canAdjustPen).toBe(true);
        expect(p.motorsOn).toBe(true); expect(commands).not.toContain('EM,0,0');
        adjustment = (async () => { await p.setPen(60); await p.setPen(70); adjusted = true; p.resume(); })();
      }
    };
    await p.plot(buildMotionPlan([{points:[{x:0,y:0},{x:10,y:0}],tool:'#111'}], settings));
    await adjustment;
    expect(adjusted).toBe(true);
    const manual = commands.findIndex(command => command.startsWith('S2,13650,'));
    expect(manual).toBeGreaterThan(0);
    expect(commands.slice(manual + 1)).toContainEqual(expect.stringMatching(/^S2,17750,4,[1-9]\d*,\d+$/));
    expect(p.originAvailable).toBe(false);
  });
  it('stops from pause after a pen command finishes and returns using tracked position on older firmware', async () => {
    const commands = mockEBB('2.4.6'); const p = new Plotter(); await p.connect(); await p.setOrigin('xylodraw');
    let requested = false; let operation: Promise<void> | undefined;
    p.onProgress = v => {
      if (v.state === 'plotting' && commands.some(c => c.startsWith('XM,')) && !requested) { requested = true; p.pause(); }
      if (v.state === 'paused') { operation = p.setPen(60); p.stop(); }
    };
    await p.plot(buildMotionPlan([{points:[{x:10,y:0},{x:20,y:0}],tool:'#111'}], {...settings,profile:'xylodraw'}));
    await operation;
    expect(commands).not.toContain('ES,1');
    expect(commands.some(c => c.startsWith('XM,') && /,0,-\d+$/.test(c))).toBe(true);
    expect(p.originAvailable).toBe(false);
  });
});

describe('pen state, servo timing and diagnostics', () => {
  it('pairs actual writes with board replies and distinguishes them from requests', async () => {
    mockEBB(); const p = new Plotter(); await p.connect(); await p.setPen(50);
    const written = p.diagnosticTrace.find(entry => entry.phase === 'written' && entry.command.startsWith('S2,'))!;
    const exchange = p.diagnosticTrace.filter(entry => entry.commandId === written.commandId);
    expect(exchange.map(entry => entry.phase)).toEqual(['requested','written','received','acknowledged']);
    expect(exchange[2]!.response).toBe('OK'); expect(written.commandId).not.toBeNull();
    expect(exchange.every(entry => entry.command === written.command)).toBe(true);
  });
  it('retains the latest complete job exchange after the small recent log rolls over', async () => {
    const commands = mockEBB(); const p = new Plotter(); await p.connect(); const before = commands.length;
    const plan = buildMotionPlan([{tool:'#000000',points:Array.from({length:220},(_,i) => ({x:10+i*.4,y:20+(i%2)*.4}))}],settings);
    await p.plot(plan);
    const job = p.diagnosticJobTrace!;
    expect(job.entries.length).toBeGreaterThan(500); expect(job.droppedEntries).toBe(0);
    expect(job.entries.filter(entry => entry.phase === 'written').map(entry => entry.command)).toEqual(commands.slice(before));
    expect(job.entries.filter(entry => entry.phase === 'written' && entry.command.startsWith('S2,')).every(entry => entry.elapsedMs! >= 0)).toBe(true);
    expect(job.settings).toEqual(plan.settings); expect(job.firmware).toBe('2.6.2');
    expect(job.plannedPenEvents.filter(event => event.penDown)).toHaveLength(1);
    job.settings.penDown = 100; job.entries.length = 0;
    expect(p.diagnosticJobTrace!.settings.penDown).toBe(60); expect(p.diagnosticJobTrace!.entries.length).toBeGreaterThan(500);
    await p.disconnect(); expect(p.diagnosticJobTrace!.entries.length).toBeGreaterThan(500);
  });
  it('records every received line of legacy position replies including the terminator', async () => {
    mockEBB('2.8.1',undefined,['5180,774\n','\rOK\r\n']);
    const p = new Plotter(); await p.connect(); p.onPosition = () => undefined;
    await p.plot(buildMotionPlan([{points:[{x:10,y:0},{x:20,y:0}],tool:'#000000'}],settings));
    const job = p.diagnosticJobTrace!, query = job.entries.find(entry => entry.phase === 'written' && entry.command === 'QS')!;
    expect(job.entries.filter(entry => entry.commandId === query.commandId && entry.phase === 'received').map(entry => entry.response)).toEqual(['5180,774','OK']);
  });
  it('records rejection text without claiming successful acknowledgement', async () => {
    mockEBB('2.8.1',undefined,undefined,command => command.startsWith('S2,') ? '!rejected height' : undefined);
    const p = new Plotter(); await p.connect(); await expect(p.setPen(50)).rejects.toThrow('rejected');
    const written = p.diagnosticTrace.find(entry => entry.phase === 'written' && entry.command.startsWith('S2,'))!;
    const exchange = p.diagnosticTrace.filter(entry => entry.commandId === written.commandId);
    expect(exchange.map(entry => entry.phase)).toEqual(['requested','written','received','failed']);
    expect(exchange[2]!.response).toBe('!rejected height'); expect(exchange[3]!.error).toContain('rejected height');
  });
  it('does not label a failed USB write as a written command', async () => {
    mockEBB('2.8.1',command => { if (command.startsWith('S2,')) throw new Error('USB transfer failed'); });
    const p = new Plotter(); await p.connect(); await expect(p.setPen(50)).rejects.toThrow('USB transfer failed');
    const requested = p.diagnosticTrace.find(entry => entry.phase === 'requested' && entry.command.startsWith('S2,'))!;
    const exchange = p.diagnosticTrace.filter(entry => entry.commandId === requested.commandId);
    expect(exchange.map(entry => entry.phase)).toEqual(['requested','failed']);
    expect(exchange.at(-1)!.error).toBe('USB transfer failed');
  });
  it('bounds long-job capture with an explicit truncation count and resets it for the next job', async () => {
    mockEBB(); const p = new Plotter(); await p.connect();
    const plan = buildMotionPlan([{points:[{x:10,y:0},{x:20,y:0}],tool:'#000000'}],settings);
    await p.plot(plan);
    for (let i = 0; i < 6000; i++) await p.firmwareVersion();
    const long = p.diagnosticJobTrace!;
    expect(long.entries.length).toBeLessThanOrEqual(20_000); expect(long.droppedEntries).toBeGreaterThan(0);
    expect(p.diagnosticPenTrace.some(entry => entry.command.startsWith('S2,15700,'))).toBe(true);
    const lastId = long.entries.at(-1)!.commandId!;
    await p.plot(plan); const next = p.diagnosticJobTrace!;
    expect(next.droppedEntries).toBe(0); expect(next.entries.length).toBeLessThan(500);
    expect(next.entries[0]!.commandId).toBeGreaterThan(lastId);
  });
  it('marks an observed pen movement without sending hardware commands', async () => {
    const commands = mockEBB(); const p = new Plotter(); await p.connect();
    await p.plot(buildMotionPlan([{points:[{x:10,y:0},{x:20,y:0}],tool:'#000000'}],settings));
    const before = commands.length; p.markPenMovement();
    expect(commands).toHaveLength(before);
    const marker = p.diagnosticJobTrace!.entries.at(-1)!;
    expect(marker.phase).toBe('marker'); expect(marker.commandId).toBeNull();
    expect(marker.note).toBe('Unexpected pen movement observed'); expect(marker.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(p.diagnosticPenTrace.at(-1)).toEqual(marker);
  });
  it('does not issue height changes inside an uninterrupted long stroke', async () => {
    const commands = mockEBB(); const p = new Plotter(); await p.connect();
    const plan = buildMotionPlan([{tool:'#000000',points:Array.from({length:220},(_,i) => ({x:10+i*.4,y:20+(i%2)*.4}))}],settings);
    const downEvent = plan.events.findIndex(event => event.kind === 'pen' && event.penDown);
    const upEvent = plan.events.findIndex((event,i) => i > downEvent && event.kind === 'pen' && !event.penDown);
    const cursor = new Map<number,number>();
    p.onProgress = progress => { if (progress.state === 'plotting') cursor.set(progress.completed,commands.length); };
    await p.plot(plan);
    const strokeCommands = commands.slice(cursor.get(downEvent+1)!,cursor.get(upEvent)!);
    expect(strokeCommands.filter(command => command.startsWith('LM,')).length).toBeGreaterThan(100);
    expect(strokeCommands.some(command => /^(S2|SC|SR|SP|TP),/.test(command))).toBe(false);
    expect(p.diagnosticTrace.some(entry => entry.command.startsWith('S2,15700,'))).toBe(false);
    const transitions = p.diagnosticPenTrace;
    expect(transitions.some(entry => entry.command.startsWith('S2,15700,') && entry.phase === 'acknowledged')).toBe(true);
    expect(transitions.length).toBeLessThanOrEqual(200);
    transitions[0]!.command = 'mutated'; expect(p.diagnosticPenTrace[0]!.command).not.toBe('mutated');
  });
  it.each([false,true])('does not replay a stored extreme during servo setup (remembered down=%s)', async rememberedDown => {
    // SC,1 immediately queues SP using the firmware's previous pen state.
    // Plain OK-only transport mocks miss this firmware-side movement.
    let up = 7500, down = 7500;
    const targets: number[] = [];
    mockEBB('2.8.1',command => {
      const values = command.split(',');
      if (values[0] === 'SC' && values[1] === '4') up = Number(values[2]);
      if (values[0] === 'SC' && values[1] === '5') down = Number(values[2]);
      if (command === 'SC,1,1') targets.push(rememberedDown ? down : up);
      if (values[0] === 'S2') targets.push(Number(values[1]));
    });
    const p = new Plotter(); await p.connect(); await p.setPen(50);
    expect(targets).toEqual([17750,17750]);
  });
  it('clears an existing power countdown before a long preflight pause', async () => {
    let reload = 60_000, counter = 0, paused = false, p: Plotter;
    mockEBB('2.8.1',command => {
      if (command.startsWith('SR,')) reload = Number(command.split(',')[1]);
      if (command.startsWith('S2,') || command === 'SC,1,1') counter = reload;
      if (command === 'CS') p.pause();
    });
    p = new Plotter(); await p.connect(); await p.setPen(50);
    expect(counter).toBe(60_000);
    p.onProgress = progress => {
      if (progress.state === 'paused') { paused = true; expect(counter).toBe(0); p.resume(); }
    };
    await p.plot(buildMotionPlan([{points:[{x:0,y:0},{x:20,y:0}],tool:'#000000'}],settings));
    expect(paused).toBe(true);
  });
  it('explicitly enables servo power for a job and a server pen retry after Stop', async () => {
    const commands = mockEBB(); const p = new Plotter(); await p.connect();
    let stopped = false;
    p.onProgress = progress => { if (!stopped && progress.state === 'plotting') { stopped = true; p.stop(); } };
    await p.plot(buildMotionPlan([{ points: [{ x: 0, y: 0 }, { x: 20, y: 0 }], tool: '#000000' }], settings));
    expect(commands).toContain('SR,0,1');
    const before = commands.length; await p.setPen(settings.penUp, true);
    expect(commands.slice(before)).toContain('SR,60000,1');
    expect(commands.slice(before).some(c => c.startsWith('S2,'))).toBe(true);
    expect(p.canAdjustPen).toBe(true);
  });
  it('initializes a standard servo once, suppresses duplicates, and reinitializes changed calibration', async () => {
    const commands = mockEBB(); const p = new Plotter(); await p.connect();
    await p.setPen(50); const before = commands.length; await p.setPen(50);
    expect(commands.slice(before).some(c => c.startsWith('S2,'))).toBe(false);
    expect(commands.filter(c => c === 'SC,1,1')).toHaveLength(1);
    expect(commands).toContain('SC,8,8'); expect(commands).toContain('SC,9,3');
    expect(commands).toContain('SC,4,17750'); expect(commands).toContain('SC,5,15700');
    p.configurePen({penUp:30,penDown:60}); await p.setPen(30);
    expect(commands.filter(c => c === 'SC,1,1')).toHaveLength(2); expect(commands).toContain('SC,4,21850');
  });
  it('sends the target again after idle servo power expires, and after reconnect', async () => {
    const clock = vi.spyOn(performance,'now').mockReturnValue(1000);
    const commands = mockEBB(); const p = new Plotter(); await p.connect(); await p.setPen(50);
    clock.mockReturnValue(61_000); await p.setPen(50);
    expect(commands.filter(c => c.startsWith('S2,17750,'))).toHaveLength(2);
    await p.disconnect(); const reconnect = mockEBB(); await p.connect(); await p.setPen(50);
    expect(reconnect.some(c => c.startsWith('S2,17750,'))).toBe(true); clock.mockRestore();
  });
  it('does not cache rejected servo commands and records failures', async () => {
    let reject = true;
    const commands = mockEBB('2.6.2',undefined,undefined,command => {
      if (reject && command.startsWith('S2,')) { reject = false; return '!servo rejected'; }
    });
    const p = new Plotter(); await p.connect(); await expect(p.setPen(50)).rejects.toThrow('rejected');
    await p.setPen(50); expect(commands.filter(c => c.startsWith('S2,17750,'))).toHaveLength(2);
    expect(p.diagnosticTrace.some(entry => entry.phase === 'failed' && entry.command.startsWith('S2,'))).toBe(true);
  });
  it('waits for a servo command to settle before announcing Pause', async () => {
    let p: Plotter, busyQueries = 0, paused = false, requested = false;
    const commands = mockEBB('2.6.2',command => {
      if (command.startsWith('S2,17750,') && requested) busyQueries = 2;
    },undefined,command => command === 'QG' && busyQueries-- > 0 ? '01' : undefined);
    p = new Plotter(); await p.connect();
    const plan = buildMotionPlan([{points:[{x:0,y:0},{x:20,y:0}],tool:'#000000'}],settings);
    p.onProgress = progress => {
      if (!requested && progress.state === 'plotting' && plan.events[progress.completed]?.kind === 'xy' && plan.events[progress.completed]?.penDown) { requested = true; p.pause(); }
      if (progress.state === 'paused') { paused = true; expect(busyQueries).toBeLessThanOrEqual(0); expect(p.canAdjustPen).toBe(true); p.resume(); }
    };
    await p.plot(plan); expect(paused).toBe(true);
    const trace = p.diagnosticTrace.filter(entry => entry.reason === 'pause lift');
    expect(trace.findIndex(entry => entry.phase === 'settled')).toBeGreaterThan(trace.findIndex(entry => entry.command.startsWith('S2,') && entry.phase === 'acknowledged'));
    expect(commands.filter(c => c === 'QG').length).toBeGreaterThan(2);
  });
  it('holds servo power during long pauses and re-arms idle timeout before releasing motors', async () => {
    let now = 1000, beforeContinue = 0, requested = false;
    const clock = vi.spyOn(performance,'now').mockImplementation(() => now);
    const commands = mockEBB(); const p = new Plotter(); await p.connect();
    p.onProgress = progress => {
      if (!requested && progress.state === 'plotting') { requested = true; p.pause(); }
      if (progress.state === 'paused') { now += 120_000; beforeContinue = commands.length; p.resume(); }
    };
    await p.plot(buildMotionPlan([{points:[{x:0,y:0},{x:20,y:0}],tool:'#000000'}],settings));
    expect(commands.slice(0,beforeContinue)).toContain('SR,0,1'); expect(commands.slice(0,beforeContinue)).not.toContain('SR,60000');
    expect(commands.slice(beforeContinue).filter(c => c.startsWith('S2,17750,'))).toHaveLength(2); // Planned lift + unchanged timer refresh.
    const timeout = commands.lastIndexOf('SR,60000'); expect(timeout).toBeGreaterThan(beforeContinue);
    expect(commands.slice(timeout)).toEqual(['SR,60000',expect.stringMatching(/^S2,17750,4,[1-9]\d*,0$/),'QG','EM,0,0']);
    clock.mockRestore();
  });
  it('shares large-movement timing with the immutable plan', async () => {
    const commands = mockEBB(); const p = new Plotter(); await p.connect();
    const plan = buildMotionPlan([{points:[{x:0,y:0},{x:20,y:0}],tool:'#000000'}],{...settings,penUp:0,penDown:100});
    await p.plot(plan);
    const down = commands.find(c => c.startsWith('S2,7500,'))!;
    expect(Number(down.split(',')[4])).toBe(plan.events.find(e => e.kind === 'pen' && e.penDown)!.duration*1000);
    expect(Number(down.split(',')[4])).toBeGreaterThan(120);
  });
  it('bounds diagnostic history and returns a copy of recorded entries', async () => {
    mockEBB(); const p = new Plotter(); await p.connect();
    for (let i = 0; i < 100; i++) await p.setPen(i % 2 ? 60 : 50);
    const trace = p.diagnosticTrace; expect(trace).toHaveLength(500);
    expect(trace.some(entry => entry.command.startsWith('S2,') && entry.reason === 'manual pen test' && entry.phase === 'acknowledged')).toBe(true);
    trace[0]!.command = 'mutated'; trace.pop(); expect(p.diagnosticTrace).toHaveLength(500);
    expect(p.diagnosticTrace[0]!.command).not.toBe('mutated');
  });
});


describe('controls during final queued motion', () => {
  it('honors Stop requested during the final idle query instead of reporting finished', async () => {
    let p: Plotter; let allQueued = false, requested = false;
    const commands = mockEBB('2.6.2', command => {
      if (command === 'QG' && allQueued && !requested) { requested = true; p.stop(); }
    });
    p = new Plotter(); await p.connect(); await p.setOrigin();
    const states: string[] = [];
    p.onProgress = value => {
      states.push(value.state);
      if (value.state === 'plotting' && value.completed === value.total) allQueued = true;
    };
    await p.plot(buildMotionPlan([{points:[{x:10,y:0},{x:20,y:0}],tool:'#111'}], settings));
    expect(requested).toBe(true); expect(states).toContain('returning'); expect(states).toContain('stopped');
    expect(states).not.toContain('finished');
    expect(commands.filter(c => c.startsWith('HM,'))).toHaveLength(2);
    expect(p.originAvailable).toBe(false);
  });
  it('honors Pause requested during the final idle query and permits resume', async () => {
    let p: Plotter; let allQueued = false, requested = false;
    mockEBB('2.6.2', command => {
      if (command === 'QG' && allQueued && !requested) { requested = true; p.pause(); }
    });
    p = new Plotter(); await p.connect(); await p.setOrigin();
    const states: string[] = [];
    p.onProgress = value => {
      states.push(value.state);
      if (value.state === 'plotting' && value.completed === value.total) allQueued = true;
      if (value.state === 'paused') { expect(p.canAdjustPen).toBe(true); queueMicrotask(() => p.resume()); }
    };
    await p.plot(buildMotionPlan([{points:[{x:10,y:0},{x:20,y:0}],tool:'#111'}], settings));
    expect(requested).toBe(true); expect(states).toContain('paused'); expect(states.at(-1)).toBe('finished');
  });
});


describe('live EBB position feedback', () => {
  it('maps rotated motor feedback back onto the unchanged canvas', async () => {
    mockEBB('2.8.1', undefined, '-400,-1200\r\nOK');
    const p = new Plotter(); await p.connect();
    const positions = vi.fn(); p.onPosition = positions;
    await p.plot(buildMotionPlan([{points:[{x:0,y:0},{x:10,y:20}],tool:'#111'}], {...settings,machineRotation:90}));
    expect(positions).toHaveBeenCalledWith({x:10,y:20});
  });
  it('returns rotated fallback motion to the same physical origin', async () => {
    const commands = mockEBB('2.4.6'); const p = new Plotter(); await p.connect();
    const rotated = {...settings,machineRotation:90 as const};
    p.onProgress = value => { if (value.state === 'plotting' && value.completed === value.total) p.stop(); };
    await p.plot(buildMotionPlan([{points:[{x:0,y:0},{x:10,y:5}],tool:'#111'}],rotated));
    expect(commands.some(command => command.endsWith(',200,-400'))).toBe(true);
    expect(p.originAvailable).toBe(false);
  });
  it.each([
    ['2.8.1', '1200,400\r\nOK', 'axidraw', {x:10,y:-20}],
    ['3.0.0', 'QS,-800,0', 'axidraw', {x:-10,y:10}],
    ['2.4.6', '1500,500\r\nOK', 'xylodraw', {x:10,y:-20}],
  ] as const)('reads %s step counters without leaving an acknowledgement behind', async (version, reply, profile, expected) => {
    const commands = mockEBB(version, undefined, reply); const p = new Plotter();
    await p.connect(); await p.setOrigin(profile);
    const positions = vi.fn(); p.onPosition = positions;
    await p.plot(buildMotionPlan([{points:[{x:0,y:0},{x:10,y:10}],tool:'#111'}], {...settings,profile}));
    expect(positions).toHaveBeenCalledWith(expected);
    expect(commands).toContain('QS'); expect(p.originAvailable).toBe(false);
  });
  it('leaves older firmware on the estimated overlay without issuing unsupported queries', async () => {
    const commands = mockEBB('2.4.2'); const p = new Plotter(); await p.connect(); await p.setOrigin();
    p.onPosition = vi.fn(); await p.plot(buildMotionPlan([{points:[{x:0,y:0},{x:10,y:0}],tool:'#111'}],settings));
    expect(commands).not.toContain('QS'); expect(p.onPosition).not.toHaveBeenCalled();
  });
  it('continues plotting when the board rejects optional position feedback', async () => {
    const diagnostic = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const commands = mockEBB('2.8.1', undefined, '!Unknown command'); const p = new Plotter();
    await p.connect(); await p.setOrigin(); p.onPosition = vi.fn();
    await p.plot(buildMotionPlan([{points:[{x:0,y:0},{x:10,y:10}],tool:'#111'}],settings));
    expect(commands.filter(c => c === 'QS')).toHaveLength(1); expect(p.originAvailable).toBe(false);
    diagnostic.mockRestore();
  });
});

describe('Plot workspace origin and pen passes', () => {
  const drawing = () => buildMotionPlan([{ points: [{ x: 10, y: 10 }, { x: 20, y: 10 }], tool: '#000000' }], settings);
  it('recaptures the automatic origin on every Start after releasing motors', async () => {
    const commands = mockEBB(); const p = new Plotter(); await p.connect();
    expect(commands).toEqual(['V']); expect(p.originStatus).toBe('unset');
    await p.plot(drawing()); expect(p.originStatus).toBe('unset'); expect(p.motorsOn).toBe(false);
    const before = commands.length; await p.plot(drawing());
    expect(commands.slice(before)).toContain('CS'); expect(commands.slice(before)).toContain('EM,2,2');
    expect(p.hasOrigin('axidraw')).toBe(false);
  });
  it('preserves an explicitly set reference when Engage is pressed', async () => {
    const commands = mockEBB(); const p = new Plotter(); await p.connect(); await p.setOrigin();
    const before = commands.length; await p.engageMotors();
    expect(commands).toHaveLength(before); expect(p.originStatus).toBe('explicit');
  });
  it('invalidates origin on release and profile change and recaptures at the next Start', async () => {
    mockEBB(); const p = new Plotter(); await p.connect(); await p.plot(drawing());
    await p.disengageMotors(); expect(p.originStatus).toBe('unset'); expect(p.motorsOn).toBe(false);
    await p.engageMotors(); expect(p.originStatus).toBe('unset'); expect(p.motorsOn).toBe(true);
    await p.plot(drawing()); expect(p.originStatus).toBe('unset');
    p.invalidateOrigin(); expect(p.originStatus).toBe('unset');
    await p.plot(buildMotionPlan([{ points: [{x:10,y:10},{x:20,y:10}], tool: '#000000' }], { ...settings, profile: 'xylodraw' }));
    expect(p.hasOrigin('xylodraw')).toBe(false); expect(p.hasOrigin('axidraw')).toBe(false);
  });
  it('lifts before reporting Paused and queues no XY motion while waiting', async () => {
    const commands = mockEBB(); const p = new Plotter(); await p.connect(); await p.setOrigin();
    let requested = false, paused = false, beforeResume = 0;
    p.onProgress = progress => {
      if (progress.state === 'plotting' && !requested) { requested = true; p.pause(); }
      if (progress.state === 'paused') {
        paused = true; expect(commands.at(-1)).toBe('QG'); expect(commands.filter(c => c.startsWith('S2,')).at(-1)).toMatch(/^S2,17750,/);
        beforeResume = commands.length;
        queueMicrotask(() => { expect(commands).toHaveLength(beforeResume); p.resume(); });
      }
    };
    await p.plot(drawing()); expect(paused).toBe(true); expect(p.originAvailable).toBe(false);
  });
  it('waits at the origin for every different pen regardless of the legacy toggle', async () => {
    const commands = mockEBB('2.4.6'); const p = new Plotter(); await p.connect();
    const plan = buildMotionPlan([{points:[{x:10,y:10},{x:20,y:10}],tool:'#000000'}, {points:[{x:30,y:10},{x:40,y:10}],tool:'#FF0000'}, {points:[{x:50,y:10},{x:60,y:10}],tool:'#000000'}], { ...settings, pauseOnToolChange: false });
    const tools: string[] = [];
    p.onProgress = progress => {
      if (progress.state === 'tool-change') {
        tools.push(progress.tool!);
        expect(p.motorsOn).toBe(true); expect(commands).not.toContain('EM,0,0');
        expect(plan.events[progress.completed]!.from).toEqual({x:0,y:0});
        expect(commands.at(-1)).toBe('QM'); expect(commands.filter(c => c.startsWith('S2,')).at(-1)).toMatch(/^S2,17750,/);
        queueMicrotask(() => p.resume());
      }
    };
    await p.plot(plan); expect(tools).toEqual(['#FF0000', '#000000']);
    expect(commands.filter(command => command === 'EM,2,2')).toHaveLength(1);
  });
  it('Stop at a pen-change wait returns to origin and does not run the next pass', async () => {
    const commands = mockEBB(); const p = new Plotter(); await p.connect();
    const plan = buildMotionPlan([{points:[{x:10,y:10},{x:20,y:10}],tool:'#000000'}, {points:[{x:100,y:100},{x:120,y:100}],tool:'#FF0000'}], settings);
    const states: string[] = [];
    p.onProgress = progress => { states.push(progress.state); if (progress.state === 'tool-change') p.stop(); };
    await p.plot(plan); expect(states).toContain('stopped'); expect(states).not.toContain('finished');
    expect(p.originAvailable).toBe(false); expect(commands).not.toContain('ES,1'); expect(commands.at(-1)).toBe('EM,0,0');
  });
});

describe('controls during automatic origin capture', () => {
  it('honors Stop during capture without drawing or resetting the request', async () => {
    let p: Plotter;
    const commands = mockEBB('2.6.2', command => { if (command === 'CS') p.stop(); });
    p = new Plotter(); await p.connect();
    const states: string[] = []; p.onProgress = value => states.push(value.state);
    await p.plot(buildMotionPlan([{points:[{x:10,y:10},{x:20,y:10}],tool:'#000000'}], settings));
    expect(commands.some(command => command.startsWith('LM,'))).toBe(false);
    expect(states).toContain('stopped'); expect(states).not.toContain('finished'); expect(p.originAvailable).toBe(false);
  });
  it('honors Pause during capture and rejects a second job until the first settles', async () => {
    let p: Plotter, paused = false;
    const commands = mockEBB('2.6.2', command => { if (command === 'CS') p.pause(); });
    p = new Plotter(); await p.connect();
    const plan = buildMotionPlan([{points:[{x:10,y:10},{x:20,y:10}],tool:'#000000'}], settings);
    p.onProgress = value => { if (value.state === 'paused') { paused = true; expect(commands.some(command => command.startsWith('LM,'))).toBe(false); queueMicrotask(() => p.resume()); } };
    const execution = p.plot(plan);
    await expect(p.plot(plan)).rejects.toThrow('idle'); await execution;
    expect(paused).toBe(true);
  });
});

describe('automatic motor release', () => {
  const drawing = (returnToOrigin = true) => buildMotionPlan([{points:[{x:10,y:10},{x:20,y:10}],tool:'#000000'}], {...settings,returnToOrigin});
  it.each([true, false])('waits for settled motion and the release acknowledgement before Complete (return=%s)', async returnToOrigin => {
    let acknowledge!: () => void;
    const gate = new Promise<void>(resolve => { acknowledge = resolve; });
    const commands = mockEBB('2.6.2', command => command === 'EM,0,0' ? gate : undefined);
    const p = new Plotter(); await p.connect();
    const states: string[] = []; p.onProgress = value => states.push(value.state);
    const execution = p.plot(drawing(returnToOrigin));
    await vi.waitFor(() => expect(commands.at(-1)).toBe('EM,0,0'));
    expect(commands.slice(-3)).toEqual([expect.stringMatching(/^S2,17750,4,[1-9]\d*,0$/),'QG','EM,0,0']);
    expect(p.active).toBe(true); expect(p.motorsOn).toBe(true); expect(states).not.toContain('finished');
    acknowledge(); await execution;
    expect(states.at(-1)).toBe('finished'); expect(p.active).toBe(false);
    expect(p.motorsOn).toBe(false); expect(p.originStatus).toBe('unset');
  });
  it('handles Stop during final pen lift by returning before releasing', async () => {
    let p: Plotter, allQueued = false, requested = false;
    const commands = mockEBB('2.6.2', command => {
      if (allQueued && command.startsWith('S2,') && !requested) { requested = true; p.stop(); }
    });
    p = new Plotter(); await p.connect();
    const states: string[] = [];
    p.onProgress = value => { states.push(value.state); if (value.state === 'plotting' && value.completed === value.total) allQueued = true; };
    await p.plot(drawing(false));
    expect(requested).toBe(true); expect(states.at(-1)).toBe('stopped'); expect(states).not.toContain('finished');
    expect(commands.filter(command => command.startsWith('HM,'))).toHaveLength(2);
    expect(commands.at(-1)).toBe('EM,0,0'); expect(p.motorsOn).toBe(false);
  });
  it('releases after an execution failure without claiming completion or returning', async () => {
    const commands = mockEBB('2.6.2', undefined, '0,0\r\nOK', command => command.startsWith('LM,') ? '!Motion failed' : undefined);
    const p = new Plotter(); await p.connect();
    const states: string[] = []; p.onProgress = value => states.push(value.state);
    await expect(p.plot(drawing())).rejects.toThrow('Motion failed');
    expect(commands).toContain('ES,1'); expect(commands.at(-1)).toBe('EM,0,0');
    expect(commands.slice(commands.indexOf('ES,1')).some(command => command.startsWith('HM,'))).toBe(false);
    expect(states).not.toContain('finished'); expect(p.motorsOn).toBe(false); expect(p.originStatus).toBe('unset');
  });
  it.each([false, true])('reports rejected release without claiming success (stop=%s)', async stop => {
    mockEBB('2.6.2', undefined, '0,0\r\nOK', command => command === 'EM,0,0' ? '!Release rejected' : undefined);
    const p = new Plotter(); await p.connect();
    const states: string[] = []; p.onProgress = value => { states.push(value.state); if (stop && value.state === 'plotting') p.stop(); };
    await expect(p.plot(drawing())).rejects.toThrow('Could not release motors');
    expect(states).not.toContain('finished'); expect(states).not.toContain('stopped');
    expect(p.active).toBe(false); expect(p.motorsOn).toBe(true); expect(p.originStatus).toBe('unset');
  });
  it('releases an explicitly engaged idle machine before disconnecting', async () => {
    const commands = mockEBB(); const p = new Plotter(); await p.connect(); await p.engageMotors();
    await p.disconnect();
    expect(commands.slice(-3)).toEqual(['QG','EM,0,0','QG']);
    expect(p.connected).toBe(false); expect(p.motorsOn).toBe(false);
  });
});
