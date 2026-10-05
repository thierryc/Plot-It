// Run with playwright-cli run-code --filename in a fresh isolated Vite session.
async (page) => {
  await page.evaluate(()=>localStorage.removeItem('plot-it-document'));
  await page.reload();
  await page.evaluate(()=>{
    const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path fill-rule="nonzero" d="M0 0H10V10H0Z M5 0H15V10H5Z M2 2V4H4V2Z"/></svg>';
    const transfer=new DataTransfer();transfer.items.add(new File([svg],'overlap.svg',{type:'image/svg+xml'}));
    const input=document.querySelector('#file-input');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.waitForFunction(()=>document.querySelectorAll('#paper [data-item-id]').length===1);
  const source=await page.evaluate(()=>JSON.parse(localStorage.getItem('plot-it-document')).items[0].markup);
  if(!await page.locator('.fill-controls').evaluate(panel=>panel.open))await page.locator('.fill-controls > summary').click();
  await page.getByRole('checkbox',{name:'Draw boundary',exact:true}).check();
  await page.waitForFunction(()=>document.querySelectorAll('#paper [data-generated-fill] path').length===2);
  await page.locator('[data-fill-setting="width"]').fill('.6');
  await page.locator('[data-fill-setting="width"]').press('Tab');
  await page.waitForFunction(()=>[...document.querySelectorAll('#paper [data-generated-fill] path')].every(p=>p.getAttribute('stroke-width')==='0.6'));
  const result=await page.evaluate(async source=>{
    const state=JSON.parse(localStorage.getItem('plot-it-document')),item=state.items[0];
    if(item.fillSettings.mode!=='none'||!item.fillSettings.outline)throw Error('Boundary-only mode changed fill mode');
    if(item.markup!==source)throw Error('Boundary-only mode rewrote source geometry');
    const url=performance.getEntriesByType('resource').filter(r=>r.name.includes('/src/fill-dom.ts?')).at(-1)?.name??'/src/fill-dom.ts';
    const {awaitFills,fillPlotPaths,exportFilledSvg}=await import(url);
    const svg=document.querySelector('#paper');await awaitFills(svg);const paths=fillPlotPaths(svg);
    if(paths.length!==2||paths.some(p=>p.points[0].x!==p.points.at(-1).x||p.points[0].y!==p.points.at(-1).y))throw Error('Unexpected interior or open boundary strokes');
    const exported=exportFilledSvg(svg,state.paper.width,state.paper.height);
    if(new DOMParser().parseFromString(exported,'image/svg+xml').querySelectorAll('path').length!==2)throw Error('Export contains original seams or fill strokes');
    return {mode:item.fillSettings.mode,boundaryLoops:paths.length,width:paths[0].width,editableSource:'preserved',export:'passed'};
  },source);
  await page.getByRole('checkbox',{name:'Draw boundary',exact:true}).uncheck();
  await page.waitForFunction(()=>document.querySelectorAll('#paper [data-generated-fill] path').length===0);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('#paper [data-generated-fill] path').length===2);
  return {...result,toggleAndUndo:'passed'};
}
