/** NextDraw homing procedure adapted from NextDraw 1.7.4 homing.py.
 * Copyright 2025 Windell H. Oskay, Bantam Tools; MIT. See reference/NEXTDRAW-NOTICE.
 * Explicit model capability only; never inferred from an EBB firmware number. */
import {compilePhases} from './compiler.js';
import {planStroke} from './planner.js';
import {Feeder} from './feeder.js';
import {PlotterError,type Clock,type MachineProfile,type PenSettings} from './types.js';
export async function homeNextDraw(f:Feeder,clock:Clock,profile:MachineProfile,pen:PenSettings,cancelled:()=>boolean):Promise<void>{
 if(profile.homing!=='nextdraw'||!profile.bounds||(!f.firmware.modern||f.firmware.minor===0&&f.firmware.patch<2))throw new PlotterError('unsupported-firmware','Automatic homing requires a NextDraw profile on supported 3.x.');
 const protocol=f.protocol,mode=profile.motorMode,scale=profile.stepsPerMm;
 const check=()=>{if(cancelled())throw new PlotterError('origin','Homing interrupted; recover origin before plotting.');};
 const block=async(expectedLimit=false):Promise<boolean>=>{const deadline=clock.now()+70000;let limit=false;for(;;){check();const status=await f.status(expectedLimit);if(status.powerLost)throw new PlotterError('power','Supply lost during homing.');limit||=status.limit;if(status.idle)break;if(clock.now()>deadline)throw new PlotterError('timeout','Homing move did not settle.');await clock.sleep(10);}if(limit&&!expectedLimit)throw new PlotterError('origin','Unexpected homing limit.');return limit;};
 const switchState=async()=>{await block();const value=Number((await protocol.request('PI,B,1')).split(',').at(-1));if(value!==0&&value!==1)throw new PlotterError('protocol','Invalid NextDraw limit input.');return value;};
 const enable=async(single=false)=>{await protocol.request(`EM,${mode},${single?0:mode}`);};
 const move=async(x:number,y:number,speed:number)=>{check();const m1=Math.round((x+y)*scale),m2=Math.round((x-y)*scale),duration=Math.max(1,Math.ceil(1000*Math.max(Math.abs(x),Math.abs(y))/speed));if(m1||m2)await protocol.request(`SM,${duration},${m1},${m2}`);};
 const seek=async(speed:number,maxDistance:number)=>{
  if(await switchState())throw new PlotterError('origin','NextDraw limit is not ready for homing.');
  await enable(true);const before=await f.position();await protocol.request('CU,52,2');await protocol.request('CU,51,2');
  await move(-maxDistance,0,speed);const found=await block(true);await protocol.request('CU,51,0');const after=await f.position();
  if(!found)throw new PlotterError('origin','NextDraw homing limit was not found. Check the model and switch.');return Math.abs(after.m1-before.m1)/scale;
 };
 const fine=async()=>{
  await enable();await move(6,0,50.8);if(await switchState())throw new PlotterError('origin','NextDraw switch did not release.');
  await move(-3.5,0,50.8);if(await switchState())throw new PlotterError('origin','NextDraw switch activated too early.');return seek(6.35,7);
 };
 try{
  await f.drain();await f.pen(pen.up,pen,profile,120);if((await f.power()).state!=='detected')throw new PlotterError('power','Homing requires motor power.');
  await protocol.request('CU,10,1');await protocol.request('PD,B,1,1');await protocol.request('PO,B,1,1');await protocol.request('CU,50,0');
  const first=await switchState()?1.27:await seek(50.8,profile.bounds.width+profile.bounds.height+12.7)/2;
  const firstFine=await fine();let distance=await fine();
  if(distance>2.5&&!(firstFine<3.81&&distance<3.048)){
   if(distance<3.81){if(await fine()>3.048)throw new PlotterError('origin','Inconsistent NextDraw homing position.');}
   else{const remaining=Math.max(0,profile.bounds.height-first-2.5);await enable();await move(remaining,0,50.8);await block();await seek(50.8,2*(remaining+2.54));distance=await fine();if(distance>2.5&&(distance>=3.81||await fine()>3.048))throw new PlotterError('origin','NextDraw coarse homing did not converge.');}
  }
  await protocol.request('CS');await enable();
  // Precision stage uses the other native belt with both motors enabled.
  await protocol.request(`SM,119,${Math.round(12*scale)},0`);await block();await protocol.request(`SM,60,0,${Math.round(-6*scale)}`);await block();
  if(await switchState())throw new PlotterError('origin','NextDraw precision limit is not ready.');
  await protocol.request('CU,52,2');await protocol.request('CU,51,2');await protocol.request(`SM,945,0,${Math.round(-12*scale)}`);
  if(!await block(true))throw new PlotterError('origin','NextDraw precision limit was not found.');
  await protocol.request('CU,51,0');await protocol.request(`SM,240,${Math.round(-12*scale)},${Math.round(12*scale)}`);await block();await protocol.request('CS');
  // Select the physical corner from which positive canvas axes stay on the bed.
  const b=profile.bounds,corner=profile.rotation===90?{x:b.width,y:0}:profile.rotation===180?{x:b.width,y:b.height}:profile.rotation===270?{x:0,y:b.height}:{x:0,y:0};
  for(const record of compilePhases(planStroke([{x:0,y:0},corner],50.8,400,0),{...profile,rotation:0},'',false,{m1:0,m2:0}))await f.motion(record);
  await block();await protocol.request('CS');
 }catch(error){await f.purge(true).catch(()=>{});throw error;}
 finally{await protocol.request('CU,51,0').catch(()=>{});await protocol.request('CU,50,1').catch(()=>{});}
}
