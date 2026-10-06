import { initialState, type Point } from '../src/model';
import type { PlotPath } from '../src/svg';
import type { PlotItDocument } from '../src/document-file';
import { buildMotionPlan } from '../src/motion-plan';

/** Three centreline As: two legs and a separate crossbar per letter. */
export function a3ThreeAs(positions: Point[] = [170,210,250].map(x => ({x,y:130}))) {
  if (!positions.length || positions.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x<10 || p.y<10 || p.x+24>287 || p.y+24>287)) throw new Error('Test zone exceeds the reserved A3 area');
  const x = Math.min(...positions.map(p=>p.x)), y = Math.min(...positions.map(p=>p.y));
  const width = Math.max(...positions.map(p=>p.x))+24-x, height = Math.max(...positions.map(p=>p.y))+24-y;
  const paths: PlotPath[] = positions.flatMap(({x,y}) => [
    {tool:'#000000',points:[{x,y:y+24},{x:x+12,y},{x:x+24,y:y+24}]},
    {tool:'#000000',points:[{x:x+5,y:y+14},{x:x+19,y:y+14}]},
  ]);
  const settings = {...initialState.settings,profile:'axidraw' as const,machineRotation:90 as const,
    speed:50,travelSpeed:200,penUp:30,penDown:44,reorderMode:'preserve' as const,returnToOrigin:true};
  const markup = paths.map(path => `<path fill="none" stroke="#000000" d="${path.points.map((p,i) => `${i?'L':'M'}${p.x-x} ${p.y-y}`).join(' ')}"/>`).join('');
  const document: PlotItDocument = {format:'plot-it',version:1,units:'mm',fonts:[],document:{
    documentName:'A3 three A reference test',paper:{name:'A3 portrait',width:297,height:420},paperColor:'#ffffff',settings,
    items:[{id:'three-a',name:'Three centreline As',markup,viewBox:[0,0,width,height],x,y,width,height,rotation:0,stroke:'#000000'}]
  }};
  return {paths,plan:buildMotionPlan(paths,settings),document};
}

/** A diagnostic pattern, never auto-started. Coordinates are paper millimetres. */
export function a3Zone(x: number, y: number, name: string, penUp: number, penDown: number) {
  // Keep every test inside the area common to portrait and landscape A3.
  if (![x, y].every(Number.isFinite) || x < 10 || y < 10 || x + 60 > 287 || y + 40 > 287) throw new Error('Test zone exceeds the reserved A3 area');
  const strokes: Point[][] = [];
  // Alternating directions expose missing starts and ink across raised travels.
  for (let i = 0; i < 6; i++) strokes.push(i % 2
    ? [{ x: i * 10, y: 20 }, { x: i * 10, y: 0 }]
    : [{ x: i * 10, y: 0 }, { x: i * 10, y: 20 }]);
  // Short marks magnify late contact; 4 mm gaps must remain completely blank.
  let cursor = 0;
  for (const length of [1, 2, 5, 10]) {
    strokes.push([{ x: cursor, y: 28 }, { x: cursor + length, y: 28 }]); cursor += length + 4;
  }
  strokes.push([{ x: 38, y: 25 }, { x: 48, y: 25 }, { x: 48, y: 35 }, { x: 38, y: 35 }, { x: 38, y: 25 }]);
  strokes.push([{ x: 0, y: 40 }, { x: 20, y: 40 }]);
  const settings = { ...initialState.settings, profile: 'xylodraw' as const, machineRotation: 90 as const,
    speed: 50, travelSpeed: 200, penUp, penDown, reorderMode: 'preserve' as const };
  const paths: PlotPath[] = strokes.map(points => ({ points: points.map(p => ({ x: p.x + x, y: p.y + y })), tool: '#000000' }));
  const markup = strokes.map(points => `<path fill="none" stroke="#000000" d="${points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')}"/>`).join('');
  const document: PlotItDocument = { format: 'plot-it', version: 1, units: 'mm', fonts: [], document: {
    documentName: `A3 ${name} pen timing`, paper: { name: 'A3 portrait', width: 297, height: 420 }, paperColor: '#ffffff', settings,
    items: [{ id: `zone-${name}`, name: `Zone ${name}`, markup, viewBox: [0, 0, 60, 40], x, y, width: 60, height: 40, rotation: 0, stroke: '#000000' }]
  } };
  return { paths, plan: buildMotionPlan(paths, settings), document };
}
