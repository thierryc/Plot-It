import { describe, expect, it, vi } from 'vitest';
import { fakeTransport } from '../server/test-fixtures/fake-ebb';
import { buildBoundsPreview } from './bounds-preview';
import { initialState } from './model';
import { buildMotionPlan } from './motion-plan';
import { servoPosition } from './pen-control';
import { PlotterCore } from './plotter-core';

const settings = { ...initialState.settings, profile:'xylodraw' as const, penUp:30, penDown:52 };
const plan = () => buildMotionPlan([{ tool:'#000000', points:[{x:10,y:10},{x:22,y:10}] }], settings);

describe('fresh physical plot setup', () => {
  it.each(['3.1.7','2.8.1','3.0.1'])('drains legacy pen commands and settles calibration on first and later jobs (%s)', async version => {
    let now=0, pendingLower=true, oldPenReadyAt=80, target=0, penReadyAt=0;
    const setup=new Map<number,number>();
    let core!:PlotterCore;
    const clock=vi.spyOn(performance,'now').mockImplementation(()=>now);
    const fixture=fakeTransport(version, command=>{
      const [name,...values]=command.split(','), args=values.map(Number);
      // Legacy ES clears motor moves, leaving a pending servo command alive.
      if(name==='ES'&&version==='3.0.1') pendingLower=false;
      if((name==='QG'||name==='QM')&&pendingLower) {
        now+=20;
        if(now>=oldPenReadyAt) {pendingLower=false; target=servoPosition(settings.penDown);}
      }
      if(name==='SC') {expect(pendingLower,'calibration cannot change under a pending old pen command').toBe(false); setup.set(args[0]!,args[1]!);}
      if(name==='SP') {
        target=setup.get(args[0]===1?4:5)!;
        penReadyAt=now+args[1]!;
      }
      if(name==='SM') {
        // A stale queued lowering command would fire during the travel block.
        if(pendingLower) target=servoPosition(settings.penDown);
        expect(pendingLower).toBe(false);
        expect(setup.get(2)).toBe(0);
        expect(setup.get(11)).toBe(1845); expect(setup.get(12)).toBe(1230);
        expect(setup.get(8)).toBe(8); expect(setup.get(9)).toBe(3);
        expect(target).toBe(servoPosition(core.executionSignal!.penDown?52:30));
        expect(now).toBeGreaterThanOrEqual(penReadyAt);
      }
    }, command=>/^ES(?:,|$)/.test(command)?'0,0,0,0,0\r\nOK'
      :command==='QG'?(pendingLower?'08':'00')
      :command==='QM'?(pendingLower?'QM,1,0,0,1':'QM,0,0,0,0'):undefined);
    core=new PlotterCore(fixture.transport,{sleep:async ms=>{now+=ms;}});
    try {
      await core.connect();
      for(const job of [plan(),buildBoundsPreview(plan()),plan(),plan()]) {
        pendingLower=true; oldPenReadyAt=now+80;
        const start=fixture.commands.length;
        await core.plot(job);
        const commands=fixture.commands.slice(start);
        const purge='ES,0';
        expect(commands.filter(c=>/^(R|RB)$/.test(c))).toEqual([]);
        expect(commands.indexOf(purge)).toBeLessThan(commands.indexOf('SC,2,0'));
        expect(commands.slice(commands.indexOf(purge)+1,commands.indexOf('SC,2,0'))).toContain('QG');
        expect(commands.indexOf('SC,5,17340')).toBeGreaterThan(commands.indexOf(purge));
        expect(commands.indexOf('SC,5,17340')).toBeLessThan(commands.findIndex(c=>c.startsWith('SP,')));
        expect(commands.find(c=>c.startsWith('SP,'))).toMatch(/^SP,1,/);
        expect(commands.filter(c=>c.startsWith('SP,0,')).length).toBe(job.events.filter(e=>e.kind==='pen'&&e.penDown).length);
        expect(core.progress.state).toBe('finished');
      }
      await core.disconnect();
    } finally { clock.mockRestore(); }
  });

  it.each(['0\r\nOK','0,0,0,0,0\r\nOK','ES,0'])('consumes complete queue-purge replies without shifting setup acknowledgements (%s)',async reply=>{
    const fixture=fakeTransport('2.8.1',undefined,c=>c==='ES,0'?reply:undefined);
    const core=new PlotterCore(fixture.transport,{sleep:async()=>{}});
    await core.connect(); await core.plot(plan());
    expect(core.progress.state).toBe('finished'); await core.disconnect();
  });

  it('skips a stale reset OK but requires the actual ES status and synchronization marker',async()=>{
    const fixture=fakeTransport('2.8.1',undefined,c=>c==='ES,0'?'OK\r\n0,0,0,0,0\r\nOK':undefined);
    const core=new PlotterCore(fixture.transport,{sleep:async()=>{}});
    await core.connect(); await core.plot(plan()); await core.plot(plan());
    expect(core.progress.state).toBe('finished'); expect(fixture.commands).not.toContain('R');
    expect(fixture.commands.filter(c=>c==='V')).toHaveLength(3);
    await core.disconnect();
  });

  it('does not treat an OK without an ES status as confirmation of a purge',async()=>{
    const fixture=fakeTransport('2.8.1',undefined,c=>c==='ES,0'?'OK':undefined);
    const core=new PlotterCore(fixture.transport,{sleep:async()=>{}});
    await core.connect(); await expect(core.plot(plan())).rejects.toThrow('Unexpected emergency-stop response');
    expect(fixture.commands.some(c=>/^(SM|HM),/.test(c))).toBe(false);
    await core.disconnect();
  });

  it.each(['ES,0','SC,2,0','SC,5,17340'])('never sends XY if startup setup is rejected at %s',async rejected=>{
    const fixture=fakeTransport('2.8.1',undefined,c=>c===rejected?'!setup rejected':undefined);
    const core=new PlotterCore(fixture.transport,{sleep:async()=>{}});
    await core.connect(); await expect(core.plot(plan())).rejects.toThrow('setup rejected');
    expect(fixture.commands.some(c=>/^(SM|HM),/.test(c))).toBe(false);
    expect(core.originStatus).toBe('unset'); expect(core.active).toBe(false);
    await core.disconnect();
  });

  it('retains an idle explicitly set origin across firmware setup',async()=>{
    const fixture=fakeTransport(), core=new PlotterCore(fixture.transport,{sleep:async()=>{}});
    await core.connect(); await core.setOrigin('xylodraw','explicit');
    const start=fixture.commands.length;
    let originDuringDrawing='';
    core.onSignal=signal=>{if(signal.kind==='xy'&&signal.phase==='started') originDuringDrawing=core.originStatus;};
    await core.plot(plan()); expect(originDuringDrawing).toBe('explicit');
    expect(fixture.commands.slice(start)).not.toContain('CS');
    expect(fixture.commands.slice(start)).not.toContain('EM,2,2');
    await core.disconnect();
  });
});
