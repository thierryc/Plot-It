import { describe, expect, it, vi } from 'vitest';
import { fakeTransport } from '../server/test-fixtures/fake-ebb';
import { initialState } from './model';
import { buildMotionPlan, samplePlan } from './motion-plan';
import { compilePlotProcess } from './plot-process';
import { penTransition, travelSettlingDelay } from './pen-control';
import { PlotterCore } from './plotter-core';
import { indexPenCounts } from './plot-signals';
import { validateJob } from './network-protocol';

const settings={...initialState.settings,penUp:30,penDown:52};
const path=(x:number)=>[{tool:'#000000',points:[{x,y:0},{x:x+12,y:0}]}];

describe('carriage and pen settling',()=>{
  it.each([0,49,50,100])('adds a raised stationary dwell before lowering after %s mm of travel',distance=>{
    const plan=buildMotionPlan(path(distance),settings),lower=plan.events.findIndex(e=>e.kind==='pen'&&e.penDown);
    const dwell=plan.events[lower-1]!;
    expect(travelSettlingDelay(distance)).toBe(distance>=50?100:0);
    if(distance>=50) {
      expect(dwell).toMatchObject({kind:'xy',duration:.1,penDown:false,initialSpeed:0,acceleration:0,stopBefore:true});
      expect(dwell.from).toEqual(dwell.to);
      expect(samplePlan(plan,dwell.start+.05)).toMatchObject({position:dwell.to,penDown:false});
      expect(compilePlotProcess(plan).steps[lower-1]!.moves.map(m=>m.command)).toEqual(['SM,100,0,0']);
    } else expect(dwell.kind!=='xy'||dwell.from.x!==dwell.to.x).toBe(true);
    expect(plan.events[lower]!.duration*1000).toBe(penTransition(30,52,false).duration);
    expect(penTransition(30,52,false).duration).toBe(166);
    expect(indexPenCounts(plan).at(-1)).toEqual({up:2,down:1});
    expect(()=>validateJob({version:1,requestId:'settling',plan})).not.toThrow();
  });

  it('waits with the pen raised before SP down and waits after SP down before drawing',async()=>{
    let now=0,readyToLower=0,readyToDraw=0,sawWait=false;
    const clock=vi.spyOn(performance,'now').mockImplementation(()=>now);
    let core!:PlotterCore;
    const fixture=fakeTransport('2.8.1',command=>{
      if(command==='SM,100,0,0') { expect(core.executionSignal?.penDown).toBe(false); readyToLower=now+100; sawWait=true; }
      if(command==='QG') now=Math.max(now,readyToLower);
      if(command.startsWith('SP,0,')) { expect(sawWait).toBe(true); expect(now).toBeGreaterThanOrEqual(readyToLower); readyToDraw=now+Number(command.split(',')[2]); }
      if(command.startsWith('SM,')&&core.executionSignal?.penDown) expect(now).toBeGreaterThanOrEqual(readyToDraw);
    });
    core=new PlotterCore(fixture.transport,{sleep:async ms=>{now+=ms;}});
    try {await core.connect(); await core.plot(buildMotionPlan(path(100),settings)); expect(sawWait).toBe(true); await core.disconnect();}
    finally {clock.mockRestore();}
  });
});
