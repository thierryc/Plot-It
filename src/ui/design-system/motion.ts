import { motion } from './foundations';

const animations = new WeakMap<HTMLElement, Animation>();
export function stopSurfaceAnimation(element:HTMLElement):void {const previous=animations.get(element);animations.delete(element);previous?.cancel();}
/** A display-only surface animation: draft commit/cancel and focus handoff stay immediate. */
export function animateSurface(element:HTMLElement, opening:boolean, complete?:()=>void):void {
  const interrupted=!opening&&animations.has(element)?getComputedStyle(element):undefined;
  const from=interrupted?{opacity:interrupted.opacity,transform:interrupted.transform}:undefined;
  stopSurfaceAnimation(element);
  if(typeof element.animate!=='function'||typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches){complete?.();return;}
  const css=getComputedStyle(element),offset=css.getPropertyValue('--motion-dialog-offset').trim()||'6px';
  const scale=css.getPropertyValue('--motion-dialog-scale').trim()||'0.99';
  const duration=parseFloat(css.getPropertyValue(opening?'--motion-dialog-duration':'--motion-exit-duration'))||(opening?motion.dialogDuration:motion.exitDuration);
  const easing=css.getPropertyValue('--motion-settle-easing').trim()||'cubic-bezier(0.22, 1, 0.36, 1)';
  const resting={opacity:1,transform:'translateY(0) scale(1)'},away={opacity:0,transform:`translateY(${offset}) scale(${scale})`};
  const animation=element.animate(opening?[away,resting]:[from??resting,away],{duration,easing});
  animations.set(element,animation);
  const finish=()=>{if(animations.get(element)!==animation)return;animations.delete(element);complete?.();};
  void animation.finished.then(finish,finish);
}

/** Keep the outgoing editor visible even if committing replaces the app shell. */
export function dismissSurface(element:HTMLElement):void {
  if(typeof element.animate==='function'&&!(typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches)){
    const parent=element.offsetParent as HTMLElement|null,origin=parent?.getBoundingClientRect();
    const left=(origin?.left??0)+element.offsetLeft,top=(origin?.top??0)+element.offsetTop;
    const width=element.offsetWidth,height=element.offsetHeight;
    element.style.position='fixed';element.style.left=`${left}px`;element.style.top=`${top}px`;
    element.style.width=`${width}px`;element.style.height=`${height}px`;document.body.append(element);
  }
  animateSurface(element,false,()=>element.remove());
}

/** Keep brief jobs silent and bridge short gaps between related background stages. */
export class SustainedIndicator<T> {
  private current:T|undefined;
  private displayed:T|undefined;
  private shownAt=0;
  private showTimer:ReturnType<typeof setTimeout>|undefined;
  private hideTimer:ReturnType<typeof setTimeout>|undefined;
  constructor(private paint:(value:T|undefined,active:boolean)=>void){}
  get value():T|undefined{return this.displayed;}
  get active():boolean{return this.current!==undefined;}
  update(value?:T):void {
    this.current=value;
    if(value!==undefined){
      clearTimeout(this.hideTimer);this.hideTimer=undefined;
      if(this.displayed!==undefined){this.displayed=value;this.paint(value,true);}
      else if(this.showTimer===undefined)this.showTimer=setTimeout(()=>{
        this.showTimer=undefined;if(this.current===undefined)return;
        this.displayed=this.current;this.shownAt=Date.now();this.paint(this.displayed,true);
      },motion.progressShowDelay);
    }else{
      clearTimeout(this.showTimer);this.showTimer=undefined;
      if(this.displayed===undefined)return;
      this.paint(this.displayed,false);
      if(this.hideTimer===undefined)this.hideTimer=setTimeout(()=>{
        this.hideTimer=undefined;if(this.current!==undefined)return;
        this.displayed=undefined;this.paint(undefined,false);
      },Math.max(motion.progressHideDelay,motion.progressMinimum-(Date.now()-this.shownAt)));
    }
  }
  destroy():void {clearTimeout(this.showTimer);clearTimeout(this.hideTimer);this.showTimer=this.hideTimer=undefined;this.current=this.displayed=undefined;}
}
