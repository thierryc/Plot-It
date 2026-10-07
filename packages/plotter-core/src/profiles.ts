import { checked, type MachineProfile, type NativePoint, type Point, type Rotation } from './types.js';
/** Preserve the existing machine calibration; physical model is independent of firmware. */
export function machineProfile(id: 'axidraw' | 'axidraw-a3' | 'xylodraw' | 'nextdraw-8511' | 'nextdraw-1117' | 'nextdraw-2234', rotation: Rotation = 90, resolution: 8 | 16 = 8, servo:'standard'|'brushless'='brushless'): MachineProfile {
  if(id.startsWith('nextdraw-')){
    const dimensions={'nextdraw-8511':[11.81,8.58],'nextdraw-1117':[16.93,11.69],'nextdraw-2234':[34.02,23.39]}[id as 'nextdraw-8511'|'nextdraw-1117'|'nextdraw-2234'];
    if(!dimensions||![0,90,180,270].includes(rotation)||![8,16].includes(resolution)||!['standard','brushless'].includes(servo))throw new Error('Invalid NextDraw profile.');
    const brushless=servo==='brushless';return{id,rotation,stepsPerMm:5*resolution,motorMode:resolution===8?2:1,servoPin:brushless?2:1,servoMin:brushless?5400:9855,servoMax:brushless?12600:27831,servoChannels:brushless?1:8,servoPeriod:3,servoKind:servo,toolOutputB3:true,servoSweepMs:brushless?70:200,servoMoveMinMs:brushless?20:45,servoMoveSlopeMs:brushless?1.28:2.69,bounds:{width:dimensions[0]!*25.4,height:dimensions[1]!*25.4},homing:'nextdraw'};
  }
  if (!['axidraw','axidraw-a3', 'xylodraw'].includes(id) || ![0,90,180,270].includes(rotation) || ![8,16].includes(resolution)) throw new Error('Invalid machine profile.');
  return { id,...(id.startsWith('axidraw')?{bounds:{width:(id==='axidraw-a3'?16.93:11.81)*25.4,height:(id==='axidraw-a3'?11.69:8.58)*25.4}}:{}),rotation, stepsPerMm: (id === 'xylodraw' ? 6.25 : 5) * resolution,
    motorMode: resolution === 8 ? 2 : 1, servoPin: 1, servoMin: 28000, servoMax: 7500, servoChannels: 8, servoPeriod: 3, toolOutputB3:true };
}
export function rotate(p: Point, rotation: Rotation): Point {
  checked(p.x,-1e6,1e6,'x'); checked(p.y,-1e6,1e6,'y');
  if(rotation===90)return{x:-p.y,y:p.x}; if(rotation===180)return{x:-p.x,y:-p.y}; if(rotation===270)return{x:p.y,y:-p.x}; return {...p};
}
/** Round half to even, including negative coordinates, before native motor quantization. */
export function roundEven(value: number): number {
  const floor=Math.floor(value), fraction=value-floor;
  return (fraction===.5 ? floor % 2 === 0 ? floor : floor+1 : Math.round(value))+0;
}
export function toNative(p: Point, profile: MachineProfile): NativePoint {
  const q=rotate(p,profile.rotation), scale=checked(profile.stepsPerMm,1,1e4,'motor scale');
  return {m1:roundEven((q.x+q.y)*scale),m2:roundEven((q.x-q.y)*scale)};
}
export function fromNative(p: NativePoint, profile: MachineProfile): Point {
  const point=rotate({x:(p.m1+p.m2)/(2*profile.stepsPerMm),y:(p.m1-p.m2)/(2*profile.stepsPerMm)}, ((360-profile.rotation)%360) as Rotation);
  return{x:point.x+0,y:point.y+0};
}
export function nativeEqual(a: NativePoint,b: NativePoint): boolean { return a.m1===b.m1&&a.m2===b.m2; }
