import { icon } from '../../icons';
import { button as nativeButton, surface, segmentedControl as nativeSegmented, disclosure, classes, type ButtonOptions as NativeButtonOptions, type Attributes } from '../design-system';
import inspector from './inspector.module.css';
import canvas from './canvas.module.css';
export { escapeUI, field, popover } from '../design-system';
export function button(o: Omit<NativeButtonOptions,'icon'> & { icon?:Parameters<typeof icon>[0]; action?:string }):string {
  return nativeButton({ ...o, icon:o.icon ? icon(o.icon) : undefined, attributes:{ ...o.attributes, ...(o.action ? { 'data-action':o.action } : {}) } });
}
export function floatingSurface(content:string, name:string, attrs:Attributes = {}):string { return surface(content, classes(name, canvas[name]), attrs); }
export function segmentedControl(label:string, options:{label:string;action:string;selected:boolean}[]):string { return nativeSegmented(label,options.map(o => ({...o,attributes:{'data-action':o.action}}))); }
export function inspectorSectionMarkup(key:string, content:string, open:boolean, name=''):string { return disclosure(content,open,classes('panel editor-panel',inspector.panel,inspector['editor-panel'],name),{'data-inspector-section':key,...(name ? {'data-ui':name} : {})}); }
