import type { PlotSettings } from '../../model';
import { MACHINE_PROFILES, NEXTDRAW_MODELS, NEXTDRAW_PREVIEW_NOTE, restoreNextDrawModel } from '../../machine-profiles';
import { setupModel } from '../../plotter-setup';
import { propertyField, escapeUI, type Attributes } from '../design-system';
import styles from '../design-system/field.module.css';

/** Shared Edit/Plot composition; callers supply their own typed event hooks. */
export function machineProfileFields(settings: PlotSettings, attrs: (key: 'profile' | 'axidrawModel' | 'nextdrawModel') => Attributes): string {
  let markup = propertyField({label:'Machine profile',prefix:'Profile',type:'select',align:'left',options:[...MACHINE_PROFILES],value:settings.profile,attributes:attrs('profile')});
  if (settings.profile === 'axidraw') markup += propertyField({label:'AxiDraw model',prefix:'Model',type:'select',align:'left',options:[
    {value:'v3-a4',label:'V3 · A4'}, {value:'v3-a3',label:'V3/A3 · A3'}
  ],value:setupModel(settings.axidrawModel),attributes:attrs('axidrawModel')});
  if (settings.profile === 'nextdraw') markup += propertyField({label:'NextDraw model',prefix:'Model',type:'select',align:'left',options:[...NEXTDRAW_MODELS],value:restoreNextDrawModel(settings.nextdrawModel),attributes:attrs('nextdrawModel')}) +
    `<p class="field-help ${styles['field-help']}">${escapeUI(NEXTDRAW_PREVIEW_NOTE)}</p>`;
  return markup;
}
