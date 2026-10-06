import { penTimingSettings } from './pen-control';
import type { MotionPlan } from './motion-plan';
import type { PlotSettings, Point } from './model';
import type { PlotProgress } from './plotter-core';
import type { PlotSignal } from './plot-signals';
import type { PowerStatus } from './ebb-power';
import { pathOptimizationSettings } from './path-optimization';

export const NETWORK_VERSION = 1;
export const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
export const DEFAULT_MAX_EVENTS = 100_000;
export const MAX_FRAME_BYTES = 64 * 1024;
export interface JobEnvelope { version: 1; requestId: string; plan: MotionPlan }
export type JobStatus = 'pending' | 'starting' | 'running' | 'pausing' | 'paused' | 'tool-change' | 'stopping' | 'returning' | 'finished' | 'stopped' | 'failed' | 'interrupted';
export interface JobRecord extends JobEnvelope { id: string; status: JobStatus; createdAt: string; startRequestId?: string; error?: string }
export interface NetworkSnapshot {
  epoch: string; revision: number; timestamp: number; connected: boolean; connecting: boolean;
  firmware: string | null; jobId: string | null; status: JobStatus | 'idle';
  progress: PlotProgress; position: Point | null; positionTimestamp: number | null;
  origin: 'unset' | 'automatic' | 'explicit'; originProfile: PlotSettings['profile'] | null;
  motorsOn: boolean; canAdjustPen: boolean; error?: string;
  connectionPolicy?: 'manual' | 'auto'; connectionDesired?: boolean;
  signal?: PlotSignal | null;
  power?: PowerStatus; elapsedMs?: number;
}
export const CONTROL_ACTIONS = ['start', 'pause', 'resume', 'continue', 'stop', 'cancel', 'pen', 'set-origin', 'return-origin', 'engage', 'release', 'invalidate-origin', 'diagnostics', 'check-power', 'connect-ebb', 'disconnect-ebb'] as const;
export type ControlAction = typeof CONTROL_ACTIONS[number];
export interface ControlRequest { version: 1; requestId: string; action: ControlAction | 'claim' | 'release-control'; jobId?: string; percent?: number; settings?: PlotSettings; profile?: PlotSettings['profile'] }
export interface ControlResult { type: 'result'; requestId: string; ok: boolean; error?: string; value?: unknown }
export const isId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
export const terminalStatus = (status: string) => ['finished', 'stopped', 'failed', 'interrupted'].includes(status);
function requireValue(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function number(value: unknown, min: number, max: number) { return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max; }
function point(value: unknown): value is Point {
  return !!value && typeof value === 'object' && number((value as Point).x, -1_000_000, 1_000_000) && number((value as Point).y, -1_000_000, 1_000_000);
}
export function validateSettings(value: unknown): PlotSettings {
  requireValue(value && typeof value === 'object', 'Missing plot settings'); const s = value as PlotSettings;
  requireValue(['axidraw', 'xylodraw'].includes(s.profile), 'Unsupported machine profile');
  requireValue(s.machineRotation === undefined || [0, 90, 180, 270].includes(s.machineRotation), 'Invalid machine rotation');
  for (const key of ['speed', 'travelSpeed', 'drawAcceleration', 'travelAcceleration'] as const) requireValue(number(s[key], Number.MIN_VALUE, 100_000), `Invalid ${key}`);
  for (const key of ['penUp', 'penDown'] as const) requireValue(number(s[key], 0, 100), `Invalid ${key}`);
  for (const key of ['cornering', 'margin', 'maxPenDownMm'] as const) requireValue(number(s[key], 0, 1_000_000), `Invalid ${key}`);
  requireValue(typeof s.returnToOrigin === 'boolean' && typeof s.pauseOnToolChange === 'boolean', 'Invalid execution flags');
  requireValue(['preserve', 'nearest', 'reversible'].includes(s.reorderMode), 'Invalid path ordering'); pathOptimizationSettings(s); penTimingSettings(s); return s;
}
/** Network inputs are untrusted even on a trusted LAN. No arbitrary serial commands. */
export function validateJob(value: unknown, limits: { maxEvents?: number } = {}): JobEnvelope {
  requireValue(value && typeof value === 'object', 'Invalid job'); const job = value as JobEnvelope;
  requireValue(job.version === 1 && isId(job.requestId), 'Unsupported job version or request ID');
  const p = job.plan; requireValue(p && typeof p === 'object', 'Missing plan'); validateSettings(p.settings);
  requireValue(Array.isArray(p.events) && p.events.length > 0 && p.events.length <= (limits.maxEvents ?? DEFAULT_MAX_EVENTS), 'Invalid event count');
  requireValue(Array.isArray(p.passes) && p.passes.length > 0 && p.passes.length <= p.events.length, 'Invalid pen passes');
  let duration = 0; let previous: Point | null = null; let penDown = false;
  for (const e of p.events) {
    requireValue(e && ['xy', 'pen', 'tool'].includes(e.kind), 'Invalid motion event');
    requireValue(point(e.from) && point(e.to), 'Invalid coordinates');
    requireValue(number(e.start, 0, 365 * 86400) && Math.abs(e.start - duration) < 1e-6, 'Discontinuous event time');
    requireValue(number(e.duration, 0, 86400) && number(e.initialSpeed, 0, 100_000) && number(e.acceleration, -100_000, 100_000), 'Invalid motion rates');
    requireValue(typeof e.penDown === 'boolean' && typeof e.tool === 'string' && e.tool.length <= 256, 'Invalid pen event');
    if (previous) requireValue(Math.hypot(e.from.x - previous.x, e.from.y - previous.y) < 1e-6, 'Discontinuous motion path');
    if (e.kind === 'xy') {
      requireValue(e.penDown === penDown, 'Motion pen state does not match pen commands');
      requireValue(e.duration > 0, 'Zero-duration motion');
      const length = Math.hypot(e.to.x - e.from.x, e.to.y - e.from.y);
      const distance = e.initialSpeed * e.duration + .5 * e.acceleration * e.duration ** 2;
      requireValue(e.initialSpeed + e.acceleration * e.duration >= -1e-6 && Math.abs(distance - length) < Math.max(1e-5, length * 1e-6), 'Inconsistent motion acceleration');
    } else {
      requireValue(Math.hypot(e.to.x - e.from.x, e.to.y - e.from.y) < 1e-6 && e.initialSpeed === 0 && e.acceleration === 0, 'Pen event moves axes');
      if (e.kind === 'pen') penDown = e.penDown;
      else requireValue(!penDown && !e.penDown && e.duration === 0 && Math.hypot(e.from.x, e.from.y) < 1e-6, 'Tool change requires pen up at origin');
    }
    duration += e.duration; previous = e.to;
  }
  requireValue(number(p.duration, 0, 365 * 86400) && Math.abs(p.duration - duration) < 1e-6, 'Invalid plan duration');
  // The planner's initial pen-up preparation precedes the first pass range.
  let end = p.events[0]?.kind === 'pen' && !p.events[0].penDown ? 1 : 0;
  for (const pass of p.passes) {
    requireValue(pass && typeof pass.tool === 'string' && pass.tool.length <= 256 && Number.isInteger(pass.startEvent) && Number.isInteger(pass.endEvent), 'Invalid pass');
    requireValue(pass.startEvent === end && pass.endEvent > pass.startEvent && pass.endEvent <= p.events.length, 'Invalid pass range');
    requireValue(number(pass.start, 0, duration) && number(pass.end, pass.start, duration), 'Invalid pass time'); end = pass.endEvent;
    const first = p.events[pass.startEvent]!, last = p.events[pass.endEvent - 1]!;
    requireValue(Math.abs(first.start - pass.start) < 1e-6 && Math.abs(last.start + last.duration - pass.end) < 1e-6, 'Pass time does not match events');
    requireValue(p.events.slice(pass.startEvent, pass.endEvent).every(e => e.tool === pass.tool), 'Pass tool does not match events');
    if (pass !== p.passes[0]) requireValue(first.kind === 'tool', 'Missing explicit pen change');
  }
  requireValue(end === p.events.length, 'Passes do not cover the job');
  if (p.pens !== undefined) requireValue(Array.isArray(p.pens) && p.pens.length <= p.passes.length + 1000 && p.pens.every(pen => pen && /^#[a-fA-F0-9]{6}$/.test(pen.color) && typeof pen.name === 'string' && pen.name.length <= 256 && Array.isArray(pen.sources) && pen.sources.length <= 1000 && pen.sources.every(source => typeof source === 'string' && source.length <= 256) && typeof pen.included === 'boolean'), 'Invalid pen metadata');
  return job;
}
export function validateControl(value: unknown): ControlRequest {
  requireValue(value && typeof value === 'object', 'Invalid control request'); const request = value as ControlRequest;
  requireValue(request.version === 1 && isId(request.requestId), 'Invalid control version or ID');
  requireValue([...CONTROL_ACTIONS, 'claim', 'release-control'].includes(request.action), 'Unsupported control');
  if (request.action === 'start') requireValue(isId(request.jobId), 'Invalid job ID');
  if (request.action === 'pen') requireValue(number(request.percent, 0, 100), 'Invalid pen height');
  if (request.action === 'pen' && request.settings !== undefined) validateSettings(request.settings);
  if (request.action === 'disconnect-ebb') validateSettings(request.settings);
  if (['return-origin', 'release'].includes(request.action)) validateSettings(request.settings);
  if (request.action === 'set-origin') requireValue(['axidraw', 'xylodraw'].includes(request.profile!), 'Invalid machine profile');
  return request;
}
