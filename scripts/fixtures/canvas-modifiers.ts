// This fixture uses a dedicated origin; never seed the user's normal app origin.
if (location.hostname !== '127.0.0.1' || location.port !== '5184') throw Error('Use the isolated fixture on port 5184.');
const { initialState, defaultFillSettings } = await import('/src/model.ts');
const { textToItem } = await import('/src/plot-font.ts');
const { awaitFills, fillPlotPaths, exportFilledSvg } = await import('/src/fill-dom.ts');
const { flattenPlotPaths } = await import('/src/svg.ts');
const { serializePlotIt } = await import('/src/document-file.ts');
const { prepareJob } = await import('/src/plot-job.ts');
const { roundStepPath } = await import('/src/motion.ts');
const fixture = structuredClone(initialState);
fixture.documentName = 'Isolated gesture fixture';
fixture.items = [{id:'fixture',name:'Inherited shapes',x:30,y:30,width:50,height:30,rotation:0,stroke:'#171714',viewBox:[0,0,50,30],markup:'<g transform="translate(3 2) rotate(12)" stroke="#171714"><rect id="sample" x="0" y="0" width="18" height="12" data-plot-it-name="Rectangle"/><path id="curve" d="M25 0C20 10 40 5 40 20" data-plot-it-name="Curve"/></g>',fillSettings:{...defaultFillSettings,mode:'none',outline:true,width:.3,overlap:0,connect:false}},textToItem('Hello',10)];
fixture.selectedId='fixture'; fixture.zoom=1;
const phase = sessionStorage.getItem('modifier-fixture-phase');
if (!phase) { localStorage.setItem('plot-it-document',JSON.stringify(fixture)); localStorage.removeItem('plot-it-editor-preferences'); }
await import('/src/main.ts');
const results = document.querySelector('#results')!;
const logs: string[]=[];
const assert=(condition: unknown,message: string)=>{if(!condition)throw Error(message);};
const equal=(a:number,b:number,message:string)=>assert(Math.abs(a-b)<.00001,`${message}: ${a} != ${b}`);
const read=()=>JSON.parse(localStorage.getItem('plot-it-document')!);
const svg=()=>document.querySelector<SVGSVGElement>('#paper')!;
const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
const focus=()=>document.querySelector<HTMLElement>('#stage')!.focus({preventScroll:true});
const click=(selector:string)=>{const button=document.querySelector<HTMLElement>(selector);assert(button,`Missing ${selector}`);button!.click();};
const key=(type:string,k:string,values={})=>{const event=new KeyboardEvent(type,{key:k,code:k===' '?'Space':k,bubbles:true,cancelable:true,...values});document.activeElement!.dispatchEvent(event);return event;};
const screen=(x:number,y:number)=>new DOMPoint(x,y).matrixTransform(svg().getScreenCTM()!);
const pointer=(target:Element,type:string,p:DOMPoint,values={})=>target.dispatchEvent(new PointerEvent(type,{clientX:p.x,clientY:p.y,pointerId:71,pointerType:'mouse',buttons:type==='pointerup'?0:1,button:0,bubbles:true,cancelable:true,...values}));
// Synthetic pointer events have no hardware capture. The controller still owns
// all listeners and its real cancellation lifecycle; SVG transforms stay native.
const capture=()=>{Object.assign(svg(),{setPointerCapture:()=>{},hasPointerCapture:()=>false,releasePointerCapture:()=>{}});};
const selectedId=()=>document.querySelector<SVGGElement>('#artwork-layer > .is-selected')!.dataset.itemId;
const item=()=>read().items.find((i:any)=>i.id===selectedId());
const selectObject=()=>click('[data-select-item="fixture"]');
const undo=()=>click('[data-action="undo"]');
const drag=(dx:number,dy:number,values={},cancel?:string)=>{
  capture();const target=document.querySelector(`[data-item-id="${selectedId()}"] [data-element-index]`)!;
  const p=screen(40,40),q=screen(40+dx,40+dy);pointer(target,'pointerdown',p,values);pointer(document.documentElement,'pointermove',q,values);
  pointer(document.documentElement,cancel??'pointerup',q,values);
};
const test=async(name:string,run:()=>void|Promise<void>)=>{await run();logs.push(`PASS ${name}`);results.textContent=logs.join('\n');};
async function run(){
 try{
 focus();
 if (phase==='reload') {
  await test('Nudge preferences survive reload',()=>{
   assert(document.querySelector<HTMLInputElement>('[data-nudge-preference="nudgeMm"]')!.value==='0.25','Normal preference lost');
   assert(document.querySelector<HTMLInputElement>('[data-nudge-preference="shiftNudgeMm"]')!.value==='2','Shift preference lost');
  });
  await test('Document import preserves local preferences',async()=>{
   const input=document.querySelector<HTMLInputElement>('#document-input')!,data=new DataTransfer();
   data.items.add(new File([serializePlotIt(fixture)],'fixture.plot-it',{type:'application/json'}));input.files=data.files;input.dispatchEvent(new Event('change'));
   for(let tries=0;tries<200 && read().items.length!==2;tries++)await new Promise(r=>setTimeout(r,20));
   await new Promise(r=>setTimeout(r,100));
   assert(document.querySelector<HTMLInputElement>('[data-nudge-preference="nudgeMm"]')!.value==='0.25','Import replaced preference');
  });
  results.textContent=`ALL CHECKS PASSED\n${sessionStorage.getItem('modifier-fixture-report')}\n${logs.join('\n')}`; sessionStorage.removeItem('modifier-fixture-phase');return;
 }
 await test('Option click creates no duplicate',()=>{const count=read().items.length;capture();const target=document.querySelector('[data-item-id="fixture"] rect')!,p=screen(40,40);pointer(target,'pointerdown',p,{altKey:true});pointer(document.documentElement,'pointerup',p,{altKey:true});assert(read().items.length===count,'Option click cloned');});
 await test('Option toggle previews a copy, release returns to original, one undo',async()=>{
  const start=item(); capture();const target=document.querySelector('[data-item-id="fixture"] rect')!,p=screen(40,40),q=screen(48,44);
  pointer(target,'pointerdown',p);pointer(document.documentElement,'pointermove',q);key('keydown','Alt');await frame();assert(document.querySelectorAll('#artwork-layer > [data-item-id]').length===3,'No provisional copy');
  key('keyup','Alt');await frame();assert(document.querySelectorAll('#artwork-layer > [data-item-id]').length===2,'Provisional copy remained');pointer(document.documentElement,'pointerup',q);
  equal(item().x,start.x+8,'Move after Alt toggle');undo();equal(item().x,start.x,'Undo');
 });
 await test('Option Shift drag and repeat displacement / rotation / nudge',()=>{
  selectObject();drag(8,3,{altKey:true,shiftKey:true});const copy=item(),source=read().items.find((i:any)=>i.id==='fixture');
  equal(copy.x,source.x+8,'Copy displacement');equal(copy.y,source.y,'Shift axis');assert(copy.id!==source.id,'Copy identity');
  click('[data-action="rotate"]');focus();key('keydown','ArrowRight');key('keyup','ArrowRight');const latest=item();
  focus();key('keydown','d',{metaKey:true});const next=item();equal(next.x,latest.x+8.1,'Repeat nudge displacement');equal(next.y,latest.y,'Repeat y');equal(next.rotation,180,'Repeat angle');
  undo();assert(item().id===latest.id,'Undo copy selection');click('[data-action="redo"]');equal(item().rotation,180,'Redo copy');
 });
 for(const reason of ['pointercancel','lostpointercapture','escape'])await test(`Duplication ${reason} ${reason==='escape'?'restores':'saves'} scene`,()=>{
  const before=JSON.stringify(read().items),id=read().selectedId;capture();const target=document.querySelector(`[data-item-id="${id}"] rect`)!,p=screen(50,40),q=screen(60,44);
  pointer(target,'pointerdown',p,{altKey:true});pointer(document.documentElement,'pointermove',q,{altKey:true});
  if(reason==='escape')key('keydown','Escape');else pointer(document.documentElement,reason,q);
  if(reason!=='escape') {
    assert(read().items.length===JSON.parse(before).length+1,'Interrupted copy was discarded');
    assert(JSON.stringify(read().items.slice(0,-1))===before,'Interrupted copy moved original');undo();
  }
  assert(JSON.stringify(read().items)===before,'Scene restoration failed');assert(read().selectedId===id,'Selection restoration failed');assert(document.querySelectorAll('#artwork-layer > [data-item-id]').length===read().items.length,'Provisional copy remains');
 });
 await test('Centered proportional resize preserves center and clears repeat',()=>{
  selectObject();const before=item();capture();const handle=document.querySelector('[data-handle="se"]')!,p=screen(before.x+before.width,before.y+before.height),q=screen(before.x+before.width+5,before.y+before.height+3);
  pointer(handle,'pointerdown',p,{altKey:true,shiftKey:true});pointer(document.documentElement,'pointerup',q,{altKey:true,shiftKey:true});
  const after=item();equal(after.x+after.width/2,before.x+before.width/2,'Centered x');equal(after.y+after.height/2,before.y+before.height/2,'Centered y');equal(after.width/after.height,before.width/before.height,'Proportions');undo();
 });
 await test('Interactive rotation and absolute Shift snap',()=>{
  selectObject();const before=item(),cx=before.x+before.width/2,cy=before.y+before.height/2;capture();
  const handle=document.querySelector('[data-rotate]')!,p=screen(cx,cy-30),angle=-67*Math.PI/180,q=screen(cx+30*Math.cos(angle),cy+30*Math.sin(angle));
  pointer(handle,'pointerdown',p);pointer(document.documentElement,'pointermove',q);key('keydown','Shift');equal(Number(document.querySelector<HTMLInputElement>('[data-item-prop="rotation"]')!.value),0,'Inspector remains source until completion');
  pointer(document.documentElement,'pointerup',q,{shiftKey:true});equal(item().rotation,30,'Absolute rotation snapping');undo();
 });
 await test('Selected SVG sibling duplication preserves parent and page displacement',()=>{
  selectObject();click('[data-select-element="0"]');const parent=document.querySelector('[data-item-id="fixture"] [data-element-index="0"]')!.parentElement!.getAttribute('transform');
  const beforeElement=document.querySelector<SVGGraphicsElement>('[data-item-id="fixture"] [data-element-index="0"]')!,m=beforeElement.getScreenCTM()!,b=beforeElement.getBBox(),before=new DOMPoint(b.x+b.width/2,b.y+b.height/2).matrixTransform(m);
  click('[data-action="duplicate"]');assert(read().items.length===4,'Element clone became whole item');
  const list=document.querySelectorAll<SVGGraphicsElement>('[data-item-id="fixture"] [data-element-index]');assert(list.length===3,'Sibling missing');assert(list[0]!.parentElement===list[1]!.parentElement,'Source parent changed');assert(list[1]!.parentElement!.getAttribute('transform')===parent,'Inherited transform changed');assert(list[0]!.id!==list[1]!.id,'SVG ID collision');
  const after=new DOMPoint(b.x+b.width/2,b.y+b.height/2).matrixTransform(list[1]!.getScreenCTM()!),scale=svg().getScreenCTM()!.a;equal(after.x-before.x,5*scale,'Page-axis copy x');equal(after.y-before.y,5*scale,'Page-axis copy y');
  click('[data-action="rotate"]');click('[data-action="duplicate"]');assert(document.querySelectorAll('[data-item-id="fixture"] [data-element-index]').length===4,'Repeated sibling missing');undo();undo();undo();
 });
 await test('Selected element Option drag is editable and cancellable',()=>{
  selectObject();click('[data-select-element="0"]');const before=JSON.stringify(read().items);drag(7,-2,{altKey:true});assert(document.querySelectorAll('[data-item-id="fixture"] [data-element-index]').length===3,'Element Option copy missing');undo();assert(JSON.stringify(read().items)===before,'Element undo altered source');
 });

 await test('Selected element modifier toggles, cancellation, nudge and selection undo',async()=>{
  selectObject();click('[data-select-element="0"]');capture();const target=document.querySelector('[data-item-id="fixture"] [data-element-index="0"]')!,p=screen(40,40),q=screen(46,42);
  const before=JSON.stringify(read().items);pointer(target,'pointerdown',p);pointer(document.documentElement,'pointermove',q);key('keydown','Alt');await frame();assert(document.querySelectorAll('[data-item-id="fixture"] [data-element-index]').length===3,'Element preview absent');key('keyup','Alt');await frame();assert(document.querySelectorAll('[data-item-id="fixture"] [data-element-index]').length===2,'Element preview remained');pointer(document.documentElement,'pointerup',q);
  undo();assert(JSON.stringify(read().items)===before,'Element toggle undo changed geometry');assert(document.querySelector('[data-select-element="0"]')!.getAttribute('aria-pressed')==='true','Element selection not restored');
  focus();const b=Number(document.querySelector<HTMLInputElement>('[data-element-bounds="x"]')!.value);key('keydown','ArrowRight',{shiftKey:true});key('keyup','ArrowRight');equal(Number(document.querySelector<HTMLInputElement>('[data-element-bounds="x"]')!.value),b+1,'Element nudge page axis');undo();
  drag(8,2,{altKey:true},'pointercancel');assert(JSON.stringify(read().items)!==before,'Interrupted element copy was discarded');undo();assert(JSON.stringify(read().items)===before,'Interrupted element copy undo failed');
  click('[data-select-element="1"]');click('[data-action="edit-nodes"]');assert(!document.querySelector('[data-handle],[data-rotate]'),'Node editor exposes transform handles');click('[data-action="edit-nodes"]');selectObject();
 });
 await test('Space pressed during artwork drag does not switch to pan',()=>{
  selectObject();capture();const target=document.querySelector('[data-item-id="fixture"] rect')!,p=screen(40,40),q=screen(44,41),before=item().x,pan=document.querySelector<HTMLElement>('.paper-shadow')!.style.translate;
  pointer(target,'pointerdown',p);pointer(document.documentElement,'pointermove',q);key('keydown',' ');pointer(document.documentElement,'pointerup',q);key('keyup',' ');equal(item().x,before+4,'Space interrupted artwork');assert(document.querySelector<HTMLElement>('.paper-shadow')!.style.translate===pan,'Space moved viewport mid gesture');undo();
 });
 await test('Resize clears repeat duplication and source/style changes restart chains',()=>{
  selectObject();drag(9,0,{altKey:true});const before=item();capture();const h=document.querySelector('[data-handle="se"]')!,p=screen(before.x+before.width,before.y+before.height),q=screen(before.x+before.width+2,before.y+before.height+2);pointer(h,'pointerdown',p);pointer(document.documentElement,'pointerup',q);
  const resized=item();click('[data-action="duplicate"]');equal(item().x,resized.x+5,'Resize repeat not cleared');equal(item().y,resized.y+5,'Resize offset');undo();undo();undo();selectObject();
 });

 await test('Asymmetric element rotation keeps the intended repeated displacement',()=>{
  selectObject();click('[data-select-element="1"]');click('[data-action="duplicate"]');click('[data-action="rotate"]');
  const box=()=>({x:Number(document.querySelector<HTMLInputElement>('[data-element-bounds="x"]')!.value),y:Number(document.querySelector<HTMLInputElement>('[data-element-bounds="y"]')!.value)});
  const before=box();click('[data-action="duplicate"]');const after=box();
  // Two 90-degree rotations restore the axis orientation but may shift AABB
  // center. Compare the page transform itself to the known repeat operation.
  const source=document.querySelector<SVGGraphicsElement>('[data-item-id="fixture"] [data-element-index="2"]')!,copy=document.querySelector<SVGGraphicsElement>('[data-item-id="fixture"] [data-element-index="3"]')!;
  const root=svg().getScreenCTM()!,page=(e:SVGGraphicsElement)=>new DOMMatrix([root.a,root.b,root.c,root.d,root.e,root.f]).inverse().multiply(e.getScreenCTM()!);
  const b=source.getBBox(),m=page(source),corners=[[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(m));
  const cx=(Math.min(...corners.map(p=>p.x))+Math.max(...corners.map(p=>p.x)))/2,cy=(Math.min(...corners.map(p=>p.y))+Math.max(...corners.map(p=>p.y)))/2;
  const expected=new DOMMatrix().translate(5,5).translate(cx,cy).rotate(90).translate(-cx,-cy).multiply(m),actual=page(copy);
  for(const prop of ['a','b','c','d','e','f'] as const)equal(actual[prop],expected[prop],`Asymmetric repeat ${prop}`);
  assert(Number.isFinite(before.x+after.y),'Element bounds unavailable');undo();undo();undo();selectObject();
 });
 await test('Held-arrow autorepeat has one undo entry',()=>{
  selectObject();focus();const before=item().x;for(let i=0;i<5;i++)key('keydown','ArrowRight',{repeat:i>0});key('keyup','ArrowRight');equal(item().x,before+.5,'Repeated nudge');undo();equal(item().x,before,'One-step nudge undo');
 });
 await test('Text metadata survives whole-object copying',()=>{
  const text=read().items.find((i:any)=>i.text);click(`[data-select-item="${text.id}"]`);click('[data-action="duplicate"]');assert(JSON.stringify(item().text)===JSON.stringify(text.text),'Text metadata lost');assert(item().markup===text.markup,'Text curves changed');undo();selectObject();
 });
 await awaitFills(svg()); const vertices=JSON.stringify(fillPlotPaths(svg())),doc=JSON.stringify(read().items);
 await test('Free Space pan on fitted sheet, release Space during pan',()=>{
  focus();key('keydown',' ');capture();const stage=document.querySelector('#stage')!,p=new DOMPoint(200,200),q=new DOMPoint(270,245);pointer(stage,'pointerdown',p);pointer(document.documentElement,'pointermove',q);key('keyup',' ');pointer(document.documentElement,'pointerup',q);
  assert(document.querySelector<HTMLElement>('.paper-shadow')!.style.translate==='70px 45px','Fitted paper did not pan');assert(JSON.stringify(read().items)===doc,'Pan changed artwork');assert(JSON.stringify(fillPlotPaths(svg()))===vertices,'Pan changed generated vertices');
 });
 await test('Artwork drag after pan and zoom stays in millimetres',()=>{click('[data-action="zoom-in"]');selectObject();const before=item().x;drag(3,0);equal(item().x,before+3,'Drag after viewport transform');undo();});
 await test('Pan cancellation restores viewport and Fit resets pan / scroll',()=>{
  focus();key('keydown',' ');capture();const stage=document.querySelector('#stage')!,p=new DOMPoint(200,200),q=new DOMPoint(300,350),old=document.querySelector<HTMLElement>('.paper-shadow')!.style.translate;pointer(stage,'pointerdown',p);pointer(document.documentElement,'pointermove',q);key('keydown','Escape');key('keyup',' ');assert(document.querySelector<HTMLElement>('.paper-shadow')!.style.translate===old,'Escape pan changed viewport');
  for(const reason of ['pointercancel','lostpointercapture']) {
    focus();key('keydown',' ');capture();pointer(stage,'pointerdown',p);pointer(document.documentElement,'pointermove',q);pointer(document.documentElement,reason,q);key('keyup',' ');
    assert(document.querySelector<HTMLElement>('.paper-shadow')!.style.translate===old,`${reason} saved interrupted pan`);
  }
  for(let i=0;i<10;i++)click('[data-action="zoom-in"]');focus();key('keydown',' ');capture();pointer(document.querySelector('#stage')!,'pointerdown',p);pointer(document.documentElement,'pointerup',q);key('keyup',' ');assert(document.querySelector<HTMLElement>('.paper-shadow')!.style.translate!==old,'Overflowing paper did not pan');click('[data-action="zoom-fit"]');assert(document.querySelector<HTMLElement>('.paper-shadow')!.style.translate==='0px','Fit did not reset pan');equal(document.querySelector('#stage')!.scrollTop,0,'Fit scroll');
 });
 await test('Inputs / IME retain shortcuts',()=>{
  const input=document.querySelector<HTMLInputElement>('[data-item-prop="name"]')!;input.focus();const count=read().items.length;assert(!key('keydown','d',{metaKey:true}).defaultPrevented,'Text duplicate swallowed');assert(!key('keydown',' ').defaultPrevented,'Text Space swallowed');assert(read().items.length===count,'Text shortcut duplicated');focus();assert(!key('keydown','d',{metaKey:true,isComposing:true}).defaultPrevented,'IME swallowed');
 });
 await test('Nudge fields validate and preserve last valid preference',()=>{
  click('[data-menu-trigger]');const normal=document.querySelector<HTMLInputElement>('[data-nudge-preference="nudgeMm"]')!,shift=document.querySelector<HTMLInputElement>('[data-nudge-preference="shiftNudgeMm"]')!;
  normal.value='.25';normal.dispatchEvent(new Event('input'));normal.value='-1';normal.dispatchEvent(new Event('input'));assert(!document.querySelector<HTMLElement>('[data-nudge-error="nudgeMm"]')!.hidden,'Validation hidden');assert(JSON.parse(localStorage.getItem('plot-it-editor-preferences')!).nudgeMm===.25,'Invalid input replaced valid');normal.value='.25';normal.dispatchEvent(new Event('input'));shift.value='2';shift.dispatchEvent(new Event('input'));click('[data-menu-trigger]');
  focus();const before=item().x;key('keydown','ArrowRight');key('keyup','ArrowRight');key('keydown','ArrowRight',{shiftKey:true});key('keyup','ArrowRight');equal(item().x,before+2.25,'Configured nudge');
 });
 await test('Completed gestures retain preview/export and reachable plot vertices',async()=>{
  await awaitFills(svg());const paths=fillPlotPaths(svg());assert(paths.length>0,'No generated boundary');
  const exported=exportFilledSvg(svg(),read().paper.width,read().paper.height);assert(!exported.includes('rotation-hit'),'Editor handle exported');
  const clone=new DOMParser().parseFromString(exported,'image/svg+xml').documentElement as unknown as SVGSVGElement;document.body.append(clone);clone.style.position='absolute';clone.style.width='500px';
  const recovered=flattenPlotPaths(clone);const exportedPoints=[...clone.querySelectorAll('[d]')].flatMap(path=>[...((path.getAttribute('d')??'').matchAll(/[ML]([+-]?[\d.eE]+)[ ,]+([+-]?[\d.eE]+)/g))].map(match=>({x:Number(match[1]),y:Number(match[2])})));
  clone.remove();assert(recovered.length>0,'Export lost trajectories');
  assert(paths.flatMap((p:any)=>p.points).every((point:any)=>exportedPoints.some(p=>Math.hypot(p.x-point.x,p.y-point.y)<.00001)),'Export altered generated vertices');
  const plan=await prepareJob(svg(),read().paper,read().settings).promise;assert(plan.events.length>0,'Plot empty');
  // Plot endpoints use the current integer step lattice and remove redundant collinear vertices.
  const generatedVertices=paths.flatMap((p:any)=>roundStepPath(p.points,read().settings));assert(generatedVertices.every((point:any)=>plan.events.some((e:any)=>e.kind==='xy'&&Math.hypot(e.to.x-point.x,e.to.y-point.y)<.00001)),'Plot lost reachable generated vertices');
 });
 sessionStorage.setItem('modifier-fixture-report',logs.join('\n'));sessionStorage.setItem('modifier-fixture-phase','reload');location.reload();
 }catch(error){results.textContent=logs.join('\n')+`\nFAIL ${(error as Error).stack}`;}
}
document.querySelector('#run')!.addEventListener('click',run);
