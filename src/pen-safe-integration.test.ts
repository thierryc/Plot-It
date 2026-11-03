import {describe,expect,it} from 'vitest';
import {VirtualClock} from '@thierryc/plotter-core/virtual';
import {PlotterCore} from './plotter-core';
import {initialState} from './model';
import {fakeTransport} from '../server/test-fixtures/fake-ebb';

const settings={...initialState.settings,profile:'xylodraw' as const,penUp:30,penDown:60};
const motionOrReset=/^(SM|XM|HM|LM|LT|L3|T3|TD|CS)(,|$)/;

describe('app facade with packaged safe RB1 driver',()=>{
 it('uses Up30/Down60 without S2, XY motion, or counter resets, including relax and rearm',async()=>{
  const fixture=fakeTransport('3.1.7'),core=new PlotterCore(fixture.transport,{clock:new VirtualClock()});
  core.configurePen(settings);
  await core.connect();
  const start=fixture.commands.length;
  await core.setPen(30);await core.setPen(60);await core.relax();await core.setPen(30);
  const manual=fixture.commands.slice(start);
  expect(manual).toContain('SP,2,0,1');
  expect(manual.some(command=>command.startsWith('SP,0,'))).toBe(true);
  expect(manual.filter(command=>command==='QG').length).toBeGreaterThanOrEqual(3);
  expect(manual.filter(command=>motionOrReset.test(command))).toEqual([]);
  expect(core.originStatus).toBe('unset');
  await core.disconnect();
  expect(fixture.commands.filter(command=>/^S2(,|$)/.test(command))).toEqual([]);
 });

 it('rejects a Down acknowledgement when QG still reports Up',async()=>{
  let rejectDown=false;
  const fixture=fakeTransport('3.1.7',undefined,command=>command==='QG'&&rejectDown?'QG,10':undefined);
  const core=new PlotterCore(fixture.transport,{clock:new VirtualClock()});
  core.configurePen(settings);await core.connect();await core.setPen(30);
  const start=fixture.commands.length;rejectDown=true;
  await expect(core.setPen(60)).rejects.toThrow('Controller pen state differs');
  expect(fixture.commands.slice(start).filter(command=>motionOrReset.test(command))).toEqual([]);
  rejectDown=false;await core.disconnect();
 });
});
