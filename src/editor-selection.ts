import type { ArtworkItem } from './model';
import type { WorldBounds } from './editor-viewport';

export const resizeHandles = [['nw',0,0],['n',.5,0],['ne',1,0],['e',1,.5],['se',1,1],['s',.5,1],['sw',0,1],['w',0,.5]] as const;
export function handlePosition(handle: string): {x:number;y:number} { const point=resizeHandles.find(([name])=>name===handle);return {x:point?.[1]??.5,y:point?.[2]??.5}; }


/** Overlay geometry is in mm; radii and offsets are projected from fixed CSS pixels. */
export function rotationHandle(x: number, y: number, scale: number): string {
  const touch=typeof matchMedia==='function'&&matchMedia('(pointer:coarse), (max-width:639px)').matches;
  const cy = y - (touch?38:26) / scale;
  return `<path class="rotation-connector" d="M${x} ${y}V${cy}"/><circle class="rotation-hit" data-rotate cx="${x}" cy="${cy}" r="${(touch?22:13) / scale}" role="button" aria-label="Rotate selection" tabindex="0"><title>Rotate · Shift snaps to 15°</title></circle><circle class="rotation-knob" cx="${x}" cy="${cy}" r="${5 / scale}"/>`;
}
export function selectionBox(bounds: WorldBounds, scale: number, editNodes: boolean, transform = ''): string {
  const {x,y,width,height}=bounds;
  const touch=typeof matchMedia==='function'&&matchMedia('(pointer:coarse), (max-width:639px)').matches;
  const names:Record<string,string>={nw:'top left',n:'top',ne:'top right',e:'right',se:'bottom right',s:'bottom',sw:'bottom left',w:'left'};
  const handles = editNodes ? '' : resizeHandles.map(([corner,dx,dy]) => {
    const cx=x+Number(dx)*width, cy=y+Number(dy)*height;
    return `<circle class="handle-hit ${corner}" data-handle="${corner}" cx="${cx}" cy="${cy}" r="${(touch?22:12)/scale}" role="button" tabindex="0" aria-label="Resize ${names[corner]}" aria-describedby="resize-instructions"><title>Resize ${names[corner]} · Arrows 0.1 mm; Shift 1 mm; Enter finishes; Escape cancels</title></circle><circle class="handle ${corner}" data-handle="${corner}" cx="${cx}" cy="${cy}" r="${6/scale}"/>`;
  }).join('') + rotationHandle(x+width/2,y,scale);
  return `<g class="selection-ui" ${transform ? `transform="${transform}"` : ''}><rect class="selection-box" x="${x}" y="${y}" width="${width}" height="${height}"/>${handles}</g>`;
}
export function wholeSelection(item: ArtworkItem, scale: number, editNodes: boolean): string {
  return selectionBox({x:0,y:0,width:item.width,height:item.height},scale,editNodes,`translate(${item.x} ${item.y}) rotate(${item.rotation} ${item.width/2} ${item.height/2})`);
}
