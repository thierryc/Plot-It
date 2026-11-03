export interface Point { x: number; y: number }
export interface NativePoint { m1: number; m2: number }
export type Rotation = 0 | 90 | 180 | 270;
export interface Clock { now(): number; sleep(ms: number): Promise<void>; schedule(ms:number,callback:()=>void):()=>void }
/** Already opened. Permission, discovery and platform streams belong to adapters. */
export interface ByteTransport {
  write(bytes: Uint8Array): Promise<void>;
  read(): Promise<Uint8Array | null>;
  close(): Promise<void>;
  onDisconnect?(listener:()=>void):()=>void;
}
export interface MachineProfile {
  id: string; stepsPerMm: number; motorMode: 1 | 2;
  rotation: Rotation; servoPin: number; servoMin: number; servoMax: number;
  servoChannels: number; servoPeriod: number;
  /** Controller pulse units per refresh per user rate point, independent of dwell. */
  servoRateScale:number;
  /** Provisional engineering allowances, not measured mechanical response. */
  servoSettleUpMs:number;servoSettleDownMs:number;servoStartupMs:number;
  bounds?: { width: number; height: number }; servoKind?: 'standard' | 'brushless';
  homing?: 'nextdraw';
  toolOutputB3?:boolean;
}
export interface PenSettings {
  timingModel:string;
  up: number; down: number; raiseRate: number; lowerRate: number;
  upDelayMs: number; downDelayMs: number; reloadWaitMs: number;
  synchronizedB3?:boolean;servoTimeoutMs?:number;
}
/** Trial workload budgets, not firmware limits. Absence preserves continuous strokes. */
export interface WorkloadCheckpointLimits { maxDrawingRecords:number; maxDrawingMs:number; maxDrawingMm:number }
export interface WorkloadChunkIdentity { sourceId:string; strokeIndex:number; reloadIndex:number; chunkIndex:number; sourceFromMm:number; sourceToMm:number }
export interface WorkloadCheckpointPreview { cuts:readonly {point:Point;identity:WorkloadChunkIdentity}[]; chunkCount:number; addedDurationMs:number }
export interface PlotOptions {
  profile: MachineProfile; pen: PenSettings; speed: number; travelSpeed: number;
  acceleration: number; travelAcceleration: number; cornering: number;
  maxPenDownMm: number; returnToOrigin: boolean; drawingMode: 'profiled' | 'constant';
  backend?: 'sm' | 't3'; firmware?: string; drawingJerk?: number; travelJerk?: number;
  handling?: 'custom' | 'technical' | 'handwriting' | 'sketching'; curveToleranceMm?: number;
  /** Independent of the controller backend. Dynamic v1 requires T3 on 3.1.7. */
  motionStrategy?: 'standard' | 'dynamic';
  dynamicCurveAcceleration?: number; dynamicAnticipationMm?: number;
  workloadCheckpoints?:WorkloadCheckpointLimits;
}
export type MotionReason = 'curve' | 'junction' | 'stop' | 'acceleration';
export interface Path { points: readonly Point[]; tool: string; width?: number;sourceId?:string;sourceOrder?:number;layerId?:string }
interface RecordBase { id: number; startMs: number; durationMs: number; tool: string; from: Point; to: Point; penDown: boolean;settings?:PlotOptions;label?:string }
export interface MotorRecord extends RecordBase {
  kind: 'motor'; fromSteps: NativePoint; toSteps: NativePoint;
  /** Zero-speed boundary where pause/stop can be serviced without cutting a ramp. */
  restBefore: boolean; width?: number;
  native?: NativeMotion;sourceId?:string;workloadChunk?:WorkloadChunkIdentity;
  /** Advisory Dynamic planner explanation, not a physical measurement. */
  motionReason?: MotionReason;
}
export interface AxisParameters { rate: number; acceleration: number; jerk: number }
export interface T3Parameters { ticks: number; axis1: AxisParameters; axis2: AxisParameters; clear: number }
export interface NativeMotion {
  command: 'T3' | 'TD'; halves: readonly T3Parameters[];
  accumulatorsBefore: NativePoint; accumulatorsAfter: NativePoint;
}
export interface PenRecord extends RecordBase { kind: 'pen';reload?:boolean;workloadCheckpoint?:WorkloadChunkIdentity }
export interface ToolRecord extends RecordBase { kind: 'tool' }
export interface DelayRecord extends RecordBase {kind:'delay'}
export interface PauseRecord extends RecordBase {kind:'pause'}
export type ExecutionRecord = MotorRecord | PenRecord | ToolRecord | DelayRecord | PauseRecord;
export interface ExecutablePlan {
  version: 1; planningModel:string;timingModel:string;backend: 'sm' | 't3'; options: PlotOptions; records: readonly ExecutionRecord[];
  durationMs: number; drawingMm: number; travelMm: number;
  workloadCheckpoints?:WorkloadCheckpointPreview;
}
export interface Firmware { major: number; minor: number; patch: number; version: string; modern: boolean }
export type ErrorCode = 'disconnected' | 'protocol' | 'rejected' | 'unsupported-firmware' | 'busy' | 'origin' | 'power' | 'invalid-plan' | 'timeout';
export class PlotterError extends Error {
  constructor(public readonly code: ErrorCode, message: string) { super(message); this.name = 'PlotterError'; }
}
export type JobState = 'idle' | 'starting' | 'running' | 'pausing' | 'paused' | 'tool-change' | 'stopping' | 'returning' | 'finished' | 'stopped' | 'cancelled' | 'failed';
export interface PenConfirmation { penState: 'unknown' | 'up' | 'down'; penHeight?: number }
export interface SessionEvent {
  kind: 'state' | 'record' | 'record-range' | 'exchange' | 'position' | 'timing-extension' | 'queue-diagnostic' | 'telemetry' | 'pen-confirmation'; timeMs: number;
  /** Authoritative feeder observation, independent of compiled record settlement. */
  penConfirmation?: PenConfirmation;
  droppedDiagnostics?:number;
  minimumMs?:number;durationMs?:number;extensionMs?:number;
  state?: JobState; recordId?: number; /** Inclusive end, only for record-range. */ recordEndId?:number;
  queueCapacity?:number;queueMaximum?:number;queueOccupancy?:number;queueEntriesAccepted?:number;stackHighWater?:number; phase?: 'requested' | 'written' | 'received' | 'acknowledged' | 'started' | 'queued' | 'settled' | 'failed';
  command?: string; response?: string; position?: Point; error?: string;
}
export type Observer = (event: SessionEvent) => void | Promise<void>;
export function checked(value: number, min: number, max: number, name: string): number {
  if (!Number.isFinite(value) || value < min || value > max) throw new PlotterError('invalid-plan', `Invalid ${name}.`);
  return value;
}
