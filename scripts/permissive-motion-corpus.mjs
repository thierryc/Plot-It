import {readFileSync} from 'node:fs';
export const corpusDefinition=JSON.parse(readFileSync(new URL('./fixtures/permissive-motion-corpus.json',import.meta.url),'utf8'));
export function motionCorpus({dense=true}={}) {
 const cases=corpusDefinition.small.map(c=>({...c,paths:(c.paths??[{tool:'black',points:c.points}]).map((p,i)=>({...p,sourceId:`${c.id}:${i}`,points:p.points.map(([x,y])=>({x,y}))}))}));
 if(dense){
  const d=corpusDefinition.dense;
  // Use the checked-in SVG's exact coordinates. Math.sin can differ by a final
  // floating-point bit across platforms, which changes canonical fixture hashes.
  const source=readFileSync(new URL('../docs/validation/dense-t3-acceptance/dense-18000.svg',import.meta.url),'utf8');
  const data=source.match(/<path\b[^>]*\bd="([^"]+)"/)?.[1];
  if(!data)throw new Error('Dense regression fixture is missing its path');
  const points=[...data.matchAll(/[ML]\s*([-+\d.eE]+)[,\s]+([-+\d.eE]+)/g)].map(([,x,y])=>({x:Number(x),y:Number(y)}));
  if(points.length!==d.count||points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))throw new Error('Invalid dense regression fixture');
  cases.push({id:d.id,paths:[{tool:'black',sourceId:`${d.id}:0`,points}]});
 }
 return cases;
}
export function corpusOptions(core,c,backend='sm') {
 return {profile:core.machineProfile('xylodraw',0),pen:{...core.defaultPen,up:30,down:52,upDelayMs:200,downDelayMs:200},speed:35,travelSpeed:60,acceleration:200,travelAcceleration:300,cornering:.127,maxPenDownMm:c.maxPenDownMm??0,returnToOrigin:c.returnToOrigin??true,drawingMode:c.drawingMode??'profiled',backend,firmware:backend==='t3'?'3.1.7':'2.8.1'};
}
