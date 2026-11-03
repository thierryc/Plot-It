import {LivePlot, livePlotView} from '../../src/live-plot';
import {PlotOverlay} from '../../src/plot-overlay';
import {initialState, type Point} from '../../src/model';
import type {MotionPlan} from '../../src/motion-plan';
import {eventSignal, indexPenCounts, type PlotSignal} from '../../src/plot-signals';

const stamp=()=>performance.timeOrigin+performance.now();
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const status=document.querySelector('#status')!, output=document.querySelector('#results')!, sidebar=document.querySelector('#sidebar')!;
const runButton=document.querySelector<HTMLButtonElement>('#run')!, download=document.querySelector<HTMLButtonElement>('#download')!;
let report:unknown;
// Historical algorithm retained here only to measure the exact full-prefix scan cost.
function legacyPosition(plan:MotionPlan,position:Point,minimumTime:number,queuedTime:number) {
  let bestTime=minimumTime,bestDistance=Infinity;
  for(const event of plan.events){
    if(event.start>queuedTime)break;
    if(event.kind!=='xy'||event.start+event.duration<minimumTime)continue;
    const dx=event.to.x-event.from.x,dy=event.to.y-event.from.y,length=Math.hypot(dx,dy);if(!length)continue;
    const fraction=Math.max(0,Math.min(1,((position.x-event.from.x)*dx+(position.y-event.from.y)*dy)/(length*length)));
    const distance=fraction*length,speed=Math.sqrt(Math.max(0,event.initialSpeed**2+2*event.acceleration*distance));
    const seconds=event.initialSpeed+speed>1e-9?2*distance/(event.initialSpeed+speed):event.duration*fraction;
    const time=event.start+Math.max(0,Math.min(event.duration,seconds));if(time<minimumTime-1e-6||time>queuedTime+1e-6)continue;
    const error=Math.hypot(position.x-(event.from.x+dx*fraction),position.y-(event.from.y+dy*fraction));
    if(error<bestDistance-.05){bestDistance=error;bestTime=time;}
  }
  return Math.max(minimumTime,Math.min(queuedTime,bestTime));
}
async function runCase(mode:'legacy'|'disabled'|'coalesced',count:number,fault:'none'|'absent'|'delayed'|'blocked'='none') {
  const plan:MotionPlan={passes:[],settings:{...initialState.settings},duration:count*.0004,events:Array.from({length:count},(_,i)=>({kind:'xy' as const,start:i*.0004,duration:.0004,from:{x:i*.01,y:Math.sin(i*.02)},to:{x:(i+1)*.01,y:Math.sin((i+1)*.02)},initialSpeed:25,acceleration:0,penDown:true,tool:'#111'}))};
  const counts=indexPenCounts(plan), signals=plan.events.map((_,i)=>eventSignal(plan,counts,i,'settled',0));
  const progress={state:'plotting' as const,completed:count,total:count};
  const paper=document.querySelector('svg')!;
  let sidebarUpdates=0,visualUpdates=0,received=0,processed=0,skipped=0,processingMs=0,maxBatchMs=0,maxTransitMs=0,lastTime=0;
  const visualListener=()=>visualUpdates++;paper.addEventListener('plotter-position',visualListener);
  const live=mode==='coalesced'?new LivePlot(plan,paper,view=>{sidebarUpdates++;sidebar.textContent=view.status+' '+view.timeLabel;}):null;
  live?.update(progress);live?.observePosition(plan.events.at(-1)!.to);
  const overlay=mode==='legacy'?new PlotOverlay(plan,paper):null;
  const longTasks:number[]=[];
  const observer=typeof PerformanceObserver!=='undefined'&&PerformanceObserver.supportedEntryTypes.includes('longtask')?new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>e.duration))):null;
  observer?.observe({type:'longtask',buffered:false});
  const start=stamp(), peerMarks:Record<string,number>={};
  let controller!:ReadableStreamDefaultController<Uint8Array>,statusQueries=0;
  const readable=new ReadableStream<Uint8Array>({start(c){controller=c;}});
  const writable=new WritableStream<Uint8Array>({write(bytes){
    const command=new TextDecoder().decode(bytes).trim();if(command==='QG')statusQueries++;
    if(command==='QG'&&statusQueries===2){
      peerMarks.finalQueryReceived=stamp();
      if(fault==='absent')return;
      if(fault==='blocked'){const end=performance.now()+750;while(performance.now()<end){};}
      if(fault==='delayed'){setTimeout(()=>{peerMarks.replyEnqueued=stamp();controller.enqueue(new TextEncoder().encode('QG,00\r\n'));},750);return;}
      peerMarks.replyEnqueued=stamp();
    }
    controller.enqueue(new TextEncoder().encode(command==='QS'?'QS,-9393,-55391\r\n':'QG,00\r\n'));
  }});
  const worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
  const result=await new Promise<Record<string,unknown>>((resolve,reject)=>{
    worker.onerror=event=>reject(new Error(event.message));
    worker.onmessage=({data})=>{
      if(data.kind==='done'){resolve(data);return;}
      const batch=data.signals as PlotSignal[],begin=performance.now();received+=batch.length;maxTransitMs=Math.max(maxTransitMs,stamp()-data.posted);
      for(const signal of batch){
        if(mode==='legacy'&&processingMs+performance.now()-begin>1500){skipped++;continue;}
        processed++;
        if(mode==='coalesced')live!.observeSignal(signal);
        if(mode==='legacy'){
          lastTime=Math.max(lastTime,signal.planTime);
          // Matches the former LivePlot path: full scan even after settled time advances.
          lastTime=legacyPosition(plan,plan.events.at(-1)!.to,lastTime,plan.duration);
          const view=livePlotView(plan,progress,false,lastTime);overlay!.update(view.time,{position:plan.events.at(-1)!.to,penDown:true});
          sidebar.textContent=view.status+' '+view.timeLabel;sidebarUpdates++;
        }
      }
      const elapsed=performance.now()-begin;processingMs+=elapsed;maxBatchMs=Math.max(maxBatchMs,elapsed);
    };
    worker.postMessage({readable,writable,signals,mode,timeoutMs:fault==='none'?5000:500},[readable,writable]);
  });
  await sleep(200); // Let the final rAF and PerformanceObserver callback settle.
  observer?.disconnect();worker.terminate();live?.destroy();overlay?.destroy();paper.removeEventListener('plotter-position',visualListener);
  return {mode,count,fault,timeoutMs:fault==='none'?5000:500,fixture:'synthetic continuous xy; same immutable signals across modes',wallMs:stamp()-start,received,processed,skipped,legacyUiBudgetMs:1500,processingMs,maxBatchMs,maxTransitMs,sidebarUpdates,visualUpdates,longTasks,maxLongTaskMs:Math.max(0,...longTasks),peerMarks,...result,memory:(performance as Performance&{memory?:unknown}).memory??null};
}
runButton.onclick=async()=>{
  runButton.disabled=true;download.disabled=true;const cases:unknown[]=[];
  try{
    const matrix:[Parameters<typeof runCase>[0],number,Parameters<typeof runCase>[2]][]=[['legacy',36000,'none'],['disabled',36000,'none'],['coalesced',36000,'none'],['coalesced',18000,'none'],['coalesced',100000,'none'],['coalesced',36000,'absent'],['coalesced',36000,'delayed'],['coalesced',36000,'blocked']];
    for(const [mode,count,fault]of matrix){status.textContent=`Running ${mode} / ${count} / ${fault}`;await sleep(50);cases.push(await runCase(mode,count,fault));output.textContent=JSON.stringify(cases,null,2);}
    report={format:'plot-it-dense-browser-experiment',createdAt:new Date().toISOString(),userAgent:navigator.userAgent,visibility:document.visibilityState,scope:'Synthetic peer and settlement burst. No controller, original command replay, firmware or real serial. Legacy processing budget may skip updates; skipped count prevents claiming a full legacy completion. 500 ms fault-injection deadlines are deliberately shorter than production 5000 ms.',cases};
    output.textContent=JSON.stringify(report,null,2);status.textContent='Complete · no hardware used';download.disabled=false;
  }catch(error){status.textContent='Failed: '+String(error);}finally{runButton.disabled=false;}
};
download.onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='dense-browser-evidence.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
