import type { Point, PlotSettings } from './model';
import type { PlotPath } from './svg';
import { constantAccelerationPlan } from './vendor/saxi/planning';
import { machinePoint, profileStepsPerMm } from './motion';
import type { PlotPen } from './pens';
import { penTransition, servoPosition } from './pen-control';

export interface MotionEvent {
  kind: 'xy' | 'pen' | 'tool'; start: number; duration: number;
  from: Point; to: Point; initialSpeed: number; acceleration: number;
  penDown: boolean; tool: string; width?: number;
}
export interface PenPass { tool: string; start: number; end: number; startEvent: number; endEvent: number }
export interface MotionPlan { events: MotionEvent[]; duration: number; settings: PlotSettings; passes: PenPass[]; pens?: PlotPen[] }
export interface MotionSample { position: Point; speed: number; penDown: boolean; tool: string; index: number; progress: number }
export function buildMotionPlan(paths: PlotPath[], settings: PlotSettings, onProgress?: (fraction: number) => void): MotionPlan {
  let completed = 0;
  for (const value of [settings.speed, settings.travelSpeed, settings.drawAcceleration, settings.travelAcceleration]) {
    if (!Number.isFinite(value) || value <= 0) throw new Error('Speeds and accelerations must be positive.');
  }
  if (!Number.isFinite(settings.cornering) || settings.cornering < 0) throw new Error('Cornering must be non-negative.');
  servoPosition(settings.penUp); servoPosition(settings.penDown);
  const eligible: PlotPath[] = [];
  for (const path of paths) {
    const steps = path.points.map(p => quantizePoint(p, settings));
    if (!steps.some((p, i) => i > 0 && (p.x !== steps[i-1]!.x || p.y !== steps[i-1]!.y))) continue;
    const previous = eligible.at(-1);
    // Preserve protected operations and deliberately requested line breaks.
    if (!settings.maxPenDownMm && previous && !previous.orderGroup && !path.orderGroup && previous.tool === path.tool && previous.width === path.width
      && Math.hypot(previous.points.at(-1)!.x-path.points[0]!.x, previous.points.at(-1)!.y-path.points[0]!.y) < 1e-9) {
      previous.points = [...previous.points, ...path.points.slice(1)];
    } else eligible.push({...path, points:[...path.points]});
  }
  const events: MotionEvent[] = []; const passes: PenPass[] = []; let duration = 0; let cursor = { x: 0, y: 0 }; let tool = ''; let width: number | undefined;
  let penPosition: number | null = null;
  const add = (event: Omit<MotionEvent, 'start'>) => { events.push({ ...event, start: duration }); duration += event.duration; };
  const pen = (down: boolean) => {
    const target = down ? settings.penDown : settings.penUp;
    const seconds = penTransition(penPosition, target).duration / 1000; penPosition = target;
    add({ kind: 'pen', duration: seconds, from: cursor, to: cursor, initialSpeed: 0, acceleration: 0, penDown: down, tool });
  };
  const xy = (points: Point[], down: boolean) => {
    const clean = points.filter((p, i) => i === 0 || Math.hypot(p.x - points[i-1]!.x, p.y - points[i-1]!.y) > 1e-9);
    if (clean.length < 2) return;
    const motion = constantAccelerationPlan(clean, { acceleration: down ? settings.drawAcceleration : settings.travelAcceleration, maximumVelocity: down ? settings.speed : settings.travelSpeed, corneringFactor: down ? settings.cornering : 0 });
    for (let i = 0; i < motion.length; i++) {
      const seconds = motion.blockDuration(i), initialSpeed = motion.vInitial(i);
      add({ kind: 'xy', duration: seconds, from: { x: motion.p1x(i), y: motion.p1y(i) }, to: { x: motion.p2x(i), y: motion.p2y(i) }, initialSpeed, acceleration: (motion.vFinal(i) - initialSpeed) / seconds, penDown: down, tool, width });
    }
    cursor = clean.at(-1)!;
  };
  if (eligible.length) pen(false);
  for (const path of eligible) {
    if (path.points.length < 2) continue;
    if (tool !== path.tool) {
      if (tool) {
        // Pen swaps happen at origin; these moves are shared by preview and execution.
        xy([cursor, { x: 0, y: 0 }], false);
        passes.at(-1)!.end = duration; passes.at(-1)!.endEvent = events.length;
        add({ kind: 'tool', duration: 0, from: cursor, to: cursor, initialSpeed: 0, acceleration: 0, penDown: false, tool: path.tool });
      }
      passes.push({ tool: path.tool, start: duration, end: duration, startEvent: events.length - (tool ? 1 : 0), endEvent: events.length });
    }
    tool = path.tool; width = path.width; xy([cursor, path.points[0]!], false); pen(true); xy(path.points, true); pen(false);
    onProgress?.(++completed / eligible.length);
  }
  if (settings.returnToOrigin) xy([cursor, { x: 0, y: 0 }], false);
  if (passes.length) { passes.at(-1)!.end = duration; passes.at(-1)!.endEvent = events.length; }
  return { events, duration, settings: { ...structuredClone(settings), pauseOnToolChange: true }, passes };
}
export function sampleEvent(event: MotionEvent, seconds: number): { position: Point; speed: number } {
  const t = Math.max(0, Math.min(event.duration, seconds));
  const length = Math.hypot(event.to.x-event.from.x, event.to.y-event.from.y);
  const distance = Math.max(0, Math.min(length, event.initialSpeed*t + event.acceleration*t*t/2));
  const f = length ? distance/length : 0;
  return { position: { x: event.from.x+(event.to.x-event.from.x)*f, y: event.from.y+(event.to.y-event.from.y)*f }, speed: event.kind === 'xy' ? Math.max(0,event.initialSpeed+event.acceleration*t) : 0 };
}
export function samplePlan(plan: MotionPlan, time: number): MotionSample {
  const t = Math.max(0,Math.min(plan.duration,time));
  let lo=0, hi=plan.events.length;
  while(lo<hi) { const mid=(lo+hi)>>>1; if(plan.events[mid]!.start<=t) lo=mid+1; else hi=mid; }
  const index=Math.max(0,lo-1), event=plan.events[index];
  if(!event) return {position:{x:0,y:0},speed:0,penDown:false,tool:'',index:0,progress:1};
  return {...sampleEvent(event,t-event.start),penDown:event.penDown,tool:event.tool,index,progress:plan.duration?t/plan.duration:1};
}
// Saxi's EBB fixed-point rate calculation: 25 kHz interrupt, 31 fractional bits.
export function axisRate(steps: number, initial: number, final: number): [number, number] {
  if (!steps) return [0,0];
  const r0=Math.round(initial*0x80000000/25000), r1=Math.round(final*0x80000000/25000);
  const seconds=2*Math.abs(steps)/(initial+final);
  return [r0,Math.round((r1-r0)/(seconds*25000))];
}
export interface CompiledMotion { command: string; targetSteps: Point }
function quantizePoint(point: Point, settings: PlotSettings): Point {
  const machine = machinePoint(point, settings.machineRotation), scale = profileStepsPerMm(settings.profile);
  return {x:Math.round(machine.x*scale)+0,y:Math.round(machine.y*scale)+0};
}
export function compileMotion(event: MotionEvent, settings: PlotSettings, currentSteps: Point, supportsLM: boolean): CompiledMotion[] {
  const scale=profileStepsPerMm(settings.profile);
  const quantize=(p:Point)=>quantizePoint(p,settings);
  if(event.kind!=='xy') return [];
  if(!supportsLM) {
    const result:CompiledMotion[]=[]; let previous=currentSteps;
    for(let t=0;t<event.duration;t+=.015) {
      const dt=Math.min(.015,event.duration-t), targetSteps=quantize(sampleEvent(event,t+dt).position);
      const dx=targetSteps.x-previous.x,dy=targetSteps.y-previous.y;
      result.push({command:`XM,${Math.max(1,Math.round(dt*1000))},${dx},${dy}`,targetSteps}); previous=targetSteps;
    } return result;
  }
  const targetSteps=quantize(event.to),dx=targetSteps.x-currentSteps.x,dy=targetSteps.y-currentSteps.y;
  if(!dx&&!dy) return [];
  const length=Math.hypot(dx,dy), initial=event.initialSpeed*scale, final=Math.max(0,event.initialSpeed+event.acceleration*event.duration)*scale;
  const [r1,d1]=axisRate(dx+dy,Math.abs((dx+dy)/length)*initial,Math.abs((dx+dy)/length)*final);
  const [r2,d2]=axisRate(dx-dy,Math.abs((dx-dy)/length)*initial,Math.abs((dx-dy)/length)*final);
  return [{command:`LM,${r1},${dx+dy},${d1},${r2},${dx-dy},${d2}`,targetSteps}];
}
