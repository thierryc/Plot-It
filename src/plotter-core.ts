import type { PlotSettings, Point } from "./model";
import type { MotionPlan } from "./motion-plan";
import { compilePlotProcess, executePlotProcess, type PlotProcess } from './plot-process';
import { eventSignal, type PlotSignal } from './plot-signals';
import { canvasPoint, profileStepsPerMm } from "./motion";
import { DEFAULT_MACHINE_ROTATION } from './model';
import { PenState, SERVO_POWER_TIMEOUT_MS } from './pen-control';
import { EbbPen } from './ebb-pen';
import type { PenSettings } from './pen-control';
import { parsePowerStatus, unavailablePower, type PowerStatus } from './ebb-power';

export interface SerialPortInfo { usbVendorId?: number; usbProductId?: number }
export interface SerialPortLike {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  getInfo(): SerialPortInfo;
}

export interface SerialTransport {
  readonly supported: boolean;
  requestPort(): Promise<SerialPortLike>;
  addEventListener?(type: 'disconnect', listener: (event: Event) => void): void;
}
export interface ExecutionOptions { positionBudgetMs?: number; maxCompiledCommands?: number; sleep?: (durationMs: number) => Promise<void> }

export interface PlotProgress {
  completed: number;
  total: number;
  state: "idle" | "plotting" | "pausing" | "paused" | "tool-change" | "stopping" | "returning" | "stopped" | "cancelled" | "finished";
  tool?: string;
}
export interface PlotterTrace {
  time: number; elapsedMs?: number; commandId: number | null; command: string;
  reason: string; event: number; state: PlotProgress['state'];
  phase: 'requested' | 'written' | 'received' | 'acknowledged' | 'settled' | 'failed';
  pen: number | null; response?: string; error?: string;
}
export interface PlotterJobTrace {
  protocol: 'ebb-timed-sp-v1';
  startedAt: string; firmware: string | null; settings: PlotSettings; estimatedDuration: number;
  plan: MotionPlan; signals: PlotSignal[]; droppedSignals: number;
  entries: PlotterTrace[]; droppedEntries: number;
}
const JOB_TRACE_LIMIT = 20_000;

export class PlotterCore {
  private port: SerialPortLike | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private buffer = "";
  private ready = false;
  private connectingNow = false;
  private deviceLabel = "";
  public onConnectionChange: () => void = () => undefined;

  constructor(private readonly transport: SerialTransport, private readonly execution: ExecutionOptions = {}) {
    this.transport.addEventListener?.("disconnect", (event) => {
      if (event.target === this.port) {
        void this.cleanup().catch((error) => console.error("EBB disconnect cleanup failed", error));
      }
    });
  }
  private cancelRequested = false;
  private paused = false;
  private pausedSettled = false;
  private stopRequested = false;
  private readonly penState = new PenState();
  private readonly penDevice = new EbbPen(this.penState, {
    command: command => this.command(command), queued: duration => {
      this.noteQueuedMotion(duration); this.penIdleNotBefore = performance.now() + duration;
    },
    sleep: duration => this.execution.sleep?.(duration) ?? new Promise(resolve => setTimeout(resolve, duration)),
    now: () => performance.now(),
  });
  private traceEntries: PlotterTrace[] = [];
  private penTraceEntries: PlotterTrace[] = [];
  private jobTrace: PlotterJobTrace | null = null;
  private jobTraceStart = 0;
  private commandId = 0;
  private pendingCommand: {id:number; command:string} | null = null;
  private commandReason = 'connection';
  private penOperation: Promise<void> | null = null;
  private lastProgress: PlotProgress = { completed: 0, total: 0, state: "idle" };
  private emit(progress: PlotProgress): void { this.lastProgress = progress; this.onProgress(progress); }
  private busy = false;
  private positionKnown = false;
  private stepPosition: Point = { x: 0, y: 0 };
  private originProfile: PlotSettings["profile"] = "axidraw";
  private originSource: 'automatic' | 'explicit' = 'explicit';
  private motorsEngaged = false;
  private machineRotation: PlotSettings['machineRotation'] = DEFAULT_MACHINE_ROTATION;
  private resumeResolver: (() => void) | null = null;
  private firmware: [number, number, number] = [0, 0, 0];
  public onProgress: (progress: PlotProgress) => void = () => undefined;
  public onPosition: ((position: Point) => void) | null = null;
  public onSignal: (signal: PlotSignal) => void = () => undefined;
  private supply = unavailablePower();
  private lastPowerPoll = -Infinity;
  private elapsedStartedAt: number | null = null;
  private elapsedFinishedMs = 0;
  get powerStatus(): PowerStatus { return { ...this.supply }; }
  get elapsedMs(): number { return this.elapsedStartedAt === null ? this.elapsedFinishedMs : performance.now()-this.elapsedStartedAt; }
  private latestSignal: PlotSignal | null = null;
  get executionSignal(): PlotSignal | null { return this.latestSignal ? structuredClone(this.latestSignal) : null; }
  private lastPositionPoll = -Infinity;
  private positionFeedback = true;
  private expectedMotionIdleAt = 0;
  private penIdleNotBefore = 0;

  get canAdjustPen(): boolean { return this.connected && (!this.busy || (this.paused && this.pausedSettled && !this.stopRequested && !this.cancelRequested)) && !this.penOperation; }
  get active(): boolean { return this.busy; }
  get progress(): PlotProgress { return { ...this.lastProgress }; }
  get originAvailable(): boolean { return this.connected && this.positionKnown && !this.busy; }
  get supported(): boolean { return this.transport.supported; }
  get connected(): boolean { return this.ready; }
  get firmwareLabel(): string | null { return this.connected ? this.firmware.join(".") : null; }
  get connecting(): boolean { return this.connectingNow; }
  get originStatus(): 'unset' | 'automatic' | 'explicit' { return this.connected && this.positionKnown ? this.originSource : 'unset'; }
  get motorsOn(): boolean { return this.motorsEngaged; }
  hasOrigin(profile: PlotSettings['profile']): boolean { return this.connected && this.positionKnown && this.originProfile === profile; }
  invalidateOrigin(): void { this.assertIdle(); this.positionKnown = false; }
  get diagnosticTrace(): PlotterTrace[] { return this.traceEntries.map(entry => ({...entry})); }
  get diagnosticPenTrace(): PlotterTrace[] { return this.penTraceEntries.map(entry => ({...entry})); }
  get diagnosticJobTrace(): PlotterJobTrace | null { return this.jobTrace ? structuredClone(this.jobTrace) : null; }
  configurePen(settings: PenSettings): void {
    if (this.busy) throw new Error('Wait until the plotter is idle before changing pen heights.');
    this.penState.configure(settings);
  }
  private trace(command: string, phase: PlotterTrace['phase'], details: Pick<PlotterTrace,'response' | 'error'> = {}): void {
    const time = performance.now();
    const entry: PlotterTrace = {time,command,phase,commandId:this.pendingCommand?.command === command ? this.pendingCommand.id : null,
      reason:this.commandReason,event:this.lastProgress.completed,state:this.lastProgress.state,pen:this.penState.requested,...details};
    if (this.jobTrace) {
      entry.elapsedMs = time-this.jobTraceStart;
      this.jobTrace.entries.push(entry);
      if (this.jobTrace.entries.length > JOB_TRACE_LIMIT) {
        // Trim in batches so diagnostics don't shift a large array on each USB
        // command. The separate pen journal preserves important transitions.
        const drop = 2000;
        this.jobTrace.entries.splice(1000,drop); this.jobTrace.droppedEntries += drop;
      }
    }
    this.traceEntries.push(entry);
    if (this.traceEntries.length > 500) this.traceEntries.splice(0,this.traceEntries.length-500);
    // Long XM/QS/QG streams must not erase the pen commands needed to diagnose
    // an unexpected physical movement. Retain their own bounded journal.
    if (/^(S2|SC|SR|SP|TP|ES|EM)(,|$)/.test(command) || phase === 'settled' || phase === 'failed') {
      this.penTraceEntries.push(entry);
      if (this.penTraceEntries.length > 200) this.penTraceEntries.splice(0,this.penTraceEntries.length-200);
    }
  }

  async connect(): Promise<string> {
    if (this.connected) return this.deviceLabel;
    if (this.connectingNow) throw new Error("A plotter connection is already in progress.");
    if (!this.transport.supported) throw new Error("Web Serial is unavailable. Open Plot-it in desktop Chrome or Edge.");
    this.connectingNow = true;
    this.onConnectionChange();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const port = await this.transport.requestPort();
      try { await port.open({ baudRate: 9600 }); }
      catch (error) {
        console.error("EBB serial port opening failed", error);
        throw new Error("Could not open the EBB. Another app such as Saxi, or another browser tab, may be using it. Close that connection and retry.");
      }
      this.port = port;
      if (!port.readable || !port.writable) throw new Error("The serial port did not open correctly. Reconnect the EBB and retry.");
      this.buffer = "";
      this.writer = port.writable.getWriter();
      this.reader = port.readable.getReader();
      const version = await Promise.race([
        this.firmwareVersion(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("The EBB did not respond within five seconds. Reconnect it and retry.")), 5000);
        }),
      ]);
      const match = version.match(/^(?:V,)?(?:EBB|EBBv\d+_and_above EB) Firmware Version (\d+)\.(\d+)\.(\d+)(?:\b.*)?$/i);
      if (!match) throw new Error("The device did not return a valid EBB firmware version. Reconnect it and retry.");
      if (this.port !== port) throw new Error("The EBB disconnected while connecting. Reconnect it and retry.");
      this.firmware = [Number(match[1]), Number(match[2]), Number(match[3])];
      const info = port.getInfo();
      const vendor = info.usbVendorId?.toString(16).padStart(4, "0") ?? "unknown";
      const product = info.usbProductId?.toString(16).padStart(4, "0") ?? "unknown";
      this.deviceLabel = `${vendor}:${product} · ${version.replace(/^V,/, "")}`;
      this.ready = true;
      await this.pollPower(true);
      return this.deviceLabel;
    } catch (error) {
      await this.cleanup().catch((cleanupError) => console.error("EBB connection cleanup failed", cleanupError));
      throw error;
    } finally {
      clearTimeout(timer);
      this.connectingNow = false;
      this.onConnectionChange();
    }
  }

  private async cleanup(): Promise<void> {
    const port = this.port, reader = this.reader, writer = this.writer;
    this.ready = false;
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.buffer = "";
    this.firmware = [0, 0, 0];
    this.deviceLabel = "";
    this.supply = unavailablePower(); this.lastPowerPoll = -Infinity;
    this.positionKnown = false;
    this.penState.invalidate(); this.penState.powerHeld = false; this.penDevice.reset();
    this.motorsEngaged = false;
    this.expectedMotionIdleAt = 0;
    this.penIdleNotBefore = 0;
    this.cancelRequested = true;
    this.resume();
    this.onConnectionChange();
    try {
      if (reader) {
        try { await reader.cancel(); } finally { reader.releaseLock(); }
      }
    } finally {
      try { writer?.releaseLock(); } finally { await port?.close(); }
    }
  }

  async disconnect(): Promise<void> {
    if (this.busy || this.connectingNow) throw new Error("Wait until the plotter is idle before disconnecting.");
    if (this.motorsEngaged) await this.disengageMotors();
    await this.cleanup();
  }

  pause(): void {
    if (!this.busy || this.stopRequested || this.cancelRequested || this.paused) return;
    this.paused = true;
    this.emit({ ...this.lastProgress, state: "pausing" });
  }
  stop(): void {
    if (!this.busy || this.stopRequested) return;
    this.stopRequested = true;
    this.resume();
    this.emit({ ...this.lastProgress, state: "stopping" });
  }
  resume(): void {
    this.paused = false;
    this.resumeResolver?.();
    this.resumeResolver = null;
  }
  cancel(): void { this.cancelRequested = true; this.resume(); }

  private async write(command: string): Promise<void> {
    if (!this.writer) throw new Error("Connect the plotter first.");
    this.pendingCommand = {id:++this.commandId,command};
    this.trace(command,'requested');
    await this.writer.write(new TextEncoder().encode(`${command}\r`));
    this.trace(command,'written');
  }

  private async readLine(): Promise<string> {
    if (!this.reader) throw new Error("Connect the plotter first.");
    while (true) {
      if (this.buffer.length > 4096) throw new Error('EBB response limit exceeded.');
      const separator = this.buffer.search(/[\r\n]/);
      if (separator >= 0) {
        const line = this.buffer.slice(0, separator).trim();
        this.buffer = this.buffer.slice(separator + 1).replace(/^[\r\n]+/, "");
        if (line) { this.trace(this.pendingCommand?.command ?? 'unsolicited','received',{response:line}); return line; }
        // CR/LF pairs may straddle USB reads. Inspect the remaining buffered
        // lines before waiting for another packet (which may never arrive).
        continue;
      }
      const result = await this.reader.read();
      if (result.done) throw new Error("The plotter disconnected.");
      this.buffer += new TextDecoder().decode(result.value, { stream: true });
    }
  }

  private async command(command: string): Promise<void> {
    try {
      await this.write(command);
      const response = await this.readLine();
      if (response.startsWith("!")) throw new Error(`Plotter rejected ${command}: ${response}`);
      const commandName = command.split(",")[0];
      if (response !== "OK" && response !== commandName) throw new Error(`Unexpected response to ${command}: ${response}`);
      this.trace(command,'acknowledged');
    } catch (error) { this.trace(command,'failed',{error:error instanceof Error ? error.message : String(error)}); this.penState.invalidate(); throw error; }
  }

  private async query(command: string): Promise<string> {
    try {
      await this.write(command);
      const response = await this.readLine();
      this.trace(command, response.startsWith('!') ? 'failed' : 'acknowledged');
      return response;
    } catch (error) { this.trace(command,'failed',{error:error instanceof Error ? error.message : String(error)}); this.penState.invalidate(); throw error; }
  }

  async firmwareVersion(): Promise<string> { return this.query("V"); }

  private firmwareAtLeast(major: number, minor: number, patch: number): boolean {
    const [currentMajor, currentMinor, currentPatch] = this.firmware;
    return currentMajor > major
      || (currentMajor === major && currentMinor > minor)
      || (currentMajor === major && currentMinor === minor && currentPatch >= patch);
  }

  private async pen(percent: number, delayMs: number, reason = 'planned pen transition', force = false): Promise<void> {
    this.commandReason = reason;
    if (!force && this.penState.current(performance.now()) === percent) return;
    if (!this.penState.powerHeld && this.firmwareAtLeast(2,6,0)) await this.command(`SR,${SERVO_POWER_TIMEOUT_MS},1`);
    await this.penDevice.move(percent, delayMs, force);
  }

  private async waitWhilePaused(progress: PlotProgress, tool?: string, resumePen: number | null = this.penState.up): Promise<void> {
    if (!this.paused) return;
    await this.waitUntilIdle();
    if (this.cancelRequested || this.stopRequested) return;
    await this.pen(this.penState.up, 120, tool ? 'pen change lift' : 'pause lift');
    await this.waitUntilIdle();
    if (this.cancelRequested || this.stopRequested) return;
    this.pausedSettled = true;
    this.emit({ ...progress, state: tool ? "tool-change" : "paused", tool });
    if (this.paused && !this.cancelRequested && !this.stopRequested) {
      await new Promise<void>((resolve) => { this.resumeResolver = resolve; });
    }
    this.pausedSettled = false;
    await this.penOperation;
    if (this.cancelRequested || this.stopRequested) return;
    // A pending pen event owns its transition. Restore only for actual XY
    // continuation (or a tool/preflight/final wait that must keep the pen up).
    if (resumePen !== null) await this.pen(resumePen, 120, 'resume next motion');
    await this.waitUntilIdle();
    this.emit({ ...progress, state: "plotting" });
  }

  private async waitForTool(tool: string, progress: PlotProgress): Promise<void> {
    this.paused = true;
    await this.waitWhilePaused(progress, tool);
  }

  /** Serial queries run through the feeder, never through a competing timer. */
  private async pollPower(force = false): Promise<void> {
    if (!force && performance.now()-this.lastPowerPoll < 2000) return;
    this.lastPowerPoll = performance.now();
    if (!this.firmwareAtLeast(2,2,3)) { this.supply=unavailablePower('Supply monitoring requires EBB firmware 2.2.3 or newer.',Date.now()); return; }
    const response = await this.query('QC');
    // Legacy replies end in OK; future replies include QC and omit that line.
    // A rejected command has no second line and must leave the stream aligned.
    if (!response.startsWith('QC,') && !response.startsWith('!') && response !== 'OK' && response !== 'QC') {
      const terminator = await this.readLine();
      if (terminator !== 'OK') throw new Error(`Unexpected QC terminator: ${terminator}`);
    }
    this.supply=parsePowerStatus(response);
  }
  async checkPowerSupply(): Promise<PowerStatus> {
    await this.manual(()=>this.pollPower(true)); return this.powerStatus;
  }
  private requirePower(): void {
    if (this.supply.state === 'low') throw new Error(this.supply.message);
  }

  private async pollPosition(force = false): Promise<void> {
    if (!this.onPosition || !this.positionKnown || !this.positionFeedback || !this.firmwareAtLeast(2, 4, 3)) return;
    const now = performance.now();
    if (!force && now - this.lastPositionPoll < 100) return;
    this.lastPositionPoll = now;
    const response = await this.query("QS");
    if (response.startsWith("!")) {
      this.positionFeedback = false;
      console.warn("EBB position feedback unavailable", response);
      return;
    }
    const future = response.startsWith("QS,");
    if (!future) {
      const terminator = await this.readLine();
      if (terminator !== "OK") throw new Error(`Unexpected QS terminator: ${terminator}`);
    }
    const match = response.match(/^(?:QS,)?([+-]?\d+),([+-]?\d+)$/);
    if (!match) throw new Error(`Unexpected EBB position: ${response}`);
    const motor1 = Number(match[1]), motor2 = Number(match[2]);
    if (![motor1, motor2].every(value => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647)) throw new Error("Invalid EBB step position.");
    const scale = profileStepsPerMm(this.originProfile);
    this.onPosition(canvasPoint({ x: (motor1 + motor2) / (2 * scale), y: (motor1 - motor2) / (2 * scale) }, this.machineRotation));
  }

  private noteQueuedMotion(durationMs: number): void {
    // ACK means queued, not settled. Count conservatively from the ACK; a
    // firmware FIFO delay can only make this estimate later than actual idle.
    this.expectedMotionIdleAt = Math.max(performance.now(), this.expectedMotionIdleAt) + durationMs;
  }

  private async waitUntilIdle(): Promise<void> {
    // A queue status is not a pen-contact sensor. Enforce the complete SP
    // allowance on the host as well, even if an early query reports idle.
    const remainingPenTime = this.penIdleNotBefore - performance.now();
    if (remainingPenTime > 0) await (this.execution.sleep?.(remainingPenTime) ?? new Promise(resolve => setTimeout(resolve, remainingPenTime)));
    this.penIdleNotBefore = 0;
    const deadline = Math.max(performance.now(), this.expectedMotionIdleAt) + 10_000;
    while (performance.now() <= deadline) {
      await this.pollPosition();
      if (this.firmwareAtLeast(2, 6, 2)) {
        const response = await this.query("QG");
        const hex = response.includes(",") ? response.split(",").at(-1)! : response;
        if (!/^[0-9a-f]{2}$/i.test(hex)) throw new Error(`Unexpected QG response: ${response}`);
        const status = Number.parseInt(hex, 16);
        if (Number.isFinite(status) && (status & 0x0f) === 0) { this.expectedMotionIdleAt = 0; this.markPenSettled(); await this.pollPosition(true); return; }
      } else {
        const response = await this.query("QM");
        if (!/^QM,[01],[01],[01],[01]$/.test(response)) throw new Error(`Unexpected QM response: ${response}`);
        const fields = response.split(",");
        if (fields[1] === "0" && fields[4] === "0") { this.expectedMotionIdleAt = 0; this.markPenSettled(); await this.pollPosition(true); return; }
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("The plotter did not become idle.");
  }
  private markPenSettled(): void {
    if (this.penState.settled !== this.penState.acknowledged) this.trace('pen','settled');
    this.penState.settle();
  }

  private async emergencyStop(): Promise<void> {
    this.commandReason = 'emergency stop';
    await this.flushMotion(true);
  }

  private async flushMotion(disableMotors: boolean): Promise<boolean> {
    this.penState.invalidate();
    const command = this.firmwareAtLeast(2,8,0) ? `ES,${disableMotors ? 1 : 0}` : 'ES';
    await this.write(command);
    let response = await this.readLine();
    // A reset may leave a trailing acknowledgement. It is not an ES status:
    // use a version marker to resynchronize without waiting forever for a
    // status that a malformed reply might have omitted.
    const resynchronize=response === 'OK';
    if (resynchronize) {
      await this.write('V');
      for (let skipped=0; response === 'OK' && skipped<4; skipped++) response=await this.readLine();
    }
    if (response.startsWith("!")) throw new Error(`Emergency stop failed: ${response}`);
    const legacy = response.match(/^([01])(?:,[+-]?\d+,[+-]?\d+,[+-]?\d+,[+-]?\d+)?$/);
    const future = response.match(/^ES,([01])$/);
    if (legacy) {
      const terminator = await this.readLine();
      if (terminator !== "OK") throw new Error(`Unexpected emergency-stop response: ${terminator}`);
    } else if (!future && response !== 'ES') {
      throw new Error(`Unexpected emergency-stop response: ${response}`);
    }
    if (resynchronize) {
      const marker=await this.readLine();
      if (!this.matchesFirmwareReply(marker)) throw new Error(`Unexpected emergency-stop synchronization response: ${marker}`);
    }
    this.trace(command, 'acknowledged');
    this.expectedMotionIdleAt = 0;
    this.penIdleNotBefore = 0;
    return (legacy?.[1] ?? future?.[1]) === '1';
  }

  private assertIdle(): void {
    if (!this.connected) throw new Error("Connect the plotter first.");
    if (this.busy) throw new Error("Wait until the plotter is idle.");
  }

  private async manual(operation: () => Promise<void>): Promise<void> {
    this.assertIdle(); this.busy = true;
    this.cancelRequested = false;
    try { await this.waitUntilIdle(); await operation(); await this.waitUntilIdle(); }
    catch (error) { this.positionKnown = false; this.penState.invalidate(); throw error; }
    finally { this.busy = false; }
  }

  async setPen(percent: number, force = false): Promise<void> {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error("Pen height must be between 0 and 100 percent.");
    if (!this.busy) { await this.manual(async () => { await this.pen(percent, 120, 'manual pen control', force); }); return; }
    if (!this.canAdjustPen) throw new Error("Pause the plot and wait until it has stopped before adjusting the pen.");
    const operation = (async () => { await this.pen(percent, 120, 'manual pen control during pause', force); await this.waitUntilIdle(); })();
    this.penOperation = operation;
    try { await operation; }
    catch (error) { this.positionKnown = false; this.penState.invalidate(); this.cancel(); throw error; }
    finally { this.penOperation = null; }
  }

  async disengageMotors(penUp = this.penState.up): Promise<void> {
    await this.manual(async () => { await this.pen(penUp,120,'release lift'); await this.waitUntilIdle(); await this.releaseMotors(); });
  }

  private async releaseMotors(): Promise<void> {
    this.positionKnown = false;
    await this.command("EM,0,0");
    this.motorsEngaged = false;
  }

  async engageMotors(): Promise<void> {
    this.assertIdle();
    // Re-enabling can reset EBB counters. Never send it for a valid reference.
    if (this.positionKnown || this.motorsEngaged) return;
    await this.manual(async () => { await this.command('EM,2,2'); this.motorsEngaged = true; });
  }

  async setOrigin(profile: PlotSettings["profile"] = "axidraw", source: 'automatic' | 'explicit' = 'explicit'): Promise<void> {
    await this.manual(() => this.captureOrigin(profile, source));
  }

  private async captureOrigin(profile: PlotSettings['profile'], source: 'automatic' | 'explicit'): Promise<void> {
    await this.command('EM,2,2');
    if (this.firmwareAtLeast(2, 4, 3)) await this.command('CS');
    this.stepPosition = { x: 0, y: 0 }; this.originProfile = profile;
    this.positionKnown = true; this.originSource = source; this.motorsEngaged = true;
  }

  async ensureOrigin(profile: PlotSettings['profile']): Promise<void> {
    if (!this.hasOrigin(profile)) await this.setOrigin(profile, 'automatic');
  }

  async returnToOrigin(settings: PlotSettings): Promise<void> {
    if (!this.positionKnown) throw new Error("Set the carriage at your origin and click Set origin first.");
    if (settings.profile !== this.originProfile) throw new Error("Machine profile changed. Set the origin again.");
    this.configurePen(settings); await this.manual(() => this.home(settings));
  }

  private async home(settings: PlotSettings): Promise<void> {
    if (!Number.isFinite(settings.travelSpeed) || settings.travelSpeed <= 0) throw new Error("Travel speed must be positive.");
    // A user may have adjusted the physical pen since the cached up command.
    this.penState.invalidate();
    await this.pen(settings.penUp,120,'home lift',true);
    await this.waitUntilIdle();
    const durationMs = Math.hypot(this.stepPosition.x,this.stepPosition.y) / profileStepsPerMm(settings.profile) / settings.travelSpeed * 1000;
    if (this.firmwareAtLeast(2,6,2)) {
      await this.command(`HM,${Math.min(25000,Math.max(2,Math.round(settings.travelSpeed * profileStepsPerMm(settings.profile))))}`);
    } else {
      const distance=Math.hypot(this.stepPosition.x,this.stepPosition.y)/profileStepsPerMm(settings.profile);
      if(distance) await this.command(`XM,${Math.max(1,Math.round(distance/settings.travelSpeed*1000))},${-this.stepPosition.x},${-this.stepPosition.y}`);
    }
    this.noteQueuedMotion(durationMs);
    await this.waitUntilIdle(); this.stepPosition={x:0,y:0};
  }

  private beginPlot(process: PlotProcess): void {
    const { plan } = process;
    this.busy = true; this.cancelRequested = false; this.paused = false;
    this.stopRequested = false; this.pausedSettled = false;
    this.positionFeedback = true; this.lastPositionPoll = -Infinity;
    this.machineRotation = plan.settings.machineRotation ?? DEFAULT_MACHINE_ROTATION;
    this.latestSignal = null;
    this.lastProgress = { completed: 0, total: plan.events.length, state: 'plotting' };
    this.jobTraceStart = performance.now();
    this.elapsedStartedAt = this.jobTraceStart; this.elapsedFinishedMs = 0;
    this.jobTrace = {
      startedAt: new Date().toISOString(), firmware: this.firmwareLabel,
      settings: structuredClone(plan.settings), estimatedDuration: plan.duration,
      protocol: 'ebb-timed-sp-v1',
      plan: structuredClone(plan), signals: [], droppedSignals: 0, entries: [], droppedEntries: 0,
    };
  }

  private sendPlotSignal(process: PlotProcess, index: number, phase: PlotSignal['phase']): void {
    const signal = eventSignal(process.plan, process.penCounts, index, phase, performance.now() - this.jobTraceStart);
    this.latestSignal = signal;
    if (this.jobTrace) {
      this.jobTrace.signals.push(signal);
      // Preserve startup evidence as well as the recent tail, independently
      // of the much noisier serial query log. The full plan is always retained.
      if (this.jobTrace.signals.length > JOB_TRACE_LIMIT) {
        this.jobTrace.signals.splice(1000, 2000); this.jobTrace.droppedSignals += 2000;
      }
    }
    this.onSignal(structuredClone(signal));
  }

  private async resetPlotterSettings(settings: PlotSettings): Promise<void> {
    this.commandReason = 'startup queue purge';
    const interrupted = this.firmwareAtLeast(2,2,7) ? await this.flushMotion(false) : false;
    if (interrupted) this.positionKnown = false;
    // EBB 2.8.1 ES removes motor moves, but not queued servo commands. Drain
    // those while stationary before changing calibration or starting the plan.
    // Keep the working servo/PWM engine; R reinitializes it and its GPIO pins.
    this.commandReason = 'startup pen queue drain';
    await this.waitUntilIdle();
    this.expectedMotionIdleAt = this.penIdleNotBefore = 0;
    this.penState.powerHeld = false;
    this.penState.invalidate();
    this.penDevice.reset();
    this.commandReason = 'startup machine setup';
    await this.command('SC,2,0');
    await this.penDevice.configure();
    this.penState.powerHeld = this.firmwareAtLeast(2,6,0);
    if (this.penState.powerHeld) await this.command('SR,0,1');
    if (!this.hasOrigin(settings.profile)) await this.captureOrigin(settings.profile, 'automatic');
  }

  private matchesFirmwareReply(response: string): boolean {
    const match=response.match(/^(?:V,)?(?:EBB|EBBv\d+_and_above EB) Firmware Version (\d+)\.(\d+)\.(\d+)(?:\b.*)?$/i);
    return !!match && this.firmware.every((value,index)=>value===Number(match[index+1]));
  }

  private async preparePlot(settings: PlotSettings): Promise<void> {
    await this.resetPlotterSettings(settings);
    await this.waitUntilIdle();
    await this.waitWhilePaused(this.lastProgress);
    if (!this.stopRequested && !this.cancelRequested && (this.stepPosition.x || this.stepPosition.y)) await this.home(settings);
  }

  private async finishPlot(settings: PlotSettings, completed: number, total: number, terminal: PlotProgress['state']): Promise<PlotProgress['state']> {
    await this.penOperation;
    if (this.cancelRequested && terminal !== 'cancelled') {
      await this.emergencyStop(); this.positionKnown = false; terminal = 'cancelled';
    }
    await this.waitUntilIdle();
    await this.pen(settings.penUp, 120, 'job cleanup lift');
    await this.waitUntilIdle();
    if (this.stopRequested && !this.cancelRequested && terminal === 'finished') {
      this.emit({ completed, total, state: 'returning' });
      await this.home(settings); terminal = 'stopped';
    }
    if (this.firmwareAtLeast(2,6,0)) {
      // The final lifted pen has settled. Release power without another move.
      this.commandReason = 'idle servo power';
      await this.command(`SR,${SERVO_POWER_TIMEOUT_MS},0`);
      this.penState.invalidate();
    }
    this.penState.powerHeld = false;
    // A control request may arrive while the final power command is awaiting ACK.
    if (this.cancelRequested && terminal !== 'cancelled') {
      await this.emergencyStop(); this.positionKnown = false; terminal = 'cancelled';
      await this.pen(settings.penUp,120,'cancel cleanup lift'); await this.waitUntilIdle();
    } else if (this.stopRequested && terminal === 'finished') {
      this.emit({ completed, total, state: 'returning' });
      await this.home(settings); terminal = 'stopped';
    } else return terminal;
    if (this.firmwareAtLeast(2,6,0)) { await this.command(`SR,${SERVO_POWER_TIMEOUT_MS},0`); this.penState.invalidate(); }
    return terminal;
  }

  async plot(input: MotionPlan): Promise<void> {
    this.assertIdle();
    const process = compilePlotProcess(input, this.execution.maxCompiledCommands);
    const { settings } = process.plan, total = process.steps.length;
    this.stopRequested = false; this.cancelRequested = false; this.busy = true;
    try {
      await this.pollPower(true);
      if (this.stopRequested || this.cancelRequested) { this.emit({completed:0,total,state:this.cancelRequested?'cancelled':'stopped'}); return; }
      this.requirePower();
    } finally { this.busy = false; }
    this.configurePen(settings); this.beginPlot(process);
    let completed = 0, terminal: PlotProgress['state'] = 'finished';
    let failure: unknown;
    try {
      await this.preparePlot(settings);
      completed = await executePlotProcess(process, {
        waitUntilIdle: () => this.waitUntilIdle(),
        boundary: async ({ event }) => {
          if (this.stopRequested || this.cancelRequested) return false;
          await this.pollPower(); this.requirePower();
          await this.waitWhilePaused({ completed, total, state: 'plotting' }, undefined,
            event.kind === 'pen' ? null : event.penDown ? settings.penDown : settings.penUp);
          return !this.stopRequested && !this.cancelRequested;
        },
        cancelled: () => this.cancelRequested,
        changeTool: tool => this.waitForTool(tool, { completed, total, state: 'plotting' }),
        movePen: (down, duration) => this.pen(down ? settings.penDown : settings.penUp, duration, 'planned pen transition', true),
        moveXY: async (move, { event }) => {
          this.commandReason = event.penDown ? 'drawing motion' : 'travel motion';
          await this.command(move.command); this.stepPosition = move.targetSteps;
          if (performance.now()-this.lastPowerPoll >= 2000) { await this.pollPower(); this.requirePower(); }
          this.noteQueuedMotion(move.durationMs);
          // Keep UI queries out of short, continuous motion blocks.
          if (move.durationMs >= (this.execution.positionBudgetMs ?? 30)) await this.pollPosition();
        },
        signal: ({ index }, phase) => this.sendPlotSignal(process, index, phase),
        progress: count => {
          completed = count;
          this.emit({ completed, total, state: this.stopRequested ? 'stopping' : this.paused ? 'pausing' : 'plotting' });
        },
      });
      if (!this.cancelRequested) await this.waitWhilePaused({ completed, total, state: 'plotting' });
    } catch (error) {
      failure = error; this.positionKnown = false; this.cancelRequested = true; terminal = 'cancelled';
      await this.emergencyStop().catch(() => undefined);
    }
    try { terminal = await this.finishPlot(settings, completed, total, terminal); }
    catch (error) {
      failure ??= error; this.positionKnown = false;
      await this.emergencyStop().catch(() => undefined);
    } finally {
      try { await this.releaseMotors(); }
      catch (error) { failure ??= new Error(`Could not release motors: ${(error as Error).message}`); }
      this.elapsedFinishedMs = this.elapsedMs; this.elapsedStartedAt = null;
      this.busy = false; this.pausedSettled = false; this.paused = false; this.penState.powerHeld = false;
    }
    if (failure) throw failure;
    this.emit({ completed: terminal === 'finished' ? total : completed, total, state: terminal });
  }
}
