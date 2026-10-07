import {describe,it,expect} from 'vitest';
import {build} from 'esbuild';
import {resolve} from 'node:path';
describe('portable plotting package boundary',()=>{
  it('bundles the public core for the browser without the editor or native serial bindings',async()=>{
    const bundled=await build({entryPoints:[resolve('packages/plotter-core/dist/index.js')],bundle:true,platform:'browser',format:'esm',write:false,metafile:true});
    const inputs=Object.keys(bundled.metafile!.inputs);
    expect(inputs.every(path=>path.startsWith('packages/plotter-core/dist/'))).toBe(true);
    expect(inputs.some(path=>path.includes('serialport')||path.includes('/browser.js')||path.includes('/node.js')||path.includes('/virtual/'))).toBe(false);
    expect(bundled.outputFiles[0]!.text).not.toMatch(/navigator\.|document\.|window\.|node:/);
  });
  it('imports the same public package in Node without DOM globals',async()=>{
    expect(typeof document).toBe('undefined');
    const core=await import('@thierryc/plotter-core');
    expect(core.toNative({x:.0125,y:.0125},core.machineProfile('axidraw',0))).toEqual({m1:1,m2:0});
    expect(typeof core.PlotterSession).toBe('function');
  });
});
