import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { loadOpenPlotFont, layoutText, toSVGPaths, flattenContour } from '@thierryc/openplotfont';
import { compileLayerProgram, validatePlan, PlotterSession, type Layer } from '../packages/plotter-core/src/index';
import { VirtualClock, VirtualEbb } from '../packages/plotter-core/src/virtual/index';
import { coreOptions } from '../src/core-settings';
import { motionPlanFromProgram } from '../src/motion-plan';
import { validateNativePreview } from '../src/native-preview';
import { generateGeometry } from '../src/fill';
import { initialState, defaultFillSettings, type Point, type FillSettings } from '../src/model';
import { parsePlotIt, type PlotItDocument } from '../src/document-file';
import type { PlotPath } from '../src/svg';

// File generation and virtual execution only. This script has no USB adapter.
const output = 'output/a3-sharpie-test';
await mkdir(output, { recursive: true });
const dom = new JSDOM();
Object.assign(globalThis, { DOMParser: dom.window.DOMParser });
const settings = { ...initialState.settings, profile: 'xylodraw' as const,
  machineRotation: 90 as const, speed: 35, travelSpeed: 80,
  drawAcceleration: 200, travelAcceleration: 400, penUp: 50, penDown: 60,
  penDelayUpMs: 500, reorderMode: 'preserve' as const, strictOrder: true,
  pathJoinToleranceMm: 0, pathSimplifyToleranceMm: 0, closedPathStart: 'preserve' as const,
  motionPreference: 'auto' as const, returnToOrigin: true, margin: 10,
  drawingJerk: 500000, travelJerk: 330200, maxPenDownMm: 0 };
const fonts = new Map<string, Awaited<ReturnType<typeof loadOpenPlotFont>>>();
for (const [id, path] of [
  ['sans', 'src/fonts/hershey-roman-simplex.opf.json'],
  ['serif', 'public/fonts/library/pf-hershey-serif-medium/pf-hershey-serif-medium.opf.json'],
  ['script', 'public/fonts/library/pf-hershey-script-1-stroke/pf-hershey-script-1-stroke.opf.json'],
  ['layout', 'src/fonts/openplotfont-layout-demo.opf.json'],
]) fonts.set(id, await loadOpenPlotFont(await readFile(path, 'utf8')));
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const n = (v: number) => Number(v.toFixed(5));
const dFor = (points: Point[]) => points.map((p,i) => `${i?'L':'M'}${n(p.x)} ${n(p.y)}`).join(' ');
const markup: string[] = [], portable: string[] = [];
const layers: Layer[] = [];
const sections: {id:string;name:string;paths:number;speed:number;pause:boolean}[] = [];
let current!: Layer, local: string[] = [], localPortable: string[] = [];
function section(id: string, name: string, speedPercent=100, pause=false) {
  if (current) finishSection();
  current = {id, name, paths:[], speedPercent, pause}; layers.push(current);
  local=[]; localPortable=[];
}
function finishSection() {
  const label = `${current.pause?'!':''}${layers.length}+S${current.speedPercent}${current.name}`;
  const open = `<g xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" id="${current.id}" inkscape:groupmode="layer" inkscape:label="${esc(label)}">`;
  markup.push(open + local.join('') + '</g>');
  portable.push(open + localPortable.join('') + '</g>');
  sections.push({id:current.id,name:current.name,paths:current.paths.length,speed:settings.speed*current.speedPercent!/100,pause:!!current.pause});
}
function path(points: Point[], original?: string) {
  if(points.length < 2) return;
  const node = `<path fill="none" stroke="#000000" stroke-width="1" d="${original??dFor(points)}"/>`;
  local.push(node);localPortable.push(node);
  (current.paths as PlotPath[]).push({points,tool:'#000000',width:1,layerId:current.id});
}
function line(x:number,y:number,x2:number,y2:number) {path([{x,y},{x:x2,y:y2}]);}
function rect(x:number,y:number,w:number,h:number) {path([{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h},{x,y}]);}
function circle(cx:number,cy:number,r:number) {
  const count=Math.ceil(Math.PI*2/Math.acos(1-.02/r));
  path(Array.from({length:count+1},(_,i)=>({x:cx+r*Math.cos(i/count*Math.PI*2),y:cy+r*Math.sin(i/count*Math.PI*2)})));
}
function cubic(v:number[]) {
  const commands=[{type:'M',values:v.slice(0,2)},{type:'C',values:v.slice(2)}];
  path(flattenContour(commands,.03),`M${v.slice(0,2).join(' ')} C${v.slice(2).join(' ')}`);
}
function text(copy:string,x:number,top:number,size=2.6,fontId='sans',options:Record<string,unknown>={}) {
  const geometry=layoutText(fonts.get(fontId)!,copy,{capHeight:size,...options});
  const [vx,vy]=geometry.viewBox;
  const paths=toSVGPaths(geometry);
  if(paths.some(p=>p.kind==='fill'))throw new Error('Labels must be stroke fonts');
  const nodes=paths.map(p=>`<path fill="none" stroke="#000000" stroke-width="1" data-openplotfont-kind="stroke" d="${p.d}"/>`).join('');
  const group=`<g data-openplotfont-order="true" transform="translate(${n(x-vx)} ${n(top-vy)})">${nodes}</g>`;
  local.push(group);localPortable.push(group);
  for(const op of geometry.operations)if(op.kind==='stroke'){
    const points=flattenContour(op.contour.commands,.02).map(p=>({x:p.x+x-vx,y:p.y+top-vy}));
    (current.paths as PlotPath[]).push({points,tool:'#000000',width:1,layerId:current.id,orderGroup:`${current.id}-text-${current.paths.length}`});
  }
  return geometry.viewBox[2];
}
const fillDiagnostics: string[]=[];
function fill(contours:Point[][],s:FillSettings,title:string) {
  const d=contours.map(c=>`${dFor(c)} Z`).join(' ');
  local.push(`<path data-plot-fill="${esc(JSON.stringify(s))}" fill="none" fill-rule="evenodd" stroke="#000000" stroke-width="1" d="${d}"/>`);
  const result=generateGeometry({contours,rule:'evenodd',settings:s,tool:'#000000',key:title,outlineTool:'#000000',outlineWidth:1});
  fillDiagnostics.push(...result.diagnostics.map(message=>`${title}: ${message}`));
  for(const p of result.paths){
    (current.paths as PlotPath[]).push({...p,layerId:current.id});
    localPortable.push(`<path fill="none" stroke="#000000" stroke-width="${p.width}" d="${dFor(p.points)}"/>`);
  }
}
const box=(x:number,y:number,w:number,h:number)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
const heading=(copy:string,y:number)=>text(copy,15,y,3.2);

section('registration','Registration and long strokes');
text('PLOT-IT / A3 SHARPIE LAB',15,12,6);
text('35 MM/S / ACCEL 200 / TRAVEL 80 / PEN 50-60 / WIDTH 1 MM',15,23,2.5);
heading('01 / REGISTRATION + LONG STROKES',33);
for(const [x,y]of [[15,15],[282,15],[15,405],[282,405]]){
  line(x-2,y,x-.6,y);line(x+.6,y,x+2,y);line(x,y-2,x,y-.6);line(x,y+.6,x,y+2);
}
for(const [i,len]of [10,25,50,100,200,240].entries()){
  const y=44+i*4.8;text(String(len),15,y-1.8,2);line(31,y,31+len,y);
}
// A true 260 mm stroke, the longest horizontal reference.
line(17,75,277,75);text('260 MM / CHECK STRAIGHTNESS AND EVEN INK',15,78,2.1);

section('short-strokes','Short marks and isolated pen lifts');
heading('02 / SHORT LINES + PEN LIFT GAPS',86);
for(const [i,len]of [.5,1,2,3,5,10,20,40].entries()){
  const x=i===7?237:i===6?210:20+i*33; text(`${len} MM`,x-3,94,2.2);
  for(let j=0;j<4;j++)line(x,103+j*4,x+len,103+j*4);
}
text('NOMINAL 40 MM SAMPLE AT RIGHT BELOW / BLANK 4 MM GAPS',15,121,2.1);
line(237,126,277,126);
for(let i=0;i<20;i++)line(18+i*10,128,24+i*10,128);

section('curves','Curves, circles, reversals and corners');
heading('03 / CURVE RADII + ACCELERATION + CORNERS',137);
for(const [i,r]of [1,2,4,8,14].entries()){
  const cx=[21,41,67,101,146][i]!;circle(cx,167,r);text(`R${r}`,cx-4,183,2.2);
}
for(let i=0;i<3;i++)cubic([174,152+i*9,190,132+i*9,253,188+i*9,277,150+i*9]);
path(Array.from({length:401},(_,i)=>{const t=i/400*Math.PI*8,r=1+4*i/400;return{x:124+r*Math.cos(t),y:190+r*Math.sin(t)};}));
path([{x:17,y:194},{x:38,y:194},{x:38,y:189},{x:48,y:194},{x:61,y:189},{x:76,y:194},{x:89,y:189}]);
text('TIGHT RADII / CUBIC S CURVES / SPIRAL / SHARP CORNERS',15,197,2.1);

for(const [i,percent]of [50,75,100].entries()){
  section(`speed-${percent}`,`Speed ladder ${settings.speed*percent/100} mm/s`,percent);
  const y=211+i*13;
  if(i===0)heading('04 / SAME CURVE AT THREE SPEEDS',204);
  text(`${settings.speed*percent/100} MM/S`,15,y+3,2.4);
  cubic([67,y+8,94,y-8,117,y+22,146,y+8]);
  path([{x:164,y:y+8},{x:184,y:y+8},{x:184,y:y-1},{x:193,y:y-1},{x:193,y:y+8},{x:213,y:y+8}]);
  line(231,y+8,277,y+8);
}

section('fill-grades','Fill grades - Continue after motion inspection',100,true);
heading('05 / FILL GRADES 0-100% / 1 MM NOMINAL MARK',254);
for(let i=0;i<=10;i++){
  const x=17+i*23.9,pct=i*10;text(`${pct}%`,x,262,2.1);
  const s={...defaultFillSettings,width:1,mode:pct===100?'solid' as const:'hatch' as const,angle:45,gap:pct?100/pct-1:1,overlap:0,outline:true,connect:true};
  if(pct===0){rect(x,270,20,16);}else fill([box(x,270,20,16)],s,`${pct}% coverage`);
}
text('COVERAGE = LINE WIDTH / SPACING / PAPER + INK CHANGE THE RESULT',15,290,2.0);
for(const [i,overlap]of [0,.1,.15,.2,.3].entries()){
  const x=17+i*28; text(`OV ${overlap*100}%`,x,297,2.1);
  fill([box(x,305,22,14)],{...defaultFillSettings,width:1,mode:'solid',angle:0,overlap,outline:true,connect:true},`Solid overlap ${overlap}`);
}
for(const [i,angle]of [0,45,90].entries()){
  const x=167+i*38;text(`${angle} DEG`,x,297,2.1);
  fill([box(x,305,30,14)],{...defaultFillSettings,width:1,mode:i===1?'crosshatch':'hatch',angle,gap:1.5,outline:true,connect:i!==2},`Angle ${angle}`);
}

section('fill-holes','Fill clipping, holes and narrow features');
heading('06 / HOLES + CROSSHATCH + NARROW FEATURES',324);
const ring=(x:number,y:number,r:number)=>Array.from({length:80},(_,i)=>({x:x+r*Math.cos(i/80*Math.PI*2),y:y+r*Math.sin(i/80*Math.PI*2)}));
fill([ring(35,348,13),ring(35,348,6)],{...defaultFillSettings,width:1,mode:'crosshatch',gap:1,outline:true,connect:true},'Donut hole');
fill([[{x:66,y:336},{x:96,y:336},{x:96,y:361},{x:86,y:361},{x:86,y:344},{x:76,y:344},{x:76,y:361},{x:66,y:361}]],{...defaultFillSettings,width:1,mode:'hatch',gap:1,outline:true,connect:true},'Concave U');
for(const [i,w]of [.5,1,1.5,2,3,5].entries()){
  const x=113+i*16;fill([box(x,340,w,19)],{...defaultFillSettings,width:1,mode:'solid',overlap:.15,angle:90,outline:true,connect:true},`Narrow ${w} mm`);text(String(w),x-1,362,2.1);
}
text('HOLES STAY BLANK',221,339,2.5);text('NO CONNECTORS',221,347,2.5);text('ACROSS VOID',221,355,2.5);

section('typography','Typography - Continue after fill inspection',100,true);
heading('07 / TYPOGRAPHY / OUTLINED AS REAL PEN STROKES',369);
text('Aa Bb 0123 @&!?',15,378,2,'sans');text('Aa Bb 0123',101,376,4,'serif');
text('Sharpie curves',205,376,4,'script');
text('Hamburgefontsiv 0123456789',15,389,4,'sans');
text('fi AA A\u0301',208,386,4,'layout',{kerning:true,ligatures:true});
text('PLOT IT',15,399,6,'sans');text('SINGLE LINE / SERIF / SCRIPT / KERN + LIGA + COMBINING MARK',75,401,2.0);
finishSection();

const item={id:'a3-sharpie-lab',name:'A3 Sharpie comprehensive test',markup:markup.join('\n'),viewBox:[0,0,297,420] as [number,number,number,number],x:0,y:0,width:297,height:420,rotation:0,stroke:'#000000'};
const document:PlotItDocument={format:'plot-it',version:1,units:'mm',fonts:[],document:{documentName:'A3 Sharpie comprehensive lab',paper:{name:'A3 portrait',width:297,height:420},paperColor:'#ffffff',settings,items:[item],pens:{assignments:{'#000000':{color:'#000000',name:'Sharpie'}},excluded:[],order:['#000000'],mode:'source'}}};
const source=JSON.stringify(document,null,2)+'\n';parsePlotIt(source);
const allPaths=layers.flatMap(l=>l.paths) as PlotPath[];
const points=allPaths.flatMap(p=>p.points);
const bounds={minX:Math.min(...points.map(p=>p.x)),minY:Math.min(...points.map(p=>p.y)),maxX:Math.max(...points.map(p=>p.x)),maxY:Math.max(...points.map(p=>p.y))};
if(bounds.minX<10.5||bounds.minY<10.5||bounds.maxX>286.5||bounds.maxY>409.5)throw new Error(`Artwork exceeds the marker-safe A3 area: ${JSON.stringify(bounds)}`);
const options=coreOptions(settings);
const program=compileLayerProgram(layers,options);validatePlan(program);
validateNativePreview(motionPlanFromProgram(program,settings));
if(program.records.at(-1)!.penDown||program.records.at(-1)!.to.x||program.records.at(-1)!.to.y)throw new Error('Job must finish raised at origin');
const report:Record<string,unknown>={paper:document.document.paper,markerWidthMm:1,settings,bounds,sections,paths:allPaths.length,points:points.length,drawingMm:program.drawingMm,travelMm:program.travelMm,estimateSeconds:program.durationMs/1000,pauses:program.records.filter(r=>r.kind==='pause').map(r=>({label:r.label,atSeconds:r.startMs/1000})),fillDiagnostics};
await writeFile(`${output}/a3-sharpie-lab.plit.json`,source);
await writeFile(`${output}/a3-sharpie-lab.svg`,`<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="420mm" viewBox="0 0 297 420"><title>A3 Sharpie comprehensive lab</title>${portable.join('\n')}</svg>\n`);
await writeFile(`${output}/paths.json`,JSON.stringify(allPaths));

if(process.argv.includes('--simulate')){
  const clock=new VirtualClock(),board=new VirtualEbb(clock,{firmware:'3.1.7',fragmentBytes:1});
  const session=new PlotterSession(board.createTransport(),clock,options.profile);await session.connect();
  const manualPauses:unknown[]=[],gates:unknown[]=[];
  let requested=false,resumed=false;
  session.subscribe(event=>{
    if(event.kind==='record'&&event.phase==='settled'&&!requested&&event.recordId>30){
      requested=true;session.pause();manualPauses.push({timeMs:clock.now(),event:'requested'});
    }
    if(event.kind==='state'&&event.state==='paused'){
      const position={...board.position};
      queueMicrotask(()=>{clock.advance(1800);if(board.position.m1!==position.m1||board.position.m2!==position.m2||!board.penUp)throw new Error('Paused board moved or pen remained down');manualPauses.push({timeMs:clock.now(),event:'resume',position,penUp:board.penUp});session.resume();resumed=true;});
    }
    if(event.kind==='state'&&event.state==='tool-change'){
      gates.push({timeMs:clock.now(),position:{...board.position},penUp:board.penUp});queueMicrotask(()=>{clock.advance(1000);session.resume();});
    }
  });
  const result=await session.run(program);
  if(result!=='finished'||!resumed||!board.penUp||board.position.m1||board.position.m2)throw new Error(`Virtual execution did not finish safely: ${result}`);
  report.virtual={result,firmware:board.firmware,backend:program.backend,elapsedMs:clock.now(),commands:board.commandCount,penUp:board.penUp,position:board.position,manualPauses,gates,rejectedCommands:board.trace.filter(e=>e.phase==='rejected').length,droppedTraceEntries:board.droppedTraceEntries};
  await session.disconnect();
}
await writeFile(`${output}/report.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
