import {machineProfileFields} from './machine-profile';
import {supportsHardwareProfile} from '../../machine-profiles';
import { version as appVersion } from '../../../package.json';
import dsInput from '../design-system/input.module.css';
import dsColor from '../design-system/color.module.css';
import appField from './field.module.css';
import appPlot from './plot.module.css';
import dsButton from '../design-system/button.module.css';
import dsDisclosure from '../design-system/disclosure.module.css';
import dsField from '../design-system/field.module.css';
import dsSelect from '../design-system/select.module.css';
import type { AppState, PenPreferences, PlotSettings } from '../../model';
import { DEFAULT_MACHINE_ROTATION } from '../../model';
import type { PlotPen } from '../../pens';
import type { MotionPlan } from '../../motion-plan';
import type { PlotDestination } from '../../plot-destination';
import type { NetworkPlotter } from '../../network-plotter';
import type { PlotSessionState } from '../../plot-workspace';
import { MACHINE_ORIENTATIONS } from '../../motion';
import { PLOTTER_POSITIONS } from '../../plotter-setup';
import { icon } from '../../icons';
import { escapeUI as escape, checkbox, checkboxInput, propertyField, numberField, disclosure, button, contextualHelp, type Attributes } from '../design-system';
const virtualMonitorButton=import.meta.env.MODE==='site'?'':button({label:'Open Virtual EBB monitor',attributes:{'data-plot-action':'virtual-monitor','aria-label':'Open Virtual EBB monitor in a new tab',title:'Open Virtual EBB monitor in a new tab'}});
const countLabel = (count:number,singular:string,plural=`${singular}s`) => `${count} ${count === 1 ? singular : plural}`;
/** Render snapshot only. Connection and hardware operations stay in PlotWorkspace. */
export interface PlotView {
  busy:boolean; locked:boolean; manualBusy:boolean; serverOwnsLocalUsb:boolean;
  destination:'machine'|'network'|'simulation'|null;
  connectionTarget:'machine'|'network'|null;
  network:Pick<NetworkPlotter,'networkConnected'|'hasControl'|'connected'|'active'>|null;
  plotter:Pick<PlotDestination,'supported'|'connected'|'connecting'|'firmwareLabel'|'canAdjustPen'|'originStatus'|'motorsOn'> & { hasOrigin:(profile:PlotSettings['profile'])=>boolean };
  localPlotter:{connected:boolean};
  settings:PlotSettings; preferences:PenPreferences; pens:PlotPen[]; plan:MotionPlan|null;
  job:boolean; inputError:string; error:string; session:PlotSessionState; documentState:AppState; deviceLabel:string; rate:number;
  penLabel:(color:string)=>string;
}
export function plotWorkspaceMarkup(view:PlotView):string {
  const locked=view.locked, disabled=locked?'disabled':'';
  function penMarkup(pen: PlotPen, index: number, disabled: string): string {
    const reorderDisabled = disabled || view.preferences.mode === 'source' ? 'disabled' : '';
    return `<div class="plot-pen-row ${appPlot["plot-pen-row"]} "><div class="plot-pen-main ${appPlot["plot-pen-main"]} "><label class="pen-include ${appPlot["pen-include"]} ">${checkboxInput(`Include pen ${view.penLabel(pen.color)}`,pen.included,{'data-pen-include':pen.color,disabled:!!disabled})}</label><input class="${dsColor["color"]}" type="color" value="${pen.color}" aria-label="Choose pen color for ${pen.color}" data-pen-picker="${pen.color}" ${disabled}><input class="${dsInput["input"]} pen-hex ${appPlot["pen-hex"]}" value="${pen.color}" aria-label="Pen hex color for ${pen.color}" data-pen-hex="${pen.color}" data-focus-key="hex-${pen.color}" maxlength="7" spellcheck="false" ${disabled}><div class="pen-order ${appPlot["pen-order"]} "><button class="button ghost ${dsButton["button"]} ${dsButton["ghost"]} " data-plot-action="up" data-pen="${pen.color}" aria-label="Move ${escape(view.penLabel(pen.color))} up" ${reorderDisabled || index === 0 ? 'disabled' : ''}>${icon('up')}</button><button class="button ghost ${dsButton["button"]} ${dsButton["ghost"]} " data-plot-action="down" data-pen="${pen.color}" aria-label="Move ${escape(view.penLabel(pen.color))} down" ${reorderDisabled || index === view.pens.length - 1 ? 'disabled' : ''}>${icon('down')}</button></div></div><div class="plot-pen-name ${appPlot["plot-pen-name"]} "><input class="${dsInput["input"]}" value="${escape(pen.name)}" placeholder="Pen name (optional)" aria-label="Pen name for ${pen.color}" data-pen-name="${pen.color}" data-focus-key="name-${pen.color}" maxlength="80" ${disabled}><button class="button ghost ${dsButton["button"]} ${dsButton["ghost"]} " data-plot-action="only" data-pen="${pen.color}" aria-label="Plot only pen ${escape(view.penLabel(pen.color))}" ${disabled}>Only</button></div>${pen.sources.length > 1 || pen.sources[0] !== pen.color ? `<small class="field-help ${dsField["field-help"]} ">Source: ${pen.sources.map(escape).join(', ')}</small>` : ''}</div>`;
  }
  function numberSetting(key:keyof PlotSettings,label:string,unit:string,min:number,max:number|undefined,disabled:string,step='1',accessibleLabel?:string):string {
    return propertyField({label:accessibleLabel??label,prefix:label,unit,value:Number((key==='copies'&&view.settings.copies==='continuous'?1:view.settings[key])??(key==='drawingJerk'?500000:key==='travelJerk'?330200:key==='copies'?1:0)),attributes:{ 'data-plot-setting':key,'data-focus-key':`setting-${key}`,min,...(max === undefined ? {} : {max}),...(accessibleLabel ? {'aria-label':`${accessibleLabel} ${unit}`.trim()} : {}),step,required:true,disabled:!!disabled }});
  }
  function machineMarkup(): string {
    const idle = view.plotter.connected && !view.locked && (view.connectionTarget !== 'network' || !!view.network?.hasControl);
    const canPen = view.plotter.connected && !view.manualBusy && view.plotter.canAdjustPen && !(view.destination === 'simulation' && view.locked);
    const hasOrigin = view.plotter.hasOrigin(view.settings.profile);
    const motors = plotSection('motors', 'Motors', `<p class="plot-origin-state ${appPlot['plot-origin-state']}">${originLabel(view.plotter.originStatus, hasOrigin)}</p>
      <div class="machine-actions ${appPlot['machine-actions']}">${[
        ['set-origin', 'Set origin', 'Set origin'], ['return-origin', 'Return', 'Return to origin'],
        ['engage', 'Engage', 'Engage motors'], ['release', 'Release', 'Release motors']
      ].map(([action, label, name]) => button({ label:label!, attributes:{'data-plot-action':action!, 'aria-label':name!, title:name!}, disabled:!idle || action === 'return-origin' && !hasOrigin || action === 'engage' && view.plotter.motorsOn })).join('')}</div>
      <div>${['x-minus','x-plus','y-minus','y-plus'].map(axis=>button({label:axis.replace('minus','−').replace('plus','+').toUpperCase(),attributes:{'data-plot-action':`jog-${axis}`},disabled:!idle||!hasOrigin})).join('')}${numberSetting('jogStepMm','Jog distance','mm',.01,10,idle?'':'disabled','.01')}</div>
      ${view.settings.profile==='nextdraw'?button({label:'Home',disabled:!idle,attributes:{'data-plot-action':'home','aria-label':'Home NextDraw'}}):''}
      ${button({label:'Check supply',disabled:!idle,attributes:{'data-plot-action':'check-power','aria-label':'Check motor supply',title:'Check motor supply'}})}`, `plot-motor-section ${appPlot['plot-motor-section']}`);
    const pen = plotSection('pen', 'Pen', `<div class="two-col ${appField['two-col']}">${button({label:'Up',disabled:!canPen,attributes:{'data-plot-action':'pen-up','aria-label':'Pen up',title:'Pen up'}})}${button({label:'Down',disabled:!canPen,attributes:{'data-plot-action':'pen-down','aria-label':'Pen down',title:'Pen down'}})}</div>
      <div class="two-col ${appField['two-col']}" data-pen-heights>${numberSetting('penUp', 'Up height', '%', 0, 100, idle ? '' : 'disabled', '1', 'Pen up height')}${numberSetting('penDown', 'Down height', '%', 0, 100, idle ? '' : 'disabled', '1', 'Pen down height')}</div>`, `plot-pen-section ${appPlot['plot-pen-section']}`);
    return motors + pen;
  }


  return `<div class="plot-scroll ${appPlot["plot-scroll"]} ">
        ${supportsHardwareProfile(view.settings.profile) ? plotSection('connection', 'Destination', connectionMarkup(view), '', {'data-connection-section':true}) : ''}
        ${plotSection('plot-settings', 'Plot settings', `${machineProfileFields(view.settings, key=>({'data-plot-setting':key,disabled:locked}))}
          ${propertyField({label:'Plotter position',prefix:'Rail',type:'select',align:'left',value:view.settings.machineRotation??DEFAULT_MACHINE_ROTATION,options:PLOTTER_POSITIONS.map(({rotation})=>({value:String(rotation),label:({90:'Right',180:'Above',270:'Left',0:'Below'} as Record<number,string>)[rotation]!})),attributes:{'data-plot-setting':'machineRotation','data-focus-key':'setup-position',disabled:locked}})}
          <div class="two-col ${appField['two-col']}">${numberSetting('speed','Draw','mm/s',1,100,disabled,'1','Drawing speed')}${numberSetting('travelSpeed','Travel','mm/s',1,200,disabled,'1','Travel speed')}</div>
          <details class="${dsDisclosure["disclosure"]} " data-section="advanced"><summary>Advanced</summary>${contextualHelp('plot-advanced-help','Advanced','<p>Machine orientation is relative to Standard and uses the pen origin. Color order groups strokes by pen or follows the artwork. A reload distance raises and lowers the pen in place; 0 disables reloads. Pen changes pause at origin.</p>')}<div class="plot-detail-content ${appPlot["plot-detail-content"]} ">
            <label class="${dsField["field"]} ">Machine orientation<select class="${dsSelect["select"]}" data-plot-setting="machineRotation" ${disabled}>${MACHINE_ORIENTATIONS.map(({rotation, label}) => `<option value="${rotation}" ${(view.settings.machineRotation ?? DEFAULT_MACHINE_ROTATION) === rotation ? 'selected' : ''}>${label}</option>`).join('')}</select></label>

            <label class="${dsField["field"]} ">Color order<select class="${dsSelect["select"]}" data-color-mode ${disabled}><option value="group" ${view.preferences.mode === 'group' ? 'selected' : ''}>Group by pen</option><option value="source" ${view.preferences.mode === 'source' ? 'selected' : ''}>Follow artwork order</option></select></label>
            <label class="${dsField["field"]} ">Path order<select class="${dsSelect["select"]}" data-plot-setting="reorderMode" ${disabled || view.preferences.mode === 'source' ? 'disabled' : ''}><option value="preserve" ${view.settings.reorderMode === 'preserve' ? 'selected' : ''}>Preserve order within pen</option><option value="nearest" ${view.settings.reorderMode === 'nearest' ? 'selected' : ''}>Nearest path</option><option value="reversible" ${view.settings.reorderMode === 'reversible' ? 'selected' : ''}>Nearest + reverse</option></select></label>
            <details class="${dsDisclosure["disclosure"]} " data-section="path-optimization"><summary>Path optimization</summary>${contextualHelp('plot-path-optimization-help','Path optimization','<p>Join endpoints draws a short connecting line between nearby open paths with the same pen and width. 0 disables joining. Simplify reduces dense vertices within the selected deviation; 0 disables reduction. A fixed random seed reproduces closed-path starts. Text operations and generated fills retain their geometry.</p>')}<div class="plot-detail-content ${appPlot["plot-detail-content"]} ">
              ${numberSetting('pathJoinToleranceMm','Join endpoints within','mm',0,1_000_000,disabled,'.001')}

              ${numberSetting('pathSimplifyToleranceMm','Simplify within','mm',0,1_000_000,disabled,'.001')}

              <label class="${dsField["field"]} ">Closed path start<select class="${dsSelect["select"]}" data-plot-setting="closedPathStart" ${disabled}><option value="preserve" ${view.settings.closedPathStart==='preserve'?'selected':''}>Original start</option><option value="nearest" ${view.settings.closedPathStart==='nearest'?'selected':''}>Nearest vertex</option><option value="random" ${view.settings.closedPathStart==='random'?'selected':''}>Random vertex</option></select></label>
              ${numberSetting('pathRandomSeed','Random seed','',0,4294967295,disabled||view.settings.closedPathStart!=='random'?'disabled':'')}

            </div></details>
            ${numberSetting('drawAcceleration', 'Draw acceleration', 'mm/s²', 1, undefined, disabled)}${numberSetting('travelAcceleration', 'Travel acceleration', 'mm/s²', 1, undefined, disabled)}${numberSetting('cornering', 'Cornering', 'mm', 0, undefined, disabled, '.001')}${numberSetting('maxPenDownMm', 'Pen reload distance', 'mm', 0, undefined, disabled)}
            <label class="${dsField.field}">Motion backend<select class="${dsSelect.select}" data-plot-setting="motionPreference" ${disabled}><option value="auto" ${(view.settings.motionPreference??'auto')==='auto'?'selected':''}>Auto · compatibility pending hardware acceptance</option><option value="compatibility" ${view.settings.motionPreference==='compatibility'?'selected':''}>Compatibility · SM</option><option value="scurve" ${view.settings.motionPreference==='scurve'?'selected':''}>S-curve · EBB 3.1.7</option></select></label>
            <label class="${dsField.field}">Handling<select class="${dsSelect.select}" data-plot-setting="handling" ${disabled}>${['custom','technical','handwriting','sketching'].map(value=>`<option value="${value}" ${(view.settings.handling??'custom')===value?'selected':''}>${value[0]!.toUpperCase()+value.slice(1)}</option>`).join('')}</select></label>
            ${numberSetting('drawingJerk','Drawing jerk','mm/s³',1,1e9,disabled||view.settings.motionPreference!=='scurve'||view.settings.drawingMode==='constant'?'disabled':'')}
            ${numberSetting('travelJerk','Travel jerk','mm/s³',1,1e9,disabled||view.settings.motionPreference!=='scurve'?'disabled':'')}
            ${numberSetting('curveToleranceMm','Curve accuracy','mm',.001,10,disabled,'.001')}
            <label class="${dsField.field}">Drawing motion<select class="${dsSelect.select}" data-plot-setting="drawingMode" ${disabled}><option value="profiled" ${(view.settings.drawingMode??'profiled')==='profiled'?'selected':''}>Accelerated</option><option value="constant" ${view.settings.drawingMode==='constant'?'selected':''}>Constant speed</option></select></label>
            <label class="${dsField.field}">Motor resolution<select class="${dsSelect.select}" data-plot-setting="resolution" ${disabled}><option value="8" ${(view.settings.resolution??8)===8?'selected':''}>8×</option><option value="16" ${view.settings.resolution===16?'selected':''}>16×</option></select></label>

            <details class="${dsDisclosure["disclosure"]} " data-section="pen-timing"><summary>Pen timing and rates</summary>${contextualHelp('plot-pen-timing-help','Pen timing and rates','<p>Rates set lift speed. Waits adjust the calculated transition time; negative waits shorten it. Reload wait is added while raised between consecutive reload chunks.</p>')}<div class="plot-detail-content ${appPlot["plot-detail-content"]} ">
              ${numberSetting('penRateRaise','Raise rate','%',1,100,disabled)}
              ${numberSetting('penRateLower','Lower rate','%',1,100,disabled)}
              ${numberSetting('penDelayUpMs','Extra wait after raising','ms',-500,10000,disabled)}
              ${numberSetting('penDelayDownMs','Extra wait after lowering','ms',-500,10000,disabled)}
              ${numberSetting('penReloadWaitMs','Extra reload wait','ms',0,10000,disabled)}

            </div></details>
            <details class="${dsDisclosure.disclosure}" data-section="repeat"><summary>Repeated copies</summary><div class="plot-detail-content ${appPlot['plot-detail-content']}">
              ${numberSetting('copies','Copies','',1,100000,disabled)}
              ${checkbox('Repeat until stopped',view.settings.copies==='continuous',{'data-plot-setting':'continuousCopies',disabled:!!disabled})}
              ${checkbox('Vary closed starts per copy',view.settings.varyClosedStarts??false,{'data-plot-setting':'varyClosedStarts',disabled:!!disabled})}
              ${numberSetting('repeatIntervalMs','Wait between copies','ms',0,86400000,disabled)}
              ${checkbox('Require Continue after the wait',view.settings.repeatRequireContinue??false,{'data-plot-setting':'repeatRequireContinue',disabled:!!disabled})}
              <p class="field-help ${dsField['field-help']}">The pen waits raised at origin. No wait follows the last finite copy.</p>
            </div></details>
            ${checkbox('Automatically orient and place drawing',view.settings.automaticPlacement??false,{'data-plot-setting':'automaticPlacement',disabled:!!disabled})}${checkbox('Clip to page and margin',view.settings.pageClipping!==false,{'data-plot-setting':'pageClipping',disabled:!!disabled})}${checkbox('Remove lines under opaque fills',view.settings.hiddenLineRemoval??false,{'data-plot-setting':'hiddenLineRemoval',disabled:!!disabled})}${checkbox('Strict source order',view.settings.strictOrder??false,{'data-plot-setting':'strictOrder',disabled:!!disabled})}
            <label class="${dsField.field}">Preview paths<select class="${dsSelect.select}" data-plot-setting="previewFilter" ${disabled}>${['all','draw','travel'].map(value=>`<option value="${value}" ${(view.settings.previewFilter??'all')===value?'selected':''}>${value}</option>`).join('')}</select></label>
            ${view.settings.profile==='nextdraw'?`<label class="${dsField.field}">Pen servo<select class="${dsSelect.select}" data-plot-setting="nextdrawServo" ${disabled}><option value="brushless" ${(view.settings.nextdrawServo??'brushless')==='brushless'?'selected':''}>Brushless</option><option value="standard" ${view.settings.nextdrawServo==='standard'?'selected':''}>Standard</option></select></label>`:''}
            ${numberSetting('servoTimeoutMs','Servo power timeout','ms',0,65535,disabled||view.settings.profile==='nextdraw'&&(view.settings.nextdrawServo??'brushless')==='brushless'?'disabled':'')}
            ${view.settings.profile==='axidraw'?`<label class="${dsField.field}">Physical travel model<select class="${dsSelect.select}" data-plot-setting="axidrawHardwareModel" ${disabled}><option value="v3-a4" ${(view.settings.axidrawHardwareModel??'v3-a4')==='v3-a4'?'selected':''}>V3 / SE A4</option><option value="v3-a3" ${view.settings.axidrawHardwareModel==='v3-a3'?'selected':''}>V3 / SE A3</option></select></label>`:''}
            ${checkbox('Synchronize B3 output with pen',view.settings.synchronizedB3??false,{'data-plot-setting':'synchronizedB3',disabled:!!disabled})}
            <details class="${dsDisclosure.disclosure}"><summary>Resume drawing</summary>${numberSetting('startAtMm','Start after drawing distance','mm',0,1e12,disabled,'.1')}${button({label:'Use completed checkpoint',attributes:{'data-plot-action':'resume-checkpoint'},disabled:!!disabled})}${button({label:'Clear start distance',attributes:{'data-plot-action':'clear-checkpoint'},disabled:!!disabled})}<p>Use Set origin after an interruption. Decrease the distance to redraw an overlap.</p></details>
            ${view.plan?.layers?.length?`<details class="${dsDisclosure.disclosure}"><summary>Layer controls</summary>${view.plan.layers.map(layer=>{const value=view.settings.layerOverrides?.[layer.sourceLayerId??layer.id]??{};return `<div><p>${escape(layer.name)}</p>${checkbox('Include layer',value.included!==false,{'data-layer-setting':'included','data-layer-id':layer.sourceLayerId??layer.id,disabled:!!disabled})}${numberField('Speed',value.speedPercent??layer.speedPercent??100,'%',{'data-layer-setting':'speedPercent','data-layer-id':layer.sourceLayerId??layer.id,min:1,max:110,disabled:!!disabled})}${numberField('Pen height',value.penDown??layer.overrides?.penDown??view.settings.penDown,'%',{'data-layer-setting':'penDown','data-layer-id':layer.sourceLayerId??layer.id,min:0,max:100,disabled:!!disabled})}${numberField('Wait',value.delayMs??layer.delayMs??0,'ms',{'data-layer-setting':'delayMs','data-layer-id':layer.sourceLayerId??layer.id,min:0,max:86400000,disabled:!!disabled})}${checkbox('Pause before layer',value.pause??layer.pause??false,{'data-layer-setting':'pause','data-layer-id':layer.sourceLayerId??layer.id,disabled:!!disabled})}</div>`;}).join('')}</details>`:''}
            ${checkbox('Return to origin when complete', view.settings.returnToOrigin, { 'data-plot-setting':'returnToOrigin',disabled:!!disabled })}
            <button class="button ${dsButton["button"]} " data-plot-action="reset-pens" ${disabled}>Reset pen assignments</button>
          </div></details>
        `, `plot-settings-section ${appPlot['plot-settings-section']}`)}
        ${plotSection('pens', 'Pens & passes', `<div class="plot-section-title ${appPlot['plot-section-title']}"><p class="field-help ${dsField['field-help']}" data-pass-summary>${countLabel(view.pens.filter(pen => pen.included).length, 'pen')} · ${countLabel(view.plan?.passes.length ?? 0, 'pass', 'passes')}</p><button class="button ghost ${dsButton['button']} ${dsButton['ghost']}" data-plot-action="all" ${disabled}>All pens</button></div>
          ${view.pens.length ? `<div class="plot-pens ${appPlot["plot-pens"]} ">${view.pens.map((pen, index) => penMarkup(pen, index, disabled)).join('')}</div>` : `<p class="field-help ${dsField["field-help"]} ">${view.session === 'planning' ? 'Reading artwork colors…' : view.session === 'error' ? 'Pen preview is unavailable until preparation succeeds.' : 'Add artwork to plot, or check that paths are inside the safe margin.'}</p>`}
          <ol class="plot-pass-list ${appPlot['plot-pass-list']}" aria-label="Pen passes" ${!view.plan?.passes.length ? 'hidden' : ''} ${view.plan?.passes.length === 1 ? 'data-single-pass' : ''}>${view.plan?.passes.map((pass, index) => `<li data-pass-index="${index}"><span class="pen-swatch ${appPlot['pen-swatch']}" style="background:${pass.tool}" aria-hidden="true"></span><span>${escape(view.penLabel(pass.tool))}</span><small data-pass-state>Upcoming</small></li>`).join('') ?? ''}</ol>
        `, 'plot-pens-section')}
        ${view.connectionTarget && supportsHardwareProfile(view.settings.profile) ? machineMarkup() : ''}
        ${plotSection('diagnostics', 'Diagnostics', `${virtualMonitorButton}${button({label:'Export preview paths',attributes:{'data-plot-action':'export-paths'},disabled:!view.plan?.executable})}${button({label:'Download log',attributes:{'data-plot-action':'machine-log','aria-label':'Download machine log',title:'Download machine log'}})}
          <dl class="${appPlot['plot-diagnostics']}"><dt>App</dt><dd>${escape(appVersion)}</dd><dt>Firmware</dt><dd>${view.plotter.firmwareLabel ? `EBB ${escape(view.plotter.firmwareLabel)}` : view.plotter.connected ? 'Unavailable' : 'Not connected'}</dd>${view.deviceLabel ? `<dt>Device</dt><dd>${escape(view.deviceLabel)}</dd>` : ''}<dt>Motion</dt><dd>${view.plan?.executable?.backend==='t3'?'S-curve · T3/TD':'Compatibility · SM'} · ${view.settings.motionFirmware??'offline target'} · ${view.settings.resolution??8}×</dd><dt>Paper</dt><dd>${escape(view.documentState.paper.name)} · ${view.documentState.paper.width} × ${view.documentState.paper.height} mm</dd></dl>`, '', {}, false)}
      </div>
      <section class="plot-player ${appPlot["plot-player"]} " aria-label="Plot playback">
        <p class="plot-current-pen ${appPlot["plot-current-pen"]} " data-player-pen></p>
        <progress max="100" value="0" aria-label="Plot progress" data-player-progress></progress>
        <div class="plot-sim-controls ${appPlot["plot-sim-controls"]} " ${view.destination === 'simulation' ? '' : 'hidden'}><input type="range" min="0" max="${view.plan?.duration ?? 0}" step=".01" value="0" aria-label="Simulation timeline" data-sim-timeline><label class="${dsField["field"]} ">Speed<select class="${dsSelect["select"]} " data-sim-rate aria-label="Playback speed">${[1, 2, 5, 10].map(rate => `<option value="${rate}" ${rate === view.rate ? 'selected' : ''}>${rate}×</option>`).join('')}</select></label></div>
        <p class="plot-error ${appPlot["plot-error"]} " role="alert" data-player-error hidden></p>
        <div class="plot-playback-actions ${appPlot["plot-playback-actions"]} "><button class="button primary ${dsButton["button"]} ${dsButton["primary"]} " data-plot-action="start">${icon('play')} <span>Start with this pen</span></button><button class="button primary ${dsButton["button"]} ${dsButton["primary"]} " data-plot-action="pause" hidden>${icon('pause')} <span>Pause</span></button><button class="button ${dsButton["button"]} " data-plot-action="stop" hidden>${icon('stop')} Stop</button><button class="button ${dsButton["button"]} " data-plot-action="cancel-plan" hidden>Cancel</button><button class="button ${dsButton["button"]} " data-plot-action="retry" hidden>Prepare again</button></div>
        <div class="plot-secondary-actions ${appPlot["plot-secondary-actions"]}"><button type="button" class="button ${dsButton.button}" data-plot-action="choose-simulation">${icon('play')} Simulate</button><button type="button" class="button ${dsButton.button}" data-plot-action="bounds-preview" title="Preview the drawing bounds with the pen raised, then return to origin">Preview bounds</button></div>
      </section>`;
}

export function originLabel(status: PlotDestination['originStatus'], hasOrigin: boolean): string {
  return hasOrigin ? status === 'automatic' ? 'Origin: automatic' : 'Origin: saved' : 'Origin: current position';
}

const plotInformation:Record<string,string> = {
  connection:'Choose a destination, then Connect. Selecting a destination does not connect or start a job. Simulate and Preview bounds are in the footer.',
  'plot-settings':'Choose the machine, model and main rail position. Drawing speed applies while the pen is down; Travel speed applies while raised; Advanced contains path settings. Fit frames the paper.',
  pens:'Assign pens without changing artwork colors. Include or exclude pens, use Only for one pen, and reorder when grouped by pen. Repeated passes can preserve text or fill operations. Artwork order is selected in Advanced. Pen changes pause at origin.',
  motors:'Set origin saves the current carriage position. Return moves back to the saved origin. Engage enables motors; Release frees them. Check supply reads the motor power status.',
  pen:'Up and Down move the pen to the selected heights. Test and adjust heights while idle. These controls remain subject to connection and ownership restrictions.',
  diagnostics:'Download a log of commands, replies and execution signals for troubleshooting. App, firmware and device details identify the current setup.'
};

function plotSection(section: string, title: string, content: string, className = '', attrs: Attributes = {}, open = true): string {
  const label = section === 'pens' ? `<span data-plot-pens-title>${escape(title)}</span>` : escape(title);
  const help = plotInformation[section];
  return disclosure(`<summary>${label}</summary>${help ? contextualHelp(`plot-${section}-help`,title,`<p>${escape(help)}</p>`) : ''}<div class="${appPlot['plot-section-body']}">${content}</div>`, open,
    `plot-section ${appPlot['plot-section']} ${className}`, { ...attrs, 'data-section': section });
}

function connectionMarkup(view: PlotView): string {
  const selected = view.connectionTarget;
  const connected = selected !== null && view.plotter.connected && (selected !== 'network' || !!view.network?.hasControl);
  const hardware = supportsHardwareProfile(view.settings.profile);
  const disabled = !hardware && !connected || view.manualBusy || view.plotter.connecting || view.locked && !(view.busy && selected === 'network' && !view.network?.hasControl) || !selected || !view.plotter.supported || selected === 'machine' && !view.plotter.connected && view.serverOwnsLocalUsb;
  const action = connected ? selected === 'network' ? 'disconnect-ebb' : 'disconnect' : 'connect';
  const status = selected === 'network' ? view.network?.networkConnected ? view.plotter.connected ? 'Server connected · Plotter connected' : view.plotter.connecting ? 'Server connected · Connecting EBB…' : 'Server connected · EBB disconnected' : 'Server disconnected' : selected === 'machine' ? view.plotter.connected ? 'USB connected' : view.plotter.connecting ? 'Connecting…' : '' : '';
  return `<select aria-label="Destination" class="${dsSelect.select}" data-plot-destination ${view.locked || !hardware ? 'disabled' : ''}><option value="" ${!selected ? 'selected' : ''}>Choose a destination</option><option value="machine" ${selected === 'machine' ? 'selected' : ''}>Direct USB · this computer</option>${view.network ? `<option value="network" ${selected === 'network' ? 'selected' : ''}>Network plotter (Node server)</option>` : ''}</select>
    <button type="button" class="button ${dsButton.button} ${selected && !connected ? `primary ${dsButton.primary}` : ''}" data-plot-action="${action}" ${disabled ? 'disabled' : ''}>${icon('usb')} ${connected ? 'Disconnect' : view.plotter.connecting || view.manualBusy ? 'Connecting…' : 'Connect'}</button>
    ${status ? `<p class="field-help ${dsField['field-help']}">${status}</p>` : ''}
    ${!view.plotter.supported ? `<p class="field-help ${dsField['field-help']}">USB connection requires desktop Chrome or Edge.</p>` : ''}
    ${selected === 'machine' && view.serverOwnsLocalUsb ? `<p class="field-help ${dsField['field-help']}">The local Node server owns the EBB. Release its USB connection before connecting directly.</p><button type="button" class="button ${dsButton.button}" data-plot-action="release-server-usb" ${view.locked || view.network?.active ? 'disabled' : ''}>Release server USB</button>` : ''}
    ${selected === 'network' && view.network?.hasControl ? `<details class="${dsDisclosure.disclosure}" data-section="connection-options"><summary>Connection options</summary><div class="plot-detail-content ${appPlot['plot-detail-content']}"><button type="button" class="button ${dsButton.button}" data-plot-action="release-control" ${view.manualBusy ? 'disabled' : ''}>Release control</button>${view.localPlotter.connected ? `<button type="button" class="button ${dsButton.button}" data-plot-action="disconnect-local-usb" ${view.locked ? 'disabled' : ''}>Disconnect direct USB</button>` : ''}</div></details>` : ''}`;
}
