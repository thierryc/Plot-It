import { describe, expect, it } from 'vitest';
import { resolveFillSettings, effectiveFill } from './fill-dom';
import { defaultFillSettings, type ArtworkItem, type FillSettings } from './model';
const setting=(mode:FillSettings['mode']):FillSettings=>({...defaultFillSettings,mode,width:.5});
describe('effective plot fill modes',()=>{
 it('defaults unconfigured shapes to None',()=>{expect(resolveFillSettings().mode).toBe('none');});
 it('makes explicit object None override all element patterns without changing saved settings',()=>{
  const off=setting('none');for(const mode of ['solid','hatch','crosshatch'] as const){const child=setting(mode),saved=structuredClone(child);expect(resolveFillSettings(off,child).mode).toBe('none');expect(child).toEqual(saved);}
 });
 it('allows element fills without an object setting',()=>{expect(resolveFillSettings(undefined,setting('hatch')).mode).toBe('hatch');});
 it('retains ordinary element precedence on enabled objects',()=>{
  expect(resolveFillSettings(setting('solid'),setting('crosshatch')).mode).toBe('crosshatch');
  expect(resolveFillSettings(setting('solid'),setting('none')).mode).toBe('none');
  expect(resolveFillSettings(setting('hatch')).mode).toBe('hatch');
 });
 it('does not parse disabled descendant settings',()=>{
  const item={fillSettings:setting('none')} as ArtworkItem;
  const element={getAttribute:()=>{throw Error('Disabled descendants must not be parsed');}} as unknown as Element;
  expect(effectiveFill(item,element).mode).toBe('none');
 });
 it('restores saved child settings after re-enabling the object',()=>{
  const child=setting('crosshatch');expect(resolveFillSettings(setting('none'),child).mode).toBe('none');
  expect(resolveFillSettings(setting('solid'),child)).toEqual(child);
 });
 it('permits boundary-only None settings while keeping object None above child patterns',()=>{
  const boundary={...setting('none'),outline:true};
  expect(resolveFillSettings(boundary,setting('solid'))).toEqual(boundary);
  expect(resolveFillSettings(undefined,boundary)).toEqual(boundary);
 });
 it('preserves original OpenPlotFont strokes when object boundary-only mode is enabled',()=>{
  const item={fillSettings:{...setting('none'),outline:true}} as ArtworkItem;
  const element={getAttribute:()=> 'stroke'} as unknown as Element;
  expect(effectiveFill(item,element)).toEqual(defaultFillSettings);
 });
});
