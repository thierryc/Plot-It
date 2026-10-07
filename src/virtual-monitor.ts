import {verifyWorkerTransport} from './worker-transport-probe';
const worker=new Worker(new URL('./virtual.worker.ts',import.meta.url),{type:'module'});
const element=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const canvas=element<HTMLCanvasElement>('canvas'),context=canvas.getContext('2d')!;
const trail=document.createElement('canvas');trail.width=canvas.width;trail.height=canvas.height;const trailContext=trail.getContext('2d')!;
let preparedText:string|undefined;
element<HTMLInputElement>('job-file').addEventListener('change',async()=>{const file=element<HTMLInputElement>('job-file').files?.[0];if(!file)return;if(file.size>32*1024*1024){element('status').textContent='Choose a prepared job smaller than 32 MiB.';return;}preparedText=await file.text();element('status').textContent=`Prepared job selected: ${file.name}. Run validates it before virtual execution.`;});
element('clear-job').addEventListener('click',()=>{preparedText=undefined;element<HTMLInputElement>('job-file').value='';element('status').textContent='Using the standard test pattern.';});
let trace:unknown=null,previous:{x:number;y:number;penUp:boolean}|null=null;
const control=(active:boolean)=>{for(const id of ['pause','resume','stop','cancel'])element<HTMLButtonElement>(id).disabled=!active;element<HTMLButtonElement>('run').disabled=active;element<HTMLInputElement>('job-file').disabled=active;element<HTMLButtonElement>('clear-job').disabled=active;};
for(const id of ['pause','resume','stop','cancel'])element(id).addEventListener('click',()=>worker.postMessage({action:id}));
element('run').addEventListener('click',()=>{
 trace=null;previous=null;context.clearRect(0,0,canvas.width,canvas.height);trailContext.clearRect(0,0,canvas.width,canvas.height);element<HTMLButtonElement>('download').disabled=true;control(true);
 const read=(id:string)=>element<HTMLInputElement>(id).value,copies=Number(read('copies')),gap=Number(read('gap'));
 if(!Number.isInteger(copies)||copies<1||copies>100||!Number.isFinite(gap)||gap<0||gap>3600){element('status').textContent='Enter valid copy and gap values.';control(false);return;}
 worker.postMessage({action:'run',settings:{firmware:read('firmware'),profile:read('profile'),backend:read('backend'),drawing:read('drawing'),scenario:read('scenario'),copies,gap,preparedText}});
});
worker.onmessage=event=>{
 const data=event.data;if(data.type==='done'){trace=data.trace;control(false);element<HTMLButtonElement>('download').disabled=false;if(data.error)element('status').textContent+='\n'+data.error;return;}
 const p=data.position;element('status').textContent=`VIRTUAL EBB · ${data.phase} · ${data.state}\nX ${p.x.toFixed(3)}  Y ${p.y.toFixed(3)} mm   M1 ${data.native.m1}  M2 ${data.native.m2}\nPen ${data.penUp?'UP':'DOWN'} · ↑ ${data.lifts}  ↓ ${data.lowers} · Pulse ${data.pulse}\nFIFO ${data.queue} · Supply ADC ${data.supply}/1023 · FIFO completed ${data.completed} · Serial commands ${data.commands}\nTime ${(data.timeMs/1000).toFixed(1)} s · Copy ${data.copy}/${data.copies} · Gap ${(data.remainingMs/1000).toFixed(1)} s\n${data.command??'Stationary'}`;
 const b=data.bounds??{minX:0,minY:0,maxX:80,maxY:30},scale=Math.min((canvas.width-40)/Math.max(1,b.maxX-b.minX),(canvas.height-40)/Math.max(1,b.maxY-b.minY));const point={x:20+(p.x-b.minX)*scale,y:20+(p.y-b.minY)*scale,penUp:data.penUp};if(previous){trailContext.strokeStyle=previous.penUp?'#ca738f':'#1657b8';trailContext.lineWidth=previous.penUp?1:2;trailContext.beginPath();trailContext.moveTo(previous.x,previous.y);trailContext.lineTo(point.x,point.y);trailContext.stroke();}previous=point;context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(trail,0,0);context.beginPath();context.arc(point.x,point.y,4,0,Math.PI*2);context.fillStyle=data.penUp?'#ca738f':'#1657b8';context.fill();
};
worker.onerror=event=>{element('status').textContent=event.message;control(false);};
element('download').addEventListener('click',()=>{if(!trace)return;const url=URL.createObjectURL(new Blob([JSON.stringify(trace,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='plot-it-virtual-ebb.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});

element('verify-worker').addEventListener('click',async()=>{const button=element<HTMLButtonElement>('verify-worker');button.disabled=true;element('status').textContent='Checking worker stream transfer with virtual EBB…';try{element('status').textContent=await verifyWorkerTransport();}catch(error){element('status').textContent=String(error);}finally{button.disabled=false;}});
