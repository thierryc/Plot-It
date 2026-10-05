import type { PlotSettings, Point } from "./model";
import { compileMotion, type MotionPlan } from "./motion-plan";
import { validateMotionCommand } from './motion-command';
import { canvasPoint, profileStepsPerMm } from "./motion";
import { DEFAULT_MACHINE_ROTATION } from './model';
import { PenState, penTransition, servoPosition, SERVO_PIN, SERVO_POWER_TIMEOUT_MS } from './pen-control';

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
export interface ExecutionOptions { precompile?: boolean; positionBudgetMs?: number; maxCompiledCommands?: number }

export interface PlotProgress {
  completed: number;
  total: number;
  state: "idle" | "plotting" | "pausing" | "paused" | "tool-change" | "stopping" | "returning" | "stopped" | "cancelled" | "finished";
  tool?: string;
}
export interface PlotterTrace {
  time: number; elapsedMs?: number; commandId: number | null; command: string;
  reason: string; event: number; state: PlotProgress['state'];
  phase: 'requested' | 'written' | 'received' | 'acknowledged' | 'settled' | 'failed' | 'marker';
  pen: number | null; response?: string; error?: string; note?: string;
}
export interface PlotterJobTrace {
  startedAt: string; firmware: string | null; settings: PlotSettings; estimatedDuration: number;
  plannedPenEvents: Array<{event:number; start:number; penDown:boolean; tool:string}>;
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
  private servoInitialized = false;
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
  private lastPositionPoll = -Infinity;
  private positionFeedback = true;
  private expectedMotionIdleAt = 0;

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
  markPenMovement(): void { this.trace('operator','marker',{note:'Unexpected pen movement observed'}); }
  configurePen(settings: Pick<PlotSettings, 'penUp' | 'penDown'>): void {
    if (this.busy) throw new Error('Wait until the plotter is idle before changing pen heights.');
    if (this.penState.configure(settings)) this.servoInitialized = false;
  }
  private trace(command: string, phase: PlotterTrace['phase'], details: Pick<PlotterTrace,'response' | 'error' | 'note'> = {}): void {
    const time = performance.now();
    const entry: PlotterTrace = {time,command,phase,commandId:phase !== 'marker' && this.pendingCommand?.command === command ? this.pendingCommand.id : null,
      reason:this.commandReason,event:this.lastProgress.completed,state:this.lastProgress.state,pen:this.penState.requested,...details};
    if (this.jobTrace) {
      entry.elapsedMs = time-this.jobTraceStart;
      this.jobTrace.entries.push(entry);
      if (this.jobTrace.entries.length > JOB_TRACE_LIMIT) {
        // Trim in batches so diagnostics don't shift a large array on each USB
        // command. The separate pen journal preserves important transitions.
        const drop = 2000;
        this.jobTrace.entries.splice(0,drop); this.jobTrace.droppedEntries += drop;
      }
    }
    this.traceEntries.push(entry);
    if (this.traceEntries.length > 500) this.traceEntries.splice(0,this.traceEntries.length-500);
    // Long LM/QS/QG streams must not erase the pen commands needed to diagnose
    // an unexpected physical movement. Retain their own bounded journal.
    if (/^(S2|SC|SR|SP|TP|ES|EM)(,|$)/.test(command) || phase === 'settled' || phase === 'failed' || phase === 'marker') {
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
    this.positionKnown = false;
    this.penState.invalidate(); this.penState.powerHeld = false; this.servoInitialized = false;
    this.motorsEngaged = false;
    this.expectedMotionIdleAt = 0;
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

  private async initializeServo(target = this.penState.up, rate = penTransition(null,target).rate): Promise<void> {
    if (this.servoInitialized) return;
    this.penState.requested = target;
    await this.command('SC,8,8'); await this.command('SC,9,3');
    // SC,1 is not configuration-only: firmware queues SP using its remembered
    // pen state. Make both endpoints the requested target before enabling it,
    // so an old up/down state cannot replay a stale (possibly extreme) height.
    await this.command(`SC,4,${servoPosition(target)}`);
    await this.command(`SC,5,${servoPosition(target)}`);
    await this.command(`SC,10,${rate}`);
    if (this.firmwareAtLeast(2,6,0)) await this.command(`SR,${this.penState.powerHeld ? 0 : SERVO_POWER_TIMEOUT_MS},1`);
    await this.command('SC,1,1');
    await this.command(`SC,4,${servoPosition(this.penState.up)}`);
    await this.command(`SC,5,${servoPosition(this.penState.down)}`);
    await this.command(`SC,11,${penTransition(this.penState.down,this.penState.up).rate}`);
    await this.command(`SC,12,${penTransition(this.penState.up,this.penState.down).rate}`);
    // Do not accept/cache SC's implicit movement. The explicit S2 that follows
    // supplies the required settling delay before any XY motion.
    this.servoInitialized = true;
  }

  private async pen(percent: number, delayMs: number, reason = 'planned pen transition', force = false): Promise<void> {
    this.commandReason = reason;
    const from = this.penState.current(performance.now());
    if (!force && from === percent) return;
    const move = penTransition(from,percent,delayMs);
    await this.initializeServo(percent,move.rate);
    this.penState.requested = percent;
    await this.command(`S2,${move.position},${SERVO_PIN},${move.rate},${move.duration}`);
    this.penState.accept(percent,performance.now());
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
    const deadline = Math.max(performance.now(), this.expectedMotionIdleAt) + 10_000;
    while (performance.now() <= deadline) {
      await this.pollPosition();
      if (this.firmwareAtLeast(2, 6, 2)) {
        const response = await this.query("QG");
        const hex = response.includes(",") ? response.split(",").at(-1)! : response;
        const status = Number.parseInt(hex, 16);
        if (Number.isFinite(status) && (status & 0x0f) === 0) { this.expectedMotionIdleAt = 0; this.markPenSettled(); await this.pollPosition(true); return; }
      } else {
        const response = await this.query("QM");
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
    this.penState.invalidate(); this.commandReason = 'emergency stop';
    await this.write("ES,1");
    const response = await this.readLine();
    if (response.startsWith("!")) throw new Error(`Emergency stop failed: ${response}`);
    if (/^[01]$/.test(response)) {
      const terminator = await this.readLine();
      if (terminator !== "OK") throw new Error(`Unexpected emergency-stop response: ${terminator}`);
    } else if (!response.startsWith("ES")) {
      throw new Error(`Unexpected emergency-stop response: ${response}`);
    }
    this.expectedMotionIdleAt = 0;
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
    const restorePower = async () => { if (force && this.firmwareAtLeast(2,6,0)) await this.command(`SR,${this.penState.powerHeld ? 0 : SERVO_POWER_TIMEOUT_MS},1`); };
    if (!this.busy) { await this.manual(async () => { await restorePower(); await this.pen(percent, 120, 'manual pen test', force); }); return; }
    if (!this.canAdjustPen) throw new Error("Pause the plot and wait until it has stopped before adjusting the pen.");
    const operation = (async () => { await restorePower(); await this.pen(percent, 120, 'manual pen test during pause', force); await this.waitUntilIdle(); })();
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
    await this.pen(settings.penUp,120,'home lift');
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

  async plot(plan: MotionPlan): Promise<void> {
    this.assertIdle();
    if (!plan.passes.length) throw new Error('There are no paths to plot.');
    this.configurePen(plan.settings);
    // Compile the complete motion stream before any preparation can move hardware.
    // The browser adapter retains its established on-demand behavior.
    let preparedCursor: Point = { x: 0, y: 0 };
    let commandCount = 0;
    const supportsLM = this.firmwareAtLeast(2,5,3);
    const prepared = this.execution.precompile ? plan.events.map(event => {
      const limit = this.execution.maxCompiledCommands ?? 1_000_000;
      if (event.kind === 'xy' && !supportsLM && Math.ceil(event.duration / .015) + commandCount > limit) throw new Error('Compiled job exceeds command limit.');
      const moves = compileMotion(event, plan.settings, preparedCursor, supportsLM);
      commandCount += moves.length;
      if (commandCount > (this.execution.maxCompiledCommands ?? 1_000_000)) throw new Error('Compiled job exceeds command limit.');
      for (const move of moves) {
        validateMotionCommand(move.command);
        preparedCursor = move.targetSteps;
      }
      return moves;
    }) : null;
    this.busy = true; this.cancelRequested = false; this.paused = false; this.stopRequested = false; this.pausedSettled = false;
    this.positionFeedback = true; this.lastPositionPoll = -Infinity;
    const settings = plan.settings;
    this.machineRotation = settings.machineRotation ?? DEFAULT_MACHINE_ROTATION;
    this.lastProgress = { completed: 0, total: plan.events.length, state: "plotting" };
    this.jobTraceStart = performance.now();
    this.jobTrace = {startedAt:new Date().toISOString(),firmware:this.firmwareLabel,settings:structuredClone(settings),estimatedDuration:plan.duration,
      plannedPenEvents:plan.events.flatMap((event,i) => event.kind === 'pen' ? [{event:i,start:event.start,penDown:event.penDown,tool:event.tool}] : []),entries:[],droppedEntries:0};
    let stepCursor: Point = { x: 0, y: 0 };
    let completed = 0;
    const total = plan.events.length;
    let failed = false;
    let terminal: PlotProgress['state'] = 'finished';
    try {
      await this.waitUntilIdle();
      this.commandReason = 'job servo setup'; this.penState.powerHeld = this.firmwareAtLeast(2,6,0);
      const alreadyInitialized = this.servoInitialized;
      await this.initializeServo();
      if (this.penState.powerHeld && alreadyInitialized) await this.command('SR,0,1');
      // SR only updates the reload value. Refresh the live countdown even
      // when cached pen-up state would otherwise suppress the command.
      if (this.penState.powerHeld) { await this.pen(settings.penUp,0,'job servo power hold',true); await this.waitUntilIdle(); }
      if (!this.hasOrigin(settings.profile)) {
        await this.captureOrigin(settings.profile, 'automatic');
        await this.waitUntilIdle();
      }
      // Stop/Pause requested during origin capture must survive preparation.
      await this.waitWhilePaused({ completed, total, state: 'plotting' });
      // Return to the established physical origin without re-enabling/resetting EBB counters.
      if (!this.stopRequested && !this.cancelRequested) await this.home(settings);
      for (const [eventIndex, event] of plan.events.entries()) {
        // Keep queued work within one continuous motion section. Draining at
        // rest boundaries also gives pause/stop a chance before the next section.
        if (event.kind !== "xy" || event.initialSpeed < 1e-9) {
          await this.waitUntilIdle();
          if (this.stopRequested || this.cancelRequested) break;
          await this.waitWhilePaused({ completed, total, state: "plotting" },undefined,event.kind === 'pen' ? null : event.penDown ? settings.penDown : settings.penUp);
        }
        if (this.cancelRequested || (this.stopRequested && (event.kind !== "xy" || event.initialSpeed < 1e-9))) break;
        if (event.kind === "tool") {
          await this.waitUntilIdle();
          await this.waitForTool(event.tool, { completed, total, state: "plotting" });
        } else if (event.kind === "pen") {
          await this.pen(event.penDown ? settings.penDown : settings.penUp, Math.round(event.duration * 1000));
        } else {
          this.commandReason = event.penDown ? 'drawing motion' : 'travel motion';
          for (const move of prepared?.[eventIndex] ?? compileMotion(event, settings, stepCursor, this.firmwareAtLeast(2,5,3))) {
            if (this.cancelRequested) break;
            await this.command(move.command); stepCursor = move.targetSteps; this.stepPosition = stepCursor;
            // Optional counter queries only use generous command-duration windows.
            // Never add a query to a short LM/XM stream to satisfy a UI update.
            const budget = this.execution.positionBudgetMs;
            const moveMs = move.command.startsWith('XM,') ? Number(move.command.split(',')[1]) : event.duration * 1000;
            this.noteQueuedMotion(moveMs);
            if (budget === undefined || moveMs >= budget) await this.pollPosition();
          }
        }
        if (this.cancelRequested) break;
        completed++; this.emit({ completed, total, state: this.stopRequested ? "stopping" : this.paused ? "pausing" : "plotting" });
      }
      await this.penOperation;
      if (!this.cancelRequested) {
        await this.waitUntilIdle();
        // Requests can arrive after the final command was acknowledged while
        // the board is still physically executing it.
        await this.waitWhilePaused({ completed, total, state: "plotting" });
      }
      await this.penOperation;
      if (this.stopRequested && !this.cancelRequested) {
        this.emit({ completed, total, state: "returning" });
        await this.home(settings);
        terminal = 'stopped';
      } else if (this.cancelRequested) {
        await this.emergencyStop(); this.positionKnown = false;
        terminal = 'cancelled';
      }
    } catch (error) {
      failed = true;
      this.positionKnown = false;
      await this.emergencyStop().catch(() => undefined);
      throw error;
    } finally {
      let cleanupError: unknown;
      try {
        await this.pen(settings.penUp,120,'job cleanup lift');
        await this.waitUntilIdle();
        if (!failed && !this.cancelRequested && this.stopRequested && terminal === 'finished') {
          this.emit({ completed, total, state: 'returning' });
          await this.home(settings); terminal = 'stopped';
        }
        if (!failed && this.cancelRequested && terminal !== 'cancelled') {
          await this.emergencyStop(); terminal = 'cancelled';
        }
      } catch (error) {
        cleanupError = error;
        await this.emergencyStop().catch(() => undefined);
      }
      // Re-arm idle servo power-off without moving an already lifted pen.
      // SR changes the reload value; S2 refreshes the actual countdown.
      try {
        if (this.firmwareAtLeast(2,6,0)) {
          this.commandReason = 'idle servo power timeout';
          await this.command(`SR,${SERVO_POWER_TIMEOUT_MS}`);
          await this.pen(settings.penUp,0,'idle servo power timeout',true);
          await this.waitUntilIdle();
        }
      } catch (error) { cleanupError ??= error; this.penState.invalidate(); }
      this.penState.powerHeld = false;
      try {
        // Stop can also arrive while the final servo-power command settles.
        if (!failed && !cleanupError && !this.cancelRequested && this.stopRequested && terminal === 'finished') {
          this.emit({ completed, total, state: 'returning' });
          await this.home(settings); terminal = 'stopped';
        }
        if (!failed && !cleanupError && this.cancelRequested && terminal !== 'cancelled') {
          await this.emergencyStop();
          await this.pen(settings.penUp,120,'cancel cleanup lift');
          await this.waitUntilIdle(); terminal = 'cancelled';
        }
      } catch (error) { cleanupError ??= error; this.positionKnown = false; }
      // Release only after final motion and pen lift settle. A missing/rejected
      // acknowledgement must not claim the motors are off or the job succeeded.
      try { await this.releaseMotors(); }
      catch (error) { cleanupError ??= new Error(`Could not release motors: ${(error as Error).message}`); }
      this.busy = false; this.pausedSettled = false; this.paused = false;
      if (!failed && cleanupError) throw cleanupError;
    }
    this.emit({ completed: terminal === 'finished' ? total : completed, total, state: terminal });
  }
}
