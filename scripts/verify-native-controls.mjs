// Run through the project's browser verifier against an isolated editor origin.
// Never use this fixture on a user's live document or connect hardware.
async (page) => {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const dimensions = async () => {
    const boxes = await page.locator('input[type=checkbox]').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).map(node => {
      const box = node.getBoundingClientRect();
      return { label: node.getAttribute('aria-label'), width: box.width, height: box.height, padding: getComputedStyle(node).padding };
    }));
    assert(boxes.length, 'No checkbox controls exercised');
    for (const box of boxes) assert(box.width === 16 && box.height === 16 && box.padding === '0px', `Incorrect checkbox geometry: ${JSON.stringify(box)}`);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal page overflow');
  };
  await page.setViewportSize({width:1440,height:960});
  await page.getByRole('button',{name:'Text',exact:true}).click();
  await page.getByRole('button',{name:/^Choose font,/}).last().click();
  await page.getByRole('combobox',{name:'Search fonts',exact:true}).fill('Inter Regular');
  await page.getByRole('option',{name:'Inter Regular Outlines · Outline fonts',exact:true}).click();
  await page.locator('#text-dialog').getByRole('checkbox',{name:'Kerning',exact:true}).waitFor();
  await dimensions();
  const check = page.locator('#text-dialog').getByRole('checkbox',{name:'Kerning',exact:true});
  await check.focus(); await page.keyboard.press('Space'); assert(!(await check.isChecked()), 'Space did not toggle Kerning');
  await page.locator('label').filter({has:check}).click(); assert(await check.isChecked(), 'Checkbox label did not toggle Kerning');
  await page.locator('#text-dialog').getByRole('textbox',{name:'Text',exact:true}).fill('UI checks');
  await page.getByRole('button',{name:'Add to canvas',exact:true}).click();
  await page.getByRole('checkbox',{name:'Draw boundary',exact:true}).waitFor();
  await dimensions();
  for (const theme of ['light','dark']) {
    await page.getByRole('button',{name:'Main menu',exact:true}).click();
    await page.getByRole('combobox',{name:'Interface theme',exact:true}).selectOption(theme);
    await page.keyboard.press('Escape');
    for (const width of [1440,768,640,390,320]) {
      await page.setViewportSize({width,height:960});await settle();
      if(width<640) await page.getByRole('button',{name:'Inspector',exact:true}).click();
      await dimensions();
      if(width<640) {
        const labels=await page.locator('label.check').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length).map(n=>n.getBoundingClientRect().height));
        assert(labels.every(height=>height>=44),'Checkbox row lacks a touch target');
        await page.keyboard.press('Escape');
        assert(await page.getByRole('button',{name:'Inspector',exact:true}).evaluate(n=>n===document.activeElement),'Drawer did not return focus');
      }
    }
    await page.setViewportSize({width:1440,height:960});
    await page.getByRole('radio',{name:'Plot',exact:true}).click();
    assert(!(await page.locator('.plot-sidebar-head').count()), 'Redundant Plot header remains');
    const plotSettings = page.locator('[data-section="plot-settings"] > summary');
    await plotSettings.press('Enter');
    assert(!(await page.locator('[data-section="plot-settings"]').evaluate(node=>node.open)), 'Enter did not collapse Plot settings');
    await plotSettings.press('Tab');
    assert(await page.locator('[data-section="pens"] > summary').evaluate(node=>node===document.activeElement), 'Tab entered a collapsed section');
    await plotSettings.press('Space');
    assert(await page.locator('[data-section="plot-settings"]').evaluate(node=>node.open), 'Space did not expand Plot settings');
    assert(!(await page.locator('[data-section="pens"] details').count()), 'Pens & passes still has nested disclosure');
    assert(!(await page.locator('[data-section="diagnostics"]').evaluate(node=>node.open)), 'Diagnostics should start collapsed');
    await page.getByRole('combobox',{name:'Destination',exact:true}).selectOption('machine');
    await page.locator('[data-section="pen"]').waitFor({state:'visible'});
    assert(!(await page.locator('[data-section="pen"] details').count()), 'Pen controls still have nested disclosure');
    assert(!(await page.getByRole('button',{name:'Pen up',exact:true}).isEnabled()), 'Disconnected pen control is enabled');
    assert(!(await page.locator('[data-section="pen"] [data-plot-action="machine-log"]').count()), 'Machine log remains in Pen controls');
    await page.getByRole('combobox',{name:'Destination',exact:true}).selectOption('');
    await page.locator('summary').filter({hasText:/^Advanced$/}).click();
    await dimensions();
    await page.getByRole('button',{name:'Simulate',exact:true}).click();
    await page.getByRole('button',{name:'Pause',exact:true}).waitFor({state:'visible'});
    assert(await page.locator('[data-edit-control]').first().evaluate(n=>n.inert), 'Plot failed to lock editing');
    await page.getByRole('button',{name:'Stop',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Stopped'}).waitFor();
    await page.getByRole('radio',{name:'Edit',exact:true}).click();
  }
  assert(!errors.length,errors.join('\n'));
  return {passed:true,themes:['light','dark'],widths:[1440,768,640,390,320]};
}
