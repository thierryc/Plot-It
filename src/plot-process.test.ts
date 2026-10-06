import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialState } from './model';
import { buildMotionPlan } from './motion-plan';
import { compilePlotProcess, executePlotProcess, type PlotStep } from './plot-process';
import { PlotterCore } from './plotter-core';
import { Simulation } from './simulation';
import type { PlotSignal } from './plot-signals';
import { servoPosition } from './pen-control';
import { fakeTransport } from '../server/test-fixtures/fake-ebb';
import { defaultPens, preparePenPaths } from './pens';

const drawing = () => buildMotionPlan([
  { tool: '#000000', points: [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }] },
  // Return to a repeated coordinate: XY alone cannot identify this pen change.
  { tool: '#000000', points: [{ x: 10, y: 10 }, { x: 10, y: 20 }] },
  { tool: '#FF0000', points: [{ x: 10, y: 10 }, { x: 20, y: 20 }] },
], { ...initialState.settings, penUp: 20, penDown: 42, returnToOrigin: true });
const optimizedDrawing=()=>{
  const settings={...initialState.settings,pathJoinToleranceMm:.2,pathSimplifyToleranceMm:.01,closedPathStart:'random' as const,pathRandomSeed:22,maxPenDownMm:8};
  const source=[{tool:'#000000',points:[{x:10,y:10},{x:20,y:10}]},{tool:'#000000',points:[{x:20.1,y:10},{x:30,y:10}]},{tool:'#000000',points:[{x:40,y:40},{x:45,y:40},{x:45,y:45},{x:40,y:40}]}];
  return buildMotionPlan(preparePenPaths(source,settings,defaultPens()).paths,settings);
};
afterEach(() => vi.unstubAllGlobals());

describe('clean plot process', () => {
  it.each(['2.4.6', '2.8.1'])('reloads the mechanical pen in place at the continuous-distance limit (%s)', async version => {
    const settings = { ...initialState.settings, maxPenDownMm: 30, returnToOrigin: false };
    // The first 30 mm crosses a corner: use drawn length, not displacement.
    const source = [{ tool: '#000000', points: [{x:10,y:10},{x:35,y:10},{x:35,y:65}] }];
    const prepared = preparePenPaths(source, settings, defaultPens());
    const plan = buildMotionPlan(prepared.paths, settings);
    const lengths: number[] = []; let drawn = 0;
    for (const event of plan.events) {
      if (event.kind === 'xy' && event.penDown) drawn += Math.hypot(event.to.x - event.from.x, event.to.y - event.from.y);
      if (event.kind === 'pen' && !event.penDown && drawn) { lengths.push(drawn); drawn = 0; }
    }
    expect(lengths).toHaveLength(3); lengths.forEach((length,i) => expect(length).toBeCloseTo([30,30,20][i]!));
    expect(plan.passes).toHaveLength(1); expect(plan.events.some(event => event.kind === 'tool')).toBe(false);
    const fixture = fakeTransport(version), core = new PlotterCore(fixture.transport, { sleep: async () => {} });
    await core.connect(); await core.plot(plan);
    const penEvents = plan.events.filter(event => event.kind === 'pen');
    expect(penEvents.map(event => ({down:event.penDown,position:event.to}))).toEqual([
      {down:false,position:{x:0,y:0}}, {down:true,position:{x:10,y:10}},
      {down:false,position:{x:35,y:15}}, {down:true,position:{x:35,y:15}},
      {down:false,position:{x:35,y:45}}, {down:true,position:{x:35,y:45}},
      {down:false,position:{x:35,y:65}},
    ]);
    const penCommands = fixture.commands.map((command,index) => ({command,index})).filter(entry => entry.command.startsWith('SP,'));
    expect(penCommands.map(entry => Number(entry.command.split(',')[1]))).toEqual([1,0,1,0,1,0,1]);
    for (const up of [2,4]) {
      const between = fixture.commands.slice(penCommands[up]!.index + 1, penCommands[up+1]!.index);
      expect(between.some(command => /^(XM|HM),/.test(command))).toBe(false);
      expect(between).toContain(version === '2.8.1' ? 'QG' : 'QM');
    }
    expect(fixture.commands.some(command => command.startsWith('HM,'))).toBe(false);
    expect(core.progress.state).toBe('finished'); await core.disconnect();
    const continuous = { ...settings, maxPenDownMm: 0 };
    const unsplit = preparePenPaths(source, continuous, defaultPens());
    expect(buildMotionPlan(unsplit.paths, continuous).events.filter(event => event.kind === 'pen' && event.penDown)).toHaveLength(1);
  });

  it.each([
    ['2.4.6', 'up'], ['2.4.6', 'down'], ['2.8.1', 'up'], ['2.8.1', 'down'],
  ])('raises before leaving origin after manual pen %s / %s and returns raised', async (version, height) => {
    const plan = buildMotionPlan([
      { tool: '#000000', points: [{ x: 10, y: 10 }, { x: 20, y: 10 }] },
    ], { ...initialState.settings, penUp: 20, penDown: 42, returnToOrigin: true });
    const fixture = fakeTransport(version), core = new PlotterCore(fixture.transport, { sleep: async () => {} });
    const settled: PlotSignal[] = [];
    core.onSignal = signal => { if (signal.phase === 'settled') settled.push(signal); };
    await core.connect(); await core.setOrigin();
    await core.setPen(height === 'up' ? plan.settings.penUp : plan.settings.penDown);
    // Even cached Up must be reissued: a physical adjustment is not observable.
    const before = fixture.commands.length;
    await core.plot(plan);
    const commands = fixture.commands.slice(before);
    expect(commands).toContain(`SC,4,${servoPosition(plan.settings.penUp)}`);
    const firstLift = commands.findIndex(command => command.startsWith('SP,'));
    const firstMotion = commands.findIndex(command => /^(LM|XM),/.test(command));
    expect(commands[firstLift]).toMatch(/^SP,1,\d+,1$/);
    expect(firstLift).toBeLessThan(firstMotion);
    expect(commands.slice(firstLift + 1, firstMotion)).toContain(version === '2.8.1' ? 'QG' : 'QM');
    expect(settled[0]).toMatchObject({ kind: 'pen', position: { x: 0, y: 0 }, penDown: false });
    const reverse = [...commands].reverse();
    const lastLift = commands.length - 1 - reverse.findIndex(command => command.startsWith('SP,'));
    const lastMotion = commands.length - 1 - reverse.findIndex(command => /^(LM|XM),/.test(command));
    expect(commands[lastLift]).toMatch(/^SP,1,\d+,1$/);
    expect(lastLift).toBeLessThan(lastMotion);
    expect(commands.slice(lastLift + 1, lastMotion)).toContain(version === '2.8.1' ? 'QG' : 'QM');
    expect(settled.at(-1)).toMatchObject({ kind: 'xy', position: { x: 0, y: 0 }, penDown: false });
    await core.disconnect();
  });

  it('rejects plans without an initial lift or the requested return before hardware preparation', async () => {
    const fixture = fakeTransport(), core = new PlotterCore(fixture.transport, { sleep: async () => {} });
    await core.connect(); const before = fixture.commands.length;
    const missingLift = drawing(); missingLift.events.shift();
    const startsDown = drawing(); startsDown.events[0]!.penDown = true;
    for (const plan of [missingLift, startsDown]) await expect(core.plot(plan)).rejects.toThrow('start by raising the pen at the origin');
    const missingReturn = buildMotionPlan([
      { tool: '#000000', points: [{ x: 10, y: 10 }, { x: 20, y: 10 }] },
    ], { ...initialState.settings, returnToOrigin: false });
    missingReturn.settings.returnToOrigin = true;
    await expect(core.plot(missingReturn)).rejects.toThrow('finish at the origin');
    expect(fixture.commands).toHaveLength(before); expect(core.active).toBe(false);
    const shortWait = drawing(); shortWait.events[0]!.duration = .001;
    await expect(core.plot(shortWait)).rejects.toThrow('pen settling time');
    expect(fixture.commands).toHaveLength(before);
    await core.disconnect();
  });

  it('reissues and settles a cached Up before manual origin return', async () => {
    const fixture = fakeTransport(), core = new PlotterCore(fixture.transport, { sleep: async () => {} });
    await core.connect(); await core.setOrigin();
    await core.setPen(initialState.settings.penUp);
    const before = fixture.commands.length;
    await core.returnToOrigin(initialState.settings);
    const commands = fixture.commands.slice(before);
    const lift = commands.findIndex(command => command.startsWith('SP,'));
    const home = commands.findIndex(command => command.startsWith('HM,'));
    expect(commands[lift]).toMatch(/^SP,1,\d+,1$/);
    // Do not use a zero-distance ramp/dwell derived from the cached Up height.
    expect(fixture.commands).toContain('SC,11,1845');
    expect(Number(commands[lift]!.split(',')[2])).toBeGreaterThanOrEqual(349);
    expect(lift).toBeLessThan(home);
    expect(commands.slice(lift + 1, home)).toContain('QG');
    await core.disconnect();
  });

  it.each([
    ['2.4.6','ordinary',drawing],['2.8.1','ordinary',drawing],['2.4.6','optimized + reloads',optimizedDrawing],['2.8.1','optimized + reloads',optimizedDrawing],
  ] as const)('matches every simulation event, position, height and counter on firmware %s (%s)', async (version,_label,makePlan) => {
    const plan = makePlan(), simulated: PlotSignal[] = [], executed: PlotSignal[] = [];
    let frame!: FrameRequestCallback;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const simulation = new Simulation(plan, () => {}, signal => simulated.push(signal));
    frame(0); frame(100_000);
    if (plan.events.some(event=>event.kind==='tool')) { simulation.play(); frame(200_000); frame(300_000); }
    simulation.destroy();
    const fixture = fakeTransport(version), core = new PlotterCore(fixture.transport, { sleep: async () => {} });
    core.onSignal = signal => executed.push(signal);
    core.onProgress = progress => { if (progress.state === 'tool-change') core.resume(); };
    await core.connect(); await core.plot(plan);
    const comparable = (signals: PlotSignal[]) => signals.filter(signal => signal.phase === 'settled').map(({ source: _source, elapsedMs: _elapsed, ...signal }) => signal);
    expect(comparable(executed)).toEqual(comparable(simulated));
    expect(comparable(executed)).toHaveLength(plan.events.length);
    expect(fixture.commands.filter(command => command.startsWith('SP,'))).toHaveLength(plan.events.filter(event => event.kind === 'pen').length);
    expect(fixture.commands.filter(command => command.startsWith('SP,')).map(command => Number(command.split(',')[2])))
      .toEqual(plan.events.filter(event => event.kind === 'pen').map(event => Math.round(event.duration * 1000)));
    expect(fixture.commands.some(command => /^(S2|TP),|^SC,(1|10),/.test(command))).toBe(false);
    expect(core.diagnosticJobTrace!.plan).toEqual(plan);
    expect(core.diagnosticJobTrace!.signals).toEqual(executed);
    await core.disconnect();
  });

  it('validates every event before issuing any hardware commands', async () => {
    const plan = drawing();
    plan.events.find(event => event.kind === 'xy')!.penDown = true;
    const fixture = fakeTransport(), core = new PlotterCore(fixture.transport, { sleep: async () => {} });
    await core.connect(); const before = fixture.commands.length;
    await expect(core.plot(plan)).rejects.toThrow('Pen state');
    expect(fixture.commands).toHaveLength(before); expect(core.active).toBe(false);
    await core.disconnect();
  });

  it('holds a pen command between drained XY sections until its idle barrier resolves', async () => {
    const process = compilePlotProcess(drawing());
    const firstDown = process.steps.find(step => step.event.kind === 'pen' && step.event.penDown)!.index;
    let waitingForPen = false, release!: () => void, reached!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const atPen = new Promise<void>(resolve => { reached = resolve; });
    const drawn: PlotStep[] = [];
    const task = executePlotProcess(process, {
      waitUntilIdle: async () => { if (waitingForPen) { reached(); await held; waitingForPen = false; } },
      boundary: async () => true, cancelled: () => false, changeTool: async () => {},
      movePen: async down => { if (down && !drawn.length) waitingForPen = true; },
      moveXY: async (_move, step) => { if (step.event.penDown) drawn.push(step); },
      signal: () => {}, progress: () => {},
    });
    await atPen; expect(drawn).toEqual([]);
    release(); await task;
    expect(drawn[0]!.index).toBeGreaterThan(firstDown);
  });

  it('services Pause/Stop boundaries before one-step strokes and short reversals', async () => {
    const plan = buildMotionPlan([{tool:'#000',points:[{x:0,y:0},{x:.025,y:0},{x:0,y:0}]}], {...initialState.settings,returnToOrigin:false});
    const process=compilePlotProcess(plan), boundaries:number[]=[], moves:number[]=[];
    const drawingSteps=process.steps.filter(step=>step.event.kind==='xy'&&step.event.penDown);
    expect(drawingSteps).toHaveLength(2);
    expect(drawingSteps.every(step=>step.event.initialSpeed>0&&step.event.stopBefore)).toBe(true);
    await executePlotProcess(process, {
      waitUntilIdle:async()=>{},boundary:async step=>{boundaries.push(step.index);return step.index!==drawingSteps[1]!.index;},
      cancelled:()=>false,changeTool:async()=>{},movePen:async()=>{},
      moveXY:async(_move,step)=>{moves.push(step.index);},signal:()=>{},progress:()=>{},
    });
    expect(boundaries).toContain(drawingSteps[0]!.index);
    expect(boundaries).toContain(drawingSteps[1]!.index);
    expect(moves).toContain(drawingSteps[0]!.index);
    expect(moves).not.toContain(drawingSteps[1]!.index);
  });

  it('executes its own snapshot when the input artwork changes during playback', () => {
    const input = drawing(), process = compilePlotProcess(input);
    input.events[0]!.penDown = true; input.settings.penDown = 100;
    expect(process.plan.events[0]!.penDown).toBe(false);
    expect(process.plan.settings.penDown).toBe(42);
    expect(() => compilePlotProcess(drawing(), 1)).toThrow('command limit');
  });
});
