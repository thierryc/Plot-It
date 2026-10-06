import { describe, expect, it } from 'vitest';
import { initialState } from './model';
import { buildMotionPlan, compileMotion, normalizeMotionTiming, samplePlan, type MotionEvent } from './motion-plan';
import { planPolyline } from './trajectory';
import { canvasPoint, machinePoint, quantizePoint, roundStepPath } from './motion';
import { validateMotionCommand, COMPILED_MAX_STEP_RATE } from './motion-command';
const settings={...initialState.settings,returnToOrigin:false};
describe('shared accelerated motion',()=>{
  it('joins touching ordinary paths without changing their inputs or adding a pen tap', () => {
    const paths = [{points:[{x:0,y:0},{x:10,y:0}],tool:'#000000'}, {points:[{x:10,y:0},{x:20,y:0}],tool:'#000000'}];
    const before = structuredClone(paths), plan = buildMotionPlan(paths,settings);
    expect(plan.events.filter(e => e.kind === 'pen' && e.penDown)).toHaveLength(1);
    expect(plan.passes).toHaveLength(1); expect(paths).toEqual(before);
    expect(samplePlan(plan,plan.duration).position).toEqual({x:20,y:0});
  });
  it.each(['protected','line breaks','different pens','different widths'])('retains required lifts for %s', reason => {
    const paths = [{points:[{x:0,y:0},{x:10,y:0}],tool:'#000000',orderGroup:reason === 'protected' ? 'text:1' : undefined,width:1}, {points:[{x:10,y:0},{x:20,y:0}],tool:reason === 'different pens' ? '#FF0000' : '#000000',width:reason === 'different widths' ? 2 : 1}];
    const plan = buildMotionPlan(paths,{...settings,maxPenDownMm:reason === 'line breaks' ? 10 : 0});
    expect(plan.events.filter(e => e.kind === 'pen' && e.penDown)).toHaveLength(2);
  });
  it('uses longer shared servo waits for large calibrated lift distances', () => {
    const paths = [{points:[{x:0,y:0},{x:10,y:0}],tool:'#000000'}];
    const normal = buildMotionPlan(paths,settings), wide = buildMotionPlan(paths,{...settings,penUp:0,penDown:100});
    expect(wide.events.filter(e => e.kind === 'pen').every(e => e.duration > .12)).toBe(true);
    expect(wide.duration).toBeGreaterThan(normal.duration);
    expect(wide.events.filter(e => e.kind === 'xy')).toEqual(normal.events.filter(e => e.kind === 'xy').map((e,i) => ({...e,start:wide.events.filter(e => e.kind === 'xy')[i]!.start})));
  });
  it.each(['axidraw','xylodraw'] as const)('omits sub-step and coincident paths before deriving %s passes', profile => {
    const plan = buildMotionPlan([{points:[{x:20,y:20},{x:20.001,y:20}],tool:'#f00'},{points:[{x:30,y:30},{x:30,y:30}],tool:'#000'}],{...settings,profile});
    expect(plan.passes).toEqual([]); expect(plan.events).toEqual([]); expect(plan.duration).toBe(0);
  });
  it.each([0, 90, 180, 270] as const)('uses rotated mixed axes for timed commands at %s degrees', machineRotation => {
    const rotated = { ...settings, machineRotation };
    const plan = buildMotionPlan([{ points: [{x:0,y:0},{x:10,y:4}], tool:'#111' }], rotated);
    const expected = machinePoint({x:400,y:160}, machineRotation);
    {
      let cursor = {x:0,y:0}, motor1 = 0, motor2 = 0;
      for (const event of plan.events) for (const move of compileMotion(event, rotated, cursor)) {
        const values = move.command.split(',').map(Number);
        motor1 += values[2]! + values[3]!; motor2 += values[2]! - values[3]!;
        cursor = move.targetSteps;
      }
      expect(cursor).toEqual(expected);
      expect({x: (motor1 + motor2)/2, y: (motor1 - motor2)/2}).toEqual(expected);
      expect(canvasPoint(expected, machineRotation)).toEqual({x:400,y:160});
    }
    expect(samplePlan(plan,plan.duration).position).toEqual({x:10,y:4});
  });
  it('matches analytical triangular and trapezoidal straight motion',()=>{
    const triangle=planPolyline([{x:0,y:0},{x:2,y:0}],{acceleration:200,maximumVelocity:35,cornering:.127});
    expect(triangle.reduce((s,b)=>s+b.duration,0)).toBeCloseTo(2*Math.sqrt(2/200));
    const trapezoid=planPolyline([{x:0,y:0},{x:100,y:0}],{acceleration:200,maximumVelocity:35,cornering:.127});
    expect(trapezoid.reduce((s,b)=>s+b.duration,0)).toBeCloseTo(100/35+35/200);
  });
  it.each([
    [{x:10,y:10},{x:20,y:10}],
    [{x:10,y:10},{x:20,y:10},{x:20,y:20}],
    [{x:10,y:10},{x:20,y:10},{x:10,y:10}],
    [{x:10,y:10},{x:10,y:10},{x:10.1,y:10}],
  ])('preserves polyline geometry and endpoints',(...points)=>{
    const plan=buildMotionPlan([{points,tool:'#111111'}],settings);
    const draw=plan.events.filter(e=>e.kind==='xy'&&e.penDown);
    const expected=points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-points[i]!.x,p.y-points[i]!.y),0);
    expect(draw.reduce((sum,e)=>sum+Math.hypot(e.to.x-e.from.x,e.to.y-e.from.y),0)).toBeCloseTo(expected);
    expect(draw[0]!.stopBefore).toBe(true);
    const last=draw.at(-1)!; expect(last.initialSpeed+last.acceleration*last.duration).toBeCloseTo(0);
    expect(samplePlan(plan,plan.duration).position).toEqual(points.at(-1));
  });
  it('handles empty and coincident paths without NaN',()=>{
    for(const points of [[],[{x:0,y:0}],[{x:0,y:0},{x:0,y:0}]]){
      const p=buildMotionPlan([{points,tool:'#111'}],settings);expect(Number.isFinite(p.duration)).toBe(true);expect(samplePlan(p,p.duration).position).toEqual({x:0,y:0});
    }
  });
  it('includes servo waits, tool stops and optional origin travel',()=>{
    const paths=[{points:[{x:0,y:0},{x:10,y:0}],tool:'#111'},{points:[{x:20,y:0},{x:30,y:0}],tool:'#f00'}];
    const p=buildMotionPlan(paths,{...settings,returnToOrigin:true});
    expect(p.events.filter(e=>e.kind==='tool')).toHaveLength(1);
    expect(p.events.filter(e=>e.kind==='pen').reduce((t,e)=>t+e.duration,0)).toBeCloseTo(1.193);
    expect(samplePlan(p,p.duration).position).toEqual({x:0,y:0});
  });
  it.each(['axidraw','xylodraw'] as const)('quantizes negative and mixed motor axes for %s',profile=>{
    const p=buildMotionPlan([{points:[{x:0,y:0},{x:-10,y:5}],tool:'#111'}],{...settings,profile});
    let cursor={x:0,y:0};const commands:string[]=[];
    for(const e of p.events)for(const move of compileMotion(e,p.settings,cursor)){commands.push(move.command);cursor=move.targetSteps;}
    expect(cursor).toEqual({x:profile==='axidraw'?-200:-250,y:profile==='axidraw'?-400:-500});
    expect(commands.every(c=>c.startsWith('XM,')&&!c.includes('NaN'))).toBe(true);
  });
  it('retains cumulative substep movement and closes exactly',()=>{
    const points=Array.from({length:100},(_,i)=>({x:i*.002,y:0}));points.push({x:0,y:0});
    const p=buildMotionPlan([{points,tool:'#111'}],settings);let cursor={x:0,y:0};
    for(const e of p.events)for(const m of compileMotion(e,settings,cursor))cursor=m.targetSteps;
    expect(cursor).toEqual({x:0,y:0});
  });
  it.each(['axidraw','xylodraw'] as const)('plans from rounded %s geometry and skips repeated step endpoints', profile => {
    const configured = {...settings,profile}, scale = profile === 'axidraw' ? 40 : 50;
    const points = [{x:0,y:0},{x:.001,y:.001},{x:.009,y:0},{x:1.011,y:.014}];
    const rounded = roundStepPath(points, configured), plan = buildMotionPlan([{points,tool:'#111'}], configured);
    expect(rounded).toHaveLength(2);
    expect(samplePlan(plan,plan.duration).position).toEqual(rounded.at(-1));
    const length = plan.events.filter(e=>e.kind==='xy'&&e.penDown).reduce((sum,e)=>sum+Math.hypot(e.to.x-e.from.x,e.to.y-e.from.y),0);
    expect(length).toBeCloseTo(Math.hypot(Math.round(1.011*scale)/scale,Math.round(.014*scale)/scale),10);
    let cursor = {x:0,y:0};
    for (const event of plan.events) {
      const moves = compileMotion(event, configured, cursor);
      if (event.kind === 'xy') expect(moves.reduce((sum,move)=>sum+move.durationMs,0)).toBeCloseTo(event.duration*1000,8);
      for (const move of moves) { validateMotionCommand(move.command); cursor = move.targetSteps; }
    }
    expect(cursor).toEqual(quantizePoint(points.at(-1)!,configured));
  });
  it('compensates integer-step overspeed in the shared timeline', () => {
    const event: MotionEvent = {kind:'xy',from:{x:0,y:0},to:{x:1,y:1},start:0,duration:.001,initialSpeed:Math.SQRT2/.001,acceleration:0,penDown:false,tool:''};
    const fixed = normalizeMotionTiming(event, settings), moves = compileMotion(fixed, settings, {x:0,y:0});
    expect(fixed.duration).toBe(.004);
    expect(moves.reduce((sum,move)=>sum+move.durationMs,0)).toBe(fixed.duration*1000);
    expect(fixed.initialSpeed * fixed.duration).toBeCloseTo(Math.SQRT2,12);
    for (const move of moves) {
      validateMotionCommand(move.command);
      const [,ms,dx,dy]=move.command.split(',').map(Number);
      expect(Math.max(Math.abs(dx!+dy!),Math.abs(dx!-dy!))*1000/ms!).toBeLessThanOrEqual(COMPILED_MAX_STEP_RATE);
    }
  });
  it('coalesces empty step intervals without losing time or asking for too-slow motor rates', () => {
    const event: MotionEvent = {kind:'xy',from:{x:0,y:0},to:{x:.025,y:0},start:0,duration:2,initialSpeed:.0125,acceleration:0,penDown:false,tool:''};
    const moves = compileMotion(event, settings, {x:0,y:0});
    expect(moves.length).toBeLessThanOrEqual(3);
    expect(moves.reduce((sum,move)=>sum+move.durationMs,0)).toBe(2000);
    expect(moves.at(-1)!.targetSteps).toEqual({x:0,y:1});
    for (const move of moves) validateMotionCommand(move.command);
  });
  it.each(['axidraw','xylodraw'] as const)('preserves timing and closes dense, rounded strokes at every %s orientation', profile => {
    let seed = 321;
    const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32);
    const points = [{x:0,y:0}];
    for (let i=0; i<200; i++) {
      const previous=points.at(-1)!,angle=random()*Math.PI*2,distance=.002+random()*.2;
      points.push({x:previous.x+Math.cos(angle)*distance,y:previous.y+Math.sin(angle)*distance});
    }
    points.push({x:0,y:0});
    for (const machineRotation of [0,90,180,270] as const) {
      const configured={...settings,profile,machineRotation},plan=buildMotionPlan([{points,tool:'#111'}],configured);
      let cursor={x:0,y:0};
      for (const event of plan.events) {
        const moves=compileMotion(event,configured,cursor);
        if (event.kind==='xy') {
          expect(moves.reduce((sum,move)=>sum+move.durationMs,0)).toBeCloseTo(event.duration*1000,8);
          expect(event.initialSpeed*event.duration+.5*event.acceleration*event.duration**2).toBeCloseTo(Math.hypot(event.to.x-event.from.x,event.to.y-event.from.y),8);
        }
        for (const move of moves) { validateMotionCommand(move.command); cursor=move.targetSteps; }
      }
      expect(cursor).toEqual({x:0,y:0});
      expect(samplePlan(plan,plan.duration).position).toEqual({x:0,y:0});
      expect(plan.events.filter(event=>event.kind==='pen'&&event.penDown)).toHaveLength(1);
    }
  });
  it.each(['axidraw','xylodraw'] as const)('does not slow a densely sampled gentle line at artificial %s step corners', profile => {
    const points=Array.from({length:2001},(_,i)=>({x:i*.03,y:i*.03*.23}));
    const plan=buildMotionPlan([{points,tool:'#111'}],{...settings,profile});
    const drawing=plan.events.filter(event=>event.kind==='xy'&&event.penDown);
    expect(Math.max(...drawing.map(event=>event.initialSpeed))).toBeGreaterThan(34);
    expect(drawing.filter(event=>event.stopBefore)).toHaveLength(1);
    expect(plan.events.filter(event=>event.kind==='pen'&&event.penDown)).toHaveLength(1);
    const sparse=buildMotionPlan([{points:[points[0]!,points.at(-1)!],tool:'#111'}],{...settings,profile});
    expect(plan.events).toEqual(sparse.events);
  });
  it('timed motion lands on the same endpoint with bounded intervals',()=>{
    const p=buildMotionPlan([{points:[{x:0,y:0},{x:10,y:4}],tool:'#111'}],settings);let cursor={x:0,y:0};
    for(const e of p.events)for(const m of compileMotion(e,settings,cursor)){expect(Number(m.command.split(',')[1])).toBeLessThanOrEqual(15);cursor=m.targetSteps;}
    expect(cursor).toEqual({x:-160,y:400});
  });
  it('rejects invalid physical settings',()=>{
    expect(()=>buildMotionPlan([],{...settings,drawAcceleration:0})).toThrow();
  });
});
