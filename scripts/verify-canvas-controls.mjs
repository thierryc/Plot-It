// Run via playwright-cli run-code --filename against an isolated Vite origin.
async (page) => {
  await page.setViewportSize({ width: 1031, height: 983 });
  await page.evaluate(() => localStorage.removeItem('plot-it-document'));
  await page.reload();
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const near = (a, b) => Math.abs(a - b) < 1e-5;
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('plot-it-document')));
  const undo = () => page.getByRole('button', { name: 'Undo', exact: true }).click();
  const redo = () => page.getByRole('button', { name: 'Redo', exact: true }).click();
  const title = () => page.locator('[data-document-name]');
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await title().dblclick();
  await page.getByRole('textbox', { name: 'Plot name', exact: true }).fill('Canvas controls');
  await page.getByRole('textbox', { name: 'Plot name', exact: true }).press('Enter');
  assert((await state()).documentName === 'Canvas controls', 'Title was not saved');
  await page.keyboard.press('Escape');
  await undo(); assert(await title().textContent() === 'Untitled plot', 'Title undo failed');
  await redo(); assert(await title().textContent() === 'Canvas controls', 'Title redo failed');
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await title().dblclick();
  await page.getByRole('textbox', { name: 'Plot name', exact: true }).fill('Cancel this');
  await page.getByRole('textbox', { name: 'Plot name', exact: true }).press('Escape');
  assert(await title().textContent() === 'Canvas controls', 'Title cancellation failed');
  await page.keyboard.press('Escape');
  await page.reload(); assert(await title().textContent() === 'Canvas controls', 'Title restoration failed');
  const insert = async name => {
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    await page.getByRole('button', { name, exact: true }).click();
  };
  for (const name of ['Rectangle', 'Ellipse', 'Triangle', 'Line']) await insert(name);
  assert((await state()).items.length === 4, 'Shape insertion failed');
  await page.evaluate(async () => {
    const { parsePlotIt, serializePlotIt } = await import('/src/document-file.ts');
    const saved = JSON.parse(localStorage.getItem('plot-it-document'));
    const restored = parsePlotIt(serializePlotIt(saved)).state;
    if (restored.documentName !== saved.documentName || restored.items.length !== 4) throw Error('Document round-trip failed');
    const { flattenPlotPaths } = await import('/src/svg.ts');
    const paths = flattenPlotPaths(document.querySelector('#paper'));
    if (paths.length !== 4 || paths.some(path => path.points.length < 2)) throw Error('Shapes are not plottable');
  });
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  assert((await download).suggestedFilename() === 'Canvas controls.plit.json', 'Save ignored the title');
  // Deleting clears selection, so select remaining added shapes explicitly.
  while ((await state()).items.length > 1) {
    await page.locator('[data-select-item]').last().click(); await page.keyboard.press('Delete');
  }
  await page.locator('[data-select-item]').first().click();
  const original = (await state()).items[0];
  const center = async () => {
    const box = await page.locator('#paper [data-item-id]').boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const startDrag = async () => {
    const p = await center(); await page.mouse.move(p.x, p.y); await page.mouse.down(); return p;
  };
  // Gesture previews are coalesced on animation frames; sample after paint.
  const nextFrame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  const livePosition = async () => {
    await nextFrame();
    return page.locator('#paper [data-item-id]').evaluate(group => {
    const match = group.getAttribute('transform').match(/^translate\(([^ ]+) ([^)]+)\)/);
    return { x: Number(match[1]), y: Number(match[2]) };
    });
  };
  let p = await startDrag();
  await page.keyboard.down('Shift'); await page.mouse.move(p.x + 40, p.y + 12); await page.mouse.up(); await page.keyboard.up('Shift');
  let item = (await state()).items[0];
  assert(item.x > original.x && near(item.y, original.y), 'Horizontal constrained drag failed');
  await undo();
  p = await startDrag();
  await page.keyboard.down('Shift'); await page.mouse.move(p.x + 10, p.y - 30); await page.mouse.up(); await page.keyboard.up('Shift');
  item = (await state()).items[0];
  assert(near(item.x, original.x) && item.y < original.y, 'Vertical constrained drag failed');
  await undo();
  p = await startDrag(); await page.mouse.move(p.x + 35, p.y + 15);
  assert(!near((await livePosition()).y, original.y), 'Free drag was constrained');
  await page.keyboard.down('Shift');
  assert(near((await livePosition()).y, original.y), 'Pressing Shift mid-drag failed');
  await page.keyboard.up('Shift');
  assert(!near((await livePosition()).y, original.y), 'Releasing Shift mid-drag failed');
  await page.mouse.up(); await undo();
  const resize = async (shift, release = false) => {
    const box = await page.locator('[data-handle="se"]').boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.move(x + 35, y + 8);
    if (release) await page.keyboard.up('Shift');
    await page.mouse.up(); if (shift && !release) await page.keyboard.up('Shift');
  };
  await resize(true); item = (await state()).items[0];
  assert(near(item.width / item.height, original.width / original.height), 'Proportional object resize failed');
  assert(near(item.x, original.x) && near(item.y, original.y), 'Opposite object corner moved');
  await undo(); await resize(false); item = (await state()).items[0];
  assert(!near(item.width / item.height, original.width / original.height), 'Free resize was constrained');
  await undo(); await resize(true, true); item = (await state()).items[0];
  assert(!near(item.width / item.height, original.width / original.height), 'Releasing Shift mid-resize failed');
  await undo();
  // Rotated objects keep their own aspect ratio and opposite anchor.
  await page.locator('[data-item-prop="rotation"]').fill('37');
  await page.locator('[data-item-prop="rotation"]').press('Tab');
  await resize(true); item = (await state()).items[0];
  assert(near(item.width / item.height, original.width / original.height), 'Rotated proportional resize failed');
  await undo(); await undo();
  // Select the native SVG element: gestures modify its transform, not item dimensions.
  await page.locator('[data-select-element="0"]').click();
  const elementBounds = async () => {
    await nextFrame();
    return page.locator('.selection-ui .selection-box').evaluate(rect => ({
    x: Number(rect.getAttribute('x')), y: Number(rect.getAttribute('y')),
    width: Number(rect.getAttribute('width')), height: Number(rect.getAttribute('height'))
    }));
  };
  let before = await elementBounds(); await resize(true); let after = await elementBounds();
  assert(near(after.width / after.height, before.width / before.height), 'Proportional element resize failed');
  assert(near(after.x, before.x) && near(after.y, before.y), 'Opposite element corner moved');
  assert(near((await state()).items[0].width, original.width), 'Element resize changed object bounds');
  await undo(); await page.locator('[data-select-element="0"]').click();
  before = await elementBounds(); p = await startDrag();
  await page.keyboard.down('Shift'); await page.mouse.move(p.x - 25, p.y + 8);
  after = await elementBounds();
  assert(after.x < before.x && near(after.y, before.y), 'Constrained element drag failed');
  await page.mouse.up(); await page.keyboard.up('Shift');
  await undo(); await redo();
  await page.screenshot({ path: 'output/playwright/canvas-controls.png' });
  return { title: 'rename, cancellation, persistence, undo/redo, filename passed', shapes: '4 editable and plottable shapes passed', constraints: 'object, element, rotation, mid-gesture modifiers and undo/redo passed' };
}
