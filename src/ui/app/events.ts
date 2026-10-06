export function bindPlotEvents(root:HTMLElement, handlers:{ click:(event:Event)=>void; change:(event:Event)=>void; input:(event:Event)=>void; focusout:(event:Event)=>void; keydown:(event:KeyboardEvent)=>void }):()=>void {
  const controller=new AbortController(), options={signal:controller.signal};
  root.addEventListener('click',handlers.click,options);
  root.addEventListener('change',handlers.change,options);
  root.addEventListener('input',handlers.input,options);
  root.addEventListener('focusout',handlers.focusout,options);
  root.addEventListener('keydown',handlers.keydown,options);
  return ()=>controller.abort();
}

export function bindWorkspaceCommands(root:ParentNode, handlers:{ theme:(value:string)=>void; action:(name:string)=>void; tool:(name:string)=>void; setting:(input:HTMLInputElement|HTMLSelectElement)=>void }):void {
  root.querySelector<HTMLSelectElement>('[data-theme-select]')?.addEventListener('change',event=>handlers.theme((event.target as HTMLSelectElement).value));
  root.querySelectorAll<HTMLElement>('[data-action]').forEach(element=>element.addEventListener('click',()=>handlers.action(element.dataset.action!)));
  root.querySelectorAll<HTMLElement>('[data-tool]').forEach(element=>element.addEventListener('click',()=>handlers.tool(element.dataset.tool!)));
  root.querySelectorAll<HTMLInputElement|HTMLSelectElement>('[data-setting]').forEach(input=>input.addEventListener('change',()=>handlers.setting(input)));
}

/** Preserve native checkbox keyboard position when a controller replaces its view. */
export function captureCheckboxFocus(root: ParentNode): () => void {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement) || active.type !== 'checkbox' || !(root instanceof Node) || !root.contains(active)) return () => {};
  const key = ['data-typography', 'data-fill-setting', 'data-pen-include'].find(key => active.hasAttribute(key));
  if (!key) return () => {};
  const value = active.getAttribute(key)!;
  return () => {
    const target = [...root.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][${key}]`)].find(input => input.getAttribute(key) === value && !input.disabled && input.getClientRects().length);
    target?.focus({ preventScroll: true });
  };
}
