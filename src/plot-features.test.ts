import { describe, expect, it, vi } from 'vitest';
import { initialState } from './model';
import { buildMotionPlan } from './motion-plan';
import { compilePlotProcess } from './plot-process';
import { penTransition, penTimingSettings, servoSetup } from './pen-control';
import { plotStatistics } from './plot-statistics';
import { buildBoundsPreview, drawingBounds } from './bounds-preview';
import { parsePowerStatus } from './ebb-power';
import { PlotterCore } from './plotter-core';
import { fakeTransport } from '../server/test-fixtures/fake-ebb';
import { parsePlotIt, serializePlotIt } from './document-file';
import { validateSettings, validateJob } from './network-protocol';
const settings = {...initialState.settings,machineRotation:0 as const};
const stroke = [{tool:'#000000',points:[{x:10,y:20},{x:40,y:20},{x:40,y:60}]}];

describe('adjustable pen timing',()=>{
  it('keeps working defaults and converts independent rates to SC increments',()=>{
    expect(penTimingSettings()).toEqual({penRateRaise:75,penRateLower:50,penDelayUpMs:150,penDelayDownMs:0,penReloadWaitMs:0});
    expect(servoSetup(30,44,{penRateRaise:10,penRateLower:20}).slice(2,4)).toEqual(['SC,11,246','SC,12,492']);
    expect(penTransition(30,44,false,0,{penRateLower:1}).duration).toBeGreaterThan(2700);
    expect(penTransition(44,30,true,0,{penDelayUpMs:650}).duration-penTransition(44,30,true).duration).toBe(500);
    expect(penTransition(30,30,false,0,{penDelayDownMs:-500}).duration).toBe(1);
  });
  it('adds reload wait only between stationary chunks, never at final lift',()=>{
    const chunks=[0,1,2].map(i=>({tool:'#000000',points:[{x:10+i*5,y:10},{x:15+i*5,y:10}]}));
    const baseline=buildMotionPlan(chunks,{...settings,maxPenDownMm:5});
    const tuned=buildMotionPlan(chunks,{...settings,maxPenDownMm:5,penReloadWaitMs:777});
    const lifts=tuned.events.filter(e=>e.kind==='pen'&&!e.penDown), original=baseline.events.filter(e=>e.kind==='pen'&&!e.penDown);
    expect(lifts.map((e,i)=>Math.round((e.duration-original[i]!.duration)*1000))).toEqual([0,777,777,0]);
    expect(tuned.duration-baseline.duration).toBeCloseTo(1.554);
    expect(()=>compilePlotProcess(tuned)).not.toThrow();
    const invalid=structuredClone(tuned); const lift=invalid.events.find(e=>e.kind==='pen'&&!e.penDown&&e.start>0)!;
    lift.duration-=.777; expect(()=>compilePlotProcess(invalid)).toThrow('settling');
  });
  it('restores legacy timing and validates document/network settings',()=>{
    const state=structuredClone(initialState); Object.assign(state.settings,{penRateRaise:12,penRateLower:22,penDelayUpMs:999,penDelayDownMs:321,penReloadWaitMs:1500});
    expect(penTimingSettings(parsePlotIt(serializePlotIt(state)).state.settings)).toEqual(penTimingSettings(state.settings));
    for (const key of Object.keys(penTimingSettings()) as Array<keyof typeof settings>) delete state.settings[key];
    expect(penTimingSettings(parsePlotIt(serializePlotIt(state)).state.settings)).toEqual(penTimingSettings());
    for (const value of [0,101,1.5,NaN,'50']) expect(()=>validateSettings({...settings,penRateRaise:value})).toThrow('penRateRaise');
    for (const value of [-501,10001,NaN]) expect(()=>penTimingSettings({penDelayUpMs:value})).toThrow();
    expect(()=>penTimingSettings({penReloadWaitMs:-1})).toThrow();
  });
  it('sends tuned rates and inclusive SP waits to the physical execution path',async()=>{
    const fixture=fakeTransport(),core=new PlotterCore(fixture.transport,{sleep:async()=>{}});
    const plan=buildMotionPlan(stroke,{...settings,penRateRaise:10,penRateLower:20,penDelayUpMs:650,penDelayDownMs:400});
    await core.connect(); await core.plot(plan);
    expect(fixture.commands).toContain('SC,11,246'); expect(fixture.commands).toContain('SC,12,492');
    const transitions=fixture.commands.filter(c=>c.startsWith('SP,'));
    expect(transitions.slice(0,3).map(c=>Number(c.split(',')[2]))).toEqual(plan.events.filter(e=>e.kind==='pen').map(e=>Math.round(e.duration*1000)));
    await core.disconnect();
  });
});
describe('bounds and statistics',()=>{
  it('counts executable distances including return, ignoring stationary waits',()=>{
    const plan=buildMotionPlan(stroke,settings),stats=plotStatistics(plan);
    expect(stats.drawingMm).toBeCloseTo(70); expect(stats.travelMm).toBeCloseTo(Math.hypot(10,20)+Math.hypot(40,60));
    expect(stats.motionSeconds).toBe(plan.duration); expect(stats.penUp).toBe(2); expect(stats.penDown).toBe(1);
  });
  it.each([0,90,180,270] as const)('previews every pen’s prepared bounds with pen up at rotation %s',rotation=>{
    const plan=buildMotionPlan([...stroke,{tool:'#FF0000',points:[{x:5,y:10},{x:50,y:80}]}],{...settings,machineRotation:rotation,returnToOrigin:false});
    const saved=structuredClone(plan), preview=buildBoundsPreview(plan);
    expect(drawingBounds(plan)).toEqual({minX:5,minY:10,maxX:50,maxY:80});
    expect(preview.events.every(e=>!e.penDown)).toBe(true); expect(preview.events.filter(e=>e.kind==='pen')).toHaveLength(1);
    expect(preview.events.at(-1)!.to).toEqual({x:0,y:0}); expect(plotStatistics(preview).drawingMm).toBe(0);
    for(const point of [{x:5,y:10},{x:50,y:10},{x:50,y:80},{x:5,y:80}]) expect(preview.events.some(e=>e.to.x===point.x&&e.to.y===point.y)).toBe(true);
    expect(()=>compilePlotProcess(preview)).not.toThrow(); expect(()=>validateJob({version:1,requestId:'bounds',plan:preview})).not.toThrow();
    expect(plan).toEqual(saved);
  });
  it('supports line bounds and rejects an empty drawing',()=>{
    expect(()=>compilePlotProcess(buildBoundsPreview(buildMotionPlan([{tool:'#000000',points:[{x:10,y:10},{x:30,y:10}]}],settings)))).not.toThrow();
    expect(()=>buildBoundsPreview(buildMotionPlan([],settings))).toThrow('no drawing');
  });
  it('executes a bounds job without any down command and returns to origin',async()=>{
    const fixture=fakeTransport(), core=new PlotterCore(fixture.transport,{sleep:async()=>{}});
    await core.connect(); await core.plot(buildBoundsPreview(buildMotionPlan(stroke,settings)));
    expect(fixture.commands.filter(c=>c.startsWith('SP,')).every(c=>c.startsWith('SP,1,'))).toBe(true);
    expect(fixture.commands.some(c=>c.startsWith('SM,'))).toBe(true); expect(core.progress.state).toBe('finished'); await core.disconnect();
  });
});
describe('supply monitoring and elapsed time',()=>{
  it('decodes legacy/future raw ADC readings with the Python supply threshold',()=>{
    expect(parsePowerStatus('0394,0300').state).toBe('ok'); expect(parsePowerStatus('QC,394,249').state).toBe('low');
    expect(parsePowerStatus('394,250').state).toBe('ok');
    for(const reply of ['!unsupported','OK','QC','QC,1024,300','-1,300','123,300,4']) expect(parsePowerStatus(reply).state).toBe('unavailable');
  });
  it.each(['0394,0300\r\nOK','QC,0394,0300'])('consumes the QC framing correctly: %s',async reply=>{
    const fixture=fakeTransport('2.8.1',undefined,c=>c==='QC'?reply:undefined),core=new PlotterCore(fixture.transport,{sleep:async()=>{}});
    await core.connect(); expect(core.powerStatus.supplyRaw).toBe(300); await core.checkPowerSupply();
    await core.plot(buildMotionPlan(stroke,settings)); expect(core.progress.state).toBe('finished'); await core.disconnect();
  });
  it('honors Stop while the supply preflight is awaiting its reply',async()=>{
    let core!:PlotterCore, checking=0;
    const fixture=fakeTransport('2.8.1',command=>{if(command==='QC'&&++checking===2) core.stop();});
    core=new PlotterCore(fixture.transport,{sleep:async()=>{}});
    await core.connect(); await core.plot(buildMotionPlan(stroke,settings));
    expect(core.progress.state).toBe('stopped'); expect(fixture.commands).toEqual(['V','QC','QC']); await core.disconnect();
  });
  it('blocks a low supply before any pen, motor-enable or XY command',async()=>{
    const fixture=fakeTransport('2.8.1',undefined,c=>c==='QC'?'0394,0010\r\nOK':undefined),core=new PlotterCore(fixture.transport,{sleep:async()=>{}});
    await core.connect(); expect(core.powerStatus.state).toBe('low');
    await expect(core.plot(buildMotionPlan(stroke,settings))).rejects.toThrow('supply');
    expect(fixture.commands).toEqual(['V','QC','QC']); expect(core.active).toBe(false); await core.disconnect();
  });
  it('reports unsupported firmware without issuing QC',async()=>{
    const fixture=fakeTransport('2.2.2'),core=new PlotterCore(fixture.transport,{sleep:async()=>{}});
    await expect(core.connect()).rejects.toThrow('requires EBB firmware 2.8.1'); expect(fixture.commands).not.toContain('QC');
  });
  it('detects loss during feeding, cancels without home, and freezes actual elapsed time',async()=>{
    let now=0, moved=false; const clock=vi.spyOn(performance,'now').mockImplementation(()=>now);
    const fixture=fakeTransport('2.8.1',c=>{if(c.startsWith('SM,')){now+=2500;moved=true;}},c=>c==='QC'?`0394,${moved?'0010':'0300'}\r\nOK`:undefined);
    const core=new PlotterCore(fixture.transport,{sleep:async ms=>{now+=ms;}});
    try {
      await core.connect(); await expect(core.plot(buildMotionPlan(stroke,settings))).rejects.toThrow('supply');
      expect(fixture.commands).toContain('ES,1'); expect(fixture.commands.some(c=>c.startsWith('HM,'))).toBe(false);
      expect(core.elapsedMs).toBeGreaterThan(2500); const elapsed=core.elapsedMs; now+=5000; expect(core.elapsedMs).toBe(elapsed);
      expect(core.originStatus).toBe('unset'); await core.disconnect();
    } finally {clock.mockRestore();}
  });
});

describe('plot after raised bounds preview',()=>{
  it.each(['3.1.7','2.8.1'])('restores physical down commands and calibration after bounds (%s)',async version=>{
    const fixture=fakeTransport(version),core=new PlotterCore(fixture.transport,{sleep:async()=>{}});
    const calibrated={...settings,penUp:30,penDown:44};
    const plan=buildMotionPlan(stroke,calibrated);
    await core.connect(); await core.plot(buildBoundsPreview(plan));
    const start=fixture.commands.length; await core.plot(plan);
    const commands=fixture.commands.slice(start);
    // Every new job must establish both physical endpoints before its forced
    // startup lift, even when the previous job only travelled with the pen up.
    const startup=commands.findIndex(c=>c.startsWith('SP,1,'));
    expect(commands.slice(0,startup).filter(c=>c.startsWith('SC,'))).toEqual(expect.arrayContaining(['SC,2,0',...servoSetup(30,44)]));
    expect(commands.filter(c=>c.startsWith('SP,')).map(c=>Number(c.split(',')[1]))).toEqual([1,0,1]);
    const lower=commands.findIndex(c=>c.startsWith('SP,0,'));
    expect(commands.slice(lower+1).some(c=>c.startsWith('SM,'))).toBe(true);
    expect(core.diagnosticJobTrace?.settings.penDown).toBe(44);
    await core.disconnect();
  });
});
