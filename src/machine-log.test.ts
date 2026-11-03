import {describe,expect,it} from 'vitest';
import {compactMachineLog} from './machine-log';
import {buildMotionPlan} from './motion-plan';
import {initialState} from './model';
import {executionFromEditor} from './plotter-adapter';
import type {PlotterJobTrace} from './plotter-core';

describe('machine log program dictionary',()=>{
  it('exports each executable once while retaining signals, checkpoint and source artwork',()=>{
    const plan=buildMotionPlan([{points:[{x:1,y:1},{x:2,y:2}],tool:'#111'}],initialState.settings),executable=executionFromEditor(plan).plan;
    const job:PlotterJobTrace={protocol:'ebb-native-t3-v2',startedAt:'test',firmware:'3.1.7',settings:initialState.settings,estimatedDuration:plan.duration,plan,executable,signals:[],droppedSignals:3,entries:[],droppedEntries:5,variants:[{copy:2,digest:'not trusted',program:structuredClone(executable)}]};
    const result=compactMachineLog({format:'test',job});
    expect(Object.keys(result.programs)).toHaveLength(1);
    const exported=result.job as {executableRef:string;plan:{executableRef:string};variants:{executableRef:string}[];droppedSignals:number};
    expect(exported.plan.executableRef).toBe(exported.executableRef);expect(exported.variants[0]!.executableRef).toBe(exported.executableRef);expect(exported.droppedSignals).toBe(3);
    expect(JSON.stringify(result).match(/"records":/g)).toHaveLength(1);
    expect(plan.events.length).toBeGreaterThan(0);expect(job.variants![0]!.program.records).toEqual(executable.records);
  });
});
