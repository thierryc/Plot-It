import type { AppState } from '../../model';
import type { editorViews } from './editor-views';
import type { WorkspaceConnection } from '../../workspace-connection';
import { machineProfileFields } from './machine-profile';
import { PLOTTER_POSITIONS } from '../../plotter-setup';
import { paperPresetIndex } from '../../paper';
import { connectionMarkup } from './plot-views';
import { supportsHardwareProfile } from '../../machine-profiles';
import { colorField, escapeUI, fieldWithAction, propertyField } from '../design-system';
import { inspectorSectionMarkup } from './components';
import { icon } from '../../icons';
import appInspector from './inspector.module.css';
import dsDisclosure from '../design-system/disclosure.module.css';
import dsField from '../design-system/field.module.css';
import dsSelect from '../design-system/select.module.css';

export function canvasInspectorMarkup(state: AppState, editor: Pick<ReturnType<typeof editorViews>, 'paperOptions'>, inspectorSections: ReadonlyMap<string, boolean>, connection: WorkspaceConnection): string {
  const locked = connection.locked;
  return `          ${inspectorSectionMarkup("paper", `<summary class="panel-title ${appInspector["panel-title"]} ">Paper</summary><div class="panel-body ${appInspector["panel-body"]} ">${fieldWithAction('Size', `<select class="${dsSelect.select}" data-setting="paper" ${locked ? 'disabled' : ''}>${editor.paperOptions(paperPresetIndex(state.paper))}</select>`, {label:'Canvas dimensions',icon:icon('more'),variant:'ghost',attributes:{'data-action':'canvas-size','aria-haspopup':'dialog','aria-controls':'canvas-dialog',title:'Advanced canvas dimensions'}})}${colorField('Paper color', state.paperColor, { 'data-setting':'paperColor', disabled:locked })}${propertyField({label:'Safe margin',prefix:'Margin',unit:'mm',value:state.settings.margin,attributes:{min:0,max:50,step:1,'data-setting':'margin',disabled:locked}})}</div>`, inspectorSections.get("paper") ?? true, "")}

  ${inspectorSectionMarkup('plotter', `<summary class="panel-title ${appInspector['panel-title']}">Plotter</summary><div class="panel-body ${appInspector['panel-body']}">
    ${machineProfileFields(state.settings,key=>({'data-setting':key,disabled:locked}))}
    ${propertyField({label:'Plotter position',prefix:'Rail',type:'select',align:'left',value:state.settings.machineRotation??90,options:PLOTTER_POSITIONS.map(({rotation})=>({value:String(rotation),label:({90:'Right',180:'Above',270:'Left',0:'Below'} as Record<number,string>)[rotation]!})),attributes:{'data-setting':'machineRotation',disabled:locked}})}
    <details class="${dsDisclosure.disclosure}" data-section="hardware"><summary>Advanced hardware</summary><div class="panel-body ${appInspector['panel-body']}">
            ${state.settings.profile==='nextdraw'?`<label class="${dsField.field}">Pen servo<select class="${dsSelect.select}" data-setting="nextdrawServo" ${locked ? 'disabled' : ''}><option value="brushless" ${(state.settings.nextdrawServo??'brushless')==='brushless'?'selected':''}>Brushless</option><option value="standard" ${state.settings.nextdrawServo==='standard'?'selected':''}>Standard</option></select></label>`:''}
            ${state.settings.profile==='axidraw'?`<label class="${dsField.field}">Physical travel model<select class="${dsSelect.select}" data-setting="axidrawHardwareModel" ${locked ? 'disabled' : ''}><option value="v3-a4" ${(state.settings.axidrawHardwareModel??'v3-a4')==='v3-a4'?'selected':''}>V3 / SE A4</option><option value="v3-a3" ${state.settings.axidrawHardwareModel==='v3-a3'?'selected':''}>V3 / SE A3</option></select></label>`:''}
</div></details>
  </div>`, inspectorSections.get('plotter') ?? true, '')}
  ${inspectorSectionMarkup('connection', `<summary class="panel-title ${appInspector['panel-title']}">Connection</summary><div class="panel-body ${appInspector['panel-body']}" data-connection-section>
    ${supportsHardwareProfile(state.settings.profile) ? connectionMarkup({connectionTarget:connection.target,plotter:connection.plotter,network:connection.network,localPlotter:connection.localPlotter,settings:state.settings,locked,manualBusy:connection.busy,busy:connection.busy,serverOwnsLocalUsb:connection.serverOwnsLocalUsb}) : '<p>Simulation is available in Plot. Choose a hardware profile to connect a plotter.</p>'}
    ${connection.error ? `<p role="alert">${escapeUI(connection.error)}</p>` : ''}${connection.notice ? `<p class="${dsField['field-help']}">${escapeUI(connection.notice)}</p>` : ''}
  </div>`, inspectorSections.get('connection') ?? true, '')}`;
}
