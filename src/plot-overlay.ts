import { icon } from './icons';
import { samplePlan, type MotionPlan } from './motion-plan';
import type { Point } from './model';
const NS = 'http://www.w3.org/2000/svg';

/** Shared plan visualization; live plotting supplies estimated job progress. */
export class PlotOverlay {
  private overlay: SVGGElement;
  private marker: SVGGElement;
  private drawings: {node:SVGPathElement;start:number;end:number;length:number;indices:number[];offsets:number[]}[] = [];
  constructor(private plan: MotionPlan, private paper: SVGSVGElement) {
    this.overlay=document.createElementNS(NS,'g');this.overlay.setAttribute('class','simulation-overlay');
    const travel=document.createElementNS(NS,'path'); travel.setAttribute('class','simulation-travel');
    travel.setAttribute('d',plan.events.filter(e=>e.kind==='xy'&&!e.penDown).map(e=>`M${e.from.x} ${e.from.y}L${e.to.x} ${e.to.y}`).join(' '));this.overlay.append(travel);
    const origin=document.createElementNS(NS,'g'); origin.setAttribute('class','plot-origin-marker');
    origin.innerHTML='<circle r="1.5"/><text x="3" y="5">Origin</text>'; this.overlay.append(origin);
    let group:typeof this.drawings[number]|undefined;
    plan.events.forEach((e,index)=>{
      if(e.kind!=='xy'||!e.penDown) { group=undefined;return; }
      const length=Math.hypot(e.to.x-e.from.x,e.to.y-e.from.y);
      if(!group) {
        const node=document.createElementNS(NS,'path');node.setAttribute('class','simulation-drawing');node.setAttribute('stroke',e.tool);if(e.width)node.style.strokeWidth=String(e.width);node.setAttribute('d',`M${e.from.x} ${e.from.y}`);
        group={node,start:e.start,end:e.start+e.duration,length:0,indices:[],offsets:[]};this.drawings.push(group);this.overlay.append(node);
      }
      group.node.setAttribute('d',`${group.node.getAttribute('d')}L${e.to.x} ${e.to.y}`);
      group.indices.push(index);group.offsets.push(group.length);group.length+=length;group.end=e.start+e.duration;
    });
    this.drawings.forEach(g=>{g.node.setAttribute('stroke-dasharray',`${g.length} ${g.length}`);g.node.setAttribute('stroke-dashoffset',String(g.length));});
    this.marker=document.createElementNS(NS,'g');this.marker.setAttribute('class','simulation-marker');
    this.marker.innerHTML=`<circle r="2.5"/><g transform="translate(.6 -5.5) scale(.2)">${icon('pen')}</g>`;this.overlay.append(this.marker);paper.append(this.overlay);
  }
  update(time: number, override?: { position?: Point; penDown?: boolean }): void {
    const sample = samplePlan(this.plan, time);
    this.paper.dispatchEvent(new CustomEvent('plotter-position', { detail: { position: override?.position ?? sample.position, settings: this.plan.settings } }));
    this.marker.setAttribute('transform',`translate(${(override?.position ?? sample.position).x} ${(override?.position ?? sample.position).y})`);
    this.marker.classList.toggle('pen-down',override?.penDown ?? sample.penDown);
    for(const g of this.drawings){
      let distance=time>=g.end?g.length:0;
      if(time>g.start&&time<g.end){const j=g.indices.indexOf(sample.index);if(j>=0){const e=this.plan.events[sample.index]!;distance=g.offsets[j]!+Math.hypot(sample.position.x-e.from.x,sample.position.y-e.from.y);}}
      const offset=String(Math.max(0,g.length-distance));if(g.node.getAttribute('stroke-dashoffset')!==offset)g.node.setAttribute('stroke-dashoffset',offset);
    }
  }
  destroy(): void { this.overlay.remove(); this.paper.dispatchEvent(new CustomEvent('plotter-position', { detail: { position: { x: 0, y: 0 } } })); }
}
