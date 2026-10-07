import {coreOptions} from './core-settings';
import {executionSvg,digest} from '@thierryc/plotter-core';
import {supportsHardwareProfile, restoreNextDrawModel} from './machine-profiles';
import { penTimingSettings } from './pen-control';
import { PlotCanvasStatus } from './ui/app/plot-status';
import { plotWorkspaceMarkup, originLabel } from './ui/app/plot-views';
import { bindPlotEvents } from './ui/app/events';
import type { AppState, PenPreferences, PlotSettings } from './model';
import { canonicalColor, restorePens, type PlotPen } from './pens';
import { prepareJob } from './plot-job';
import type { MotionPlan } from './motion-plan';
import { PlotOverlay } from './plot-overlay';
import type { PlotProgress } from './plotter';
import type { PlotDestination } from './plot-destination';
import type { NetworkPlotter } from './network-plotter';
import { discoverNetwork } from './network-discovery';
import { LivePlot, livePlotView } from './live-plot';
import { Simulation, type SimulationView } from './simulation';
import type { TaskProgress } from './task-progress';
import { icon } from './icons';
import { setupModel } from './plotter-setup';
import { PlotPenCounter } from './plot-pen-counter';
import type { PlotSignal } from './plot-signals';
import { pathOptimizationSettings } from './path-optimization';
import { plotStatistics, type PlotStatistics } from './plot-statistics';
import { buildBoundsPreview } from './bounds-preview';
import { powerStatusLabel } from './ebb-power';

const clock = (time: number) => `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;
export type PlotSessionState = 'choosing' | 'planning' | 'ready' | 'running' | 'pausing' | 'paused' | 'tool-change' | 'stopping' | 'returning' | 'finished' | 'stopped' | 'error';

/** One owner for preparation, preview, connection, simulation and physical playback. */
export class PlotWorkspace {
  private panel: HTMLElement;
  private canvasStatus: PlotCanvasStatus;
  private connectionTarget: 'machine' | 'network' | null;
  private releaseEvents: () => void;
  private paper: SVGSVGElement;
  private penCounter: PlotPenCounter;
  private savedEditor = document.createDocumentFragment();
  private editorScroll: number;
  private savedInert = new Map<HTMLElement, boolean>();
  private session: PlotSessionState = 'choosing';
  private destination: 'machine' | 'network' | 'simulation' | null;
  private readonly localPlotter: PlotDestination;
  private network: NetworkPlotter | null = null;
  private attaching = false;
  private plan: MotionPlan | null = null;
  private playbackPlan: MotionPlan | null = null;
  private previewingBounds = false;
  private statistics: PlotStatistics | null = null;
  private elapsedTimer: ReturnType<typeof setInterval> | null = null;
  private job: ReturnType<typeof prepareJob> | null = null;
  private revision = 0;
  private visual: PlotOverlay | null = null;
  private simulation: Simulation | null = null;
  private live: LivePlot | null = null;
  private simulationView: SimulationView | null = null;
  private hardwareView: ReturnType<typeof livePlotView> | null = null;
  private progress: PlotProgress = { completed: 0, total: 0, state: 'idle' };
  private task: TaskProgress | undefined;
  private manualBusy = false;
  private executing = false;
  private error = '';
  private inputError = '';
  private notice = '';
  private deviceLabel = '';
  private rate = 1;
  private closed = false;
  private readonly settings: PlotSettings;
  private preferences: PenPreferences;

  constructor(private root: HTMLElement, private plotter: PlotDestination, private documentState: AppState, private save: () => void, private onExit: () => void) {
    this.localPlotter = plotter;
    this.settings = documentState.settings;
    Object.assign(this.settings,pathOptimizationSettings(this.settings),penTimingSettings(this.settings));
    if (supportsHardwareProfile(this.settings.profile)) this.plotter.configurePen(this.settings);
    this.preferences = restorePens(documentState.pens);
    this.destination = plotter.connected ? 'machine' : null;
    this.connectionTarget = this.destination;
    this.canvasStatus = new PlotCanvasStatus(root);
    this.panel = root.querySelector<HTMLElement>('[data-ui="inspector"]')!;
    this.paper = root.querySelector<SVGSVGElement>('#paper')!;
    this.penCounter = new PlotPenCounter(this.paper);
    this.editorScroll = this.panel.scrollTop;
    while (this.panel.firstChild) this.savedEditor.append(this.panel.firstChild);
    root.querySelector<HTMLElement>('#main-menu')?.hidePopover();
    root.querySelectorAll<HTMLElement>(':popover-open').forEach(node => node.hidePopover());
    root.querySelectorAll<HTMLElement>('[data-edit-control],.empty-state').forEach(node => { this.savedInert.set(node, node.inert); node.inert = true; });
    this.paper.querySelectorAll('.selection-ui,.editor-hit-layer').forEach(node => node.remove());
    this.panel.classList.add('plot-sidebar'); this.panel.toggleAttribute('data-plot-sidebar', true); this.root.classList.add('plot-mode'); this.root.toggleAttribute('data-plot-mode', true);
    root.querySelector('[data-action="edit-mode"]')!.setAttribute('aria-checked', 'false');
    root.querySelector('[data-action="edit-mode"]')!.setAttribute('tabindex', '-1');
    root.querySelector('[data-action="open-plot"]')!.setAttribute('aria-checked', 'true');
    root.querySelector('[data-action="open-plot"]')!.setAttribute('tabindex', '0');
    this.releaseEvents = bindPlotEvents(this.panel, { click:this.onClick, change:this.onChange, input:this.onInput, focusout:this.onFocusOut, keydown:this.onKeyDown });
    this.render(); this.panel.querySelector<HTMLElement>('.plot-scroll > details > summary')?.focus();
    void this.prepare();
    void this.discoverNetwork();
  }

  private async discoverNetwork(): Promise<void> {
    const network = await discoverNetwork();
    if (this.closed || !network) return;
    this.network = network;
    network.onConnectionChange = () => { if (this.destination === 'network') this.connectionChanged(); else if (!this.closed) this.render(); };
    network.onError = message => { if (this.destination === 'network' && !this.closed) { this.notice = message; this.render(); } };
    this.render();
    try { await network.watch(); } catch (error) { if (!this.closed) this.notice = (error as Error).message; }
  }

  private async attachNetworkJob(): Promise<void> {
    if (!this.network?.active || this.executing || this.attaching) return;
    this.attaching = true;
    ++this.revision; this.job?.cancel(); this.job = null; this.task = undefined;
    try {
      const plan = await this.network.activePlan();
      if (this.closed || this.destination !== 'network' || !plan) return;
      this.plan = plan; this.statistics = plotStatistics(plan); this.session = 'ready'; this.render();
      await this.startHardware(true);
    } catch (error) { this.error = (error as Error).message; this.render(); }
    finally { this.attaching = false; }
  }

  get busy(): boolean { return this.executing || this.manualBusy || this.plotter.connecting; }
  private get locked(): boolean { return this.executing || this.manualBusy || this.plotter.connecting || !!this.simulationView && !['finished', 'stopped'].includes(this.simulationView.state); }
  private get pens(): PlotPen[] { return this.plan?.pens ?? []; }
  private penLabel(color: string): string { const name = this.pens.find(pen => pen.color === color)?.name; return name ? `${name} · ${color}` : color; }
  private persist(): void { this.documentState.pens = structuredClone(this.preferences); this.settings.pauseOnToolChange = true; this.save(); }

  connectionChanged(): void {
    if (this.closed) return;
    if (this.destination === 'network') this.deviceLabel = this.network?.connected ? `Network plotter · EBB ${this.network.firmwareLabel ?? ''}` : 'Network plotter · EBB disconnected';
    const status = this.root.querySelector<HTMLElement>('[data-connection-status]');
    if (status) status.textContent = this.plotter.connected ? 'Plotter connected' : 'Plotter not connected';
    if (!this.plotter.connected && this.executing) {
      if (this.destination === 'network') this.notice = this.network?.networkConnected ? 'Server connected, but the EBB is unavailable. Check the interrupted job before restarting.' : 'Network feedback unavailable. Reconnect to check the current job state.';
      else this.error = 'The plotter disconnected. Reconnect and prepare a new job.';
    } else if (this.destination === 'network' && this.network?.networkConnected) this.notice = '';
    if (this.destination === 'network' && this.network?.active && !this.executing && !this.attaching) void this.attachNetworkJob();
    this.render();
  }

  private async prepare(autoPlay = false, preserveControls = false): Promise<void> {
    if (this.executing || this.closed) return;
    const revision = ++this.revision;
    this.job?.cancel(); this.job = null;
    this.simulation?.destroy(); this.simulation = null; this.simulationView = null;
    this.live?.destroy(); this.live = null; this.hardwareView = null;
    this.visual?.destroy(); this.visual = null;
    this.plan = null; this.playbackPlan = null; this.statistics = null; this.previewingBounds = false;
    this.error = ''; this.notice = ''; this.task = { label: 'Preparing preview' };
    this.session = 'planning'; this.root.classList.remove('plot-running');
    // Numeric commits keep the current controls and scroll geometry while planning.
    // The previous executable plan is still discarded immediately.
    if (!preserveControls) this.render();
    const snapshot={...this.settings,...(this.plotter.firmwareLabel?{motionFirmware:this.plotter.firmwareLabel}:{})};
    const job = prepareJob(this.paper, this.documentState.paper, snapshot, task => {
      if (revision !== this.revision || this.closed) return;
      this.task = task; this.syncPlayer();
    }, this.preferences);
    this.job = job;
    if (preserveControls) this.syncPlayer();
    try {
      const plan = await job.promise;
      if (revision !== this.revision || this.closed) return;
      this.plan = plan; this.statistics = plotStatistics(plan);
      const colors = plan.pens!.map(pen => pen.color);
      this.preferences.order = [...this.preferences.order.filter(color => colors.includes(color)), ...colors.filter(color => !this.preferences.order.includes(color))];
      this.persist();
      this.visual = new PlotOverlay(plan, this.paper);
      this.visual.update(plan.duration, { position: { x: 0, y: 0 }, penDown: false });
      this.session = this.destination ? 'ready' : 'choosing';
    } catch (error) {
      if (revision !== this.revision || this.closed) return;
      this.plan = null; this.session = 'error'; this.error = (error as Error).message;
    } finally {
      if (revision === this.revision && !this.closed) { this.job = null; this.task = undefined; this.render(); }
    }
    if (autoPlay && revision === this.revision && this.plan?.passes.length && !this.inputError) this.startSimulation();
  }

  private cancelPlanning(): void {
    ++this.revision; this.job?.cancel(); this.job = null; this.task = undefined;
    this.plan = null; this.playbackPlan = null; this.statistics = null; this.session = this.destination ? 'ready' : 'choosing'; this.notice = 'Preview preparation cancelled.'; this.render();
  }

  private async connect(): Promise<void> {
    if (!supportsHardwareProfile(this.settings.profile)) return;
    if (this.manualBusy || this.plotter.connecting || this.locked && !(this.executing && this.connectionTarget === 'network' && !this.network?.hasControl) || this.plotter.connected && (this.connectionTarget !== 'network' || this.network?.hasControl)) return;
    if (!this.connectionTarget) return;
    this.destination = this.connectionTarget;
    this.plotter = this.connectionTarget === 'network' && this.network ? this.network : this.localPlotter;
    if (this.destination === 'machine' && this.serverOwnsLocalUsb) { this.error = 'The local Node server owns the EBB. Release server USB, then click Connect.'; this.render(); return; }
    this.error = ''; this.manualBusy = true; this.render();
    try {
      this.deviceLabel = await this.plotter.connect();
      if (this.connectionTarget === 'network' && this.network && !this.network.connected && !this.network.active) {
        if (this.localPlotter.connected && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) throw new Error('Disconnect Direct USB on this computer before connecting the same EBB through the server.');
        await this.network.connectEbb();
      }
      if (!this.job) this.session = 'ready';
      const firmware=this.plotter.firmwareLabel;if(firmware&&firmware!==this.settings.motionFirmware){this.settings.motionFirmware=firmware;this.persist();await this.prepare();}
    }
    catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) this.error = (error as Error).message;
    }
    this.manualBusy = false; this.render();
  }

  private startSimulation(bounds = false): void {
    if (!this.plan?.passes.length || this.inputError || this.job || this.locked) return;
    const plan = bounds ? buildBoundsPreview(this.plan) : this.plan;
    this.playbackPlan = plan; this.previewingBounds = bounds; this.statistics = plotStatistics(plan); this.notice = '';
    this.destination = 'simulation'; this.visual?.destroy(); this.visual = new PlotOverlay(plan, this.paper);
    this.simulation?.destroy(); this.simulation = null;
    this.session = 'running'; this.root.classList.add('plot-running'); this.render();
    this.simulation = new Simulation(plan, view => {
      if(view.plan&&view.plan!==this.playbackPlan){this.playbackPlan=view.plan;this.visual?.destroy();this.visual=new PlotOverlay(view.plan,this.paper);}
      this.simulationView = view; this.session = view.state;
      if (bounds && view.state==='finished') this.notice='Bounds preview complete.';
      this.visual?.update(view.time, { position: view.state === 'stopped' || view.state === 'tool-change' ? { x: 0, y: 0 } : undefined, penDown: view.state !== 'running'||view.nextAction ? false : undefined });
      this.syncPlayer(); this.syncPasses();
    }, signal => this.dispatchSignal(signal));
    this.simulation.setRate(this.rate);
  }

  private async startHardware(resumeNetworkJob = false, bounds = false): Promise<void> {
    if (!supportsHardwareProfile(this.settings.profile)) return;
    if (!this.plan?.passes.length || this.inputError || this.job || this.locked || !this.plotter.connected) return;
    const plan = bounds ? buildBoundsPreview(this.plan) : this.plan;
    this.playbackPlan = plan; this.previewingBounds = bounds; this.statistics = plotStatistics(plan); this.notice = '';
    this.visual?.destroy(); this.visual = null; this.live?.destroy();
    this.executing = true; this.error = ''; this.session = 'running'; this.progress = { completed: 0, total: plan.events.length, state: 'plotting' };
    this.root.classList.add('plot-running'); this.render();
    this.live = new LivePlot(plan, this.paper, (view, progress) => {
      this.hardwareView = view; this.progress = progress;
      this.session = progress.state === 'plotting' ? 'running' : progress.state === 'cancelled' ? 'error' : progress.state === 'idle' ? 'ready' : progress.state;
      this.syncPlayer(); this.syncPasses();
    });
    this.plotter.onPosition = position => this.live?.observePosition(position);
    this.plotter.onSignal = signal => { this.live?.observeSignal(signal); this.dispatchSignal(signal); };
    this.plotter.onProgress = progress => this.live?.update(progress);
    this.elapsedTimer = setInterval(()=>this.syncPlayer(),250);
    try {
      if (resumeNetworkJob && this.network) { this.live.update(this.network.progress); await this.network.waitForJob(); }
      else await this.plotter.plot(plan);
    }
    catch (error) { this.error = (error as Error).message; }
    finally {
      this.plotter.onPosition = null; this.plotter.onProgress = () => undefined; this.plotter.onSignal = () => undefined;
      if (this.elapsedTimer) clearInterval(this.elapsedTimer); this.elapsedTimer = null;
      this.executing = false; this.live?.finish();
      if (this.error || this.progress.state === 'cancelled') { this.session = 'error'; this.error ||= 'Plot cancelled. Prepare a new job before starting again.'; }
      else this.notice = bounds ? 'Bounds preview complete. Motors released.' : 'Motors released. Restore the physical origin and use Set origin if the carriage has moved.';
      this.render();
    }
  }

  private async manual(action: string): Promise<void> {
    if (!supportsHardwareProfile(this.settings.profile)) return;
    const pen = action === 'pen-up' || action === 'pen-down';
    if (this.manualBusy || !this.plotter.connected || this.destination === 'simulation' && this.locked || this.connectionTarget === 'network' && !this.network?.hasControl || (this.executing && (!pen || !this.plotter.canAdjustPen))) return;
    this.manualBusy = true; this.error = ''; this.render();
    const settings = this.executing && this.destination === 'network' && this.plan ? this.plan.settings : this.settings;
    try {
      if(!this.executing)this.plotter.configurePen(settings);
      if (pen) {
        if (!this.executing) this.plotter.configurePen(settings);
        await this.plotter.setPen(action === 'pen-up' ? settings.penUp : settings.penDown); this.live?.update(this.progress, action === 'pen-down');
      }
      if (action === 'check-power') { const power = await this.plotter.checkPowerSupply(); this.notice = powerStatusLabel(power); }
      if(action.startsWith('jog-')){const step=this.settings.jogStepMm??1;await this.plotter.jog({x:action==='jog-x-plus'?step:action==='jog-x-minus'?-step:0,y:action==='jog-y-plus'?step:action==='jog-y-minus'?-step:0},settings);}
      if(action==='home'){this.plotter.configurePen(settings);await this.plotter.home();}
      if (action === 'set-origin') await this.plotter.setOrigin(this.settings.profile);
      if (action === 'return-origin') await this.plotter.returnToOrigin(this.settings);
      if (action === 'engage') await this.plotter.engageMotors();
      if (action === 'release') await this.plotter.disengageMotors(this.settings.penUp);
      if (action !== 'check-power') this.notice = action === 'set-origin' ? 'Origin saved at the current carriage position.' : action === 'release' ? 'Motors released. Restore the physical origin and use Set origin if the carriage has moved.' : 'Machine command complete.';
    } catch (error) { this.error = (error as Error).message; }
    finally { this.manualBusy = false; this.render(); }
  }

  private downloadMachineLog(): void {
      const blob = new Blob([JSON.stringify({format:'plot-it-machine-log',version:6,createdAt:new Date().toISOString(),firmware:this.plotter.firmwareLabel,power:this.plotter.powerStatus,elapsedMs:this.plotter.elapsedMs,penHeights:{up:this.settings.penUp,down:this.settings.penDown},entries:this.plotter.diagnosticTrace,penTransitions:this.plotter.diagnosticPenTrace,job:this.plotter.diagnosticJobTrace},null,2)],{type:'application/json'});
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = 'plot-it-machine-log.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url),1000);
  }

  private dispatchSignal(signal: PlotSignal): void {
    this.paper.dispatchEvent(new CustomEvent('plot-execution-signal', { detail: signal }));
  }

  private onClick = (event: Event): void => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-plot-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.plotAction!;
    if (action === 'virtual-monitor') { window.open('/virtual.html', '_blank', 'noopener'); return; }
    if (action === 'machine-log' && this.destination === 'network' && this.network) {
      void this.network.refreshDiagnostics().then(() => this.downloadMachineLog()).catch(error => { this.notice = (error as Error).message; this.render(); }); return;
    }
    if (action === 'machine-log') {
      this.downloadMachineLog(); return;
    }
    if (action === 'cancel-plan') { this.cancelPlanning(); return; }
    if (action === 'connect') { void this.connect(); return; }
    if (action === 'disconnect') { void this.disconnect(); return; }
    if (['connect-ebb', 'disconnect-ebb', 'release-control', 'release-server-usb', 'disconnect-local-usb'].includes(action)) { void this.serverConnection(action); return; }
    if (action === 'retry') { if (!this.locked) void this.prepare(); return; }
    if (action === 'pause') {
      if (this.manualBusy) return;
      if (this.destination === 'simulation') { this.simulationView?.state === 'running' ? this.simulation?.pause() : this.simulation?.play(); }
      else if (this.progress.state === 'paused' || this.progress.state === 'tool-change') this.plotter.resume();
      else this.plotter.pause();
      return;
    }
    if (action === 'stop') { if (this.destination === 'simulation') this.simulation?.stop(); else this.plotter.stop(); return; }
    if (['pen-up', 'pen-down', 'set-origin', 'return-origin', 'engage', 'release', 'check-power','home','jog-x-plus','jog-x-minus','jog-y-plus','jog-y-minus'].includes(action)) { void this.manual(action); return; }
    if (this.locked) return;
    if(action==='export-paths'){if(this.plan?.executable){const url=URL.createObjectURL(new Blob([executionSvg(this.plan.executable,this.settings.previewFilter??'all')],{type:'image/svg+xml'}));const a=document.createElement('a');a.href=url;a.download='plot-it-executed-paths.svg';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}return;}
    if(action==='resume-checkpoint'){const trace=this.plotter.diagnosticJobTrace,checkpoint=trace?.checkpoint;if(!checkpoint||!this.plan?.executable||checkpoint.programDigest!==digest(this.plan.executable)){this.error='Checkpoint does not match this prepared drawing. Restore its document and settings first.';this.render();return;}this.settings.startAtMm=checkpoint.drawingMm;this.persist();void this.prepare();return;}
    if(action==='clear-checkpoint'){this.plotter.clearCheckpoint();this.settings.startAtMm=0;this.persist();void this.prepare();return;}
    if (action === 'bounds-preview') {
      if (!this.plan?.passes.length || this.job || this.inputError) return;
      try { if (this.connectionTarget && supportsHardwareProfile(this.settings.profile)) { this.destination = this.connectionTarget; void this.startHardware(false,true).catch(error=>{this.error=(error as Error).message; this.render();}); } else this.startSimulation(true); }
      catch (error) { this.error=(error as Error).message; this.render(); }
      return;
    }
    if (action === 'choose-simulation') { this.destination = 'simulation'; this.session = this.job ? 'planning' : 'ready'; this.render(); if (this.job) void this.prepare(true); else if (this.plan) this.startSimulation(); else void this.prepare(true); return; }
    if (action === 'start') {
      if (!this.connectionTarget) return;
      this.destination = this.connectionTarget;
      this.simulation?.destroy(); this.simulation = null; this.simulationView = null;
      void this.startHardware(); return;
    }
    if (action === 'all') this.preferences.excluded = [];
    if (action === 'reset-pens') { this.preferences.assignments = {}; this.preferences.order = []; this.inputError = ''; }
    if (action === 'only') this.preferences.excluded = this.pens.filter(pen => pen.color !== button.dataset.pen).flatMap(pen => pen.sources);
    if (action === 'up' || action === 'down') {
      const colors = this.pens.map(pen => pen.color), index = colors.indexOf(button.dataset.pen!);
      const next = index + (action === 'up' ? -1 : 1);
      if (index < 0 || next < 0 || next >= colors.length || this.preferences.mode === 'source') return;
      [colors[index], colors[next]] = [colors[next]!, colors[index]!]; this.preferences.order = colors;
    }
    if (['all', 'only', 'up', 'down', 'reset-pens'].includes(action)) { this.persist(); void this.prepare(); }
  };

  private async disconnect(): Promise<void> {
    if (this.locked) return;
    try { await this.plotter.disconnect(); this.deviceLabel = ''; this.destination = this.connectionTarget; this.session = this.plan ? 'ready' : 'choosing'; }
    catch (error) { this.error = (error as Error).message; }
    this.render();
  }

  private get serverOwnsLocalUsb() {
    return ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) && !!this.network?.connected;
  }

  private async serverConnection(action: string): Promise<void> {
    if (this.manualBusy || !this.network || (action !== 'release-control' && this.locked)) return;
    this.manualBusy = true; this.error = ''; this.render();
    try {
      if (action === 'release-control') await this.network.releaseControl();
      else if (action === 'disconnect-local-usb') await this.localPlotter.disconnect();
      else if (action === 'connect-ebb') {
        if (this.localPlotter.connected && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) throw new Error('Disconnect Direct USB on this computer before connecting the same EBB through the server.');
        await this.network.connectEbb();
      } else {
        if (!this.network.hasControl) await this.network.connect();
        await this.network.disconnectEbb(this.settings);
        this.notice = action === 'release-server-usb' ? 'Server USB released. Click Connect to use Direct USB. Set the origin again after connecting.' : 'Plotter disconnected.';
      }
    } catch (error) { this.error = (error as Error).message; }
    finally { this.manualBusy = false; this.render(); }
  }

  private onInput = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    if (!input.matches('[data-pen-hex],[data-plot-setting][type=number]') || this.locked) return;
    const hex = input.matches('[data-pen-hex]');
    if (hex) input.setCustomValidity(/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(input.value.trim()) ? '' : 'Enter a hex color such as #C43A32.');
    const valid = input.checkValidity();
    input.setAttribute('aria-invalid', String(!valid));
    this.inputError = valid ? '' : hex ? 'Enter a hex color such as #C43A32.' : 'Enter a valid value within the displayed range.';
    this.syncPlayer();
  };

  private onFocusOut = (event: Event): void => {
    if ((event.target as Element).matches('[data-pen-hex],[data-pen-name],[data-plot-setting][type=number]')) this.onChange(event);
  };
  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Enter' && (event.target as Element).matches('[data-pen-hex],[data-pen-name],[data-plot-setting][type=number]')) { event.preventDefault(); this.onChange(event); }
  };

  private onChange = (event: Event): void => {
    const input = event.target as HTMLInputElement | HTMLSelectElement;
    if (input.matches('[data-sim-timeline]')) { this.simulation?.seek(Number(input.value)); return; }
    if (input.matches('[data-sim-rate]')) { this.rate = Number(input.value); this.simulation?.setRate(this.rate); return; }
    if (this.locked) return;
    if(input.matches('[data-layer-setting]')){if(input instanceof HTMLInputElement&&!input.checkValidity()){this.inputError='Enter a valid layer setting.';this.syncPlayer();return;}const id=input.dataset.layerId!,key=input.dataset.layerSetting!;this.settings.layerOverrides??={};const previous=this.settings.layerOverrides[id]??{};this.settings.layerOverrides[id]={...previous,[key]:input instanceof HTMLInputElement&&input.type==='checkbox'?input.checked:Number(input.value)};this.persist();void this.prepare();return;}
    if (input.matches('[data-plot-destination]')) {
      this.connectionTarget = input.value === 'machine' || input.value === 'network' ? input.value : null;
      this.destination = this.connectionTarget;
      this.deviceLabel = '';
      this.plotter = this.destination === 'network' && this.network ? this.network : this.localPlotter;
      if (!this.plotter.active && supportsHardwareProfile(this.settings.profile)) this.plotter.configurePen(this.settings);
      if (this.destination === 'network' && this.network?.active) void this.attachNetworkJob();
      else void this.prepare();
      return;
    }
    if (input.matches('[data-pen-include]')) {
      const pen = this.pens.find(pen => pen.color === input.dataset.penInclude)!;
      this.preferences.excluded = this.preferences.excluded.filter(source => !pen.sources.includes(source));
      if (!(input as HTMLInputElement).checked) this.preferences.excluded.push(...pen.sources);
    } else if (input.matches('[data-pen-hex],[data-pen-picker],[data-pen-name]')) {
      const color = input.dataset.penHex ?? input.dataset.penPicker ?? input.dataset.penName!;
      const pen = this.pens.find(pen => pen.color === color); if (!pen) return;
      let newColor = color;
      if (!input.matches('[data-pen-name]')) {
        if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(input.value.trim())) { this.inputError = 'Enter a hex color such as #C43A32.'; input.setAttribute('aria-invalid', 'true'); this.syncPlayer(); return; }
        newColor = canonicalColor(input.value);
      }
      const name = input.matches('[data-pen-name]') ? input.value.trim().slice(0, 80) : pen.name;
      const merging = this.pens.find(other => other.color === newColor && other !== pen);
      if ([...pen.sources, ...(merging?.sources ?? [])].every(source => {
        const previous = this.preferences.assignments[source];
        return (previous?.color ?? source) === newColor && (previous?.name ?? '') === (name || merging?.name || '');
      })) { this.inputError = ''; this.syncPlayer(); return; }
      for (const source of [...pen.sources, ...(merging?.sources ?? [])]) this.preferences.assignments[source] = { color: newColor, name: name || merging?.name || '' };
      if (pen.included || merging?.included) this.preferences.excluded = this.preferences.excluded.filter(source => !pen.sources.includes(source) && !merging?.sources.includes(source));
      this.preferences.order = [...new Set(this.preferences.order.map(color => color === pen.color ? newColor : color))];
      this.inputError = '';
    } else if (input.matches('[data-plot-setting]')) {
      const key = input.dataset.plotSetting as keyof PlotSettings | 'continuousCopies';
      if (input instanceof HTMLInputElement && !input.checkValidity()) { this.inputError = 'Enter a valid value within the displayed range.'; this.syncPlayer(); return; }
      this.inputError = '';
      const next = key === 'profile' || key === 'reorderMode' || key === 'axidrawModel' || key === 'nextdrawModel' || key === 'closedPathStart' || key==='drawingMode' || key==='motionPreference' || key==='handling'||key==='nextdrawServo'||key==='previewFilter'||key==='axidrawHardwareModel' ? input.value : ['returnToOrigin','repeatRequireContinue','continuousCopies','automaticPlacement','pageClipping','hiddenLineRemoval','strictOrder','synchronizedB3','varyClosedStarts'].includes(key) ? (input as HTMLInputElement).checked : Number(input.value);
      if (key!=='continuousCopies'&&this.settings[key] === next) { this.syncPlayer(); return; }
      if (key === 'profile') {
        if (input.value !== this.settings.profile && this.plotter.connected) this.plotter.invalidateOrigin();
        this.settings.profile = input.value as PlotSettings['profile'];
      } else if (key === 'reorderMode') this.settings.reorderMode = input.value as PlotSettings['reorderMode'];
      else if(key==='motionPreference')this.settings.motionPreference=input.value as PlotSettings['motionPreference'];
      else if(key==='handling'){if(this.plotter.connected)this.plotter.invalidateOrigin();this.settings.handling=input.value as PlotSettings['handling'];const resolved=coreOptions(this.settings);Object.assign(this.settings,{speed:resolved.speed,resolution:resolved.profile.motorMode===1?16:8,curveToleranceMm:resolved.curveToleranceMm,drawingJerk:resolved.drawingJerk,travelJerk:resolved.travelJerk});}
      else if(key==='axidrawHardwareModel'){this.settings.axidrawHardwareModel=input.value as PlotSettings['axidrawHardwareModel'];if(this.plotter.connected)this.plotter.invalidateOrigin();}
      else if(key==='nextdrawServo'){this.settings.nextdrawServo=input.value as PlotSettings['nextdrawServo'];if(this.plotter.connected)this.plotter.invalidateOrigin();}
      else if(key==='previewFilter')this.settings.previewFilter=input.value as PlotSettings['previewFilter'];
      else if(['automaticPlacement','pageClipping','hiddenLineRemoval','strictOrder','synchronizedB3','varyClosedStarts'].includes(key))(this.settings as unknown as Record<string,boolean>)[key]=(input as HTMLInputElement).checked;
      else if(key==='continuousCopies')this.settings.copies=(input as HTMLInputElement).checked?'continuous':1;
      else if(key==='repeatRequireContinue')this.settings.repeatRequireContinue=(input as HTMLInputElement).checked;
      else if(key==='drawingMode')this.settings.drawingMode=input.value as PlotSettings['drawingMode'];
      else if(key==='resolution'){if(this.plotter.connected)this.plotter.invalidateOrigin();this.settings.resolution=Number(input.value) as 8|16;}
      else if (key === 'closedPathStart') this.settings.closedPathStart = input.value as PlotSettings['closedPathStart'];
      else if (key === 'nextdrawModel') this.settings.nextdrawModel = restoreNextDrawModel(input.value);
      else if (key === 'axidrawModel') this.settings.axidrawModel = setupModel(input.value);
      else if (key === 'returnToOrigin') this.settings.returnToOrigin = (input as HTMLInputElement).checked;
      else (this.settings as unknown as Record<string, number>)[key] = Number(input.value);
      if(['speed','drawingJerk','travelJerk','curveToleranceMm','resolution'].includes(key))this.settings.handling='custom';
      if (supportsHardwareProfile(this.settings.profile) && ['penUp','penDown','penRateRaise','penRateLower','penDelayUpMs','penDelayDownMs','penReloadWaitMs'].includes(key)) this.plotter.configurePen(this.settings);
    } else if (input.matches('[data-color-mode]')) this.preferences.mode = input.value as PenPreferences['mode'];
    else return;
    this.persist(); void this.prepare(false, input.matches('[data-plot-setting][type=number]'));
  };

  private render(): void {
    if (this.closed) return;
    const detailStates = new Map([...this.panel.querySelectorAll<HTMLDetailsElement>('details[data-section]')].map(node => [node.dataset.section, node.open]));
    const scroll = this.panel.querySelector<HTMLElement>('.plot-scroll')?.scrollTop ?? 0;
    const active = document.activeElement instanceof HTMLElement && this.panel.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = active && this.panel.contains(active) ? active.getAttribute('data-focus-key') : null;
    const focusAction = active?.getAttribute('data-plot-action');
    const focusPen = active?.getAttribute('data-pen');
    const focusSetting = active?.getAttribute('data-plot-setting');
    const focusDestination = active?.hasAttribute('data-plot-destination');
    const focusSection = active?.matches('summary') ? active.parentElement?.dataset.section : null;
    this.panel.innerHTML = plotWorkspaceMarkup({ busy:this.busy, destination:this.destination, connectionTarget:this.connectionTarget, deviceLabel:this.deviceLabel, documentState:this.documentState, error:this.error, inputError:this.inputError, job:!!this.job, localPlotter:this.localPlotter, locked:this.locked, manualBusy:this.manualBusy, network:this.network, pens:this.pens, plan:this.plan, plotter:this.plotter, preferences:this.preferences, rate:this.rate, serverOwnsLocalUsb:this.serverOwnsLocalUsb, session:this.session, settings:this.settings, penLabel:color=>this.penLabel(color) });
    this.panel.querySelectorAll<HTMLDetailsElement>('details[data-section]').forEach(node => {
      if (detailStates.has(node.dataset.section)) node.open = detailStates.get(node.dataset.section)!;
    });
    this.syncPlayer(); this.syncPasses();
    if (active) {
      let target = focusKey ? this.panel.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`) : focusAction ? this.panel.querySelector<HTMLElement>(`[data-plot-action="${CSS.escape(focusAction)}"]${focusPen ? `[data-pen="${CSS.escape(focusPen)}"]` : ''}`) : focusSetting ? this.panel.querySelector<HTMLElement>(`[data-plot-setting="${CSS.escape(focusSetting)}"]`) : focusDestination ? this.panel.querySelector<HTMLElement>('[data-plot-destination]') : focusSection ? this.panel.querySelector<HTMLElement>(`details[data-section="${CSS.escape(focusSection)}"] > summary`) : null;
      if (target instanceof HTMLInputElement && active instanceof HTMLInputElement && active.type === 'number' && active.hasAttribute('data-plot-setting')) {
        // Keep the editing field itself, including any newer uncommitted value.
        active.disabled = target.disabled; target.replaceWith(active); target = active;
      }
      if (target && !target.hidden && !(target as HTMLButtonElement).disabled) target.focus({ preventScroll: true });
      else (this.panel.querySelector<HTMLElement>('[data-plot-action="pause"]:not([hidden]):not(:disabled)') ?? this.panel.querySelector<HTMLElement>('.plot-scroll > details > summary'))?.focus({ preventScroll: true });
    }
    this.panel.querySelector<HTMLElement>('.plot-scroll')!.scrollTop = scroll;
  }

  private syncPlayer(): void {
    if (this.closed) return;
    const focusedControl = document.activeElement instanceof HTMLButtonElement && this.panel.contains(document.activeElement) ? document.activeElement : null;
    const displayPlan = this.playbackPlan ?? this.plan;
    const view = this.simulationView;
    const signal = view?.signal && view.state !== 'running' ? { ...view.signal, penDown: false, penHeight: this.settings.penUp } : view?.signal ?? null;
    this.penCounter.update(signal, this.destination === 'simulation' && !!displayPlan);
    const player = this.panel.querySelector<HTMLElement>('.plot-player'); if (!player) return;
    const setText = (selector: string, text: string) => { const node = player.querySelector<HTMLElement>(selector)!; if (node.textContent !== text) node.textContent = text; };
    const simulationActive = !!this.simulationView && !['finished', 'stopped'].includes(this.session);
    const active = this.executing || simulationActive;
    if (active && !this.root.classList.contains('plot-playing')) {
      this.panel.querySelector<HTMLDetailsElement>('[data-section="pens"]')!.open = true;
    }
    this.root.classList.toggle('plot-playing', active);
    this.root.classList.toggle('plot-paused', this.session === 'paused' || this.session === 'tool-change');
    this.panel.querySelector<HTMLElement>('[data-plot-pens-title]')!.textContent = active ? 'Pen passes' : 'Pens & passes';
    const terminal = ['finished', 'stopped'].includes(this.session);
    const waiting = this.session === 'tool-change';
    const pass = this.currentPass();
    const color = displayPlan?.passes[pass]?.tool ?? '';
    const schedule=this.destination==='simulation'?this.simulationView:this.progress;
    const scheduleText=schedule?.nextAction==='delay'?`Copy ${schedule.copy}/${schedule.copies} · Next copy in ${clock((schedule.remainingMs??0)/1000)}`:schedule?.nextAction==='continue'?`Copy ${schedule.copy}/${schedule.copies} · Continue for the next copy`:null;
    const status = scheduleText??(waiting&&schedule?.pauseReason==='layer'?`Layer ${schedule.label??''} · Continue when ready`:null)??(this.job ? this.task?.label ?? 'Preparing preview' : this.error ? 'Plot needs attention' : !supportsHardwareProfile(this.settings.profile) && ['choosing','ready'].includes(this.session) ? 'Ready to simulate' : waiting ? `Load ${this.penLabel(color)} — pass ${pass + 1} of ${displayPlan?.passes.length}` : ({ choosing: 'Choose a destination to plot', ready: this.connectionTarget && (!this.plotter.connected || this.connectionTarget === 'network' && !this.network?.hasControl) ? 'Connect to plot' : 'Ready to plot', running: this.destination === 'simulation' ? 'Simulating' : 'Plotting', pausing: 'Pausing…', paused: 'Paused · pen lifted', stopping: 'Stopping…', returning: 'Returning to origin', finished: 'Complete', stopped: this.destination === 'simulation' ? 'Stopped · simulation reset' : 'Stopped · returned to origin', error: 'Prepare a new job', planning: 'Preparing preview', 'tool-change': '' } satisfies Record<PlotSessionState, string>)[this.session]);
    this.canvasStatus.text('[data-player-status]', this.previewingBounds && (active || terminal) ? `Bounds preview · ${status}` : !scheduleText&&schedule?.copy?`Copy ${schedule.copy}/${schedule.copies} · ${status}`:status);
    setText('[data-player-pen]', schedule?.nextAction?`Pen raised at origin · ${schedule.nextAction==='delay'?'Waiting':'Ready to continue'}`:color ? active || terminal ? `Pass ${pass + 1} of ${displayPlan?.passes.length} · ${this.penLabel(color)}` : `Load ${this.penLabel(displayPlan!.passes[0]!.tool)}` : '');
    const time = this.destination === 'simulation' ? this.simulationView?.time ?? 0 : this.hardwareView?.time ?? 0;
    const percent = this.job ? Math.round((this.task?.fraction ?? 0) * 100) : this.destination === 'simulation' ? displayPlan?.duration ? Math.round(time / displayPlan.duration * 100) : 0 : this.hardwareView?.percent ?? 0;
    this.canvasStatus.text('[data-player-time]', !this.job && displayPlan?.passes.length ? this.destination === 'simulation' && (active || terminal) ? `${clock(time)} / ${clock(displayPlan.duration)} · ${percent}%` : `${active || terminal ? `${percent}% · ` : ''}Estimate ${clock(displayPlan.duration)}` : '');
    const completed=this.plotter.completedCheckpoint?.drawingMm??0;
    this.canvasStatus.text('[data-plot-distances]', !this.job&&active&&this.destination!=='simulation'&&this.statistics?`Drawn ${completed.toFixed(1)} mm · Remaining ${Math.max(0,this.statistics.drawingMm-completed).toFixed(1)} mm` : !this.job && !active && this.statistics ? `Drawing ${this.statistics.drawingMm.toFixed(1)} mm · Travel ${this.statistics.travelMm.toFixed(1)} mm · ↑${this.statistics.penUp} ↓${this.statistics.penDown}` : '');
    if(!active&&this.statistics?.aggregateSeconds!==undefined)this.canvasStatus.text('[data-player-time]',`Per copy ${clock(displayPlan?.duration??0)} · ${this.statistics.aggregateSeconds===null?'Total time depends on Continue or Stop':`Total ${clock(this.statistics.aggregateSeconds)} including waits`}`);
    this.canvasStatus.text('[data-plot-elapsed]', this.destination !== 'simulation' && (active || terminal || !!this.live) ? `Elapsed ${clock(this.plotter.elapsedMs/1000)}` : '');
    const supply = this.canvasStatus.element.querySelector<HTMLElement>('[data-power-status]')!;
    supply.hidden = !supportsHardwareProfile(this.settings.profile) || this.destination!=='machine' && this.destination!=='network';
    if (!supply.hidden) { this.canvasStatus.text('[data-power-status]', powerStatusLabel(this.plotter.powerStatus)); supply.dataset.state=this.plotter.powerStatus.state; }
    const hardware = supportsHardwareProfile(this.settings.profile);
    const boundsButton=this.panel.querySelector<HTMLButtonElement>('[data-plot-action="bounds-preview"]');
    if (boundsButton) boundsButton.disabled=active||this.manualBusy||!!this.job||!!this.inputError||!this.plan?.passes.length||hardware&&!!this.connectionTarget&&(!this.plotter.connected||this.connectionTarget==='network'&&!this.network?.hasControl);
    if (boundsButton) boundsButton.hidden = active;
    const connectButton = this.panel.querySelector<HTMLButtonElement>('[data-plot-action="connect"]');
    if (connectButton) connectButton.disabled = !hardware || !this.connectionTarget || !this.plotter.supported || this.manualBusy || this.plotter.connecting || active && !(this.executing && this.connectionTarget === 'network' && !this.network?.hasControl) || this.connectionTarget === 'machine' && this.serverOwnsLocalUsb;
    this.panel.querySelectorAll<HTMLButtonElement>('[data-plot-action="disconnect"],[data-plot-action="disconnect-ebb"]').forEach(control => { control.disabled = active || this.manualBusy || this.plotter.connecting; });
    const simulateButton = this.panel.querySelector<HTMLButtonElement>('[data-plot-action="choose-simulation"]')!;
    simulateButton.hidden = active; simulateButton.disabled = this.locked || !!this.job || !!this.inputError || !this.plan?.passes.length;
    const bar = player.querySelector<HTMLProgressElement>('[data-player-progress]')!; bar.value = percent;
    if (this.job && this.task?.fraction === undefined) bar.removeAttribute('value');
    bar.hidden = !this.job && !active && !terminal;
    const error = player.querySelector<HTMLElement>('[data-player-error]')!; error.hidden = !(this.error || this.inputError); setText('[data-player-error]', this.inputError || this.error);
    const empty = !this.job && displayPlan && !displayPlan.passes.length ? this.pens.some(pen => pen.included) ? 'No drawing paths remain at the machine’s resolution.' : this.pens.length ? 'Select at least one pen to plot.' : 'Add artwork to plot.' : '';
    this.canvasStatus.text('[data-player-notice]', empty || this.notice);
    const button = (action: string) => player.querySelector<HTMLButtonElement>(`[data-plot-action="${action}"]`)!;
    button('start').hidden = active || !!this.job || this.session === 'error';
    button('start').disabled = !hardware || !this.connectionTarget || !displayPlan?.passes.length || !!this.inputError || this.locked || !this.plotter.connected || this.connectionTarget === 'network' && !this.network?.hasControl;
    button('start').querySelector('span')!.textContent = terminal && this.destination !== 'simulation' ? 'Plot again' : 'Start with this pen';
    button('pause').hidden = !active;
    button('pause').disabled = this.destination === 'network' && (!this.network?.hasControl || !this.network.networkConnected) || this.manualBusy || ['pausing', 'stopping', 'returning', 'finished', 'stopped', 'error'].includes(this.session) || !!this.error;
    button('pause').querySelector('span')!.textContent = schedule?.nextAction==='continue'?'Continue to next copy':schedule?.pauseReason==='layer'?'Continue layer':waiting ? 'Continue with this pen' : this.session === 'paused' ? 'Resume' : 'Pause';
    button('pause').querySelector('svg')!.outerHTML = icon(this.session === 'running' ? 'pause' : 'play');
    button('stop').hidden = !active; button('stop').disabled = this.destination === 'network' && (!this.network?.hasControl || !this.network.networkConnected) || ['stopping', 'returning', 'finished', 'stopped'].includes(this.session);
    button('cancel-plan').hidden = !this.job;
    button('retry').hidden = this.session !== 'error' && !(this.notice === 'Preview preparation cancelled.'); button('retry').disabled = this.locked;
    const timeline = player.querySelector<HTMLInputElement>('[data-sim-timeline]')!;
    timeline.max=String(displayPlan?.duration??0);timeline.disabled = !this.simulation || !!this.job; timeline.value = String(time);
    const simControls = player.querySelector<HTMLElement>('.plot-sim-controls')!; simControls.hidden = this.destination !== 'simulation' || !this.simulation;
    this.root.querySelector<HTMLButtonElement>('[data-action="edit-mode"]')!.disabled = this.busy;
    // Playback updates preserve focus and never rebuild the sidebar each frame.
    this.panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-pen-include],[data-pen-picker],[data-pen-hex],[data-pen-name],[data-plot-setting],[data-layer-setting],[data-color-mode],[data-plot-destination]').forEach(input => {
      const penHeight = input.getAttribute('data-plot-setting') === 'penUp' || input.getAttribute('data-plot-setting') === 'penDown';
      const preparingPens = !!this.job && input.matches('[data-pen-include],[data-pen-picker],[data-pen-hex],[data-pen-name]');
      const key=input.getAttribute('data-plot-setting');
      input.disabled = key==='copies'&&this.settings.copies==='continuous'||key==='drawingJerk'&&(this.settings.motionPreference!=='scurve'||this.settings.drawingMode==='constant')||key==='travelJerk'&&this.settings.motionPreference!=='scurve'||!hardware && input.matches('[data-plot-destination]') || active || this.manualBusy || this.plotter.connecting || preparingPens || (penHeight && !this.plotter.connected) || input.getAttribute('data-plot-setting') === 'reorderMode' && this.preferences.mode === 'source' || input.getAttribute('data-plot-setting') === 'pathRandomSeed' && this.settings.closedPathStart !== 'random';
    });
    this.panel.querySelectorAll<HTMLButtonElement>('[data-plot-action="all"],[data-plot-action="only"],[data-plot-action="up"],[data-plot-action="down"],[data-plot-action="reset-pens"]').forEach(node => {
      const action = node.dataset.plotAction;
      const index = this.pens.findIndex(pen => pen.color === node.dataset.pen);
      node.disabled = active || !!this.job || this.manualBusy || this.plotter.connecting || (action === 'up' || action === 'down') && (this.preferences.mode === 'source' || action === 'up' && index === 0 || action === 'down' && index === this.pens.length - 1);
    });
    this.panel.querySelectorAll<HTMLButtonElement>('[data-plot-action="pen-up"],[data-plot-action="pen-down"]').forEach(node => { node.disabled = this.manualBusy || !this.plotter.canAdjustPen || this.destination === 'simulation' && active; });
    if (focusedControl?.hidden) {
      const next = [...player.querySelectorAll<HTMLButtonElement>('button')].find(control => !control.hidden && !control.disabled);
      next?.focus({preventScroll:true});
    }
    const originState = this.panel.querySelector<HTMLElement>('.plot-origin-state');
    if (originState) {
      const hasOrigin = this.plotter.hasOrigin(this.settings.profile);
      originState.textContent = originLabel(this.plotter.originStatus, hasOrigin);
    }
  }
  private currentPass(): number {
    const displayPlan = this.playbackPlan ?? this.plan;
    if (!displayPlan) return 0;
    if (this.destination === 'simulation') return this.simulationView?.pass ?? 0;
    let index = 0;
    displayPlan.passes.forEach((pass, i) => { if (pass.startEvent < this.progress.completed || this.progress.state === 'tool-change' && pass.startEvent === this.progress.completed) index = i; });
    return index;
  }
  private syncPasses(): void {
    const pass = this.currentPass();
    const started = !!this.simulation || !!this.live;
    this.panel.querySelectorAll<HTMLElement>('[data-pass-index]').forEach(row => {
      const index = Number(row.dataset.passIndex);
      const state = this.session === 'finished' ? 'Completed' : started && !(this.session === 'stopped' && this.destination === 'simulation') ? index < pass ? 'Completed' : index === pass ? this.session === 'stopped' ? 'Stopped' : 'Current' : 'Upcoming' : 'Upcoming';
      row.dataset.state = state.toLowerCase(); row.querySelector('[data-pass-state]')!.textContent = state;
    });
  }
  destroy(): void {
    this.penCounter.destroy();
    if (this.busy || this.closed) return;
    this.closed = true; if (this.elapsedTimer) clearInterval(this.elapsedTimer); void this.network?.disconnect(); ++this.revision; this.job?.cancel(); this.simulation?.destroy(); this.live?.destroy(); this.visual?.destroy();
    this.releaseEvents(); this.canvasStatus.destroy();
    this.panel.replaceChildren(this.savedEditor); this.panel.classList.remove('plot-sidebar'); this.panel.removeAttribute('data-plot-sidebar'); this.panel.scrollTop = this.editorScroll;
    this.root.classList.remove('plot-mode', 'plot-running', 'plot-playing', 'plot-paused'); this.root.removeAttribute('data-plot-mode'); this.savedInert.forEach((inert, node) => { node.inert = inert; });
    this.onExit();
  }
}
