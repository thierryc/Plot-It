import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlotterCore } from './plotter-core';
import { Plotter } from './plotter';
import { buildMotionPlan } from './motion-plan';
import { initialState } from './model';
import { servoPosition } from './pen-control';
import { fakeTransport } from '../server/test-fixtures/fake-ebb';

const settings = { ...initialState.settings, penUp: 30, penDown: 44, returnToOrigin: true };
const drawing = () => buildMotionPlan([
  { tool: '#000000', points: [{x:10,y:10},{x:20,y:10},{x:20,y:20}] },
  { tool: '#FF0000', points: [{x:25,y:10},{x:30,y:10}] },
], settings);
const fast = { sleep: async () => {} };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('EBB protocol plotter', () => {
  it.each(['3.1.7','2.8.1'])('executes configured SP and timed SM, and releases only after completion (%s)', async version => {
    const fixture = fakeTransport(version), core = new PlotterCore(fixture.transport, fast);
    core.onProgress = progress => { if (progress.state === 'tool-change') core.resume(); };
    await core.connect(); await core.setPen(44); const before = fixture.commands.length;
    await core.plot(drawing());
    const commands = fixture.commands.slice(before);
    expect(commands).toContain('SC,4,21850'); expect(commands).toContain('SC,5,18980');
    expect(commands).toContain('SC,11,1845'); expect(commands).toContain('SC,12,1230');
    expect(commands.find(c=>c.startsWith('SP,'))).toMatch(/^SP,1,\d+,1$/);
    expect(commands.filter(c=>c.startsWith('SP,')).at(-1)).toMatch(/^SP,1,\d+,1$/);
    expect(commands.some(c=>c.startsWith('SM,'))).toBe(true);
    expect(commands.some(c=>/^(S2|TP|LM),|^SC,1,/.test(c))).toBe(false);
    expect(commands.at(-1)).toBe('EM,0,0'); expect(core.progress.state).toBe('finished');
    expect(core.motorsOn).toBe(false); expect(core.originStatus).toBe('unset');
    expect(core.executionSignal).toMatchObject({position:{x:0,y:0},penDown:false});
    await core.disconnect();
  });

  it.each(['3.1.7','2.8.1'])('waits for pen dwell and drained XY on an asynchronous firmware queue (%s)', async version => {
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout','performance']});
    let busyUntil=0, upPulse=0, downPulse=0, target=0, penUp=true, xy=0;
    let core!: PlotterCore;
    const fixture = fakeTransport(version, command => {
      const parts=command.split(','), values=parts.map(Number);
      if(parts[0]==='SC'&&values[1]===4) upPulse=values[2]!;
      if(parts[0]==='SC'&&values[1]===5) downPulse=values[2]!;
      if(parts[0]==='SP') {
        expect(performance.now(),'pen must change only after previous XY drains').toBeGreaterThanOrEqual(busyUntil);
        penUp=values[1]===1; target=penUp?upPulse:downPulse;
        busyUntil=performance.now()+values[2]!;
      }
      if(parts[0]==='SM') {
        if(!xy || core.executionSignal?.kind==='xy' && core.executionSignal.phase==='started' && core.executionSignal.eventIndex!==lastEvent) {
          expect(performance.now(),'XY cannot start during a pen dwell').toBeGreaterThanOrEqual(penReadyAt);
        }
        expect(target).toBe(servoPosition(core.executionSignal!.penDown ? settings.penDown : settings.penUp));
        busyUntil=Math.max(performance.now(),busyUntil)+values[1]!; xy++;
        lastEvent=core.executionSignal!.eventIndex;
      }
      if(parts[0]==='SP') penReadyAt=busyUntil;
    }, command => command==='QG' ? (performance.now()<busyUntil?'08':'00')
      : command==='QM' ? (performance.now()<busyUntil?'QM,1,0,0,0':'QM,0,0,0,0') : undefined);
    let penReadyAt=0,lastEvent=-1;
    core=new PlotterCore(fixture.transport);
    core.onProgress=progress=>{if(progress.state==='tool-change')core.resume();};
    await core.connect();
    const run=core.plot(drawing());
    await Promise.all([expect(run).resolves.toBeUndefined(),vi.advanceTimersByTimeAsync(30000)]);
    expect(xy).toBeGreaterThan(20); expect(penUp).toBe(true); expect(core.progress.state).toBe('finished');
    await core.disconnect();
  });

  it('waits on the host after SP even when a board reports idle immediately', async () => {
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout','performance']});
    let core!: PlotterCore, readyAt=0;
    const fixture=fakeTransport('2.8.1',command=>{
      if(command.startsWith('SP,')) { const duration=Number(command.split(',')[2]); readyAt=performance.now()+duration; }
      if(command.startsWith('SM,')) expect(performance.now()).toBeGreaterThanOrEqual(readyAt);
    });
    core=new PlotterCore(fixture.transport); await core.connect();
    const run=core.plot(buildMotionPlan([{tool:'#000000',points:[{x:10,y:10},{x:20,y:10}]}],settings));
    await Promise.all([expect(run).resolves.toBeUndefined(),vi.advanceTimersByTimeAsync(5000)]);
    await core.disconnect();
  });

  it('allows manual calibration while paused and restores the next drawing state before XY', async () => {
    const fixture=fakeTransport(),core=new PlotterCore(fixture.transport,fast);
    let paused=false, requested=false, adjusted=0;
    core.onSignal=signal=>{if(!requested && signal.kind==='pen'&&signal.penDown&&signal.phase==='settled'){requested=true;core.pause();}};
    core.onProgress=progress=>{
      if(progress.state==='paused') {
        paused=true;expect(core.canAdjustPen).toBe(true);
        void core.setPen(67,true).then(()=>{adjusted=fixture.commands.length;core.resume();});
      }
    };
    await core.connect(); await core.plot(buildMotionPlan([{tool:'#000000',points:[{x:10,y:10},{x:20,y:10}]}],settings));
    expect(paused).toBe(true);const tail=fixture.commands.slice(adjusted);
    const down=tail.findIndex(c=>c.startsWith('SP,0,')),motion=tail.findIndex(c=>c.startsWith('SM,'));
    expect(tail).toContain('SC,5,18980');expect(down).toBeGreaterThanOrEqual(0);expect(down).toBeLessThan(motion);
    await core.disconnect();
  });

  it('holds every tool change at origin and resumes only after explicit Continue', async () => {
    const fixture=fakeTransport(),core=new PlotterCore(fixture.transport,fast),tools:string[]=[];
    core.onProgress=progress=>{
      if(progress.state==='tool-change') {
        tools.push(progress.tool!);expect(core.motorsOn).toBe(true);
        expect(fixture.commands.at(-1)).toBe('QG');
        expect(core.executionSignal).toMatchObject({kind:'tool',position:{x:0,y:0},penDown:false});
        queueMicrotask(()=>core.resume());
      }
    };
    await core.connect();await core.plot(drawing());expect(tools).toEqual(['#FF0000']);await core.disconnect();
  });

  it.each(['3.1.7','2.8.1'])('Stop drains, raises, returns without resetting origin, and releases (%s)',async version=>{
    let core!:PlotterCore,requested=false;
    const fixture=fakeTransport(version,command=>{if(command.startsWith('SM,')&&core.executionSignal?.penDown&&!requested){requested=true;core.stop();}});
    core=new PlotterCore(fixture.transport,fast);await core.connect();await core.plot(drawing());
    expect(core.progress.state).toBe('stopped');expect(fixture.commands).not.toContain('ES,1');
    expect(fixture.commands.filter(c=>c==='CS')).toHaveLength(1);
    const lastUp=fixture.commands.map((c,i)=>c.startsWith('SP,1,')?i:-1).filter(i=>i>=0).at(-1)!;
    expect(fixture.commands.slice(lastUp+1).some(c=>/^(HM|SM),/.test(c))).toBe(true);
    expect(fixture.commands.at(-1)).toBe('EM,0,0');await core.disconnect();
  });

  it('emergency cancellation flushes motion, lifts, and never initiates a home move',async()=>{
    let core!:PlotterCore,requested=false;
    const fixture=fakeTransport('2.8.1',command=>{if(command.startsWith('SM,')&&core.executionSignal?.penDown&&!requested){requested=true;core.cancel();}});
    core=new PlotterCore(fixture.transport,fast);await core.connect();await core.plot(drawing());
    const stop=fixture.commands.indexOf('ES,1');expect(stop).toBeGreaterThan(0);
    expect(fixture.commands.slice(stop).some(c=>c.startsWith('HM,'))).toBe(false);
    expect(fixture.commands.slice(stop).some(c=>c.startsWith('SP,1,'))).toBe(true);
    expect(core.progress.state).toBe('cancelled');expect(core.originStatus).toBe('unset');await core.disconnect();
  });

  it('clears an old servo countdown and holds power through pause and plotting',async()=>{
    let reload=60000,counter=0,core!:PlotterCore,paused=false;
    const fixture=fakeTransport('2.8.1',command=>{
      if(command.startsWith('SR,'))reload=Number(command.split(',')[1]);
      if(command.startsWith('SP,'))counter=reload;
      if(command==='CS')core.pause();
    });
    core=new PlotterCore(fixture.transport,fast);await core.connect();await core.setPen(30);
    core.onProgress=progress=>{if(progress.state==='paused'){paused=true;expect(counter).toBe(0);core.resume();}if(progress.state==='tool-change')core.resume();};
    await core.plot(drawing());expect(paused).toBe(true);expect(fixture.commands).toContain('SR,0,1');
    expect(fixture.commands.slice(-2)).toEqual(['SR,60000','EM,0,0']);await core.disconnect();
  });

  it('reissues the startup lift and recaptures origin for every fresh job',async()=>{
    const fixture=fakeTransport(),core=new PlotterCore(fixture.transport,fast);
    core.onProgress=p=>{if(p.state==='tool-change')core.resume();};
    await core.connect();await core.plot(drawing());const before=fixture.commands.length;await core.plot(drawing());
    const tail=fixture.commands.slice(before);expect(tail).toContain('CS');expect(tail).toContain('EM,2,2');
    expect(tail.find(c=>c.startsWith('SP,'))).toMatch(/^SP,1,/);await core.disconnect();
  });

  it('records requested, written, received, acknowledged and failed exchanges without caching rejection',async()=>{
    let reject=true;
    const fixture=fakeTransport('2.8.1',undefined,command=>command.startsWith('SP,')&&reject ? (reject=false,'!servo rejected') : undefined);
    const core=new PlotterCore(fixture.transport,fast);await core.connect();await expect(core.setPen(50)).rejects.toThrow('rejected');
    const written=core.diagnosticTrace.find(e=>e.phase==='written'&&e.command.startsWith('SP,'))!;
    expect(core.diagnosticTrace.filter(e=>e.commandId===written.commandId).map(e=>e.phase)).toEqual(['requested','written','received','failed']);
    expect(fixture.commands).toContain('ES,1');const beforeRetry=fixture.commands.filter(c=>c.startsWith('SP,1,')).length;await core.setPen(50);expect(fixture.commands.filter(c=>c.startsWith('SP,1,'))).toHaveLength(beforeRetry+1);await core.disconnect();
  });

  it('consumes legacy QS terminators and future responses without shifting the next acknowledgement',async()=>{
    for(const future of [false,true]) {
      let m1=0,m2=0;const fixture=fakeTransport('3.0.1',command=>{if(command==='CS')m1=m2=0;else if(command.startsWith('SM,')){const p=command.split(',').map(Number);m1+=p[2]!;m2+=p[3]!;}},command=>future ? command==='V'?'V,EBB Firmware Version 3.0.1':command==='QS'?`QS,${m1},${m2}`:command==='QG'?'QG,10':command==='QC'?'QC,0394,0300':command.split(',')[0] : undefined);
      const core=new PlotterCore(fixture.transport,fast);core.onPosition=()=>{};core.onProgress=p=>{if(p.state==='tool-change')core.resume();};
      await core.connect();await core.plot(drawing());expect(core.progress.state).toBe('finished');
      const replies=core.diagnosticJobTrace!.entries.filter(e=>e.command==='QS'&&e.phase==='received').map(e=>e.response);
      expect(replies).toContain(future?'QS,0,0':'OK');await core.disconnect();
    }
  });

  it('keeps a full plan and pen signals when serial history rolls over',async()=>{
    const fixture=fakeTransport(),core=new PlotterCore(fixture.transport,fast);core.onProgress=p=>{if(p.state==='tool-change')core.resume();};
    await core.connect();await core.plot(drawing());const signals=core.diagnosticJobTrace!.signals;
    for(let i=0;i<7000;i++)await core.firmwareVersion();
    const job=core.diagnosticJobTrace!;expect(job.entries.length).toBeLessThanOrEqual(20000);expect(job.droppedEntries).toBeGreaterThan(0);
    expect(job.protocol).toBe('ebb-native-sm-v1');
    expect(job.entries.some(e=>e.command==='SC,4,21850'&&e.phase==='written')).toBe(true);
    expect(job.signals).toEqual(signals);expect(job.plan).toEqual(drawing());expect(core.diagnosticPenTrace.some(e=>e.command.startsWith('SP,0,'))).toBe(true);
    job.signals.length=0;expect(core.diagnosticJobTrace!.signals.length).toBeGreaterThan(0);await core.disconnect();
  });

  it('browser facade requests only the EBB USB filter',async()=>{
    const fixture=fakeTransport(),request=vi.fn(()=>fixture.transport.requestPort());
    vi.stubGlobal('navigator',{serial:{requestPort:request}});
    const plotter=new Plotter(fast);await plotter.connect();
    expect(request).toHaveBeenCalledWith({filters:[{usbVendorId:0x04d8,usbProductId:0xfd92}]});await plotter.disconnect();
  });
});
