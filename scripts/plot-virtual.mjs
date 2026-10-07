import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {compileJob,machineProfile,defaultPen,PlotterSession,fromNative,capabilities,selectBackend,JobSequence} from '@thierryc/plotter-core';
import {VirtualClock,RealtimeVirtualClock,VirtualEbb} from '@thierryc/plotter-core/virtual';
// This entry point imports no physical USB adapter and can never open real hardware.
const args=process.argv.slice(2),value=flag=>{const index=args.indexOf(flag);return index<0?undefined:args[index+1];};
if(args.includes('--help')){
 console.log(`Virtual EBB monitor (no physical USB)\n\n  npm run plot:virtual -- --modern --monitor\n  npm run plot:virtual -- --modern --realtime --monitor --trace\n\n  --modern              EBB 3.1.7 / S-curve (default: 2.8.1 / SM)\n  --compatibility       Force SM on the modern board\n  --constant            Constant drawing, accelerated travel\n  --profile ID          axidraw, xylodraw or NextDraw model\n  --input FILE          Normalized millimetre path JSON\n  --monitor             Live terminal position/pen/FIFO/status\n  --realtime            Pace at wall-clock speed\n  --copies N            Repeat with a raised return before every gap
  --gap-ms N            Inter-copy wait in milliseconds
  --trace               Save JSON trace + SVG to output/virtual-ebb/\n  --power-loss-ms N     Reproducible supply-loss scenario\n  --help                This help\n\nAn initial raised bounds job precedes the drawing. SVG: solid drawing, dashed travel.\nVirtual execution establishes ordering/steps, not physical line quality.`);process.exit(0);
}
const known=['--profile','--input','--power-loss-ms','--copies','--gap-ms'];const positional=args.filter((arg,i)=>!arg.startsWith('--')&&!known.includes(args[i-1]));
const file=value('--input')??positional[0],firmware=args.includes('--modern')?'3.1.7':'2.8.1';
const paths=file?JSON.parse(await readFile(file,'utf8')):[{tool:'#000000',points:[{x:55,y:10},{x:80,y:10},{x:80,y:30},{x:60,y:30}]}];
const clock=args.includes('--realtime')?new RealtimeVirtualClock({now:()=>performance.now(),sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms)),schedule:(ms,callback)=>{const timer=setTimeout(callback,ms);return()=>clearTimeout(timer);}}):new VirtualClock(),board=new VirtualEbb(clock,{firmware,fragmentBytes:1}),profile=machineProfile(value('--profile')??'xylodraw');
const session=new PlotterSession(board.createTransport(),clock,profile);await session.connect();
const backend=selectBackend(session.firmware,args.includes('--compatibility')?'compatibility':'auto',true);
const options={profile,pen:{...defaultPen,up:30,down:52},speed:35,travelSpeed:60,acceleration:200,travelAcceleration:300,cornering:.127,maxPenDownMm:15,returnToOrigin:true,drawingMode:args.includes('--constant')?'constant':'profiled',backend,firmware,drawingJerk:500000,travelJerk:330200};
const sequence=new JobSequence(session,clock);let schedule=null;sequence.onStatus=s=>{schedule=s;};
let last=-Infinity,completed=0,upCount=0,downCount=0;const points=[],journal=[];
session.subscribe(event=>{journal.push(event);if(journal.length>20000)journal.splice(1000,2000);if(event.kind==='record'&&event.phase==='settled')completed++;});
const monitor=()=>{
 const point=fromNative(board.position,profile);points.push({timeMs:clock.now(),...point,penUp:board.penUp});if(points.length>20000)points.splice(1000,2000);
 if(!args.includes('--monitor')||clock.now()-last<200)return;last=clock.now();
 upCount=board.liftCount;downCount=board.lowerCount;
 const line=`VIRTUAL ${firmware} ${backend.toUpperCase()} | ${(clock.now()/1000).toFixed(1).padStart(6)}s | X ${point.x.toFixed(3).padStart(8)} Y ${point.y.toFixed(3).padStart(8)} mm | M1 ${String(board.position.m1).padStart(6)} M2 ${String(board.position.m2).padStart(6)} | PEN ${board.penUp?'UP  ':'DOWN'} ↑${upCount} ↓${downCount} | FIFO ${board.queued} | ADC ${board.supplyAdc} | ${session.state} #${completed} | copy ${schedule?.copy??1} gap ${schedule?.remainingMs??0}ms`;
 if(process.stdout.isTTY)process.stdout.write('\r\x1b[2K'+line);else console.log(line);
};
board.subscribe(monitor);process.on('SIGINT',()=>sequence.busy?sequence.cancel():session.cancel());
const fault=value('--power-loss-ms');if(fault!==undefined){const ms=Number(fault);if(!Number.isFinite(ms)||ms<0)throw new Error('Invalid fault time');clock.schedule(ms,()=>board.losePower());}
let failure=null;
try{await session.run(compileJob(paths,options,'bounds'));const first=board.trace.length;await sequence.run([{id:'drawing',plan:compileJob(paths,options)}],{copies:Number(value('--copies')??1),intervalMs:Number(value('--gap-ms')??0),requireContinue:false});const drawing=board.trace.slice(first).filter(t=>t.phase==='started'&&/^(SM|T3|TD),/.test(t.command)&&!t.penUp);console.log('\n'+JSON.stringify({virtual:true,firmware,backend,commands:board.commandCount,drawingMoves:drawing.length,elapsedMs:clock.now(),penUp:board.penUp,position:board.position,capabilities:capabilities(session.firmware)},null,2));}
catch(error){failure=String(error);console.error('\nVirtual fault:',failure);process.exitCode=1;}
finally{if(session.connected&&!session.busy)await session.disconnect();clock.dispose?.();}
if(args.includes('--trace')){
 await mkdir('output/virtual-ebb',{recursive:true});await writeFile('output/virtual-ebb/trace.json',JSON.stringify({format:'plot-it-virtual-ebb-v2',firmware,options,scenario:{powerLossMs:fault?Number(fault):null},failure,trace:board.trace,droppedTraceEntries:board.droppedTraceEntries,droppedCommands:board.droppedCommands,journal,observed:points},null,2)+'\n');
 const coordinates=board.trace.filter(t=>t.phase==='completed').map(t=>({...fromNative(t.position,profile),penUp:t.penUp}));
 const all=[{x:0,y:0},...coordinates],xs=all.map(p=>p.x),ys=all.map(p=>p.y),minX=Math.min(...xs)-5,minY=Math.min(...ys)-5,width=Math.max(...xs)-minX+5,height=Math.max(...ys)-minY+5;
 const lines=coordinates.map((p,i)=>{const from=i?coordinates[i-1]:{x:0,y:0};return`<path d="M ${from.x} ${from.y} L ${p.x} ${p.y}" fill="none" stroke="${p.penUp?'#ca738f':'#1657b8'}" stroke-width=".2"${p.penUp?' stroke-dasharray="1 .6"':''}/>`;}).join('\n');
 await writeFile('output/virtual-ebb/motion.svg',`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}"><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="white"/>${lines}<circle cx="0" cy="0" r=".5" fill="#333"/></svg>\n`);
 console.log('Saved output/virtual-ebb/trace.json and motion.svg');
}
