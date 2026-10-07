import { contextualHelp, propertyField, segmentedControl } from '../design-system';
import { inspectorSectionContent } from './components';
import appCanvas from './canvas.module.css';
import appField from './field.module.css';
import appInspector from './inspector.module.css';
import appOverlay from './overlay.module.css';
import dsButton from '../design-system/button.module.css';
import dsDisclosure from '../design-system/disclosure.module.css';
import dsField from '../design-system/field.module.css';
import dsInput from '../design-system/input.module.css';
import dsSelect from '../design-system/select.module.css';
import dsTextarea from '../design-system/textarea.module.css';
import type { AppState, ArtworkItem, FillSettings, TextOptions } from '../../model';
import { PAPERS } from '../../model';
import { canonicalColor } from '../../pens';
import { elements, markupRoot, elementName, SHAPE_FIELDS, pathNodes, parsePath } from '../../editor';
import { findFont, textOptions, defaultTextOptions } from '../../typography';
import { supportedCharacters } from '../../plot-font';
import { paperPresetIndex, MIN_CANVAS_MM, MAX_CANVAS_MM } from '../../paper';
import { hasElementFills } from '../../fill-dom';
import { fillSpacing } from '../../fill';
import type { TaskProgress } from '../../task-progress';
import { icon } from '../../icons';
import { fontPickerMarkup } from './font-picker';
import { colorField, checkbox, escapeUI as escapeHtml, type Attributes } from '../design-system';

export interface EditorViewContext {
  state: AppState;
  selectedElement: number | null;
  editNodes: boolean;
  selectedNode: { command: number; pair: number } | null;
  inspectorSections: ReadonlyMap<string, boolean>;
  fillStatus: string;
  fillStats: string;
  fillTask?: TaskProgress;
  currentFill: (item: ArtworkItem) => FillSettings;
  liveElement: () => SVGGraphicsElement | undefined;
  elementBounds: () => { x:number; y:number; width:number; height:number } | null;
  elementMatrix: (element: SVGGraphicsElement) => DOMMatrix;
}
export function editorViews(context: EditorViewContext) {
  const { state, selectedElement, editNodes, selectedNode, inspectorSections, fillStatus, fillStats, fillTask, currentFill, liveElement, elementBounds, elementMatrix } = context;
  const selected = () => state.items.find(item => item.id === state.selectedId);
function inspectorSection(key: string): string {
  return `data-inspector-section="${key}" ${(inspectorSections.get(key) ?? true) ? 'open' : ''}`;
}
function colorControl(label: string, color: string, attributes: Attributes, compact = false): string {
  let value = '#000000';
  try { value = canonicalColor(color); } catch { /* A color picker cannot represent SVG none or gradients. */ }
  return colorField(label, value, attributes, compact);
}
function selectionPanelMarkup(): string {
  const item = selected();
  return inspectorSectionContent('selection', `<summary class="panel-title ${appInspector["panel-title"]} ">Selection</summary><div class="panel-body ${appInspector["panel-body"]} ">${item && !item.text ? elementList(item) : ""}${item ? inspectorMarkup(item) : `<p class="panel-empty ${appInspector["panel-empty"]} ">Select an object on the paper or in the object list.</p>`}</div>`);
}

function inspectorMarkup(item: ArtworkItem): string {
  if (selectedElement !== null && !item.text) return elementInspector(item);
  const dimensions = (['x','y','width','height'] as const).map(key=>propertyField({
    label:{x:'X position',y:'Y position',width:'Width',height:'Height'}[key],prefix:{x:'X',y:'Y',width:'W',height:'H'}[key],value:item[key].toFixed(3),unit:'mm',
    attributes:{'data-item-prop':key,step:'.1',...(['width','height'].includes(key)?{min:'.1'}:{})}
  })).join('');
  return `<input class="${dsInput.input}" aria-label="Object name" data-item-prop="name" value="${escapeHtml(item.name)}">
    <div class="two-col ${appField['two-col']}">${dimensions}</div>
    <div class="two-col ${appField['two-col']}">${propertyField({label:'Rotation',prefix:'Deg',unit:'°',value:item.rotation,attributes:{'data-item-prop':'rotation',step:1}})}<button class="button ${dsButton.button}" data-action="rotate" aria-label="Rotate selection 90 degrees" title="Rotate selection 90 degrees">${icon('rotate')} 90°</button></div>
    ${item.text ? typographyControls(textOptions(item),Number((item.height/item.viewBox[3]*1.4).toFixed(3)),`<textarea class="${dsTextarea.textarea}" aria-label="Text content" data-text-content rows="2">${escapeHtml(item.text.content)}</textarea>`) : ''}
    ${fillControls(item,colorControl('Pen color',item.stroke,{'data-item-prop':'stroke'},true))}
    <div class="selection-actions ${appInspector['selection-actions']}"><button class="button ${dsButton.button}" data-action="duplicate" title="Duplicate selection · Command/Ctrl+D · repeats the last copy transformation">${icon('copy')} Copy</button><button class="button danger ${dsButton.button} ${dsButton.danger}" data-action="delete">${icon('trash')} Delete</button></div>`;
}
function objectsMarkup(): string {
  return inspectorSectionContent('objects', `<summary class="panel-title object-panel-heading ${appInspector["panel-title"]} ${appInspector["object-panel-heading"]} ${appInspector["panel-title"]} ${appInspector["object-panel-heading"]} "><span>Objects</span><span class="object-count ${appInspector["object-count"]} ">${state.items.length}</span></summary><div class="panel-body ${appInspector["panel-body"]} ">${state.items.length ? `<div class="object-list ${appInspector["object-list"]} " data-object-list>${state.items.map((item) => `<button class="object-row ${appInspector["object-row"]} ${item.id === state.selectedId ? "active" : ""}" data-select-item="${item.id}" aria-pressed="${item.id === state.selectedId}" title="${escapeHtml(item.name)} · Double-click or press F2 to rename"><span class="object-icon ${appInspector["object-icon"]} " aria-hidden="true">${icon(item.text ? "text" : "shape")}</span><span class="object-name ${appInspector["object-name"]} ">${escapeHtml(item.name)}</span></button>`).join("")}</div>` : `<p class="panel-empty ${appInspector["panel-empty"]} ">Import an SVG, add text or a shape, or draw a path.</p>`}</div>`);
}
function elementList(item: ArtworkItem): string {
  return `<details class="element-list-section ${appInspector["element-list-section"]} ${dsDisclosure.disclosure}" data-item-elements="${item.id}" ${inspectorSection("elements")}><summary class="panel-title ${appInspector["panel-title"]} ">SVG elements</summary>${contextualHelp('svg-elements-help','SVG elements','<p>Select individual elements to edit their geometry. Double-click a name or press F2 to rename. Whole object returns to the object controls.</p>')}<div class="panel-body ${appInspector["panel-body"]} "><div class="object-list ${appInspector["object-list"]} " data-object-list>${elements(markupRoot(item.markup)).map((element, index) => `<button class="object-row ${appInspector["object-row"]} ${selectedElement === index ? "active" : ""}" data-select-element="${index}" aria-pressed="${selectedElement === index}" title="Double-click or press F2 to rename · ${escapeHtml(`${index + 1}. ${elementName(element)}${element.id ? ` · ${element.id}` : ""}`)}"><span class="object-name ${appInspector["object-name"]} ">${index + 1}. ${escapeHtml(elementName(element))}${element.id ? ` · ${escapeHtml(element.id)}` : ""}</span></button>`).join("")}</div></div></details>`;
}
function elementInspector(item: ArtworkItem): string {
  const element = elements(markupRoot(item.markup))[selectedElement!];
  if (!element) return `<p class="panel-empty ${appInspector["panel-empty"]} ">Select an SVG element to edit.</p>`;
  const fields = SHAPE_FIELDS[element.localName] ?? [];
  const bounds = elementBounds();
  return `<button class="button ${dsButton["button"]} " data-action="select-object">${icon("back")} Whole object</button><div class="panel-title ${appInspector["panel-title"]} ">${escapeHtml(element.localName)} ${selectedElement! + 1}</div><label class="${dsField["field"]} ">Name<input class="${dsInput["input"]}" data-element-name value="${escapeHtml(elementName(element))}"></label>${bounds ? `<div class="two-col ${appField['two-col']}">${(['x','y','width','height'] as const).map(key=>propertyField({label:{x:'Element X position',y:'Element Y position',width:'Element width',height:'Element height'}[key],prefix:{x:'X',y:'Y',width:'W',height:'H'}[key],unit:'mm',value:bounds[key].toFixed(3),attributes:{'data-element-bounds':key,step:'.1',...(['width','height'].includes(key)?{min:'.1'}:{})}})).join('')}</div>` : ''}${fields.length ? `<details class="${dsDisclosure["disclosure"]} "><summary>Shape geometry (SVG units)</summary><div class="two-col ${appField["two-col"]} ">${fields.map((field) => `<label class="${dsField["field"]} ">${field}<input class="${dsInput["input"]}" type="number" step="any" data-element-attr="${field}" value="${escapeHtml(element.getAttribute(field) ?? (field === "font-size" ? "16" : "0"))}"></label>`).join("")}</div></details>` : ""}${element.localName === "text" ? `<label class="${dsField["field"]} ">Text<textarea class="${dsTextarea["textarea"]} " data-element-content rows="3">${escapeHtml(element.textContent ?? "")}</textarea></label><p class="field-help ${dsField["field-help"]} ">Imported SVG text must be converted to paths before pen plotting. Use the Text tool to create plottable font outlines.</p>` : ""}${element.localName === "path" ? `<button class="button ${dsButton["button"]} ${editNodes ? "node-active" : ""}" data-action="edit-nodes">${editNodes ? "Finish node editing" : "Edit path nodes"}</button>${nodeInspector()}<label class="${dsField["field"]} ">Path data<textarea class="${dsTextarea["textarea"]} " data-path-data rows="4" spellcheck="false">${escapeHtml(element.getAttribute("d") ?? "")}</textarea></label><p class="field-help ${dsField["field-help"]} ">Drag square anchors or round curve handles. Path data uses the original SVG units.</p>` : ""}${element.localName === "polyline" || element.localName === "polygon" ? `<label class="${dsField["field"]} ">Points (SVG units)<textarea class="${dsTextarea["textarea"]} " data-element-points rows="3">${escapeHtml(element.getAttribute("points") ?? "")}</textarea></label>` : ""}${colorControl("Element pen color", liveElement() ? getComputedStyle(liveElement()!).stroke : element.getAttribute("stroke") ?? item.stroke, { 'data-element-color': '' })}${fillControls(item)}<div class="selection-actions ${appInspector["selection-actions"]} "><button class="button ${dsButton["button"]} " data-action="duplicate" title="Duplicate element · Command/Ctrl+D">${icon("copy")} Duplicate</button><button class="button ${dsButton["button"]} " data-action="rotate" title="Rotate selected element 90°">${icon("rotate")} 90°</button></div><button class="button danger ${dsButton["button"]} ${dsButton["danger"]} " data-action="delete-element">${icon("trash")} Delete element</button>`;
}
function nodeInspector(): string {
  const element = liveElement(); if (!selectedNode || !element) return "";
  try {
    const node = pathNodes(parsePath(element.getAttribute("d") ?? "")).find((entry) => entry.command === selectedNode?.command && entry.pair === selectedNode.pair);
    if (!node) return "";
    const point = new DOMPoint(node.point.x, node.point.y).matrixTransform(elementMatrix(element));
    return `<div class="two-col ${appField["two-col"]} ">${["x", "y"].map((axis) => `<label class="${dsField["field"]} ">Node ${axis.toUpperCase()}<div class="unit-input ${dsInput["unit-input"]} "><input class="${dsInput["input"]}" type="number" step=".1" data-node-axis="${axis}" value="${point[axis as "x" | "y"].toFixed(3)}"><span>mm</span></div></label>`).join("")}</div>`;
  } catch { return ""; }
}
function typographyControls(options: TextOptions, capHeight?:number, content = ''): string {
  const font = findFont(options.fontId), outline = options.fontId !== "plot-sans", advanced = outline && (!font?.openplotfont || !!font.openplotfont.layout);
  const numeric = (key: 'letterSpacing'|'wordSpacing'|'lineHeight', label:string, prefix:string, unit:string) => propertyField({label,prefix,unit,value:options[key],attributes:{'data-typography':key,step:'any',...(key==='lineHeight'?{min:'.01'}:{})}});
  const alignment = `<div class="${appField['type-alignment']}"><input type="hidden" data-typography="align" value="${options.align}">${segmentedControl('Text alignment',(['left','center','right'] as const).map(value=>({label:`Align ${value}`,selected:options.align===value,icon:icon(`align-${value}`),iconOnly:true,attributes:{'data-alignment':value,'data-focus-key':`alignment-${value}`}})))}</div>`;
  const information = `<p>${font?.openplotfont ? `OpenPlotFont ${font.openplotfont.version} · original strokes and fill regions. ${font.openplotfont.layout ? 'OpenType layout enabled.' : 'Simple Latin layout with stored spacing and kerning.'} ${font.bundled ? `Bundled with Plot-it. <a href="${font.noticeUrl}" target="_blank" rel="noopener">Font attribution</a>.` : 'Fonts are saved in this browser.'}${font.id === 'openplotfont-layout-demo' ? ' Demo characters: A, f, i, n, u, 0, space and combining marks. Try fi AA or Á.' : ''}` : outline ? `Font outlines are plotted as resolved boundaries. ${font?.bundled ? `Bundled with Plot-it. <a href="${font.noticeUrl}" target="_blank" rel="noopener">Font attribution</a>.` : 'Fonts are saved in this browser.'}` : `Plot Sans supports ${supportedCharacters()}. Lowercase uses uppercase forms.`}${font?.coverageHint ? ` ${escapeHtml(font.coverageHint)}` : ''}</p>`;
  const markup = `${fontPickerMarkup(options.fontId, options.fontId === 'plot-sans' ? 'Plot Sans · single line' : font?.name ?? 'Unavailable font · load original file', capHeight===undefined?information:'', capHeight===undefined?'Font':'')}<p class="field-help ${dsField['field-help']}" data-font-status role="status" hidden></p>${content}
    <div class="two-col ${appField['two-col']}">${capHeight===undefined?'':propertyField({label:'Cap height',prefix:'Cap',unit:'mm',value:capHeight,attributes:{min:'.1',step:'.1','data-text-size':''}})}${numeric('lineHeight','Line height','Line','×')}${numeric('letterSpacing','Letter spacing','Track','em')}${numeric('wordSpacing','Word spacing','Word','em')}</div>
    <div class="${appField['type-actions']}">${alignment}${font?.openplotfont && !advanced ? checkbox('Kern',options.kerning,{'data-typography':'kerning','aria-label':'Kerning'}) : ''}</div>${advanced ? `<div class="type-checks ${appField["type-checks"]} ">${([['kerning', 'Kerning'], ['ligatures', 'Standard ligatures'], ['contextual', 'Contextual alternates']] as const).map(([key, label]) => checkbox(label, options[key], { 'data-typography':key })).join('')}</div><details class="${dsDisclosure["disclosure"]} "><summary>OpenType features and language</summary><div class="typography-advanced ${appField["typography-advanced"]} "><label class="${dsField["field"]} ">Features<input class="${dsInput["input"]}" data-typography="features" value="${escapeHtml(options.features)}" placeholder="smcp=1, dlig=1, ss01=1, salt=2" spellcheck="false"></label><p class="field-help ${dsField["field-help"]} ">${font ? `Available tags: ${escapeHtml(font.features.join(', ') || 'none')}` : 'Load the original font to edit.'} Features depend on the font, script, and language. Nonzero letter spacing suppresses optional ligatures unless explicitly enabled here.</p>${font && Object.keys(font.axes).length ? `<label class="${dsField["field"]} ">Variable axes<input class="${dsInput["input"]}" data-typography="variations" value="${escapeHtml(options.variations)}" placeholder="wght=700, wdth=100" spellcheck="false"></label><p class="field-help ${dsField["field-help"]} ">${Object.entries(font.axes).map(([tag, axis]) => `${tag}: ${axis.min}–${axis.max} (default ${axis.default})`).join(' · ')}</p>` : ''}<div class="two-col ${appField["two-col"]} "><label class="${dsField["field"]} ">Direction<select class="${dsSelect["select"]} " data-typography="direction">${['auto', 'ltr', 'rtl'].map(v => `<option ${options.direction === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label class="${dsField["field"]} ">Language<input class="${dsInput["input"]}" data-typography="language" value="${escapeHtml(options.language)}" placeholder="auto / en / tr"></label><label class="${dsField["field"]} ">Script<input class="${dsInput["input"]}" data-typography="script" value="${escapeHtml(options.script)}" placeholder="auto / Latn / Arab" maxlength="4"></label></div><p class="field-help ${dsField["field-help"]} ">Use one script and direction per text object. Automatic detection uses each line. Tracking is suppressed for Arabic, Syriac, and Mongolian to preserve joining.</p></div></details>` : ''}`;
  return capHeight===undefined ? markup : `<details class="${appInspector['typography-controls']} ${dsDisclosure.disclosure}" ${inspectorSection('typography')}><summary class="panel-title ${appInspector['panel-title']}">Typography</summary>${contextualHelp('typography-help','Typography',information)}<div class="panel-body ${appInspector['panel-body']}">${markup}</div></details>`;
}
function textDialogMarkup(): string {
  return `<form method="dialog" id="text-form"><div class="dialog-head ${appOverlay["dialog-head"]} "><div><span class="eyebrow ${appOverlay["eyebrow"]} ">Typography</span><h2>Add plot text</h2></div><button class="close ${appOverlay["close"]} " value="cancel" formnovalidate aria-label="Close">${icon("close")}</button></div><label class="${dsField["field"]} ">Text<textarea class="${dsTextarea["textarea"]} " id="text-value" rows="3" placeholder="PLOT SOMETHING" required></textarea></label><label class="${dsField["field"]} ">Cap height<div class="unit-input ${dsInput["unit-input"]} "><input class="${dsInput["input"]} " id="text-size" type="number" value="12" min=".1" step=".1"><span>mm</span></div></label><div data-dialog-typography>${typographyControls(defaultTextOptions)}</div><p id="text-error" class="text-error ${appOverlay["text-error"]} " role="alert" hidden></p><div class="dialog-actions ${appOverlay["dialog-actions"]} "><button class="button ${dsButton["button"]} " value="cancel" formnovalidate>Cancel</button><button class="button primary ${dsButton["button"]} ${dsButton["primary"]} " value="default">Add to canvas</button></div></form>`;
}
function paperOptions(index: number): string {
  return `${PAPERS.map((paper, candidate) => `<option value="${candidate}" ${candidate === index ? "selected" : ""}>${paper.name}</option>`).join("")}<option value="custom" ${index < 0 ? "selected" : ""}>Custom size…</option>`;
}
function canvasDialogMarkup(): string {
  return `<form id="canvas-form" method="dialog"><div class="dialog-head ${appOverlay["dialog-head"]} "><div><span class="eyebrow ${appOverlay["eyebrow"]} ">Paper & canvas</span><h2 id="canvas-title">Canvas size</h2></div><button class="close ${appOverlay["close"]} " type="button" data-action="close-canvas" aria-label="Close canvas size">${icon("close")}</button></div><label class="${dsField["field"]} ">Paper format<select class="${dsSelect["select"]} " id="canvas-preset">${paperOptions(paperPresetIndex(state.paper))}</select></label><div class="two-col ${appField["two-col"]} "><label class="${dsField["field"]} ">Canvas width<div class="unit-input ${dsInput["unit-input"]} "><input class="${dsInput["input"]}" id="canvas-width" type="number" min="${MIN_CANVAS_MM}" max="${MAX_CANVAS_MM}" step="any" value="${state.paper.width}" required><span>mm</span></div></label><label class="${dsField["field"]} ">Canvas height<div class="unit-input ${dsInput["unit-input"]} "><input class="${dsInput["input"]}" id="canvas-height" type="number" min="${MIN_CANVAS_MM}" max="${MAX_CANVAS_MM}" step="any" value="${state.paper.height}" required><span>mm</span></div></label></div><button class="button ${dsButton["button"]} " type="button" data-action="swap-canvas">${icon("rotate")} Swap width and height</button><p class="dialog-note ${appOverlay["dialog-note"]} ">Artwork keeps its size and position. The safe margin stays unchanged. A larger canvas does not increase your plotter’s physical travel.</p><p id="canvas-error" class="canvas-error ${appField["canvas-error"]} " role="alert" hidden></p><div class="dialog-actions ${appOverlay["dialog-actions"]} "><button class="button ${dsButton["button"]} " type="button" data-action="close-canvas">Cancel</button><button class="button primary ${dsButton["button"]} ${dsButton["primary"]} " value="apply">Apply size</button></div></form>`;
}
function fillControls(item: ArtworkItem, color = ''): string {
  const s = currentFill(item);
  const blocked=selectedElement!==null && item.fillSettings?.mode==='none';
  const mixed=selectedElement===null && hasElementFills(item,markupRoot(item.markup));
  const disabledParameters=blocked||mixed;
  const numeric = (key:keyof FillSettings,label:string,prefix:string,unit:string,min:number,max:number,step:number,value:number) => propertyField({label,prefix,unit,value,attributes:{'data-fill-setting':key,min,max,step,disabled:disabledParameters}});
  let spacing = ''; try { spacing = fillSpacing(s).toFixed(3); } catch { /* Invalid saved settings are reported by generation. */ }
  return `<details class="fill-controls ${appInspector["fill-controls"]} ${dsDisclosure.disclosure}" ${inspectorSection("fill")}><summary class="panel-title ${appInspector["panel-title"]} ">${color ? 'Pen & fill' : 'Plot fill'}</summary>${contextualHelp('fill-help','Plot fill',`    <p>${blocked?'Object fill is None. Enable a fill mode on the object to use element fill settings.':mixed?'Individual SVG elements have fill settings. Choose None to disable all fills in this object.':s.mode === 'none' ? (s.outline ? 'Draw boundary removes overlap seams within each element and draws outer and hole boundaries, without interior fill.' : item.text?.format === 'openplotfont' ? 'Enable Draw boundary or choose a fill mode for filled OpenPlotFont regions. Centerline strokes retain their original paths.' : 'None draws original outlines. Enable Draw boundary for cleaned perimeters without interior fill.') : `Stroke spacing: ${spacing} mm. Interior marks stay inside the shape.`} An outline extends half its stroke width outside the boundary.</p><p>Add a calibration swatch, compare it on your paper, then choose an overlap preset.</p>`)}<div class="panel-body ${appInspector["panel-body"]} ">${color}${propertyField({label:'Fill mode',prefix:'Fill',type:'select',value:mixed?'elements':s.mode,attributes:{'data-fill-setting':'mode',disabled:blocked},options:[...(mixed?[{value:'elements',label:'Element fills',disabled:true}]:[]),...(['none','solid','hatch','crosshatch'] as const).map(value=>({value,label:{none:'None',solid:'Solid',hatch:'Hatch',crosshatch:'Crosshatch'}[value]}))]})}
    <div class="two-col ${appField['two-col']}">${numeric('width','Drawn line width','W','mm',.05,20,.05,s.width)}${numeric('angle','Angle','Deg','°',-360,360,1,s.angle)}</div>
    ${s.mode === 'solid' || s.mode === 'none' ? numeric('overlap','Overlap','Overlap','%',0,80,1,s.overlap*100) : numeric('gap','Clear gap','Gap','mm',0,100,.1,s.gap)}
    <div class="two-col ${appField['two-col']}">${checkbox('Boundary', s.outline, { 'data-fill-setting':'outline', 'aria-label':'Draw boundary', disabled:disabledParameters })}
    ${checkbox('Connect', s.connect, { 'data-fill-setting':'connect', 'aria-label':'Connect strokes', disabled:disabledParameters })}</div>

    ${blocked || mixed ? `<p class="field-help ${dsField['field-help']}" data-fill-availability>${blocked ? 'Enable a fill mode on the object to edit element fills.' : 'Element fills are active. Choose None to disable them.'}</p>` : ''}
    <button class="button ${dsButton["button"]} " data-action="fill-calibration" ${disabledParameters?'disabled':''}>Calibration…</button>
    <div class="fill-calibration-options ${appInspector["fill-calibration-options"]} ">${[0,.1,.15,.2].map(v=>`<button class="button ${dsButton["button"]} " data-fill-overlap="${v}" ${disabledParameters?'disabled':''}>Use ${v*100}%</button>`).join('')}</div>
    <p class="field-help ${dsField["field-help"]} " data-fill-status role="status">${escapeHtml(fillStatus === 'Generating fill…' ? '' : fillStatus)}</p><p class="field-help ${dsField["field-help"]} " data-fill-stats>${escapeHtml(fillStats)}</p></div></details>`;
}
function fillProgressMarkup(floating = false): string {
  const task = fillTask;
  const percent = task?.fraction === undefined ? undefined : Math.round(task.fraction * 100);
  return `<div class="fill-task-progress ${appField["fill-task-progress"]} ${floating ? `fill-task-floating ${appCanvas['fill-task-floating']}` : ''}" data-fill-progress ${task ? '' : 'hidden'}>
    <div class="fill-task-heading ${appField["fill-task-heading"]} "><span data-fill-task-label aria-live="polite">${escapeHtml(task?.label ?? '')}</span><span data-fill-task-percent aria-hidden="true">${percent === undefined ? '' : `${percent}%`}</span></div>
    <progress max="100" ${percent === undefined ? '' : `value="${percent}"`} aria-label="${escapeHtml(task?.label ?? 'Fill task progress')}"></progress>
    ${floating ? `<button class="button ${dsButton["button"]} " data-action="cancel-fill-task">Cancel task</button>` : ''}
  </div>`;
}
return { inspectorSection, colorControl, selectionPanelMarkup, inspectorMarkup, objectsMarkup, elementList, elementInspector, nodeInspector, typographyControls, textDialogMarkup, paperOptions, canvasDialogMarkup, fillControls, fillProgressMarkup };
}
