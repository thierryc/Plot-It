if(location.hostname!=='127.0.0.1'||location.port!=='5184')throw Error('Use isolated port 5184.');
const {initialState,defaultFillSettings}=await import('/src/model.ts');
const {awaitFills}=await import('/src/fill-dom.ts');
const state=structuredClone(initialState);
state.documentName='Complex incremental fixture';state.items=[];
for(let i=0;i<24;i++)state.items.push({id:`complex-${i}`,name:`Complex ${i}`,x:20+i%4*40,y:30+Math.floor(i/4)*35,width:35,height:28,rotation:0,stroke:'#171714',viewBox:[0,0,35,28],markup:Array.from({length:120},(_,n)=>`<path id="shape-${i}-${n}" d="M${n%12*2} ${Math.floor(n/12)*2}c.5 1 1 -.5 1.5 1l.2 .2"/>`).join('')});
state.items.push({id:'filled',name:'Filled unaffected',x:150,y:240,width:20,height:20,rotation:0,stroke:'#171714',viewBox:[0,0,20,20],markup:'<rect width="20" height="20"/>',fillSettings:{...defaultFillSettings,mode:'hatch',outline:true,width:.5}});
state.selectedId='complex-0';localStorage.setItem('plot-it-document',JSON.stringify(state));
await import('/src/main.ts');
const results=document.querySelector('#results')!;
const frame=()=>new Promise<number>(resolve=>requestAnimationFrame(resolve));
async function measure(){
try {
 const svg=document.querySelector<SVGSVGElement>('#paper')!;await awaitFills(svg);
 Object.assign(svg,{setPointerCapture:()=>{},hasPointerCapture:()=>false,releasePointerCapture:()=>{}});
 document.querySelector<HTMLElement>('#stage')!.focus();
 const target=document.querySelector('#artwork-layer > [data-item-id="complex-0"] path')!;
 const untouched=document.querySelector('#artwork-layer > [data-item-id="complex-1"]')!,fill=document.querySelector('[data-item-id="filled"] [data-generated-fill]')!;
 const records:MutationRecord[]=[];const observer=new MutationObserver(r=>records.push(...r));observer.observe(untouched,{subtree:true,attributes:true,childList:true});observer.observe(fill,{subtree:true,attributes:true,childList:true});
 const p=new DOMPoint(25,35).matrixTransform(svg.getScreenCTM()!);
 const event=(type:string,x:number)=>new PointerEvent(type,{pointerId:123,pointerType:'mouse',clientX:p.x+x,clientY:p.y,buttons:type==='pointerup'?0:1,bubbles:true});
 target.dispatchEvent(event('pointerdown',0));
 const durations:number[]=[],processing:number[]=[];
 for(let f=0;f<20;f++) {const t=performance.now();for(let j=0;j<8;j++)document.dispatchEvent(event('pointermove',f*2+j/8+3));processing.push(performance.now()-t);await frame();durations.push(performance.now()-t);}
 const identity=document.querySelector('[data-item-id="complex-1"]')===untouched;
 document.dispatchEvent(event('pointerup',42));await frame();observer.disconnect();
 const report={events:160,frames:20,medianFrameMs:durations.sort((a,b)=>a-b)[10],medianDispatchMs:processing.sort((a,b)=>a-b)[10],unrelatedNodesRetained:identity,unrelatedMutationCount:records.length,paperRetained:document.querySelector('#paper')===svg};
 if(location.hash==='#baseline')sessionStorage.setItem('incremental-baseline',JSON.stringify(report));
 const baseline=sessionStorage.getItem('incremental-baseline');results.textContent=JSON.stringify({baseline:baseline?JSON.parse(baseline):null,current:report},null,2);
} catch(error){results.textContent=String((error as Error).stack);}}
document.querySelector('#run')!.addEventListener('click',measure);

const assert=(condition:unknown,message:string)=>{if(!condition)throw Error(message);};
const read=()=>JSON.parse(localStorage.getItem('plot-it-document')!);
const paper=()=>document.querySelector<SVGSVGElement>('#paper')!;
const group=(id:string)=>document.querySelector<SVGGElement>(`#artwork-layer > [data-item-id="${id}"]`)!;
const click=(selector:string)=>document.querySelector<HTMLElement>(selector)!.click();
const select=(id:string,index?:number)=>{click(`[data-select-item="${id}"]`);if(index!==undefined)click(`[data-select-element="${index}"]`);};
const screen=(x:number,y:number)=>new DOMPoint(x,y).matrixTransform(paper().getScreenCTM()!);
const ptr=(target:EventTarget,type:string,p:DOMPoint,mods={})=>target.dispatchEvent(new PointerEvent(type,{pointerId:123,pointerType:'mouse',clientX:p.x,clientY:p.y,buttons:type==='pointerup'?0:1,bubbles:true,cancelable:true,...mods}));
const key=(type:string,key:string)=>document.dispatchEvent(new KeyboardEvent(type,{key,bubbles:true,cancelable:true}));
const capture=()=>Object.assign(paper(),{setPointerCapture:()=>{},hasPointerCapture:()=>false,releasePointerCapture:()=>{}});
const generated=(id:string)=>group(id).querySelector<SVGGElement>('[data-generated-fill]')!;
const pageMatrix=(element:SVGGraphicsElement)=>{const m=paper().getScreenCTM()!;return new DOMMatrix([m.a,m.b,m.c,m.d,m.e,m.f]).inverse().multiply(element.getScreenCTM()!);};
let checks:string[]=[];
const importDoc=(content:string,file?:File)=>{const data=new DataTransfer();data.items.add(file??new File([content],'fixture.plit.json',{type:'application/json'}));const input=document.querySelector<HTMLInputElement>('#document-input')!;input.files=data.files;input.dispatchEvent(new Event('change'));};
async function test(name:string,run:()=>Promise<void>){await run();checks.push(`PASS ${name}`);results.textContent=checks.join('\n');}
async function verify(){
 try {
  const {fillPlotPaths,exportFilledSvg}=await import('/src/fill-dom.ts');
  const {prepareJob}=await import('/src/plot-job.ts');
  await awaitFills(paper());
  await test('Artwork interruptions commit once across move, element move, resize, rotation and node edit',async()=>{
    for (const kind of ['move','element','resize','rotate','node']) for (const end of ['lostpointercapture','pointercancel','blur','error']) {
      select(kind==='element'||kind==='resize'?'filled':'complex-0',kind==='element'||kind==='node'?0:undefined);
      if(kind==='node')click('[data-action="edit-nodes"]');
      capture();await awaitFills(paper());const svg=paper(),id=read().selectedId,source=group(id),before=JSON.stringify(read().items);
      const target=kind==='resize'?svg.querySelector('[data-handle="se"]')!:kind==='rotate'?svg.querySelector('[data-rotate]')!:kind==='node'?svg.querySelector('[data-path-node="0:0"]')!:source.querySelector('[data-element-index]')!;
      const box=target.getBoundingClientRect(),p=new DOMPoint(box.x+box.width/2,box.y+box.height/2),q=new DOMPoint(p.x+20,p.y+10);
      let writes=0;const setItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='plot-it-document')writes++;return setItem.call(this,key,value);};
      try {
        ptr(target,'pointerdown',p);ptr(document,'pointermove',q);await frame();
        if(end==='blur')window.dispatchEvent(new Event('blur'));
        else if(end==='error') {
          const bad=new PointerEvent('pointermove',{pointerId:123,pointerType:'mouse',buttons:1,bubbles:true});Object.defineProperty(bad,'clientX',{value:NaN});document.dispatchEvent(bad);
        } else ptr(document,end,q);
        await awaitFills(svg);const after=JSON.stringify(read().items);
        assert(before!==after,`${kind}/${end} discarded transformation`);assert(writes===1,`${kind}/${end} persisted ${writes} times`);
        ptr(document,'pointerup',q);await frame();assert(JSON.stringify(read().items)===after&&writes===1,`${kind}/${end} finished twice`);
        click('[data-action="undo"]');assert(JSON.stringify(read().items)===before,`${kind}/${end} needs more than one Undo`);
        click('[data-action="redo"]');assert(JSON.stringify(read().items)===after,`${kind}/${end} Redo lost endpoint`);
        click('[data-action="undo"]');await awaitFills(paper());
      } finally {Storage.prototype.setItem=setItem;}
    }
  });
  await test('Interrupted Option duplication commits one copy while Escape discards it',async()=>{
    select('complex-0');capture();const before=JSON.stringify(read().items),svg=paper(),p=screen(25,35),q=screen(32,38);
    ptr(group('complex-0').querySelector('path')!,'pointerdown',p,{altKey:true});ptr(document,'pointermove',q,{altKey:true});await frame();ptr(document,'lostpointercapture',q);await awaitFills(svg);
    assert(read().items.length===JSON.parse(before).length+1,'Interrupted copy was discarded');assert(JSON.stringify(read().items.slice(0,-1))===before,'Interrupted copy moved source');
    const after=JSON.stringify(read().items);click('[data-action="undo"]');assert(JSON.stringify(read().items)===before,'Copy undo failed');click('[data-action="redo"]');assert(JSON.stringify(read().items)===after,'Copy redo failed');click('[data-action="undo"]');await awaitFills(paper());
    select('complex-0');capture();ptr(group('complex-0').querySelector('path')!,'pointerdown',p,{altKey:true});ptr(document,'pointermove',q,{altKey:true});await frame();key('keydown','Escape');await awaitFills(paper());assert(JSON.stringify(read().items)===before,'Escape committed copy');
  });
  await test('One preview per frame; unchanged persisted state; unrelated DOM and fill identity',async()=>{
    select('complex-0');capture();const svg=paper(),active=group('complex-0'),untouched=group('complex-1'),fill=generated('filled');
    let writes=0;const setItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='plot-it-document')writes++;return setItem.call(this,key,value);};
    const saved=JSON.stringify(read().items),records:MutationRecord[]=[],updates:MutationRecord[]=[];
    const observer=new MutationObserver(r=>records.push(...r)),counter=new MutationObserver(r=>updates.push(...r));
    observer.observe(untouched,{subtree:true,attributes:true,childList:true});observer.observe(fill,{subtree:true,attributes:true,childList:true});counter.observe(active,{attributes:true,attributeFilter:['transform']});
    const p=screen(25,35);ptr(active.querySelector('path')!,'pointerdown',p);
    for(let f=0;f<5;f++){for(let j=0;j<20;j++)ptr(document,'pointermove',screen(28+f+j/100,35));await frame();assert(JSON.stringify(read().items)===saved,'Preview persisted source state');}
    await frame();assert(updates.length===5,`${updates.length} updates for five frames`);
    let blocked=false;try{await awaitFills(svg);}catch{blocked=true;}assert(blocked,'Provisional output available');
    ptr(document,'pointerup',screen(35,35));await awaitFills(svg);await frame();observer.disconnect();counter.disconnect();
    assert(paper()===svg && group('complex-0')===active && group('complex-1')===untouched && generated('filled')===fill,'Gesture replaced mounted DOM');
    Storage.prototype.setItem=setItem;assert(writes===1,`Persisted ${writes} times for one gesture`);assert(records.length===0,'Unrelated nodes mutated');
  });
  await test('Option toggling reuses a provisional copy and cancellation leaves no late frame',async()=>{
    select('complex-0');capture();const svg=paper(),saved=JSON.stringify(read()),source=group('complex-0'),p=screen(30,35),q=screen(38,39);
    ptr(source.querySelector('path')!,'pointerdown',p);ptr(document,'pointermove',q);await frame();key('keydown','Alt');await frame();
    const copy=[...svg.querySelectorAll<SVGGElement>('#artwork-layer > [data-item-id]')].find(g=>g.dataset.itemId!.startsWith('item-'))!;assert(copy,'Missing provisional copy');
    key('keyup','Alt');await frame();assert(!copy.isConnected,'Alt release kept copy');key('keydown','Alt');await frame();assert(copy.isConnected,'Copy DOM was recreated');
    ptr(document,'pointermove',screen(42,40));key('keydown','Escape');await frame();
    assert(!copy.isConnected && paper()===svg && group('complex-0')===source,'Cancel replaced scene or retained copy');assert(JSON.stringify(read())===saved,'Cancel changed document');await awaitFills(svg);
  });
  await test('Whole-object move commits one undo and redo with source geometry intact',async()=>{
    select('complex-0');capture();const before=read().items.find((i:any)=>i.id==='complex-0'),source=group('complex-0'),p=screen(30,35),q=screen(36,38);
    ptr(source.querySelector('path')!,'pointerdown',p);ptr(document,'pointermove',q);await frame();ptr(document,'pointerup',q);await awaitFills(paper());
    const after=read().items.find((i:any)=>i.id==='complex-0');assert(after.x===before.x+6&&after.y===before.y+3&&after.markup===before.markup,'Move commit wrong');
    click('[data-action="undo"]');assert(read().items.find((i:any)=>i.id==='complex-0').x===before.x,'Undo did not restore');click('[data-action="redo"]');assert(read().items.find((i:any)=>i.id==='complex-0').x===after.x,'Redo did not restore');await awaitFills(paper());
  });
  await test('Cached filled object follows rigid movement; resize exposes only its outline',async()=>{
    select('filled');capture();await awaitFills(paper());let svg=paper(),fill=generated('filled'),source=group('filled').querySelector<SVGGraphicsElement>('rect')!,d=fill.innerHTML,before=pageMatrix(fill),p=screen(155,245),q=screen(159,247);
    ptr(source,'pointerdown',p);ptr(document,'pointermove',q);await frame();const after=pageMatrix(fill);assert(fill.innerHTML===d&&Math.abs(after.e-before.e-4)<.00001&&Math.abs(after.f-before.f-2)<.00001,'Cached fill did not follow move');
    ptr(document,'pointerup',q);await awaitFills(svg);assert(generated('filled')!==fill,'Moved fill not regenerated');
    capture();fill=generated('filled');source=group('filled').querySelector('rect')!;const handle=svg.querySelector('[data-handle="se"]')!,old=read().items.find((i:any)=>i.id==='filled');p=screen(old.x+20,old.y+20);q=screen(old.x+23,old.y+22);
    ptr(handle,'pointerdown',p);ptr(document,'pointermove',q,{altKey:true,shiftKey:true});await frame();assert(getComputedStyle(fill).display==='none'&&getComputedStyle(source).opacity==='1','Resize not showing source outline');
    ptr(document,'pointerup',q,{altKey:true,shiftKey:true});await awaitFills(svg);assert(generated('filled')!==fill&&getComputedStyle(source).opacity==='0','Resize failed to resolve');
  });
  await test('Cached region follows element move and rotation, with no sibling mutations',async()=>{
    select('filled',0);capture();await awaitFills(paper());const svg=paper(),source=group('filled').querySelector<SVGGraphicsElement>('rect')!,fill=generated('filled'),unrelated=group('complex-1'),records:MutationRecord[]=[];
    const observer=new MutationObserver(r=>records.push(...r));observer.observe(unrelated,{subtree:true,attributes:true,childList:true});
    let p=screen(160,245),q=screen(164,248);const old=pageMatrix(fill);ptr(source,'pointerdown',p);ptr(document,'pointermove',q);await frame();assert(Math.abs(pageMatrix(fill).e-old.e-4)<.00001,'Element fill not translated');ptr(document,'pointerup',q);await awaitFills(svg);
    capture();const bounds=svg.querySelector<SVGRectElement>('.selection-box')!,cx=Number(bounds.getAttribute('x'))+Number(bounds.getAttribute('width'))/2,cy=Number(bounds.getAttribute('y'))+Number(bounds.getAttribute('height'))/2;
    const nextFill=generated('filled'),before=pageMatrix(nextFill);p=screen(cx,cy-30);q=screen(cx+30,cy);ptr(svg.querySelector('[data-rotate]')!,'pointerdown',p);ptr(document,'pointermove',q);await frame();const after=pageMatrix(nextFill);assert(Math.abs(after.b-before.a)<.00001,'Element fill not rotated');ptr(document,'pointerup',q);await awaitFills(svg);await frame();observer.disconnect();assert(records.length===0,'Unrelated mutations during element transforms');
  });
  await test('Filled Option copies retain author paint, unique region keys and editable source',async()=>{
    for(const index of [undefined,0]){
      select('filled',index);capture();await awaitFills(paper());const svg=paper(),source=group('filled').querySelector('rect')!,p=screen(165,245),q=screen(170,248),before=read().items.length;
      ptr(source,'pointerdown',p,{altKey:true});ptr(document,'pointermove',q,{altKey:true});await frame();ptr(document,'pointerup',q,{altKey:true});await awaitFills(svg);
      const keys=[...svg.querySelectorAll('[data-generated-fill]')].map(g=>g.getAttribute('data-fill-path-key'));assert(new Set(keys).size===keys.length,'Duplicate region key');
      assert(index===undefined?read().items.length===before+1:group('filled').querySelectorAll('[data-element-index]').length===2,'Copy lost editable source');assert(fillPlotPaths(svg).length>0,'Copy output missing');
    }
  });
  await test('Moving one filled sibling retains the other source and generated region',async()=>{
    select('filled',0);capture();await awaitFills(paper());const svg=paper(),sources=group('filled').querySelectorAll<SVGGraphicsElement>('[data-element-index]'),sibling=sources[1]!,key=sibling.getAttribute('data-fill-path-key'),fill=[...group('filled').querySelectorAll<SVGGElement>('[data-generated-fill]')].find(node=>node.getAttribute('data-fill-path-key')===key)!,records:MutationRecord[]=[];
    const observer=new MutationObserver(r=>records.push(...r));observer.observe(sibling,{attributes:true,subtree:true,childList:true});observer.observe(fill,{attributes:true,subtree:true,childList:true});
    const p=screen(165,245),q=screen(167,246);ptr(sources[0]!,'pointerdown',p);ptr(document,'pointermove',q);await frame();ptr(document,'pointerup',q);await awaitFills(svg);await frame();observer.disconnect();assert(records.length===0&&fill.isConnected&&sibling.isConnected,'Unchanged sibling region was mutated or replaced');
  });
  await test('Node preview updates only active path; cancellation restores cached fills and nodes',async()=>{
    select('complex-0',0);click('[data-action="edit-nodes"]');capture();const svg=paper(),source=group('complex-0').querySelector<SVGPathElement>('path')!,sibling=group('complex-0').querySelectorAll('path')[1]!,old=source.getAttribute('d'),saved=JSON.stringify(read().items),records:MutationRecord[]=[];
    const observer=new MutationObserver(r=>records.push(...r));observer.observe(sibling,{attributes:true,childList:true,subtree:true});const handle=svg.querySelector('[data-path-node="0:0"]')!,box=handle.getBoundingClientRect(),p=new DOMPoint(box.x+box.width/2,box.y+box.height/2),q=new DOMPoint(p.x+8,p.y+5);
    ptr(handle,'pointerdown',p);ptr(document,'pointermove',q);await frame();assert(source.getAttribute('d')!==old,'Node did not preview');assert(paper()===svg && group('complex-0').querySelector('path')===source,'Node preview replaced source');assert(JSON.stringify(read().items)===saved,'Node preview serialized');key('keydown','Escape');await frame();observer.disconnect();assert(records.length===0&&source.getAttribute('d')===old,'Node cancellation or sibling isolation failed');
    capture();ptr(svg.querySelector('[data-path-node="0:0"]')!,'pointerdown',p);ptr(document,'pointerup',q);await awaitFills(svg);assert(read().items.find((i:any)=>i.id==='complex-0').markup.includes(source.getAttribute('d')),'Node commit not serialized');click('[data-action="undo"]');assert(JSON.stringify(read().items)===saved,'Node undo failed');await awaitFills(paper());
  });
  await test('Committed preview, export and plot reuse the same generated vertices',async()=>{
    const svg=paper();await awaitFills(svg);const paths=fillPlotPaths(svg),exported=exportFilledSvg(svg,read().paper.width,read().paper.height);
    const documentSvg=new DOMParser().parseFromString(exported,'image/svg+xml'),points=[...documentSvg.querySelectorAll('path')].flatMap(path=>[...(path.getAttribute('d')??'').matchAll(/[ML]([+-]?[\d.eE]+)[ ,]+([+-]?[\d.eE]+)/g)].map(match=>({x:Number(match[1]),y:Number(match[2])})));
    assert(paths.flatMap((p:any)=>p.points).every((p:any)=>points.some(q=>Math.hypot(p.x-q.x,p.y-q.y)<.00001)),'Export changed vertices');
    const plan=await prepareJob(svg,read().paper,read().settings).promise;
    assert(paths.flatMap((p:any)=>p.points).every((p:any)=>plan.events.some((e:any)=>e.kind==='xy'&&Math.hypot(e.to.x-p.x,e.to.y-p.y)<.00001)),'Plot changed vertices');
  });
  await test('Pending document replacement cannot overwrite an active preview',async()=>{
    select('complex-0');await awaitFills(paper());const saved=JSON.stringify(read()),{serializePlotIt}=await import('/src/document-file.ts');
    const incoming=structuredClone(read());incoming.documentName='Should not replace preview';
    const file=new File([],'deferred.plit.json');let resolve!:(content:string)=>void;Object.defineProperty(file,'text',{value:()=>new Promise<string>(r=>resolve=r)});
    importDoc('',file);capture();const p=screen(30,35),q=screen(35,38);ptr(group('complex-0').querySelector('path')!,'pointerdown',p);ptr(document,'pointermove',q);await frame();
    resolve(serializePlotIt(incoming));await frame();await frame();assert(document.querySelector('.document-title')?.textContent!==incoming.documentName,'Load overwrote preview');
    key('keydown','Escape');await frame();assert(JSON.stringify(read())===saved,'Pending load replaced document');
  });
  await test('Inter text keeps cached perimeters while moving and resolves resize per object',async()=>{
    const {ensureFontLoaded,typographyToItem,defaultTextOptions}=await import('/src/typography.ts');const {serializePlotIt}=await import('/src/document-file.ts');
    await ensureFontLoaded('inter');const text=typographyToItem('Claude BO',15,{...defaultTextOptions,fontId:'inter',tracking:-.08});text.id='inter-text';text.x=30;text.y=40;
    const incoming=structuredClone(read());incoming.items.push(text);importDoc(serializePlotIt(incoming));
    for(let i=0;i<100&&!read().items.some((item:any)=>item.id===text.id);i++)await frame();assert(group('inter-text'),'Inter document import failed');await awaitFills(paper());
    select('inter-text');capture();const svg=paper(),nodes=group('inter-text').querySelectorAll<SVGPathElement>('[data-element-index]'),batch=generated('inter-text'),other=generated('filled'),curves=[...nodes].map(node=>node.getAttribute('d')),p=screen(35,45),q=screen(38,46);
    ptr(nodes[0]!,'pointerdown',p);ptr(document,'pointermove',q);await frame();assert(getComputedStyle(batch).display!=='none'&&generated('inter-text')===batch,'Text movement discarded cached boundary');
    ptr(document,'pointerup',q);await awaitFills(svg);assert(generated('inter-text')!==batch&&generated('filled')===other,'Text commit affected unrelated fill');
    const cached=generated('inter-text'),saved=JSON.stringify(read().items),current=read().items.find((item:any)=>item.id===text.id),start=screen(current.x+current.width,current.y+current.height),end=screen(current.x+current.width+5,current.y+current.height+2);
    capture();ptr(svg.querySelector('[data-handle="se"]')!,'pointerdown',start);ptr(document,'pointermove',end);await frame();assert(getComputedStyle(cached).display==='none'&&getComputedStyle(nodes[0]!).opacity==='1','Text resize did not expose outline');key('keydown','Escape');await frame();await awaitFills(svg);assert(generated('inter-text')===cached&&JSON.stringify(read().items)===saved,'Text cancellation lost cached result');
    capture();ptr(svg.querySelector('[data-handle="se"]')!,'pointerdown',start);ptr(document,'pointerup',end);await awaitFills(svg);assert(generated('inter-text')!==cached&&generated('filled')===other,'Text resize failed to reconcile');assert([...nodes].every((node,i)=>node.getAttribute('d')===curves[i]),'Text resizing changed original curves');
  });
  await test('Zoom remounts reuse resolved region keys and exact vertices',async()=>{
    await awaitFills(paper());const {fillPlotPaths}=await import('/src/fill-dom.ts'),before=JSON.stringify(fillPlotPaths(paper()));
    click('[data-action="zoom-in"]');await awaitFills(paper());assert(JSON.stringify(fillPlotPaths(paper()))===before,'Zoom invalidated region identities or vertices');
  });
  results.textContent=`ALL CHECKS PASSED\n${checks.join('\n')}`;
 }catch(error){results.textContent=checks.join('\n')+`\nFAIL ${(error as Error).stack}`;}
}
document.querySelector('#verify')!.addEventListener('click',verify);

for(const button of document.querySelectorAll<HTMLButtonElement>('#verification button'))button.disabled=false;
