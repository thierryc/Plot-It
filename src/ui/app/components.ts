import { icon } from '../../icons';
import { button as nativeButton, surface, segmentedControl as nativeSegmented, disclosure, contextualHelp, escapeUI as escapeHelp, classes, type ButtonOptions as NativeButtonOptions, type Attributes } from '../design-system';
import inspector from './inspector.module.css';
import canvas from './canvas.module.css';
export { escapeUI, field, popover } from '../design-system';
export function button(o: Omit<NativeButtonOptions,'icon'> & { icon?:Parameters<typeof icon>[0]; action?:string }):string {
  return nativeButton({ ...o, icon:o.icon ? icon(o.icon) : undefined, attributes:{ ...o.attributes, ...(o.action ? { 'data-action':o.action } : {}) } });
}
export function floatingSurface(content:string, name:string, attrs:Attributes = {}):string { return surface(content, classes(name, canvas[name]), attrs); }
export function segmentedControl(label:string, options:{label:string;action:string;selected:boolean}[]):string { return nativeSegmented(label,options.map(o => ({...o,attributes:{'data-action':o.action}}))); }
const sectionInformation:Record<string,{label:string;text:string}> = {
  paper:{label:'Paper',text:'Choose a paper preset, or open the ellipsis for custom dimensions. Paper color affects the preview. The safe margin keeps plotted paths away from the page edges.'},
  setup:{label:'Plotter setup',text:'Choose the machine and model, then its main rail position relative to the paper. Paper size is independent of the model selection. Fit frames the paper.'},
  objects:{label:'Objects',text:'Select an object here or on the paper. Double-click its name or press F2 to rename. Option/Alt-drag copies; Shift constrains. Command/Ctrl+D repeats the last copy transformation.'},
  selection:{label:'Selection',text:'Drag corners to resize; Option/Alt resizes from the center. Shift rotates in 15° steps. Space-drag pans the canvas. Geometry fields edit the selected object or SVG element.'}
};
export function inspectorSectionContent(key:string, content:string):string {
  const help = sectionInformation[key];
  if (help && !content.includes(`data-context-help="inspector-${key}-help"`)) content = content.replace('</summary>',`</summary>${contextualHelp(`inspector-${key}-help`,help.label,`<p>${escapeHelp(help.text)}</p>`)}`);
  return content;
}
export function inspectorSectionMarkup(key:string, content:string, open:boolean, name=''):string {
  content = inspectorSectionContent(key,content);
  return disclosure(content,open,classes('panel editor-panel',inspector.panel,inspector['editor-panel'],name),{'data-inspector-section':key,...(name ? {'data-ui':name} : {})});
}
