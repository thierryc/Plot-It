import { remapVariationRanges, selectedVariationValue, setVariationRange, variationValues } from '../../text-variation-ranges';
import { bindTextDecorations, type TextSelection } from './text-decorations';
import { sliderRow, axisLabel, dimensions, decorateFeedback, animateSurface, dismissSurface } from '../design-system';
import { fillSettingsMarkup, textFontSupportsFill } from './fill-controls';
import { defaultFillSettings } from '../../model';
import { fillSpacing, validateFill } from '../../fill';
import { featureToggleMarkup } from './text-controls';
import { bindResizeHandle, resizeHandleMarkup } from './resize-controls';
import { input as controlInput, field as controlField, select as controlSelect } from '../design-system';
import { icon } from '../../icons';
import { displayTextNumber, textNumericStep, stepTextNumber } from './text-numeric-input';
import type { ArtworkItem, FillSettings, Point, TextOptions } from '../../model';
import { textOptions, findFont, ensureFontLoaded, fontTextOptions, loadFontFile } from '../../typography';
import { setFeatureRange, remapFeatureRanges } from '@thierryc/openplotfont';
import { normalizeTextLineBreaks } from '../../text-wrap';
import { FontPicker, fontPickerMarkup } from './font-picker';
import { fontChoices } from '../../font-choices';
import { customFontPreviews } from '../../font-preview-cache';
import { escapeUI as esc } from '../design-system';
import styles from './canvas.module.css';
import textareaStyles from '../design-system/textarea.module.css';
import buttonStyles from '../design-system/button.module.css';
import selectStyles from '../design-system/select.module.css';
export interface TextEditorDraft { content: string; options: TextOptions; capHeight: number; fillSettings?: FillSettings }
interface TextEditorOptions {
  host: HTMLElement; item: ArtworkItem; mode?: 'add'|'edit';
  project(point: Point): Point;
  preview(content: string): void;
  previewDraft?(draft: TextEditorDraft): void;
  finish(cancelled: boolean): void;
}
let remembered:{width:number;height:number;textHeight:number} = {width:dimensions.editorWidth,height:dimensions.editorHeight,textHeight:dimensions.textArea};
export function openCanvasTextEditor({host,item,mode='edit',project,preview,previewDraft,finish}:TextEditorOptions):{finish(cancelled?:boolean):boolean} {
  const root=document.createElement('div');root.className=styles['canvas-text-editor']!;root.dataset.canvasTextEditor='';root.setAttribute('role','dialog');root.setAttribute('aria-label',mode==='add'?'Add canvas text':'Edit canvas text');root.setAttribute('aria-modal','false');
  try{const saved=JSON.parse(sessionStorage.getItem('plot-it-text-overlay')??'null');if(saved&&[saved.width,saved.height,saved.textHeight].every((v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>0))remembered=saved;}catch{/* Storage can be unavailable. */}
  root.style.width=`${remembered.width}px`;root.style.height=`${remembered.height}px`;
  root.innerHTML=`<header data-text-drag tabindex="0" role="group" aria-label="Move text editor with arrow keys">${icon('grip')}<strong>${mode==='add'?'Add text':'Edit text'}</strong><button class="${buttonStyles.button} ${buttonStyles['icon-button']}" type="button" data-text-close aria-label="Close text editor">${icon('close')}</button></header><label data-text-input>Text<textarea class="${textareaStyles.textarea}" aria-label="Canvas text" rows="8" spellcheck="false" aria-describedby="canvas-text-error"></textarea></label><div data-text-split role="separator" tabindex="0" aria-label="Text area height" aria-orientation="horizontal" aria-valuemin="120" aria-valuemax="400" aria-valuenow="180"></div><div data-text-scope><span>Apply settings to</span><button class="${buttonStyles.button} ${styles['text-option-button']}" type="button" data-scope="block">Block</button><button class="${buttonStyles.button} ${styles['text-option-button']}" type="button" data-scope="selection">Selection</button></div><nav role="tablist" aria-label="Text settings"></nav><section data-text-settings></section><p id="canvas-text-error" role="alert" hidden></p><footer><span data-text-status>${icon('circle')} Live preview</span><button type="button" class="${buttonStyles.button}" data-text-cancel>Cancel</button><button type="button" class="${buttonStyles.button} ${buttonStyles.primary}" data-text-done>${mode==='add'?'Add to canvas':'Done'}</button></footer>${resizeHandleMarkup('Resize text editor','corner','data-text-resize')}`;
  const input=root.querySelector('textarea')!,error=root.querySelector<HTMLElement>('[role=alert]')!,settings=root.querySelector<HTMLElement>('[data-text-settings]')!, tabs=root.querySelector<HTMLElement>('nav')!;
  decorateFeedback(error,'error');
  const draft:TextEditorDraft={content:normalizeTextLineBreaks(item.text!.content),options:structuredClone(textOptions(item)),capHeight:item.height/item.viewBox[3]*1.4,...(item.fillSettings?{fillSettings:structuredClone(item.fillSettings)}:{})};
  input.value=draft.content;
  const controller=new AbortController(),options={signal:controller.signal};
  let closed=false,busy=false,revision=0,tab='basics',scope='block',picker:FontPicker|undefined,lastApplied=JSON.stringify(draft),composing=false;
  let selectionRange:TextSelection={start:input.value.length,end:input.value.length,direction:'none'};
  const label=input.parentElement!;
  const labelRow=document.createElement('span');labelRow.dataset.textLabel='';labelRow.textContent='Text';
  const legend=document.createElement('small');legend.textContent='Underline: local settings';legend.hidden=true;labelRow.append(legend);
  label.firstChild!.replaceWith(labelRow);
  const decorationHelp=document.createElement('span');decorationHelp.id='canvas-text-decoration-help';decorationHelp.hidden=true;decorationHelp.textContent='Underlined text has local feature or variable-axis settings.';label.append(decorationHelp);
  const decorations=bindTextDecorations(input,legend,decorationHelp);
  const updateDecorations=()=>decorations.update({selection:selectionRange,scope:(tab==='details'||tab==='variable')&&scope==='selection'?'selection':'block',overrides:[...draft.options.featureRanges??[],...draft.options.variationRanges??[]],composing});
  const showError=(failure:unknown)=>{error.textContent=failure instanceof Error?failure.message:String(failure);error.hidden=false;input.setAttribute('aria-invalid','true');queueMicrotask(()=>{if(!closed)setTextHeight(remembered.textHeight);});};
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  const cancelScheduledPreview=()=>{if(previewTimer!==undefined){clearTimeout(previewTimer);previewTimer=undefined;}};
  const schedulePreview=()=>{
    cancelScheduledPreview();
    previewTimer=setTimeout(()=>{previewTimer=undefined;if(!closed)apply();},150);
  };
  const apply=(force=false)=>{
    cancelScheduledPreview();
    updateDecorations();
    if(busy){showError('Wait for the font to finish loading.');return false;}
    try{if(draft.fillSettings)validateFill(draft.fillSettings);const value=JSON.stringify(draft);if(value!==lastApplied||(force&&!draft.content.trim())){if(previewDraft)previewDraft(structuredClone(draft));else preview(draft.content);position();lastApplied=value;}error.hidden=true;input.removeAttribute('aria-invalid');return true;}catch(failure){showError(failure);return false;}
  };
  const updateScope=()=>{
    const count=[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(input.value.slice(selectionRange.start,selectionRange.end))].length;
    const supportsSelection=tab==='details'||tab==='variable',visibleScope=supportsSelection?scope:'block';
    for(const b of root.querySelectorAll<HTMLButtonElement>('[data-scope]')){b.disabled=b.dataset.scope==='selection'&&(!count||!supportsSelection);b.title=!supportsSelection?'Selected-letter settings are available in Details and Variable.':'';b.setAttribute('aria-pressed',String(b.dataset.scope===visibleScope));if(b.dataset.scope==='selection')b.textContent=`Selection${count?` · ${count}`:''}`;}
    updateDecorations();
  };
  const effective=(tag:string,at:number)=>{
    const base=tag==='kern'?+draft.options.kerning:tag==='liga'||tag==='clig'?+draft.options.ligatures:tag==='calt'?+draft.options.contextual:findFont(draft.options.fontId)?.openplotfont?.layout?.features.find(f=>f.tag===tag)?.recommendedValue??0;
    let value=base;
    for(const token of draft.options.features.split(',')){const match=token.trim().match(/^([ -~]{4})(?:=(\d+))?$/);if(match?.[1]===tag)value=Number(match[2]??1);}
    for(const r of draft.options.featureRanges??[])if(r.tag===tag&&r.start<=at&&r.end>at)value=r.value;
    return value;
  };
  const featureValue=(tag:string)=>{
    if(scope==='block')return effective(tag,-1);
    const {start,end}=selectionRange;
    const positions=new Set([start,...(draft.options.featureRanges??[]).filter(r=>r.tag===tag&&r.start<end&&r.end>start).flatMap(r=>[Math.max(start,r.start),...(r.end<end?[r.end]:[])])]);
    const values=[...positions].map(p=>effective(tag,p));return values.every(v=>v===values[0])?values[0]!:undefined;
  };
  const field=(label:string,key:string,value:string|number,type='number')=>{
    const step=textNumericStep(key);
    return controlField(label,controlInput(typeof value==='number'?displayTextNumber(key==='capHeight'?Number(value.toFixed(3)):value):value,{'data-option':key,...(key==='capHeight'?{title:displayTextNumber(Number(value))}:{}),...(type==='number'?{step,'data-base-step':step,...(key==='capHeight'?{min:.1}:key==='lineHeight'?{min:.01}:{})}:{})},type as 'number'|'text'));
  };
  const feature=(tag:string,label:string,numeric=false)=>{
    const value=featureValue(tag);
    return numeric ? `<div data-feature-row><span>${esc(label)}</span>${controlInput(value===undefined?'':displayTextNumber(value),{'aria-label':label,'data-feature':tag,min:0,max:4294967295,step:1,'data-base-step':1,placeholder:'Mixed'},'number')}${value===undefined?'<small>Mixed</small>':''}</div>` : featureToggleMarkup(label,value,{'data-feature':tag,'data-value':0},{'data-feature':tag,'data-value':1},{'data-feature-row':''});
  };
  const renderSettings=()=>{
    const active=document.activeElement instanceof HTMLElement && root.contains(document.activeElement)?document.activeElement:undefined;
    const focusKeys=['data-feature','data-value','data-option','data-axis','data-tab','data-reset','data-font-picker-trigger','data-font-file','data-text-fill-setting'];
    const focusAttributes=active?focusKeys.filter(key=>active.hasAttribute(key)).map(key=>[key,active.getAttribute(key)!] as const):[];
    const scroll=settings.scrollTop;
    picker?.destroy();picker=undefined;
    const font=findFont(draft.options.fontId),axes=Object.entries(font?.axes??{}),tags=font?.features??[];
    const supportsFill=textFontSupportsFill(font,draft.options.fontId===textOptions(item).fontId?item:undefined);
    if(tab==='variable'&&!axes.length||tab==='fill'&&!supportsFill)tab='basics';
    tabs.innerHTML=['basics','details',...(axes.length?['variable']:[]),...(supportsFill?['fill']:[])].map(t=>`${t==='fill'?'<span data-text-tab-divider aria-hidden="true"></span>':''}<button class="${buttonStyles.button} ${styles['text-option-button']}" type="button" role="tab" id="text-tab-${t}" aria-controls="text-settings-panel" aria-selected="${tab===t}" tabindex="${tab===t?0:-1}" data-tab="${t}">${t[0]!.toUpperCase()+t.slice(1)}</button>`).join('');
    settings.id='text-settings-panel';settings.setAttribute('role','tabpanel');settings.setAttribute('aria-labelledby',`text-tab-${tab}`);
    if(tab==='basics'){
      settings.innerHTML=`<p>Block settings</p>${fontPickerMarkup(draft.options.fontId,font?.name??'Plot Sans')}<div data-text-grid>${field('Cap height · mm','capHeight',draft.capHeight)}${field('Line height · ×','lineHeight',draft.options.lineHeight)}${field('Letter spacing · em','letterSpacing',draft.options.letterSpacing)}${field('Word spacing · em','wordSpacing',draft.options.wordSpacing)}</div>${controlField('Alignment',controlSelect(['left','center','right'].map(value=>({value,label:value})),draft.options.align,{'data-option':'align'}))}`;
      picker=new FontPicker(settings.querySelector<HTMLElement>('[data-font-picker]')!,fontChoices,id=>customFontPreviews.get(id));
    }else if(tab==='fill'){
      const fill=draft.fillSettings??defaultFillSettings;let spacing='';try{if(fill.mode!=='none')spacing=`Stroke spacing: ${displayTextNumber(Number(fillSpacing(fill).toFixed(3)))} mm.`;}catch{/* The inline draft error describes invalid values. */}
      settings.innerHTML=`<p>Fill settings · whole block</p>${fillSettingsMarkup(fill,'data-text-fill-setting')}<p>${spacing} Filled regions use these settings; centerline strokes keep their original paths.</p><p data-fill-status role="status"></p>`;
    }else if(tab==='variable'){
      const base=variationValues(draft.options.variations),ranges=draft.options.variationRanges??[];
      settings.innerHTML=`<p>Variable axes · ${scope==='selection'?'selected letters':'whole block'}</p>`+axes.map(([tag,a])=>{
        const block=base[tag]??a.default,value=scope==='selection'?selectedVariationValue(block,ranges,tag,selectionRange.start,selectionRange.end):block,mixed=value===undefined,step=textNumericStep(tag,a.min,a.max);
        return sliderRow({label:axisLabel(tag),value:mixed?undefined:Number(displayTextNumber(value)),fallback:block,min:a.min,max:a.max,step,rangeAttributes:{'data-axis':tag,'aria-label':tag,title:`${axisLabel(tag)} (${tag})`},valueAttributes:{'data-axis':tag,'aria-label':`${tag} value`},mixedAttributes:{'data-axis-mixed':tag}});
      }).join('')+`<button class="${buttonStyles.button}" type="button" data-reset ${selectionRange.start===selectionRange.end?'disabled':''}>Reset selection overrides</button><p>Reset restores the selected letters to the block’s variable axes.</p>`;
    }else{
      const kern=!!font?.openplotfont?.kerning?.length||tags.includes('kern'),others=tags.filter(t=>!['kern','liga','clig','calt'].includes(t)&&!/^ss\d\d$/.test(t));
      settings.innerHTML=`<p>${esc(font?.name??'Plot Sans')}${font?.openplotfont?.layout?' · Layout enabled':''}</p>${tags.some(t=>['liga','clig','calt'].includes(t))?'<h4>Letterforms</h4>':''}${tags.some(t=>t==='liga'||t==='clig')?feature(tags.includes('liga')?'liga':'clig','Standard ligatures'):''}${tags.includes('calt')?feature('calt','Contextual alternates'):''}${kern?'<h4>Spacing</h4>'+feature('kern','Kerning pairs'):''}${tags.some(t=>/^ss\d\d$/.test(t))?'<h4>Stylistic sets</h4>':''}${tags.filter(t=>/^ss\d\d$/.test(t)).map(t=>feature(t,font?.openplotfont?.layout?.features.find(f=>f.tag===t)?.label??`Stylistic set ${Number(t.slice(2))}`)).join('')}<details><summary>More features & language</summary>${others.map(t=>feature(t,t,true)).join('')}<p>Language settings apply to the whole block.</p>${field('Language','language',draft.options.language,'text')}${field('Script','script',draft.options.script,'text')}<label>Direction<select class="${selectStyles.select}" data-option="direction">${['auto','ltr','rtl'].map(v=>`<option ${v===draft.options.direction?'selected':''}>${v}</option>`).join('')}</select></label>${field('Expert feature expressions','features',draft.options.features,'text')}</details><p>Only supported features are shown.</p><button class="${buttonStyles.button}" type="button" data-reset ${selectionRange.start===selectionRange.end?'disabled':''}>Reset selection overrides</button>`;
    }
    updateScope();
    settings.scrollTop=scroll;
    if(active && !active.isConnected && focusAttributes.length){
      const candidate=[...root.querySelectorAll<HTMLElement>('button,input,select')].find(node=>focusAttributes.every(([key,value])=>node.getAttribute(key)===value));
      candidate?.focus({preventScroll:true});
    }
  };
  const changeFeature=(tag:string,value:number,render=true)=>{
    const font=findFont(draft.options.fontId);const tags=(tag==='liga'||tag==='clig'?['liga','clig']:[tag]).filter(t=>t==='kern'||font?.features.includes(t));
    for(const t of tags){
      if(scope==='selection')draft.options.featureRanges=setFeatureRange(draft.options.featureRanges??[],selectionRange.start,selectionRange.end,t,value);
      else{draft.options.featureRanges=(draft.options.featureRanges??[]).filter(r=>r.tag!==t);draft.options.features=draft.options.features.split(',').filter(s=>s.trim().slice(0,4)!==t).join(',');if(t==='kern')draft.options.kerning=!!value;else if(t==='liga'||t==='clig')draft.options.ligatures=!!value;else if(t==='calt')draft.options.contextual=!!value;else draft.options.features=[draft.options.features,`${t}=${value}`].filter(Boolean).join(',');}
    }if(render){apply();renderSettings();}else{updateDecorations();schedulePreview();}
  };
  const close=(cancelled=false)=>{
    if(closed)return true;if(!cancelled&&!apply(true)){input.focus({preventScroll:true});return false;}
    remembered.width=parseFloat(root.style.width)||remembered.width;remembered.height=parseFloat(root.style.height)||remembered.height;
    try{sessionStorage.setItem('plot-it-text-overlay',JSON.stringify(remembered));}catch{/* Storage can be unavailable. */}
    cancelScheduledPreview();closed=true;revision++;controller.abort();picker?.destroy();observer.disconnect();panelResize.destroy();decorations.destroy();
    root.inert=true;root.setAttribute('aria-hidden','true');dismissSurface(root);finish(cancelled);return true;
  };
  let manuallyPlaced = false;
  const clamp = (value: number, max: number) => Math.max(8, Math.min(Math.max(8, max), value));
  const place = (x: number, y: number) => {
    root.style.left = `${clamp(x, host.clientWidth - root.offsetWidth - 8)}px`;
    root.style.top = `${clamp(y, host.clientHeight - root.offsetHeight - 8)}px`;
  };
  const position = () => {
    root.style.maxWidth = `${Math.max(1, host.clientWidth - 16)}px`;
    root.style.maxHeight = `${Math.max(1, host.clientHeight - 16)}px`;
    if (manuallyPlaced) { place(parseFloat(root.style.left), parseFloat(root.style.top)); return; }
    const radians = item.rotation * Math.PI / 180;
    const corners = [0, 1].flatMap(dx => [0, 1].map(dy => {
      const x = (dx - .5) * item.width, y = (dy - .5) * item.height;
      return project({x:item.x + item.width / 2 + Math.cos(radians)*x - Math.sin(radians)*y,
        y:item.y + item.height / 2 + Math.sin(radians)*x + Math.cos(radians)*y});
    }));
    const left = Math.min(...corners.map(p => p.x)), right = Math.max(...corners.map(p => p.x));
    const top = Math.min(...corners.map(p => p.y)), bottom = Math.max(...corners.map(p => p.y));
    const width = root.offsetWidth, height = root.offsetHeight;
    const candidates = [[right + 16, top], [left - width - 16, top], [left, bottom + 16], [left, top - height - 16]]
      .map(([x, y]) => ({x:clamp(x!,host.clientWidth-width-8), y:clamp(y!,host.clientHeight-height-8)}));
    const overlap = (p: Point) => Math.max(0, Math.min(p.x+width,right)-Math.max(p.x,left)) *
      Math.max(0, Math.min(p.y+height,bottom)-Math.max(p.y,top));
    candidates.sort((a,b) => overlap(a)-overlap(b));
    place(candidates[0]!.x, candidates[0]!.y);
  };
  const handle = root.querySelector<HTMLElement>('[data-text-drag]')!;
  let drag: {id: number; x: number; y: number; left: number; top: number} | undefined;
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    event.preventDefault(); event.stopPropagation();
    manuallyPlaced = true;
    drag = {id:event.pointerId,x:event.clientX,y:event.clientY,left:parseFloat(root.style.left),top:parseFloat(root.style.top)};
    handle.setPointerCapture(event.pointerId);
  }, options);
  handle.addEventListener('pointermove', event => {
    if (drag?.id === event.pointerId) place(drag.left+event.clientX-drag.x, drag.top+event.clientY-drag.y);
  }, options);
  const endDrag = () => { drag = undefined; };
  handle.addEventListener('pointerup', endDrag, options);
  handle.addEventListener('pointercancel', endDrag, options);
  handle.addEventListener('lostpointercapture', endDrag, options);
  handle.addEventListener('keydown', event => {
    if(event.target!==handle)return;
    const delta = {ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
    if (!delta) return;
    event.preventDefault(); event.stopPropagation(); manuallyPlaced = true;
    const step = event.shiftKey ? 1 : 10;
    place(parseFloat(root.style.left)+delta[0]!*step, parseFloat(root.style.top)+delta[1]!*step);
  }, options);
  const textHeightLimits=()=>{
    const available=Math.max(0,Math.min(host.clientHeight,root.offsetHeight||host.clientHeight));
    const measured=root.offsetHeight>0;
    const fixed=measured ? (()=>{
      const style=getComputedStyle(root),children=[...root.children].filter((node):node is HTMLElement=>node instanceof HTMLElement&&!node.hidden&&!node.hasAttribute('data-text-resize'));
      return (parseFloat(style.paddingTop)||0)+(parseFloat(style.paddingBottom)||0)+2 + (parseFloat(style.rowGap)||0)*Math.max(0,children.length-1) + children.filter(node=>!node.hasAttribute('data-text-settings')).reduce((sum,node)=>sum+node.offsetHeight-(node.hasAttribute('data-text-input')?input.offsetHeight:0),0) + 40;
    })() : 280;
    const max=Math.max(40,available-fixed), min=Math.min(120,max);
    return {min,max};
  };
  const setTextHeight=(height:number,userChange=false)=>{
    const {min,max}=textHeightLimits(),actual=Math.min(max,Math.max(min,height));if(userChange)remembered.textHeight=actual;root.style.setProperty('--text-editor-height',`${actual}px`);
    const split=root.querySelector<HTMLElement>('[data-text-split]')!;split.setAttribute('aria-valuemin',String(min));split.setAttribute('aria-valuemax',String(max));split.setAttribute('aria-valuenow',String(actual));
  };
  const panelResize=bindResizeHandle(root.querySelector<HTMLElement>('[data-text-resize]')!,{
    axis:'corner',get:()=>({width:root.offsetWidth||remembered.width,height:root.offsetHeight||remembered.height}),
    limits:()=>({min:{width:Math.min(360,Math.max(1,host.clientWidth-16)),height:Math.min(480,Math.max(1,host.clientHeight-16))},max:{width:Math.max(1,host.clientWidth-16),height:Math.max(1,host.clientHeight-16)}}),
    start:()=>{manuallyPlaced=true;},set:size=>{root.style.width=`${size.width}px`;root.style.height=`${size.height}px`;position();setTextHeight(remembered.textHeight);}
  });
  const observer=new ResizeObserver(()=>{position();setTextHeight(remembered.textHeight);panelResize.sync();});
  host.append(root);setTextHeight(remembered.textHeight);position();observer.observe(host);observer.observe(root);renderSettings();animateSurface(root,true);
  host.addEventListener('viewportchange',position,options);
  const captureSelection=(leaving=false)=>{
    if(composing||!leaving&&document.activeElement!==input)return;
    const boundaries=[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(input.value)].map(p=>p.index).concat(input.value.length);
    const a=input.selectionStart,b=input.selectionEnd,start=boundaries.filter(p=>p<=a).at(-1)??0,end=a===b?start:boundaries.find(p=>p>=b)??b;
    const changed=start!==selectionRange.start||end!==selectionRange.end;
    selectionRange={start,end,direction:input.selectionDirection};
    if(changed){scope=start<end?'selection':'block';if(!leaving&&(tab==='details'||tab==='variable'))renderSettings();else updateScope();}
    else updateDecorations();
  };
  const selection=()=>captureSelection();
  document.addEventListener('selectionchange',selection,options);input.addEventListener('select',selection,options);input.addEventListener('keyup',selection,options);input.addEventListener('pointerup',selection,options);
  root.addEventListener('pointerdown',event=>{if(event.target!==input&&document.activeElement===input)captureSelection(true);},{...options,capture:true});
  input.addEventListener('blur',()=>captureSelection(true),options);
  let pointerEntering=false;
  input.addEventListener('pointerdown',()=>{pointerEntering=true;},options);
  document.addEventListener('pointerup',()=>{pointerEntering=false;},options);document.addEventListener('pointercancel',()=>{pointerEntering=false;},options);
  root.addEventListener('keydown',event=>{if(event.key==='Tab')pointerEntering=false;},options);
  input.addEventListener('focus',()=>{
    if(!pointerEntering&&selectionRange.start<selectionRange.end)input.setSelectionRange(selectionRange.start,selectionRange.end,selectionRange.direction);
    updateDecorations();
  },options);
  const updateContent=()=>{const content=normalizeTextLineBreaks(input.value);draft.options.featureRanges=remapFeatureRanges(draft.options.featureRanges??[],draft.content,content);draft.options.variationRanges=remapVariationRanges(draft.options.variationRanges??[],draft.content,content);draft.content=content;apply();selection();};
  input.addEventListener('compositionstart',()=>{composing=true;updateDecorations();},options);
  input.addEventListener('input',event=>{if((event as InputEvent).isComposing){composing=true;updateDecorations();}else if(!composing)updateContent();},options);
  input.addEventListener('compositionend',()=>{composing=false;updateContent();},options);
  root.addEventListener('click',event=>{const target=(event.target as Element).closest<HTMLButtonElement>('button');if(!target)return;
    if(target.hasAttribute('data-text-cancel')||target.hasAttribute('data-text-close'))close(true);
    else if(target.hasAttribute('data-text-done'))close();
    else if(target.dataset.tab){tab=target.dataset.tab;renderSettings();tabs.querySelector<HTMLElement>(`[data-tab="${tab}"]`)?.focus();}
    else if(target.dataset.scope){scope=target.dataset.scope;renderSettings();}
    else if(target.dataset.feature)changeFeature(target.dataset.feature,Number(target.dataset.value));
    else if(target.hasAttribute('data-reset')){if(tab==='variable')draft.options.variationRanges=setVariationRange(draft.options.variationRanges??[],selectionRange.start,selectionRange.end);else draft.options.featureRanges=setFeatureRange(draft.options.featureRanges??[],selectionRange.start,selectionRange.end);apply();renderSettings();}
  },options);
  const changeAxis=(target:HTMLInputElement)=>{
    const tag=target.dataset.axis!,value=target.value.trim()?Number(target.value):NaN;
    if(scope==='selection')draft.options.variationRanges=setVariationRange(draft.options.variationRanges??[],selectionRange.start,selectionRange.end,tag,value);
    else {
      draft.options.variations=[...draft.options.variations.split(',').filter(token=>token.trim()&&token.trim().slice(0,4)!==tag),`${tag}=${value}`].join(',');
      draft.options.variationRanges=draft.options.variationRanges?.filter(range=>range.tag!==tag);
    }
    updateDecorations();
    schedulePreview();settings.querySelector(`[data-axis-mixed="${tag}"]`)?.remove();
    for(const peer of settings.querySelectorAll<HTMLInputElement>(`input[data-axis="${tag}"]`)){
      if(peer!==target)peer.value=target.value;peer.removeAttribute('aria-valuetext');peer.removeAttribute('data-mixed-base');peer.removeAttribute('placeholder');
    }
  };
  root.addEventListener('input',event=>{
    const target=event.target;
    if(target instanceof HTMLInputElement&&target.type==='range'&&target.dataset.axis)changeAxis(target);
  },options);
  root.addEventListener('change',async event=>{
    const target=event.target as HTMLInputElement;const key=target.dataset.option??target.dataset.typography;
    if(target.hasAttribute('data-font-file')){const file=target.files?.[0];if(!file)return;const request=++revision;busy=true;try{const font=await loadFontFile(file);if(closed||request!==revision)return;draft.options={...fontTextOptions(font,draft.options),featureRanges:[]};busy=false;apply();renderSettings();}catch(failure){if(!closed&&request===revision)showError(failure);}finally{if(request===revision)busy=false;}return;}
    if(key==='fontId'){const request=++revision;busy=true;root.querySelector<HTMLButtonElement>('[data-text-done]')!.disabled=true;try{const font=target.value==='plot-sans'?undefined:await ensureFontLoaded(target.value);if(closed||request!==revision)return;if(!font&&target.value!=='plot-sans')throw new Error('Font unavailable.');draft.options=font?{...fontTextOptions(font,draft.options),featureRanges:[]}:{...draft.options,fontId:'plot-sans',features:'',variations:'',featureRanges:[],variationRanges:[]};busy=false;apply();renderSettings();}catch(failure){if(!closed&&request===revision){showError(failure);renderSettings();}}finally{if(!closed&&request===revision){busy=false;root.querySelector<HTMLButtonElement>('[data-text-done]')!.disabled=false;}}return;}
    if(target.dataset.textFillSetting){
      const key=target.dataset.textFillSetting as keyof FillSettings;
      const value=target.type==='checkbox'?target.checked:key==='mode'?target.value:target.value.trim()?Number(target.value):NaN;
      const next={...(draft.fillSettings??defaultFillSettings),[key]:key==='overlap'?Number(value)/100:value} as FillSettings;
      if(key==='mode')next.connect=next.mode==='solid';draft.fillSettings=next;
      if(key==='mode'){apply();renderSettings();}else schedulePreview();return;
    }
    if(target.dataset.feature){const tag=target.dataset.feature;changeFeature(tag,Number(target.value),false);target.closest('[data-feature-row]')?.querySelector('small')?.remove();return;}
    if(target.dataset.axis){changeAxis(target);return;}
    if(key){if(key==='capHeight')draft.capHeight=Number(target.value);else Object.assign(draft.options,{[key]:['lineHeight','letterSpacing','wordSpacing'].includes(key)?Number(target.value):target.value});schedulePreview();}
  },options);
  tabs.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const buttons=[...tabs.querySelectorAll<HTMLButtonElement>('button')],at=buttons.findIndex(b=>b.dataset.tab===tab);buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(at+(event.key==='ArrowRight'?1:buttons.length-1))%buttons.length]!.click();},options);
  const split=root.querySelector<HTMLElement>('[data-text-split]')!;let splitting:{id:number;y:number;height:number}|undefined;
  split.addEventListener('pointerdown',event=>{event.preventDefault();splitting={id:event.pointerId,y:event.clientY,height:Number(split.getAttribute('aria-valuenow'))};split.setPointerCapture(event.pointerId);},options);
  split.addEventListener('pointermove',event=>{if(splitting?.id===event.pointerId)setTextHeight(splitting.height+event.clientY-splitting.y,true);},options);
  split.addEventListener('lostpointercapture',()=>{splitting=undefined;},options);
  split.addEventListener('keydown',event=>{if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();setTextHeight(Number(split.getAttribute('aria-valuenow'))+(event.key==='ArrowDown'?1:-1)*(event.shiftKey?1:10),true);}},options);
  // Native spinner clicks use the same Shift multiplier as keyboard arrows.
  const numericTarget=(event:Event)=>event.target instanceof HTMLInputElement && event.target.type==='number' ? event.target : undefined;
  root.addEventListener('pointerdown',event=>{const target=numericTarget(event);if(target)target.step=displayTextNumber(Number(target.dataset.baseStep??target.step)*(event.shiftKey?10:1));},options);
  root.addEventListener('keyup',event=>{const target=numericTarget(event);if(target)target.step=target.dataset.baseStep??target.step;},options);
  root.addEventListener('pointerup',event=>{const target=numericTarget(event);if(target)target.step=target.dataset.baseStep??target.step;},options);
  root.addEventListener('keydown',event=>{if(event.isComposing)return;
    const target=numericTarget(event);
    if(target && !event.ctrlKey && !event.metaKey && !event.altKey && (event.key==='ArrowUp'||event.key==='ArrowDown')){event.preventDefault();event.stopPropagation();stepTextNumber(target,event.key==='ArrowUp'?1:-1,event.shiftKey);return;}
if(event.key==='Escape'||event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();event.stopPropagation();close(event.key==='Escape');}},options);
  input.focus({preventScroll:true});input.setSelectionRange(input.value.length,input.value.length);
  return {finish:close};
}
