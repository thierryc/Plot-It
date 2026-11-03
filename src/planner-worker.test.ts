import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState } from './model';
import { defaultPens } from './pens';
import type { PlotPath } from './svg';
import type { MotionPlan,MotionComparison } from './motion-plan';
let worker: { postMessage: ReturnType<typeof vi.fn>; onmessage?: (event: MessageEvent) => void };
const paths: PlotPath[] = [
  { tool: '#000000', points: [{ x: 20, y: 20 }, { x: 25, y: 20 }] },
  { tool: '#FF0000', points: [{ x: 30, y: 20 }, { x: 35, y: 20 }] }
];
beforeEach(async () => {
  vi.resetModules(); worker = { postMessage: vi.fn() }; vi.stubGlobal('self', worker);
  // Import the actual worker entry in a context without document/window.
  await import('./planner.worker');
});
afterEach(() => vi.unstubAllGlobals());
function run(overrides: Record<string, unknown> = {}) {
  worker.postMessage.mockClear();
  worker.onmessage!({ data: { paths, settings: structuredClone(initialState.settings), paper: initialState.paper, preferences: defaultPens(), ...overrides } } as MessageEvent);
  return worker.postMessage.mock.calls.at(-1)![0] as { plan?: MotionPlan; comparison?:MotionComparison;error?: string };
}
describe('actual planner worker entry', () => {
  it('compares strategies against the same optimized geometry and preserves the selected strategy',()=>{
    const settings={...initialState.settings,profile:'xylodraw',motionPreference:'scurve',motionFirmware:'3.1.7',motionStrategy:'standard',pathJoinToleranceMm:.2,maxPenDownMm:6};
    const source=[{tool:'#000000',points:[{x:10,y:10},{x:20,y:10}]},{tool:'#000000',points:[{x:20.1,y:10},{x:30,y:10},{x:35,y:15}]}];
    const result=run({settings,paths:source,compare:true});
    expect(result.error).toBeUndefined();
    const {standard,dynamic}=result.comparison!;
    expect(standard.sourcePaths).toEqual(dynamic.sourcePaths);
    expect(standard.settings.motionStrategy).toBe('standard');
    expect(dynamic.settings.motionStrategy).toBe('dynamic');
    expect(result.plan).toEqual(standard);
    expect(standard.executable!.backend).toBe('t3');expect(dynamic.executable!.backend).toBe('t3');
    expect(dynamic.events.filter(e=>e.kind==='pen').map(e=>e.penDown)).toEqual(standard.events.filter(e=>e.kind==='pen').map(e=>e.penDown));
    expect(run({settings,paths:source,compare:true}).comparison).toEqual(result.comparison);
  });
  it('shares prepared layers and rejects comparisons on unsupported backends',()=>{
    const settings={...initialState.settings,motionPreference:'scurve',motionFirmware:'3.1.7'};
    const layered=paths.map((p,i)=>({...p,layerId:`layer-${i}`}));
    const layers=[{id:'layer-0',name:'First',sourceOrder:0},{id:'layer-1',name:'Second',sourceOrder:1,controls:{delayMs:200}}];
    const result=run({paths:layered,layers,settings,compare:true});
    expect(result.error).toBeUndefined();
    expect(result.comparison!.standard.layers).toEqual(result.comparison!.dynamic.layers);
    expect(result.comparison!.dynamic.executable!.records.some(r=>r.kind==='delay')).toBe(true);
    expect(run({compare:true}).error).toMatch(/requires S-curve/);
  });
  it('applies optimization before reload splitting and repeats seeded plans in the real worker',()=>{
    const configured={...initialState.settings,pathJoinToleranceMm:.2,pathSimplifyToleranceMm:.01,closedPathStart:'random',pathRandomSeed:98,maxPenDownMm:6};
    const source=[{tool:'#000000',points:[{x:10,y:10},{x:20,y:10}]},{tool:'#000000',points:[{x:20.1,y:10},{x:30,y:10}]},{tool:'#000000',points:[{x:50,y:50},{x:60,y:50},{x:60,y:60},{x:50,y:50}]}];
    const first=run({paths:source,settings:configured}); expect(first.error).toBeUndefined();
    expect(run({paths:source,settings:configured}).plan).toEqual(first.plan);
    expect(first.plan!.events.filter(event=>event.kind==='pen'&&event.penDown).length).toBeGreaterThan(4);
    let drawn=0;
    for (const event of first.plan!.events) {
      if (event.kind==='xy'&&event.penDown) drawn+=Math.hypot(event.to.x-event.from.x,event.to.y-event.from.y);
      if (event.kind==='pen'&&!event.penDown) { expect(drawn).toBeLessThanOrEqual(6.05); drawn=0; }
    }
  });
  it('starts without browser DOM globals and returns pen metadata, motion and settled pen boundaries', () => {
    expect(typeof document).toBe('undefined'); const result = run();
    expect(result.error).toBeUndefined(); const plan = result.plan!;
    expect(plan.pens?.map(pen => pen.color)).toEqual(['#000000', '#FF0000']);
    expect(plan.passes.map(pass => pass.tool)).toEqual(['#000000', '#FF0000']); expect(plan.duration).toBeGreaterThan(0);
    const boundary = plan.events[plan.passes[1]!.startEvent]!;
    expect(boundary.kind).toBe('tool'); expect(boundary.from).toEqual({ x: 0, y: 0 }); expect(boundary.penDown).toBe(false);
    expect(worker.postMessage.mock.calls.some(([data]) => data.progress)).toBe(true);
  });
  it('returns explicit validation errors and can process another request afterward', () => {
    expect(run({ settings: { ...initialState.settings, speed: 0 } }).error).toContain('Invalid speed');
    expect(run().plan?.passes).toHaveLength(2);
  });
  it('returns a zero-motion plan when artwork is genuinely empty or clipped away', () => {
    for (const source of [[], [{ tool: '#000000', points: [{ x: -20, y: -20 }, { x: -10, y: -20 }] }]]) {
      const plan = run({ paths: source }).plan!; expect(plan.events).toEqual([]); expect(plan.passes).toEqual([]); expect(plan.duration).toBe(0);
    }
  });
  it('keeps the discovered palette when every pen is excluded', () => {
    const preferences = defaultPens(); preferences.excluded = ['#000000', '#FF0000'];
    const plan = run({ preferences }).plan!;
    expect(plan.events).toEqual([]); expect(plan.pens).toHaveLength(2); expect(plan.pens!.every(pen => !pen.included)).toBe(true);
  });
});
