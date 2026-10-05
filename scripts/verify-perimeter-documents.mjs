// Run with playwright-cli run-code --filename in an isolated local Vite page.
async (page) => {
  await page.evaluate(()=>localStorage.removeItem('plot-it-document'));
  await page.reload();
  await page.getByRole('button',{name:'Text',exact:true}).click();
  await page.locator('#text-value').fill('Hello');
  await page.locator('#text-size').fill('24');
  await page.locator('#text-form [data-typography="fontId"]').selectOption('inter');
  await page.getByRole('button',{name:'Add to canvas',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('#paper [data-fill-source]').length===5);
  const fixture = await page.evaluate(async()=>{
    const fillUrl=performance.getEntriesByType('resource').filter(r=>r.name.includes('/src/fill-dom.ts?')).at(-1)?.name??'/src/fill-dom.ts';
    const {awaitFills,fillPlotPaths}=await import(fillUrl);
    const {elements,markupRoot,parsePath,pathData}=await import('/src/editor.ts');
    const {splitContours}=await import('/src/typography.ts');
    await awaitFills(document.querySelector('#paper'));
    if(fillPlotPaths(document.querySelector('#paper')).length!==7)throw Error('UI Hello lost boundary loops');
    const state=JSON.parse(localStorage.getItem('plot-it-document'));
    const legacy=structuredClone(state.items[0]);legacy.name='Imported legacy text';
    legacy.markup=elements(markupRoot(legacy.markup)).flatMap(p=>splitContours(parsePath(p.getAttribute('d'))).map(c=>`<path d="${pathData(c)}"/>`)).join('');
    return {state,legacy};
  });
  async function load(item) {
    const source=JSON.stringify({format:'plot-it',version:1,units:'mm',document:{...fixture.state,items:[item]},fonts:[]});
    await page.evaluate(source=>{
      const input=document.querySelector('#document-input'),transfer=new DataTransfer();
      transfer.items.add(new File([source],'perimeter-check.plit.json',{type:'application/json'}));
      input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    },source);
    await page.waitForFunction(name=>JSON.parse(localStorage.getItem('plot-it-document')).items[0]?.name===name,item.name);
  }
  await load(fixture.legacy);
  const migrated=await page.evaluate(()=>JSON.parse(localStorage.getItem('plot-it-document')).items[0]);
  if(!migrated.markup.includes('data-opentype-outline'))throw Error('Document import failed to migrate');
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('plot-it-document')).items[0].name==='Hello');
  await page.getByRole('button',{name:'Redo',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('plot-it-document')).items[0].name==='Imported legacy text');
  const modified={...fixture.legacy,name:'Modified legacy text',markup:fixture.legacy.markup.replace(/M[\d.-]+/,'M999')};
  await load(modified);
  const preserved=await page.evaluate(()=>JSON.parse(localStorage.getItem('plot-it-document')).items[0]);
  if(preserved.markup.includes('data-opentype-outline'))throw Error('Node edits were overwritten');
  if(!await page.locator('.toast').textContent().then(text=>text.includes('stored outlines were preserved')))throw Error('Missing preservation notice');
  const unavailable={...fixture.legacy,name:'Unavailable font',text:{...fixture.legacy.text,options:{...fixture.legacy.text.options,fontId:'missing-check'}}};
  await load(unavailable);
  const fallback=await page.evaluate(()=>JSON.parse(localStorage.getItem('plot-it-document')).items[0]);
  if(fallback.markup.includes('data-opentype-outline'))throw Error('Unavailable font fallback was replaced');
  await page.evaluate(({state,legacy})=>{
    localStorage.setItem('plot-it-document',JSON.stringify({...state,items:[legacy]}));
  },fixture);
  await page.reload();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('plot-it-document')).items[0].markup.includes('data-opentype-outline'));
  await page.waitForFunction(()=>document.querySelectorAll('#paper [data-generated-fill] path').length===7);
  const result = await page.evaluate(async()=>{
    const fillUrl=performance.getEntriesByType('resource').filter(r=>r.name.includes('/src/fill-dom.ts?')).at(-1)?.name??'/src/fill-dom.ts';
    const {awaitFills}=await import(fillUrl);await awaitFills(document.querySelector('#paper'));
    const jobUrl=performance.getEntriesByType('resource').filter(r=>r.name.includes('/src/plot-job.ts?')).at(-1)?.name??'/src/plot-job.ts';
    const {prepareJob}=await import(jobUrl);
    const state=JSON.parse(localStorage.getItem('plot-it-document'));
    const job=prepareJob(document.querySelector('#paper'),state.paper,state.settings,undefined,state.pens);
    const plan=await job.promise;
    if(!plan.events.some(event=>event.kind==='xy'&&event.penDown))throw Error('No drawing motion events from cleaned text');
    if(plan.events.filter(event=>event.kind==='pen'&&event.penDown).length!==7)throw Error('Boundary loops did not retain separate pen-down strokes');
    return {ui:'Inter Hello',documentImport:'passed',undoRedo:'passed',nodeEdits:'preserved',missingFont:'preserved',startupMigration:'passed',motionEvents:plan.events.length};
  });
  await page.screenshot({path:'output/playwright/inter-resolved-perimeter.png'});
  return result;
}
