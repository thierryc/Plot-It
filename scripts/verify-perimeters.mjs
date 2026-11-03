// Run against an isolated local Vite page with playwright-cli run-code --filename.
// Uses real SVG geometry APIs and the application's actual geometry worker.
async (page) => {
  const report = await page.evaluate(async () => {
    const typography = await import('/src/typography.ts');
    const { defaultFillSettings } = await import('/src/model.ts');
    const { renderItem, flattenPlotPathsAsync } = await import('/src/svg.ts');
    const { FillPreview, awaitFills, fillPlotPaths, exportFilledSvg } = await import('/src/fill-dom.ts');
    const { WorkSlice } = await import('/src/cooperative.ts');
    const { elements, markupRoot, parsePath } = await import('/src/editor.ts');
    await typography.initializeTypography();
    await typography.ensureFontLoaded('inter');
    const report = [], fixtures = [];
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    const samePoints = (a, b) => a.length === b.length && a.every((p, i) => Math.hypot(p.x-b[i].x,p.y-b[i].y)<.00005);
    const closed = path => path.points.length > 2 && samePoints([path.points[0]], [path.points.at(-1)]);
    const text = (content, changes = {}) => typography.typographyToItem(content, 12, {...typography.defaultTextOptions, fontId:'inter', ...changes});
    const svgItem = (markup, fill = true) => ({id:`check-${crypto.randomUUID()}`,name:'SVG check',markup,viewBox:[0,0,20,20],x:20,y:20,width:20,height:20,rotation:0,stroke:'#000000',fillSettings:{...defaultFillSettings,mode:fill?'hatch':'none',outline:fill,connect:false}});
    function svgPoints(svg, paths) {
      const root = svg.getScreenCTM().inverse();
      return paths.map(path => {
        const transform = root.multiply(path.getScreenCTM());
        return parsePath(path.getAttribute('d')).filter(c=>c.type==='M'||c.type==='L').map(c=>{
          const p=new DOMPoint(...c.values).matrixTransform(transform);return {x:p.x,y:p.y};
        });
      });
    }
    async function run(name, items, verify) {
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('viewBox','0 0 200 200');svg.setAttribute('width','600');svg.setAttribute('height','600');
      svg.classList.add('paper');svg.style.cssText='position:fixed;left:-10000px;top:0';
      svg.innerHTML=`<g id="artwork-layer" fill="none" stroke="currentColor" stroke-width=".35">${items.map(item=>renderItem(item)).join('')}</g>`;
      document.body.append(svg);
      const preview=new FillPreview();fixtures.push({svg,preview});
      const source=JSON.stringify(items), notices=[];
      preview.update(svg,items,(status,error)=>{if(error) throw new Error(status);if(status)notices.push(status);});
      await awaitFills(svg);
      const generated=fillPlotPaths(svg), plotted=await flattenPlotPathsAsync(svg,new WorkSlice(),generated);
      const originalCount=items.reduce((n,item)=>n+elements(markupRoot(item.markup)).length,0);
      assert(elements(svg).length===originalCount,`${name}: generated paths entered editor indexing`);
      assert(JSON.stringify(items)===source,`${name}: editable source changed`);
      const shown=svgPoints(svg,[...svg.querySelectorAll('[data-generated-fill] path')]);
      assert(shown.length===generated.length,`${name}: preview path count mismatch`);
      generated.forEach((path,i)=>assert(samePoints(path.points,shown[i]),`${name}: preview vertex mismatch`));
      const generatedPlot=plotted.filter(path=>path.sourceKey);
      assert(generatedPlot.length===generated.length,`${name}: duplicate or missing plotting paths`);
      generated.forEach((path,i)=>assert(samePoints(path.points,generatedPlot[i].points),`${name}: plotter resampled boundary vertices`));
      const exported=exportFilledSvg(svg,200,200);
      assert(!/data-fill-source|data-generated-fill|data-opentype/.test(exported),`${name}: source metadata leaked into SVG export`);
      const exportedRoot=document.importNode(new DOMParser().parseFromString(exported,'image/svg+xml').documentElement,true);
      exportedRoot.style.cssText=svg.style.cssText;document.body.append(exportedRoot);
      const exportedPoints=svgPoints(exportedRoot,[...exportedRoot.querySelectorAll('path')]);
      for(const path of generated) assert(exportedPoints.some(points=>samePoints(points,path.points)),`${name}: missing SVG boundary vertices`);
      exportedRoot.remove();
      const before=fillPlotPaths(svg);svg.style.transform='scale(1.5)';
      preview.update(svg,items,()=>{});await awaitFills(svg);
      assert(generated.length ? fillPlotPaths(svg)===before : fillPlotPaths(svg).length===0,`${name}: zoom invalidated page-space cache`);
      await verify({svg,preview,generated,plotted,notices});
      report.push({name,paths:generated.length,vertices:generated.reduce((n,p)=>n+p.points.length,0)});
    }
    try {
      await run('Inter Hello', [text('Hello')],({generated,svg})=>{
        assert(generated.length===7,'Hello: outer boundaries and counters');
        assert(svg.querySelectorAll('[data-fill-source]').length===5,'Hello: suppress every glyph source');
        assert(generated.every(closed),'Hello: open boundary');
      });
      await run('Inter e counter', [text('e')],({generated})=>assert(generated.length===2,'e: lost counter'));
      await run('Inter BO counters', [text('BO')],({generated})=>assert(generated.length===5,'BO: lost counters'));
      await run('Inter tracking overlap', [text('HH',{letterSpacing:-.3})],({generated})=>assert(generated.length===1,'HH: internal letter seam'));
      await run('Inter heavy variable', [text('Hello',{variations:'wght=900'})],({generated})=>assert(generated.length===7,'heavy: lost counters'));
      const stretched=text('Hello');stretched.width*=3;stretched.rotation=23;
      await run('Inter anisotropic transform', [stretched],({generated})=>assert(generated.every(closed),'transformed: open boundary'));
      await run('Inter multiline overlap', [text('H\nH',{lineHeight:.5})],({generated})=>assert(generated.length===2,'stacked H: lost newly enclosed counter'));
      const colored=text('HH',{letterSpacing:-.3}),root=markupRoot(colored.markup);
      elements(root)[1].setAttribute('stroke','#ff0000');colored.markup=root.innerHTML;
      await run('Independent text pens', [colored],({generated})=>assert(generated.length===2&&new Set(generated.map(p=>p.tool)).size===2,'different pens were merged'));
      const mixed=text('HH',{letterSpacing:-.3}),mixedRoot=markupRoot(mixed.markup);
      mixed.fillSettings={...defaultFillSettings,mode:'hatch',outline:true,connect:false};
      elements(mixedRoot)[1].setAttribute('data-plot-fill',JSON.stringify({...defaultFillSettings,mode:'none'}));mixed.markup=mixedRoot.innerHTML;
      await run('Independent text fill settings', [mixed],({generated})=>assert(generated.filter(closed).length===2,'different fill settings were merged'));
      const filled=text('BO');filled.fillSettings={...defaultFillSettings,mode:'hatch',outline:true,connect:false};
      await run('Inter filled counters', [filled],({generated})=>assert(generated.filter(closed).length===5,'filled text: raw outlines leaked'));
      const overlap='M0 0H10V10H0Z M5 0H15V10H5Z';
      await run('SVG compound overlap', [svgItem(`<path d="${overlap}"/>`)],({generated})=>assert(generated.filter(closed).length===1,'SVG: raw overlap outlines'));
      const separate='<rect width="10" height="10"/><rect x="5" width="10" height="10"/>';
      await run('Independent SVG elements', [svgItem(separate)],({generated})=>assert(generated.filter(closed).length===2,'SVG elements were merged'));
      const star='M10 0L15.88 18.09L.49 6.91L19.51 6.91L4.12 18.09Z';
      for(const rule of ['nonzero','evenodd']) await run(`SVG inherited ${rule}`, [svgItem(`<g fill-rule="${rule}"><path d="${star}"/></g>`)],({generated})=>{
        const loops=generated.filter(closed);
        assert(loops.length===(rule==='nonzero'?1:5),`${rule}: wrong star boundaries`);
      });
      await run('Narrow SVG boundary', [svgItem('<rect width=".1" height="10"/>')],({generated,notices})=>{
        assert(generated.length===1&&closed(generated[0]),'narrow: lost boundary');assert(notices.some(n=>n.includes('too narrow')),'narrow: missing diagnostic');
      });
      await run('SVG mixed open linework', [svgItem('<path d="M0 0H10V10H0Z M15 0L15 10"/>')],({generated})=>{
        assert(generated.filter(closed).length===1,'mixed: boundary missing');assert(generated.some(p=>!closed(p)&&p.points.every(q=>Math.abs(q.x-35)<.001)),'mixed: open stroke missing');
      });
      await run('Unfilled SVG stays original', [svgItem(`<path d="${overlap}"/>`,false)],({generated,plotted})=>assert(generated.length===0&&plotted.length===2,'unfilled SVG was normalized'));
      const boundaryOnly=svgItem(`<path d="${overlap}"/>`,false);boundaryOnly.fillSettings.outline=true;boundaryOnly.fillSettings.width=.7;
      await run('None mode cleaned SVG boundary', [boundaryOnly],({generated})=>{
        assert(generated.length===1&&generated.every(closed),'None: boundary-only output includes interior strokes');
        assert(generated[0].width===.7,'None: ignored configured boundary width');
      });
      const elementOnly=svgItem('<path fill-rule="evenodd" d="M0 0H20V20H0Z M5 5H15V15H5Z"/>',false);
      delete elementOnly.fillSettings;
      const elementRoot=markupRoot(elementOnly.markup);elements(elementRoot)[0].setAttribute('data-plot-fill',JSON.stringify({...defaultFillSettings,mode:'none',outline:true}));elementOnly.markup=elementRoot.innerHTML;
      await run('Element-only None boundary and hole', [elementOnly],({generated})=>assert(generated.length===2&&generated.every(closed),'element None: lost boundary or counter'));
      await run('Cache invalidation and cancellation', [text('Hello')],async({svg,preview})=>{
        const item=text('Hello');svg.querySelector('#artwork-layer').innerHTML=renderItem(item);
        preview.update(svg,[item],()=>{});const obsolete=awaitFills(svg).then(()=>false,()=>true);
        item.width*=2;svg.querySelector('#artwork-layer').innerHTML=renderItem(item);
        preview.update(svg,[item],()=>{});await awaitFills(svg);
        assert(await obsolete,'obsolete geometry was not cancelled');
        assert(fillPlotPaths(svg).length===7,'updated geometry was not applied');
        const invalid={...item,x:100001};svg.querySelector('#artwork-layer').innerHTML=renderItem(invalid);
        preview.update(svg,[invalid],()=>{});
        let failed=false;try{await awaitFills(svg);}catch(error){failed=error.message.includes('bounds');}
        assert(failed,'worker geometry failure did not reject readiness');
        assert(fillPlotPaths(svg).length===0,'stale geometry survived failure');
        svg.querySelector('#artwork-layer').innerHTML=renderItem(item);preview.update(svg,[item],()=>{});await awaitFills(svg);
        assert(fillPlotPaths(svg).length===7,'geometry failure could not be retried');
      });
    } finally {
      for(const {svg,preview} of fixtures){preview.cancel();svg.remove();}
    }
    return report;
  });
  return report;
}
