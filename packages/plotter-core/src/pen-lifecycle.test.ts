import { describe, expect, it } from 'vitest';
import { PlotterSession, compileJob, defaultPen, machineProfile, sampleExecution, servoPulse, type PlotOptions } from './index.js';
import { ascii, text } from './protocol.js';
import { VirtualClock, VirtualEbb } from './virtual/index.js';

const options: PlotOptions = {
  profile: machineProfile('xylodraw'), pen: { ...defaultPen, up: 50, down: 60 },
  speed: 35, travelSpeed: 80, acceleration: 200, travelAcceleration: 400,
  cornering: .127, maxPenDownMm: 6, returnToOrigin: true, drawingMode: 'profiled',
};
const paths = [
  { tool: 'black', points: [{ x: 12, y: 10 }, { x: 30, y: 10 }] },
  { tool: 'black', points: [{ x: 40, y: 15 }, { x: 40, y: 25 }] },
];

describe('pen state across hardware runs', () => {
  it.each(['2.8.1', '3.1.7'] as const)('preserves pen/XY order through Stop, simulation, idle timeout, manual tests and bounds (%s)', async firmware => {
    const clock = new VirtualClock(), board = new VirtualEbb(clock, { firmware });
    const session = new PlotterSession(board.createTransport(), clock, options.profile);
    const plan = compileJob(paths, options), original = structuredClone(plan);
    let stopNext = false, stopped = false, drawingMoves = 0, observeDrawing = true;
    const observed: Array<{ penUp: boolean; pulse: number; penDown: boolean }> = [];
    session.subscribe(event => {
      if (!observeDrawing || event.kind !== 'record' || event.phase !== 'started') return;
      const record = plan.records[event.recordId!]!;
      if (record.kind !== 'motor') return;
      observed.push({ penUp: board.penUp, pulse: board.pulse, penDown: record.penDown });
      if (record.penDown) {
        drawingMoves++;
        if (stopNext && !stopped) { stopped = true; session.stop(); }
      }
    });
    await session.connect();
    expect(await session.run(plan)).toBe('finished');
    stopNext = true;
    expect(await session.run(plan)).toBe('stopped');
    expect(stopped).toBe(true);
    expect(board.penUp).toBe(true);
    expect(board.position).toEqual({ m1: 0, m2: 0 });
    const commands = board.commandCount;
    for (let ms = 0; ms <= plan.durationMs; ms += 50) sampleExecution(plan, ms);
    clock.advance(70000);
    expect(board.commandCount).toBe(commands);
    await session.setPen(options.pen.down);
    await session.setPen(options.pen.up);
    // Bounds has a different record timeline; temporarily observe it separately.
    const bounds = compileJob(paths, options, 'bounds');
    const boundsStates: boolean[] = [];
    const boundsSession = session.subscribe(event => {
      if (event.kind === 'record' && event.phase === 'started' && bounds.records[event.recordId!]?.kind === 'motor') boundsStates.push(board.penUp);
    });
    // The common plan observer only checks normal jobs.
    const beforeBounds = drawingMoves;
    observeDrawing = false;
    expect(await session.run(bounds)).toBe('finished');
    boundsSession(); observeDrawing = true;
    expect(boundsStates.length).toBeGreaterThan(0);
    expect(boundsStates.every(Boolean)).toBe(true);
    expect(drawingMoves).toBe(beforeBounds);
    const beforeRepeat = drawingMoves;
    expect(await session.run(plan)).toBe('finished');
    expect(drawingMoves).toBeGreaterThan(beforeRepeat);
    for (const state of observed) {
      expect(state.penUp).toBe(!state.penDown);
      expect(state.pulse).toBe(servoPulse(state.penDown ? options.pen.down : options.pen.up, options.profile));
    }
    expect(plan).toEqual(original);
    await session.disconnect();
  });

  it.each(['2.8.1', '3.1.7'] as const)('refuses XY after a later acknowledged Down remains Up (%s)', async firmware => {
    const clock = new VirtualClock(), board = new VirtualEbb(clock, { firmware });
    const bytes = board.createTransport();
    let loseDown = false;
    const session = new PlotterSession({ ...bytes, write: async data => {
      const command = text(data);
      // Acknowledge SP normally, but leave the controller at the wrong pen state.
      await bytes.write(loseDown && command.startsWith('SP,0,') ? ascii(command.replace('SP,0,', 'SP,1,')) : data);
    } }, clock, options.profile);
    const plan = compileJob(paths, options);
    await session.connect(); await session.run(plan);
    const start = board.trace.length;
    loseDown = true;
    await expect(session.run(plan)).rejects.toThrow(/pen state/i);
    const tail = board.trace.slice(start), failedDown = tail.findIndex(t => t.phase === 'completed' && t.command===`SP,1,${plan.records.find(r=>r.kind==='pen'&&r.penDown)!.durationMs},1`);
    expect(failedDown).toBeGreaterThanOrEqual(0);
    expect(tail.slice(failedDown + 1).some(t => t.command.startsWith('SM,'))).toBe(false);
    expect(session.origin.recoveryRequired).toBe(true);
    expect(board.penUp).toBe(true);
    loseDown = false;
    await session.setOrigin();
    expect(await session.run(plan)).toBe('finished');
    await session.disconnect();
  });
});


describe('relax plotter', () => {
  it.each(['2.8.1', '3.1.7'] as const)('settles Up before releasing motors and servo, and restores control afterward (%s)', async firmware => {
    const clock=new VirtualClock(), board=new VirtualEbb(clock,{firmware});
    const session=new PlotterSession(board.createTransport(),clock,options.profile);
    await session.connect(); session.configure(options.pen);
    await session.setOrigin(); await session.setPen(options.pen.down);
    const start=board.commands.length, traceStart=board.trace.length;
    await session.relax();
    const commands=board.commands.slice(start);
    const up=commands.findIndex(c=>c.startsWith('SP,1,'));
    const motors=commands.indexOf('EM,0,0'), servo=commands.indexOf('S2,0,4');
    expect(up).toBeGreaterThanOrEqual(0);
    expect(motors).toBeGreaterThan(up);
    if(firmware==='3.1.7'){expect(servo).toBe(-1);expect(commands.indexOf('SR,60000,0')).toBeGreaterThan(motors);}
    else{expect(servo).toBeGreaterThan(motors);expect(commands.indexOf('SR,60000,0')).toBeGreaterThan(servo);}
    const settled=board.trace.slice(traceStart).find(t=>t.phase==='completed'&&t.command===commands[up]);
    const released=board.trace.slice(traceStart).find(t=>t.phase==='accepted'&&t.command==='EM,0,0');
    expect(settled).toBeDefined();expect(released!.timeMs).toBeGreaterThanOrEqual(settled!.timeMs);
    expect(board.penUp).toBe(true);expect(board.motorsOn).toBe(false);
    expect(session.connected).toBe(true);expect(session.origin.source).toBe('unset');expect(session.origin.recoveryRequired).toBe(true);
    expect(commands.some(c=>c.startsWith('SM,')||c==='CS')).toBe(false);
    await expect(session.setOrigin(options.profile,'automatic')).rejects.toThrow(/origin/i);
    await session.setPen(options.pen.down);expect(board.penUp).toBe(false);
    await session.setPen(options.pen.up);await session.setOrigin();await session.disconnect();
  });
  it('disables the brushless servo signal on its own pin', async () => {
    const clock=new VirtualClock(),board=new VirtualEbb(clock,{firmware:'3.1.7'});
    const session=new PlotterSession(board.createTransport(),clock,machineProfile('nextdraw-8511'));
    await session.connect();await session.relax();
    expect(board.commands).toContain('S2,0,5');
    expect(board.commands.some(c=>c.startsWith('SR,'))).toBe(false);
    expect(board.motorsOn).toBe(false);await session.disconnect();
  });
  it('refuses to relax during a job or pause', async () => {
    const clock=new VirtualClock(),board=new VirtualEbb(clock),session=new PlotterSession(board.createTransport(),clock,options.profile);
    await session.connect();const before=board.commands.length;session.busy=true;
    await expect(session.relax()).rejects.toThrow(/idle/i);
    expect(board.commands).toHaveLength(before);session.busy=false;await session.disconnect();
  });
  it('keeps the servo enabled if raising the pen cannot be confirmed', async () => {
    const clock=new VirtualClock(),board=new VirtualEbb(clock,{firmware:'3.1.7'}),bytes=board.createTransport();
    let loseUp=false;
    const session=new PlotterSession({...bytes,write:async data=>{
      const command=text(data);await bytes.write(loseUp&&command.startsWith('SP,1,')?ascii(command.replace('SP,1,','SP,0,')):data);
    }},clock,options.profile);
    await session.connect();session.configure(options.pen);await session.setPen(options.pen.down);loseUp=true;
    const start=board.commands.length;await expect(session.relax()).rejects.toThrow(/pen state/i);
    const recovery=board.commands.slice(start);
    expect(recovery.some(c=>/^SR,.*?,0$/.test(c))).toBe(false);
    // Recovery may transiently disable unknown outputs to initialize them; a
    // failed Relax must never leave the final action as signal/power release.
    for(const [i,c]of recovery.entries())if(c.startsWith('S2,0,'))expect(recovery.slice(i+1).some(next=>next.startsWith('SP,'))).toBe(true);
    loseUp=false;await session.setPen(options.pen.up);await session.disconnect();
  });
});
