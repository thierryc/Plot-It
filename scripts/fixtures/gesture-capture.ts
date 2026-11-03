// Dedicated origin: never modify the user's editor document.
if(location.hostname!=='127.0.0.1'||location.port!=='5184')throw Error('Use isolated port 5184.');
const {initialState}=await import('/src/model.ts');
const state=structuredClone(initialState);
state.documentName='Trusted pointer capture fixture';
state.items=[{id:'capture-shape',name:'Rectangle',x:40,y:40,width:45,height:30,rotation:0,stroke:'#171714',viewBox:[0,0,45,30],markup:'<rect width="45" height="30"/>'}];
if(new URLSearchParams(location.search).has('text')) {
 const {ensureFontLoaded,typographyToItem,defaultTextOptions}=await import('/src/typography.ts');
 await ensureFontLoaded('inter');
 const item=typographyToItem('Plot-it',17,{...defaultTextOptions,fontId:'inter'});
 Object.assign(item,{id:'capture-shape',x:40,y:40,rotation:35.626});state.items=[item];
}
state.selectedId='capture-shape';
if(!new URLSearchParams(location.search).has('restore'))localStorage.setItem('plot-it-document',JSON.stringify(state));
const trace=document.querySelector('#trace')!,log:unknown[]=[],wrapped=new WeakSet<SVGSVGElement>();
const geometry=(item:any)=>item&&({id:item.id,x:item.x,y:item.y,width:item.width,height:item.height,rotation:item.rotation});
const add=(entry:unknown)=>{log.push(entry);trace.textContent=JSON.stringify(log,null,2);};
const setItem=Storage.prototype.setItem;
Storage.prototype.setItem=function(key,value){if(key==='plot-it-document')add({type:'persist',item:geometry(JSON.parse(value).items[0])});return setItem.call(this,key,value);};
let interrupted=false;
for(const type of ['pointerdown','pointermove','pointerup','pointercancel','gotpointercapture','lostpointercapture'])document.addEventListener(type,event=>{
 const p=event as PointerEvent;
 if(type==='pointermove'&&log.filter((e:any)=>e.type==='pointermove').length>10)return;
 add({type,id:p.pointerId,pointerType:p.pointerType,buttons:p.buttons,trusted:p.isTrusted,target:(p.target as Element).id||(p.target as Element).localName,x:p.clientX,y:p.clientY});
 if(type==='pointerdown'){
  const svg=document.querySelector<SVGSVGElement>('#paper')!;
  if(!wrapped.has(svg)){wrapped.add(svg);const capture=svg.setPointerCapture.bind(svg);svg.setPointerCapture=id=>{add({type:'setPointerCapture',id});try{capture(id);}catch(error){add({type:'captureError',error:String(error)});throw error;}};}
 }
 if(type==='pointermove'&&!interrupted&&p.buttons===1&&new URLSearchParams(location.search).has('lose-capture')) {
  const svg=document.querySelector<SVGSVGElement>('#paper')!;
  if(svg.hasPointerCapture(p.pointerId)&&p.clientX>450) {
   interrupted=true;add({type:'force-native-capture-loss',transform:document.querySelector('[data-item-id="capture-shape"]')?.getAttribute('transform')});svg.releasePointerCapture(p.pointerId);
  }
 }
 if(type==='pointerup'||type==='lostpointercapture'||type==='pointercancel')setTimeout(()=>add({type:'after-'+type,transform:document.querySelector('[data-item-id="capture-shape"]')?.getAttribute('transform'),stored:geometry(JSON.parse(localStorage.getItem('plot-it-document')!).items[0]),toast:document.querySelector('#toast')?.textContent}),0);
},true);
window.addEventListener('blur',()=>add({type:'window-blur'}));
window.addEventListener('error',event=>add({type:'error',message:event.message}));
await import('/src/main.ts');
add({type:'ready'});
