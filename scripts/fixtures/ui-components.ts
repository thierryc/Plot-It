import '../../src/styles.css';
import { button, checkbox, checkboxInput, colorField, dialog, disclosure, field, fieldWithAction, propertyField, input, numberField, popover, select, segmentedControl, surface, textarea, NativeOverlays, mountSegmentedControls, contextualHelp, mountContextualHelp } from '../../src/ui/design-system';
import './ui-components.css';
import {icon} from '../../src/icons';

// This entry is outside every production build input.
if (!import.meta.env.DEV) throw new Error('Component showcase is development-only.');
const root = document.querySelector<HTMLElement>('#app')!;
root.innerHTML = `<div data-ui-root class="showcase"><h1>Plot-It app components</h1><p>Native HTML · compact desktop controls · comfortable touch targets</p>
${field('Preview theme', select([{value:'light',label:'Light'},{value:'dark',label:'Dark'}], 'light', {'data-preview-theme':'','aria-label':'Preview theme'}))}
${surface(`<h2>Buttons</h2><div class="examples">${button({label:'Primary',variant:'primary'})}${button({label:'Secondary'})}${button({label:'Ghost',variant:'ghost'})}${button({label:'Delete',variant:'danger'})}${button({label:'Unavailable',disabled:true})}</div>`, 'example')}
${surface(`<h2>Workspace modes</h2>${segmentedControl('Example modes', [{label:'Edit',selected:true,attributes:{'data-example-mode':'edit'}},{label:'Plot',selected:false,attributes:{'data-example-mode':'plot'}}])}`, 'example')}
${surface(`<h2>Segmented states</h2>${segmentedControl('Example output', [{label:'All artwork',selected:true,attributes:{}},{label:'Selection only',selected:false,attributes:{}},{label:'Hardware unavailable',selected:false,attributes:{disabled:true}}])}`, 'example')}
${surface(`<h2>Inspector property fields</h2><div class="property-examples">${propertyField({label:'X position',prefix:'X',value:'20.100',unit:'mm',attributes:{step:'.1'}})}${propertyField({label:'Y position',prefix:'Y',value:20,unit:'mm'})}${propertyField({label:'Width',prefix:'W',value:122.88,unit:'mm'})}${propertyField({label:'Height',prefix:'H',value:48,unit:'mm'})}${propertyField({label:'Cap height',prefix:'Cap',value:12,unit:'mm'})}${propertyField({label:'Line height',prefix:'Line',value:2,unit:'×'})}${propertyField({label:'Drawing speed',prefix:'Draw',value:35,unit:'mm/s'})}${propertyField({label:'Travel speed',prefix:'Travel',value:100,unit:'mm/s'})}</div>${propertyField({label:'Overlap',prefix:'Overlap',value:15,unit:'%'})}${propertyField({label:'Machine profile',prefix:'Profile',type:'select',align:'left',value:'nextdraw',options:[{value:'axidraw',label:'AxiDraw / EBB'},{value:'nextdraw',label:'Bantam Tools NextDraw'}]})}${segmentedControl('Text alignment',(['left','center','right'] as const).map(value=>({label:`Align ${value}`,selected:value==='left',icon:icon(`align-${value}`),iconOnly:true,attributes:{}})))}${propertyField({label:'Unavailable height',prefix:'H',value:48,unit:'mm',attributes:{disabled:true}})}${propertyField({label:'Invalid width',prefix:'W',value:-1,unit:'mm',attributes:{'aria-invalid':true,'aria-describedby':'property-error'}})}<p id="property-error">Width must be positive.</p>`, 'example')}
${surface(`<h2>Checkboxes</h2>${checkbox('Draw boundary',false,{'data-example':'boundary'})}${checkbox('Kerning',true,{'data-example':'kerning'})}${checkbox('A long checkbox label wraps onto multiple lines without stretching its native square or shrinking its clickable row',true)}${checkbox('Disabled checked',true,{disabled:true})}<label class="standalone-check">${checkboxInput('Include pen Black',true)}<span>Standalone pen inclusion</span></label>`, 'example')}
${surface(`<h2>Field with advanced action</h2>${fieldWithAction('Size',select([{value:'a4',label:'A4 portrait'},{value:'a3',label:'A3 portrait'}],'a4'),{label:'Canvas dimensions',icon:icon('more'),variant:'ghost',attributes:{'data-field-dialog':'','aria-haspopup':'dialog','aria-controls':'field-dialog'}})}`, 'example')}
${dialog('field-dialog','field-dialog-title',`<form method="dialog"><h2 id="field-dialog-title">Advanced dimensions</h2>${numberField('Width',210,'mm',{min:1})}${numberField('Height',297,'mm',{min:1})}${button({label:'Close dimensions',type:'submit'})}</form>`)}
${surface(`<h2>Fields</h2>${field('Name', input('Untitled plot'))}${numberField('Drawing speed',35,'mm/s',{min:1,max:100,step:1})}${field('Profile',select([{value:'axidraw',label:'AxiDraw / EBB'},{value:'xylo',label:'XyloDraw'}],'axidraw'))}${field('Text',textarea('Plot something',{rows:3}))}${field('Invalid value',input('Invalid',{'aria-invalid':true,'aria-describedby':'example-error'}))}<p id="example-error" role="alert">Enter a valid value.</p>${field('Disabled field',input('Read only',{disabled:true}))}${field('Font file',input('',{accept:'.ttf,.otf'},'file'))}${colorField('Pen color','#0B99FF')}`, 'example')}
${surface(`<h2>Contextual help</h2><div class="examples"><span>Plot fill</span>${contextualHelp('example-context-help','Plot fill','<p>Choose a fill mode or enable Draw boundary. This information is available on demand.</p>')}</div>`, 'example')}
${surface(`<h2>Surfaces and overlays</h2>${disclosure('<summary>Advanced controls</summary><p>Native details preserves keyboard operation.</p>',true)}${button({label:'Open popover',attributes:{popovertarget:'example-popover','aria-haspopup':'dialog','aria-controls':'example-popover'}})}${popover('example-popover','example-title',`<h2 id="example-title">Reusable popover</h2>${checkbox('Compact inside an overlay',true)}${button({label:'Close',attributes:{popovertarget:'example-popover',popovertargetaction:'hide'}})}`)}`, 'example')}
${button({label:'Open dialog',attributes:{'data-example-dialog':''}})}${dialog('example-dialog','example-dialog-title',`<form method="dialog"><h2 id="example-dialog-title">Native dialog</h2>${checkbox('Compact inside a modal',true)}${button({label:'Close dialog',type:'submit'})}</form>`)}
<p data-density-result></p><p data-check-result role="status"></p></div>`;
const bindings = new NativeOverlays([{overlay:root.querySelector<HTMLDialogElement>('#field-dialog')!,trigger:root.querySelector<HTMLElement>('[data-field-dialog]')!},{overlay:root.querySelector<HTMLDialogElement>('#example-dialog')!,trigger:root.querySelector<HTMLElement>('[data-example-dialog]')!},{overlay:root.querySelector<HTMLElement>('#example-popover')!,trigger:root.querySelector<HTMLElement>('[popovertarget=example-popover]')!}]);
root.querySelector<HTMLSelectElement>('[data-preview-theme]')!.addEventListener('change',event=>{document.documentElement.dataset.theme=(event.target as HTMLSelectElement).value;});
const releaseSegments = mountSegmentedControls(root);
const releaseHelp = mountContextualHelp(root);
window.addEventListener('pagehide',()=>{bindings.destroy();releaseSegments();releaseHelp();},{once:true});

function verifyGeometry(): void {
  const styles = getComputedStyle(document.documentElement);
  root.querySelector('[data-density-result]')!.textContent = `Desktop: ${styles.getPropertyValue('--control-height').trim()} fields · ${styles.getPropertyValue('--button-height').trim()} buttons · ${styles.getPropertyValue('--field-gap').trim()} label gap · touch targets 44px`;
  const controls = [...root.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].filter(control=>control.getClientRects().length);
  const failures = controls.filter(control=>{const box=control.getBoundingClientRect();return box.width!==16||box.height!==16;});
  root.querySelector('[data-check-result]')!.textContent=failures.length ? `${failures.length} sizing failures` : `${controls.length} checkbox controls verified at 16 × 16px`;
}
requestAnimationFrame(verifyGeometry);
window.addEventListener('resize',verifyGeometry);

root.querySelector('[data-example-dialog]')!.addEventListener('click',()=>root.querySelector<HTMLDialogElement>('#example-dialog')!.showModal());

root.querySelector('[data-field-dialog]')!.addEventListener('click',()=>root.querySelector<HTMLDialogElement>('#field-dialog')!.showModal());
