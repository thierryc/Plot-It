import { describe, expect, it } from 'vitest';
import { initialState } from './model';
import { buildMotionPlan, compileMotion, samplePlan, axisRate } from './motion-plan';
import { constantAccelerationPlan } from './vendor/saxi/planning';
import { canvasPoint, machinePoint } from './motion';
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
  it.each([0, 90, 180, 270] as const)('uses the same rotated machine axes for LM and XM at %s degrees', machineRotation => {
    const rotated = { ...settings, machineRotation };
    const plan = buildMotionPlan([{ points: [{x:0,y:0},{x:10,y:4}], tool:'#111' }], rotated);
    const expected = machinePoint({x:400,y:160}, machineRotation);
    for (const lm of [true, false]) {
      let cursor = {x:0,y:0}, motor1 = 0, motor2 = 0;
      for (const event of plan.events) for (const move of compileMotion(event, rotated, cursor, lm)) {
        const values = move.command.split(',').map(Number);
        if (lm) { motor1 += values[2]!; motor2 += values[5]!; }
        else { motor1 += values[2]! + values[3]!; motor2 += values[2]! - values[3]!; }
        cursor = move.targetSteps;
      }
      expect(cursor).toEqual(expected);
      expect({x: (motor1 + motor2)/2, y: (motor1 - motor2)/2}).toEqual(expected);
      expect(canvasPoint(expected, machineRotation)).toEqual({x:400,y:160});
    }
    expect(samplePlan(plan,plan.duration).position).toEqual({x:10,y:4});
  });
  it('matches analytical triangular and trapezoidal straight motion',()=>{
    const triangle=constantAccelerationPlan([{x:0,y:0},{x:1,y:0}],{acceleration:200,maximumVelocity:35,corneringFactor:.127});
    expect(triangle.duration()).toBeCloseTo(2*Math.sqrt(1/200));
    const trapezoid=constantAccelerationPlan([{x:0,y:0},{x:100,y:0}],{acceleration:200,maximumVelocity:35,corneringFactor:.127});
    expect(trapezoid.duration()).toBeCloseTo(100/35+35/200);
  });
  it.each([
    [{x:10,y:10},{x:20,y:10}],
    [{x:10,y:10},{x:20,y:10},{x:20,y:20}],
    [{x:10,y:10},{x:20,y:10},{x:10,y:10}],
    [{x:10,y:10},{x:10,y:10},{x:10.1,y:10}],
  ])('preserves pinned Saxi blocks, timing, and endpoints',(...points)=>{
    const plan=buildMotionPlan([{points,tool:'#111111'}],settings);
    const original=constantAccelerationPlan(points,{acceleration:200,maximumVelocity:35,corneringFactor:.127});
    const draw=plan.events.filter(e=>e.kind==='xy'&&e.penDown);
    expect(draw.length).toBe(original.length);
    expect(draw.reduce((t,e)=>t+e.duration,0)).toBeCloseTo(original.duration());
    draw.forEach((e,i)=>{expect(e.to).toEqual({x:original.p2x(i),y:original.p2y(i)});expect(e.initialSpeed).toBe(original.vInitial(i));});
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
    expect(p.events.filter(e=>e.kind==='pen').reduce((t,e)=>t+e.duration,0)).toBeCloseTo(.912);
    expect(samplePlan(p,p.duration).position).toEqual({x:0,y:0});
  });
  it.each(['axidraw','xylodraw'] as const)('quantizes negative and mixed motor axes for %s',profile=>{
    const p=buildMotionPlan([{points:[{x:0,y:0},{x:-10,y:5}],tool:'#111'}],{...settings,profile});
    let cursor={x:0,y:0};const commands:string[]=[];
    for(const e of p.events)for(const move of compileMotion(e,p.settings,cursor,true)){commands.push(move.command);cursor=move.targetSteps;}
    expect(cursor).toEqual({x:profile==='axidraw'?-200:-250,y:profile==='axidraw'?-400:-500});
    expect(commands.every(c=>c.startsWith('LM,')&&!c.includes('NaN'))).toBe(true);
  });
  it('retains cumulative substep movement and closes exactly',()=>{
    const points=Array.from({length:100},(_,i)=>({x:i*.002,y:0}));points.push({x:0,y:0});
    const p=buildMotionPlan([{points,tool:'#111'}],settings);let cursor={x:0,y:0};
    for(const e of p.events)for(const m of compileMotion(e,settings,cursor,true))cursor=m.targetSteps;
    expect(cursor).toEqual({x:0,y:0});
  });
  it('XM fallback lands on the same endpoint with bounded intervals',()=>{
    const p=buildMotionPlan([{points:[{x:0,y:0},{x:10,y:4}],tool:'#111'}],settings);let cursor={x:0,y:0};
    for(const e of p.events)for(const m of compileMotion(e,settings,cursor,false)){expect(Number(m.command.split(',')[1])).toBeLessThanOrEqual(15);cursor=m.targetSteps;}
    expect(cursor).toEqual({x:-160,y:400});
  });
  it('encodes documented EBB fixed point rates and rejects invalid settings',()=>{
    expect(axisRate(100,1000,1000)).toEqual([85899346,0]);expect(axisRate(0,0,0)).toEqual([0,0]);
    expect(()=>buildMotionPlan([],{...settings,drawAcceleration:0})).toThrow();
  });
});
