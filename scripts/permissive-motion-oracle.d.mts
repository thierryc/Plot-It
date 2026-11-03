import type {Checkpoint,ExecutablePlan,MachineProfile,NativePoint,Path,Point} from '@thierryc/plotter-core';
export function quantizeIndependent(point:Point,profile:MachineProfile):NativePoint;
export function inspectExecutable(plan:ExecutablePlan,paths:readonly Path[],options?:{minimumPenDwellMs?:number;checkCoverage?:boolean}):{
 durationMs:number;drawingMm:number;travelMm:number;endpoint:NativePoint;toolOrder:string[];records:number;
};
export function inspectCheckpoint(checkpoint:Checkpoint,plan:ExecutablePlan):void;
export function inspectTrace(trace:readonly {phase:string;timeMs:number;command:string}[]):void;
