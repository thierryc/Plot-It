import {fromNative,toNative,rotate,roundEven} from './profiles.js';
import {ACCUMULATOR,encodeT3,encodeTD,predictT3Axis,TICKS_PER_SECOND,validateT3,maximumRate} from './ebb-math.js';
import {sampleJerkPhase,type JerkPhase} from './scurve.js';
import {PlotterError,type AxisParameters,type MachineProfile,type MotorRecord,type NativePoint,type T3Parameters} from './types.js';
const B=Number(ACCUMULATOR),HZ=TICKS_PER_SECOND;
function fitAxis(ticks:number,desired:AxisParameters,delta:number,accum:number,clear:boolean):AxisParameters {
  const sample=(rate:number)=>predictT3Axis(ticks,{...desired,rate},clear?'clear':accum);
  const reference=desired.rate,margin=Math.ceil(B/ticks)*4+4;
  let low=Math.max(-2147000000,reference-margin),high=Math.min(2147000000,reference+margin);
  // Endpoint correction modifies the rate of this timed phase, never appends a jog.
  while(low<high){const mid=Math.floor((low+high)/2);if(sample(mid).steps<delta)low=mid+1;else high=mid;}
  const first=low;if(sample(first).steps!==delta)throw new PlotterError('invalid-plan','Cannot quantize T3 endpoint.');
  low=first;high=Math.min(2147000000,reference+margin);
  while(low<high){const mid=Math.ceil((low+high)/2);if(sample(mid).steps>delta)high=mid-1;else low=mid;}
  return{...desired,rate:Math.max(first,Math.min(low,reference))};
}
export function compileJerkPhases(phases:readonly JerkPhase[],profile:MachineProfile,tool:string,penDown:boolean,current:NativePoint,startMs=0,width?:number,maxSpeed=Infinity):MotorRecord[] {
  const records:MotorRecord[]=[];let position={...current},accumulators:NativePoint={m1:0,m2:0},time=startMs;
  for(const phase of phases){
    const total=Math.max(1,Math.ceil(phase.duration*HZ-1e-8)),count=Math.max(1,Math.ceil(total/10000)),length=Math.hypot(phase.to.x-phase.from.x,phase.to.y-phase.from.y);
    const direction=length?rotate({x:(phase.to.x-phase.from.x)/length,y:(phase.to.y-phase.from.y)/length},profile.rotation):{x:0,y:0};
    const factors=[(direction.x+direction.y)*profile.stepsPerMm,(direction.x-direction.y)*profile.stepsPerMm];
    if(length>1e-12&&phase.jerk&&Math.max(...factors.map(f=>Math.abs(phase.jerk*f*B/HZ**3)))<1)throw new PlotterError('invalid-plan','Requested jerk is below native resolution; increase jerk or select SM.');
    let previousTicks=0;
    for(let index=1;index<=count;index++){
      const until=roundEven(total*index/count),nominalTicks=until-previousTicks,seconds=phase.duration*previousTicks/total;
      const target=toNative(index===count?phase.to:sampleJerkPhase(phase,phase.duration*index/count),profile),rest=records.length===0||index===1&&phase.restBefore;
      let ticks=nominalTicks,axes:AxisParameters[]=[];
      for(let attempt=0;attempt<24;attempt++){const scale=nominalTicks/ticks;
      axes=factors.map((factor,axis)=>{
        const velocity=phase.initialSpeed+phase.acceleration*seconds+phase.jerk*seconds*seconds/2,acceleration=phase.acceleration+phase.jerk*seconds;
        // Truncation keeps quantized acceleration/jerk within the requested axis caps.
        const desired={rate:roundEven(velocity*scale*factor*B/HZ),acceleration:Math.trunc(acceleration*scale**2*factor*B/HZ**2),jerk:Math.trunc(phase.jerk*scale**3*factor*B/HZ**3)};
        const key=axis===0?'m1':'m2';if(target[key]===position[key])return{rate:0,acceleration:0,jerk:0};return fitAxis(ticks,desired,target[key]-position[key],accumulators[key],rest);
      });
      const actualSpeed=Math.hypot(maximumRate(ticks,axes[0]!),maximumRate(ticks,axes[1]!))*HZ/B/(Math.SQRT2*profile.stepsPerMm);
      if(actualSpeed<=maxSpeed+1e-7)break;const longer=Math.max(ticks+1,Math.ceil(ticks*actualSpeed/maxSpeed));if(longer>12500||attempt===23)throw new PlotterError('invalid-plan','Cannot quantize native speed within the bounded command horizon.');ticks=longer;
      }
      const parameters:T3Parameters={ticks,axis1:axes[0]!,axis2:axes[1]!,clear:rest?3:0};validateT3(parameters);
      const predictions=[predictT3Axis(ticks,parameters.axis1,rest?'clear':accumulators.m1),predictT3Axis(ticks,parameters.axis2,rest?'clear':accumulators.m2)];
      const after={m1:predictions[0]!.accumulator,m2:predictions[1]!.accumulator};
      const record:MotorRecord={id:0,kind:'motor',startMs:time,durationMs:ticks/HZ*1000,tool,penDown,from:fromNative(position,profile),to:fromNative(target,profile),fromSteps:{...position},toSteps:{...target},restBefore:rest,width,
        native:{command:'T3',halves:[parameters],accumulatorsBefore:{...accumulators},accumulatorsAfter:after}};
      encodeT3(parameters);records.push(record);position=target;accumulators=after;time+=record.durationMs;previousTicks=until;
      if(records.length>1e6)throw new PlotterError('invalid-plan','Modern command limit exceeded.');
    }
  }
  return coalesceTD(records);
}
/** A TD is used only when its literal firmware expansion matches both records. */
export function coalesceTD(records:readonly MotorRecord[]):MotorRecord[] {
  const result:MotorRecord[]=[];
  for(let i=0;i<records.length;i++){
    const a=records[i]!,b=records[i+1],p=a.native?.halves[0],q=b?.native?.halves[0];
    if(b&&p&&q&&!b.restBefore&&a.native?.command==='T3'&&b.native?.command==='T3'&&a.penDown===b.penDown&&a.tool===b.tool){
      try{encodeTD(p,q);result.push({...a,to:{...b.to},toSteps:{...b.toSteps},durationMs:a.durationMs+b.durationMs,native:{command:'TD',halves:[p,q],accumulatorsBefore:{...a.native.accumulatorsBefore},accumulatorsAfter:{...b.native.accumulatorsAfter}}});i++;continue;}catch{/* Distinct durations/accelerations retain their T3 form. */}
    }
    result.push(a);
  }
  return result;
}
