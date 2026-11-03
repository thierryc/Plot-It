import { samplePlan, type MotionComparison } from './motion-plan';
import { comparisonData, comparisonDisplayPoints, speedColor, timeAtDistance } from './motion-comparison-data';
import css from './motion-comparison.module.css';
import buttonCss from './ui/design-system/button.module.css';

const sides = ['standard','dynamic'] as const;
type Side = typeof sides[number];
/** Isolated preview: no transport, execution, or machine connection dependencies. */
export class MotionComparisonPreview {
  readonly element = document.createElement('dialog');
  private data;
  private time = 0;
  private offsets = {standard:0,dynamic:0};
  private playing = false;
  private frame = 0;
  private lastFrame: number | null = null;
  private stroke = 0;
  private viewBox: number[];
  private initialViewBox: number[];
  private selectedDistance: number | null = null;
  private previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  private destroyed = false;
  private get duration() { return Math.max(...sides.map(side=>this.plans[side].duration-this.offsets[side])); }
  constructor(host: HTMLElement, private plans: MotionComparison, private onChoose: (strategy:Side)=>void, private onClose:()=>void) {
    this.data={standard:comparisonData(plans.standard),dynamic:comparisonData(plans.dynamic)};
    const points=this.data.standard.strokes.flatMap(stroke=>stroke.points);
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const point of points){minX=Math.min(minX,point.x);minY=Math.min(minY,point.y);maxX=Math.max(maxX,point.x);maxY=Math.max(maxY,point.y);}
    if(!points.length){minX=0;minY=0;maxX=1;maxY=1;}
    this.viewBox=[minX-5,minY-5,maxX-minX+10,maxY-minY+10];this.initialViewBox=[...this.viewBox];
    const peak=Math.max(this.data.standard.peak,this.data.dynamic.peak,1);
    const button=(label:string,action:string)=>`<button class="${buttonCss.button}" type="button" data-compare-action="${action}">${label}</button>`;
    this.element.className=css.dialog!;this.element.setAttribute('aria-labelledby','motion-comparison-title');
    this.element.innerHTML=`<header class="${css.header}"><h2 id="motion-comparison-title">Compare motion</h2>${button('Close','close')}</header>
      <p>Same drawing and motion ceilings. Preview only; choose a strategy before starting a plot.</p>
      <div class="${css.controls}">${button('Play','play')}${button('Restart','restart')}<input type="range" min="0" max="${this.duration}" step=".001" value="0" aria-label="Comparison timeline in seconds" data-compare-timeline><output data-compare-clock>0.00 s</output>
      <label>Layout <select data-compare-layout><option value="side">Side by side</option><option value="stacked">Stacked</option></select></label></div>
      <div class="${css.controls}"><label>Stroke <select data-compare-stroke>${this.data.standard.strokes.map((_,i)=>`<option value="${i}">${i+1}</option>`).join('')}</select></label>${button('Zoom in','zoom-in')}${button('Zoom out','zoom-out')}${button('Fit drawing','fit')}<span>Drag either drawing to pan both.</span></div>
      <div class="${css.legend}"><span>0 mm/s</span><span class="${css.scale}"></span><span>${peak.toFixed(1)} mm/s · shared speed scale</span></div>
      <div class="${css.panes}" data-compare-panes>${sides.map(side=>`<section class="${css.pane}" data-compare-side="${side}"><h3>${side==='standard'?'Standard':'Dynamic'}</h3><svg class="${css.map}" data-compare-map="${side}" role="img" tabindex="0" aria-label="${side} motion drawing; use arrow keys to pan and plus or minus to zoom"></svg>
      <dl class="${css.metrics}"><div><dt>Estimated total</dt><dd>${plans[side].duration.toFixed(2)} s</dd></div><div><dt>Estimated drawing</dt><dd>${this.data[side].penDownSeconds.toFixed(2)} s</dd></div><div><dt>Sampled peak</dt><dd>${this.data[side].peak.toFixed(1)} mm/s</dd></div><div><dt>Commands</dt><dd>${this.data[side].commands}</dd></div></dl>
      <svg class="${css.graph}" data-compare-graph="${side}" viewBox="0 0 500 140" preserveAspectRatio="none" role="img" aria-label="${side} speed versus drawing distance"></svg><p class="${css.readout}" data-compare-readout="${side}"></p></section>`).join('')}</div>
      <p>Graph: speed (mm/s) against distance along the selected stroke (mm). Select a distance to inspect each plan at that location.</p><label>Drawing distance <input type="range" min="0" step=".01" value="0" data-compare-distance aria-label="Drawing distance along selected stroke"></label><p data-compare-reasons></p>
      <footer class="${css.footer}">${button('Use Standard','standard')}${button('Use Dynamic','dynamic')}</footer>`;
    host.append(this.element);
    this.element.addEventListener('click',this.click);
    this.element.addEventListener('input',this.input);
    this.element.addEventListener('change',this.input);
    this.element.addEventListener('cancel',event=>{event.preventDefault();this.onClose();});
    this.element.addEventListener('keydown',this.keydown);
    for(const side of sides){
      const map=this.element.querySelector<SVGSVGElement>(`[data-compare-map="${side}"]`)!;
      const totalPoints=this.data[side].strokes.reduce((total,stroke)=>total+stroke.points.length,0);
      map.innerHTML=this.data[side].strokes.map((stroke,index)=>{
        const points=comparisonDisplayPoints(stroke.points,Math.max(2,Math.floor(4000*stroke.points.length/Math.max(1,totalPoints))));
        // One path per speed band keeps dense jobs from creating a DOM node per sample.
        const bands=new Map<number,string[]>();
        for(let i=1;i<points.length;i++){const point=points[i]!,previous=points[i-1]!,band=Math.round(point.speed/peak*31);const paths=bands.get(band)??[];paths.push(`M${previous.x} ${previous.y}L${point.x} ${point.y}`);bands.set(band,paths);}
        return `<g opacity="${index===this.stroke?1:.3}">${[...bands].map(([band,paths])=>`<path d="${paths.join('')}" stroke="${speedColor(band/31*peak,peak)}" stroke-width="1.5" vector-effect="non-scaling-stroke" fill="none"/>`).join('')}</g>`;
      }).join('')+'<circle data-compare-marker r="1.2" fill="white" stroke="#111" stroke-width="2" vector-effect="non-scaling-stroke"/>';
      let drag:{x:number;y:number}|null=null;
      map.addEventListener('pointerdown',event=>{drag={x:event.clientX,y:event.clientY};map.setPointerCapture?.(event.pointerId);});
      map.addEventListener('pointermove',event=>{if(!drag)return;const bounds=map.getBoundingClientRect(),scale=Math.max(this.viewBox[2]!/Math.max(1,bounds.width),this.viewBox[3]!/Math.max(1,bounds.height));this.viewBox[0]! -= (event.clientX-drag.x)*scale;this.viewBox[1]! -= (event.clientY-drag.y)*scale;drag={x:event.clientX,y:event.clientY};this.updateViewBox();});
      map.addEventListener('pointerup',()=>{drag=null;});map.addEventListener('pointercancel',()=>{drag=null;});
      map.addEventListener('wheel',event=>{event.preventDefault();this.zoom(event.deltaY>0?1.15:1/1.15);},{passive:false});
    }
    this.updateViewBox();this.graphs();this.update();
    if(typeof this.element.showModal==='function')this.element.showModal();else this.element.setAttribute('open','');
    this.element.querySelector<HTMLButtonElement>('[data-compare-action="close"]')!.focus();
  }
  private updateViewBox(){this.element.querySelectorAll('[data-compare-map]').forEach(map=>map.setAttribute('viewBox',this.viewBox.join(' ')));}
  private zoom(factor:number){this.viewBox[0]! += this.viewBox[2]!*(1-factor)/2;this.viewBox[1]! += this.viewBox[3]!*(1-factor)/2;this.viewBox[2]! *= factor;this.viewBox[3]! *= factor;this.updateViewBox();}
  private graphs(){
    const peak=Math.max(this.data.standard.peak,this.data.dynamic.peak,1),length=Math.max(...sides.map(side=>this.data[side].strokes[this.stroke]?.length??0),.01);
    this.element.querySelector<HTMLInputElement>('[data-compare-distance]')!.max=String(length);
    const reasons=new Set<string>();
    for(const side of sides){const points=this.data[side].strokes[this.stroke]?.points??[];points.forEach(point=>{if(point.reason)reasons.add(point.reason);});
      this.element.querySelector(`[data-compare-graph="${side}"]`)!.innerHTML=`<path d="M35 10V115H490" fill="none" stroke="currentColor" opacity=".3"/><text x="3" y="15" font-size="10">${peak.toFixed(0)}</text><text x="30" y="133" font-size="10">0</text><text x="450" y="133" font-size="10">${length.toFixed(1)} mm</text><path d="${comparisonDisplayPoints(points).map((point,i)=>`${i?'L':'M'}${35+point.distance/length*455} ${115-point.speed/peak*100}`).join('')}" fill="none" stroke="${side==='standard'?'#4b66cf':'#b94e36'}" stroke-width="1.5"/><line data-distance-marker x1="35" x2="35" y1="10" y2="115" stroke="currentColor" stroke-dasharray="3 3"/>`;
      this.element.querySelector(`[data-compare-map="${side}"]`)!.querySelectorAll('g').forEach((group,i)=>group.setAttribute('opacity',i===this.stroke?'1':'.3'));
    }
    this.element.querySelector('[data-compare-reasons]')!.textContent=reasons.size?`Planner limits on this stroke: ${[...reasons].map(reason=>({curve:'tight curve',junction:'junction limit',stop:'braking for stop',acceleration:'acceleration limit'}[reason]??reason)).join(', ')}.`:'Planner limit reasons are unavailable for this stroke; the graph shows compiled speed.';
  }
  private click=(event:MouseEvent)=>{
    const target=event.target as Element,action=target.closest<HTMLElement>('[data-compare-action]')?.dataset.compareAction;
    if(action==='close'){this.onClose();return;}if(action==='standard'||action==='dynamic'){this.onChoose(action);return;}
    if(action==='play'){this.playing=!this.playing;this.lastFrame=null;if(this.playing){if(this.time>=this.duration)this.time=0;this.frame=requestAnimationFrame(this.tick);}else cancelAnimationFrame(this.frame);this.update();}
    if(action==='restart'){this.pause();this.time=0;this.offsets={standard:0,dynamic:0};this.selectedDistance=null;this.update();}
    if(action==='zoom-in')this.zoom(1/1.25);if(action==='zoom-out')this.zoom(1.25);if(action==='fit'){this.viewBox=[...this.initialViewBox];this.updateViewBox();}
    const graph=target.closest<SVGSVGElement>('[data-compare-graph]');if(graph){const rect=graph.getBoundingClientRect(),length=Number(this.element.querySelector<HTMLInputElement>('[data-compare-distance]')!.max);this.seekDistance(Math.max(0,Math.min(1,((event.clientX-rect.left)/rect.width*500-35)/455))*length);}
  };
  private input=(event:Event)=>{const input=event.target as HTMLInputElement;
    if(input.matches('[data-compare-timeline]')){this.pause();this.time=Number(input.value);this.selectedDistance=null;this.update();}
    if(input.matches('[data-compare-distance]'))this.seekDistance(Number(input.value));
    if(input.matches('[data-compare-layout]'))this.element.querySelector('[data-compare-panes]')!.toggleAttribute('data-stacked',input.value==='stacked');
    if(input.matches('[data-compare-stroke]')){this.stroke=Number(input.value);this.graphs();this.seekDistance(0);}
  };
  private keydown=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();this.onClose();return;}if(!(event.target as Element).matches('[data-compare-map]'))return;
    const step=this.viewBox[2]!*.1;
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','='].includes(event.key)){event.preventDefault();if(event.key==='+'||event.key==='=')this.zoom(1/1.25);else if(event.key==='-')this.zoom(1.25);else{this.viewBox[event.key==='ArrowLeft'||event.key==='ArrowRight'?0:1]! += (event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:1)*step;this.updateViewBox();}}
  };
  private seekDistance(distance:number){this.pause();this.selectedDistance=distance;this.time=0;for(const side of sides)this.offsets[side]=timeAtDistance(this.data[side].strokes[this.stroke],distance);this.update();}
  private pause(){this.playing=false;this.lastFrame=null;cancelAnimationFrame(this.frame);}
  private tick=(timestamp:number)=>{if(this.destroyed||!this.playing)return;if(this.lastFrame!==null)this.time=Math.min(this.duration,this.time+(timestamp-this.lastFrame)/1000);this.lastFrame=timestamp;if(this.time>=this.duration)this.playing=false;this.update();if(this.playing)this.frame=requestAnimationFrame(this.tick);};
  private update(){
    const timeline=this.element.querySelector<HTMLInputElement>('[data-compare-timeline]')!;timeline.max=String(this.duration);timeline.value=String(this.time);
    this.element.querySelector('[data-compare-clock]')!.textContent=`${this.time.toFixed(2)} s${this.offsets.standard||this.offsets.dynamic?' from selected distance':''}`;
    this.element.querySelector('[data-compare-action="play"]')!.textContent=this.playing?'Pause':'Play';
    const length=Number(this.element.querySelector<HTMLInputElement>('[data-compare-distance]')!.max);
    if(this.selectedDistance!==null)this.element.querySelector<HTMLInputElement>('[data-compare-distance]')!.value=String(this.selectedDistance);
    for(const side of sides){const time=Math.min(this.plans[side].duration,this.time+this.offsets[side]),sample=samplePlan(this.plans[side],time);
      const marker=this.element.querySelector(`[data-compare-map="${side}"] [data-compare-marker]`)!;marker.setAttribute('cx',String(sample.position.x));marker.setAttribute('cy',String(sample.position.y));
      this.element.querySelector(`[data-compare-readout="${side}"]`)!.textContent=`${time.toFixed(2)} s · ${sample.speed.toFixed(1)} mm/s${time>=this.plans[side].duration?' · Finished':''}`;
      const line=this.element.querySelector(`[data-compare-graph="${side}"] [data-distance-marker]`)!;line.setAttribute('visibility',this.selectedDistance===null?'hidden':'visible');const x=35+(this.selectedDistance??0)/length*455;line.setAttribute('x1',String(x));line.setAttribute('x2',String(x));
    }
  }
  destroy(){if(this.destroyed)return;this.destroyed=true;this.pause();this.element.remove();if(this.previousFocus?.isConnected)this.previousFocus.focus({preventScroll:true});}
}
