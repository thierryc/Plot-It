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
import { DEFAULT_MACHINE_ROTATION } from './model';
import { MACHINE_ORIENTATIONS } from './motion';
import { PLOTTER_POSITIONS, setupModel } from './plotter-setup';

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const clock = (time: number) => `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`;
const countLabel = (count: number, singular: string, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`;
export type PlotSessionState = 'choosing' | 'planning' | 'ready' | 'running' | 'pausing' | 'paused' | 'tool-change' | 'stopping' | 'returning' | 'finished' | 'stopped' | 'error';

/** One owner for preparation, preview, connection, simulation and physical playback. */
export class PlotWorkspace {
  private panel: HTMLElement;
  private paper: SVGSVGElement;
  private savedEditor = document.createDocumentFragment();
  private editorScroll: number;
  private savedInert = new Map<HTMLElement, boolean>();
  private session: PlotSessionState = 'choosing';
  private destination: 'machine' | 'network' | 'simulation' | null;
  private readonly localPlotter: PlotDestination;
  private network: NetworkPlotter | null = null;
  private attaching = false;
  private plan: MotionPlan | null = null;
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
    this.plotter.configurePen(this.settings);
    this.preferences = restorePens(documentState.pens);
    this.destination = plotter.connected ? 'machine' : null;
    this.panel = root.querySelector<HTMLElement>('.inspector')!;
    this.paper = root.querySelector<SVGSVGElement>('#paper')!;
    this.editorScroll = this.panel.scrollTop;
    while (this.panel.firstChild) this.savedEditor.append(this.panel.firstChild);
    root.querySelector<HTMLElement>('#settings-popover')?.hidePopover();
    root.querySelector<HTMLElement>('#more-elements')?.hidePopover();
    root.querySelectorAll<HTMLElement>('.tool-rail,.top-actions [data-action="undo"],.top-actions [data-action="redo"],.canvas-size-button,.empty-state').forEach(node => { this.savedInert.set(node, node.inert); node.inert = true; });
    this.paper.querySelectorAll('.selection-ui,.editor-hit-layer').forEach(node => node.remove());
    this.panel.classList.add('plot-sidebar'); this.root.classList.add('plot-mode');
    root.querySelector('[data-action="edit-mode"]')!.setAttribute('aria-pressed', 'false');
    root.querySelector('[data-action="open-plot"]')!.setAttribute('aria-pressed', 'true');
    this.panel.addEventListener('click', this.onClick);
    this.panel.addEventListener('change', this.onChange);
    this.panel.addEventListener('input', this.onInput);
    this.panel.addEventListener('focusout', this.onFocusOut);
    this.panel.addEventListener('keydown', this.onKeyDown);
    this.render(); this.panel.querySelector<HTMLElement>('h2')?.focus();
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
      this.plan = plan; this.session = 'ready'; this.render();
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
    const status = this.root.querySelector<HTMLElement>('.statusbar > span');
    if (status) status.textContent = this.plotter.connected ? `EBB connected · Firmware ${this.plotter.firmwareLabel}` : 'Plotter not connected';
    if (!this.plotter.connected && this.executing) {
      if (this.destination === 'network') this.notice = this.network?.networkConnected ? 'Server connected, but the EBB is unavailable. Check the interrupted job before restarting.' : 'Network feedback unavailable. Reconnect to check the current job state.';
      else this.error = 'The plotter disconnected. Reconnect and prepare a new job.';
    } else if (this.destination === 'network' && this.network?.networkConnected) this.notice = '';
    if (this.destination === 'network' && this.network?.active && !this.executing && !this.attaching) void this.attachNetworkJob();
    this.render();
  }

  private async prepare(autoPlay = false): Promise<void> {
    if (this.executing || this.closed) return;
    const revision = ++this.revision;
    this.job?.cancel(); this.job = null;
    this.simulation?.destroy(); this.simulation = null; this.simulationView = null;
    this.live?.destroy(); this.live = null; this.hardwareView = null;
    this.visual?.destroy(); this.visual = null;
    this.plan = null;
    this.error = ''; this.notice = ''; this.task = { label: 'Preparing preview' };
    this.session = 'planning'; this.root.classList.remove('plot-running'); this.render();
    const job = prepareJob(this.paper, this.documentState.paper, this.settings, task => {
      if (revision !== this.revision || this.closed) return;
      this.task = task; this.syncPlayer();
    }, this.preferences);
    this.job = job;
    try {
      const plan = await job.promise;
      if (revision !== this.revision || this.closed) return;
      this.plan = plan;
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
    this.plan = null; this.session = this.destination ? 'ready' : 'choosing'; this.notice = 'Preview preparation cancelled.'; this.render();
  }

  private async connect(): Promise<void> {
    if (this.manualBusy || this.plotter.connecting || this.locked && this.destination !== 'network' || this.plotter.connected && (this.destination !== 'network' || this.network?.hasControl)) return;
    if (this.destination !== 'network') { this.destination = 'machine'; this.plotter = this.localPlotter; }
    if (this.destination === 'machine' && this.serverOwnsLocalUsb) { this.error = 'The local Node server owns the EBB. Release server USB, then click Connect.'; this.render(); return; }
    this.error = '';
    try { this.deviceLabel = await this.plotter.connect(); if (!this.job) this.session = 'ready'; }
    catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) this.error = (error as Error).message;
    }
    this.render();
  }

  private startSimulation(): void {
    if (!this.plan?.passes.length || this.inputError || this.job || this.locked) return;
    this.destination = 'simulation'; this.visual?.destroy(); this.visual = new PlotOverlay(this.plan, this.paper);
    this.simulation?.destroy(); this.simulation = null;
    this.session = 'running'; this.root.classList.add('plot-running'); this.render();
    this.simulation = new Simulation(this.plan, view => {
      this.simulationView = view; this.session = view.state;
      this.visual?.update(view.time, { position: view.state === 'stopped' || view.state === 'tool-change' ? { x: 0, y: 0 } : undefined, penDown: view.state !== 'running' ? false : undefined });
      this.syncPlayer(); this.syncPasses();
    });
    this.simulation.setRate(this.rate);
  }

  private async startHardware(resumeNetworkJob = false): Promise<void> {
    if (!this.plan?.passes.length || this.inputError || this.job || this.locked || !this.plotter.connected) return;
    const plan = this.plan;
    this.visual?.destroy(); this.visual = null; this.live?.destroy();
    this.executing = true; this.error = ''; this.session = 'running'; this.progress = { completed: 0, total: plan.events.length, state: 'plotting' };
    this.root.classList.add('plot-running'); this.render();
    this.live = new LivePlot(plan, this.paper, (view, progress) => {
      this.hardwareView = view; this.progress = progress;
      this.session = progress.state === 'plotting' ? 'running' : progress.state === 'cancelled' ? 'error' : progress.state === 'idle' ? 'ready' : progress.state;
      this.syncPlayer(); this.syncPasses();
    });
    this.plotter.onPosition = position => this.live?.observePosition(position);
    this.plotter.onProgress = progress => this.live?.update(progress);
    try {
      if (resumeNetworkJob && this.network) { this.live.update(this.network.progress); await this.network.waitForJob(); }
      else await this.plotter.plot(plan);
    }
    catch (error) { this.error = (error as Error).message; }
    finally {
      this.plotter.onPosition = null; this.plotter.onProgress = () => undefined;
      this.executing = false; this.live?.finish();
      if (this.error || this.progress.state === 'cancelled') { this.session = 'error'; this.error ||= 'Plot cancelled. Prepare a new job before starting again.'; }
      else this.notice = 'Motors released. The next start will use the current position as origin.';
      this.render();
    }
  }

  private async manual(action: string): Promise<void> {
    const pen = action === 'pen-up' || action === 'pen-down';
    if (this.manualBusy || !this.plotter.connected || this.destination === 'network' && !this.network?.hasControl || (this.executing && (!pen || !this.plotter.canAdjustPen))) return;
    this.manualBusy = true; this.error = ''; this.render();
    const settings = this.executing && this.destination === 'network' && this.plan ? this.plan.settings : this.settings;
    try {
      if (pen) {
        if (!this.executing) this.plotter.configurePen(settings);
        await this.plotter.setPen(action === 'pen-up' ? settings.penUp : settings.penDown); this.live?.update(this.progress, action === 'pen-down');
      }
      if (action === 'set-origin') await this.plotter.setOrigin(this.settings.profile);
      if (action === 'return-origin') await this.plotter.returnToOrigin(this.settings);
      if (action === 'engage') await this.plotter.engageMotors();
      if (action === 'release') await this.plotter.disengageMotors(this.settings.penUp);
      this.notice = action === 'set-origin' ? 'Origin saved at the current carriage position.' : action === 'release' ? 'Motors released. The next start will use the current position as origin.' : 'Machine command complete.';
    } catch (error) { this.error = (error as Error).message; }
    finally { this.manualBusy = false; this.render(); }
  }

  private downloadMachineLog(): void {
      const blob = new Blob([JSON.stringify({format:'plot-it-machine-log',version:3,createdAt:new Date().toISOString(),firmware:this.plotter.firmwareLabel,penHeights:{up:this.settings.penUp,down:this.settings.penDown},entries:this.plotter.diagnosticTrace,penTransitions:this.plotter.diagnosticPenTrace,job:this.plotter.diagnosticJobTrace},null,2)],{type:'application/json'});
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = 'plot-it-machine-log.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url),1000);
  }

  private onClick = (event: Event): void => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-plot-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.plotAction!;
    if (action === 'machine-log' && this.destination === 'network' && this.network) {
      void this.network.refreshDiagnostics().then(() => this.downloadMachineLog()).catch(error => { this.notice = (error as Error).message; this.render(); }); return;
    }
    if (action === 'machine-log') {
      this.downloadMachineLog(); return;
    }
    if (action === 'mark-pen-movement') { this.plotter.markPenMovement(); this.notice = 'Pen movement marked in the machine log.'; this.syncPlayer(); return; }
    if (action === 'back') { if (!this.busy) this.destroy(); return; }
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
    if (['pen-up', 'pen-down', 'set-origin', 'return-origin', 'engage', 'release'].includes(action)) { void this.manual(action); return; }
    if (this.locked) return;
    if (action === 'choose-simulation') { this.destination = 'simulation'; this.session = this.job ? 'planning' : 'ready'; this.render(); if (this.job) void this.prepare(true); else if (this.plan) this.startSimulation(); else void this.prepare(true); return; }
    if (action === 'start') { this.destination === 'simulation' ? this.startSimulation() : void this.startHardware(); return; }
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
    try { await this.plotter.disconnect(); this.deviceLabel = ''; this.destination = null; this.session = 'choosing'; }
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
        this.notice = 'Server USB released. Click Connect to use Direct USB. Set the origin again after connecting.';
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
    if (input.matches('[data-plot-destination]')) {
      this.destination = input.value as 'machine' | 'network' | 'simulation';
      this.deviceLabel = '';
      this.plotter = this.destination === 'network' && this.network ? this.network : this.localPlotter;
      if (!this.plotter.active) this.plotter.configurePen(this.settings);
      if (this.destination === 'network' && this.network?.active) void this.attachNetworkJob();
      else void this.prepare(this.destination === 'simulation');
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
      const key = input.dataset.plotSetting as keyof PlotSettings;
      if (input instanceof HTMLInputElement && !input.checkValidity()) { this.inputError = 'Enter a valid value within the displayed range.'; this.syncPlayer(); return; }
      this.inputError = '';
      const next = key === 'profile' || key === 'reorderMode' || key === 'axidrawModel' ? input.value : key === 'returnToOrigin' ? (input as HTMLInputElement).checked : Number(input.value);
      if (this.settings[key] === next) { this.syncPlayer(); return; }
      if (key === 'profile') {
        if (input.value !== this.settings.profile && this.plotter.connected) this.plotter.invalidateOrigin();
        this.settings.profile = input.value as PlotSettings['profile'];
      } else if (key === 'reorderMode') this.settings.reorderMode = input.value as PlotSettings['reorderMode'];
      else if (key === 'axidrawModel') this.settings.axidrawModel = setupModel(input.value);
      else if (key === 'returnToOrigin') this.settings.returnToOrigin = (input as HTMLInputElement).checked;
      else (this.settings as unknown as Record<string, number>)[key] = Number(input.value);
      if (key === 'penUp' || key === 'penDown') this.plotter.configurePen(this.settings);
    } else if (input.matches('[data-color-mode]')) this.preferences.mode = input.value as PenPreferences['mode'];
    else return;
    this.persist(); void this.prepare();
  };

  private render(): void {
    if (this.closed) return;
    const openDetails = new Set([...this.panel.querySelectorAll<HTMLDetailsElement>('details[open]')].map(node => node.dataset.section));
    const scroll = this.panel.querySelector<HTMLElement>('.plot-scroll')?.scrollTop ?? 0;
    const active = document.activeElement instanceof HTMLElement && this.panel.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = active && this.panel.contains(active) ? active.getAttribute('data-focus-key') : null;
    const focusAction = active?.getAttribute('data-plot-action');
    const focusPen = active?.getAttribute('data-pen');
    const focusSetting = active?.getAttribute('data-plot-setting');
    const focusDestination = active?.hasAttribute('data-plot-destination');
    const locked = this.locked;
    const disabled = locked ? 'disabled' : '';
    this.panel.innerHTML = `<div class="plot-sidebar-head"><button class="button ghost" data-plot-action="back" ${this.busy ? 'disabled' : ''}>${icon('back')} Back to editing</button><h2 tabindex="-1">Plot</h2></div>
      <div class="plot-scroll">
        <section class="plot-section"><label>Destination<select data-plot-destination ${disabled}><option value="" ${this.destination === null ? 'selected' : ''} disabled>Choose a destination</option><option value="machine" ${this.destination === 'machine' ? 'selected' : ''}>Direct USB · this computer</option>${this.network ? `<option value="network" ${this.destination === 'network' ? 'selected' : ''}>Network plotter (Node server)</option>` : ''}<option value="simulation" ${this.destination === 'simulation' ? 'selected' : ''}>Simulation</option></select></label>
          ${this.destination === null ? `<div class="plot-choices"><button class="button primary" data-plot-action="choose-simulation">${icon('play')} Simulate</button><button class="button" data-plot-action="connect" ${!this.plotter.supported ? 'disabled' : ''}>${icon('usb')} Connect plotter</button></div>` : this.destination === 'network' ? `<div class="plot-connection"><span>${this.network?.networkConnected ? this.plotter.connected ? `Server connected · EBB ${escape(this.plotter.firmwareLabel ?? '')}` : this.plotter.connecting ? 'Server connected · Connecting EBB…' : 'Server connected · EBB disconnected' : 'Connecting to server…'}</span><button class="button ghost" data-plot-action="${this.network?.hasControl ? 'release-control' : 'connect'}" ${this.plotter.connecting || this.manualBusy ? 'disabled' : ''}>${this.network?.hasControl ? 'Release control' : 'Take control'}</button></div><div class="plot-connection"><button class="button" data-plot-action="${this.network?.connected ? 'disconnect-ebb' : 'connect-ebb'}" ${locked || this.manualBusy || this.plotter.connecting || !this.network?.hasControl ? 'disabled' : ''}>${this.network?.connected ? 'Disconnect EBB · release USB' : 'Connect EBB'}</button></div>${this.localPlotter.connected ? `<button class="button ghost" data-plot-action="disconnect-local-usb" ${locked || this.manualBusy ? 'disabled' : ''}>Disconnect Direct USB</button>` : ''}<p class="field-help">${this.network?.hasControl ? 'You control the server. ' : 'Viewing only. Take control to operate it. '}Disconnect EBB lifts the pen, releases motors and frees server USB while idle. The server executes the full job locally. Position updates show EBB counters; interpolation is estimated.</p>` : this.destination === 'machine' ? `<div class="plot-connection"><span>${this.plotter.connecting ? 'Connecting…' : this.plotter.connected ? `Connected · EBB ${escape(this.plotter.firmwareLabel ?? '')}` : 'Plotter not connected'}</span><button class="button ghost" data-plot-action="${this.plotter.connected ? 'disconnect' : 'connect'}" ${locked || this.manualBusy || !this.plotter.supported || !this.plotter.connected && this.serverOwnsLocalUsb ? 'disabled' : ''}>${this.plotter.connected ? 'Disconnect' : this.error ? 'Retry connection' : 'Connect'}</button></div>${this.serverOwnsLocalUsb ? `<p class="field-help">The local Node server owns the EBB. Release its USB connection before connecting directly.</p><button class="button" data-plot-action="release-server-usb" ${locked || this.manualBusy || this.network?.active ? 'disabled' : ''}>Release server USB</button>` : '<p class="field-help">USB connects to this computer. A remote server uses its own USB device.</p>'}` : '<p class="field-help">Simulation uses no hardware.</p>'}
          ${!this.plotter.supported ? '<p class="field-help">Connect using desktop Chrome or Edge. Simulation is available here.</p>' : ''}
        </section>
        <section class="plot-section plot-pens-section"><div class="plot-section-title"><h3>Pens & passes</h3><button class="button ghost" data-plot-action="all" ${disabled}>All pens</button></div>
          <p class="field-help plot-assignment-help">Assign your pens here. Artwork colors stay unchanged.</p>
          ${this.pens.length ? `<div class="plot-pens">${this.pens.map((pen, index) => this.penMarkup(pen, index, disabled)).join('')}</div>` : `<p class="field-help">${this.session === 'planning' ? 'Reading artwork colors…' : this.session === 'error' ? 'Pen preview is unavailable until preparation succeeds.' : 'Add artwork to plot, or check that paths are inside the safe margin.'}</p>`}
          <details data-section="passes"><summary data-pass-summary>${countLabel(this.pens.filter(pen => pen.included).length, 'pen')} · ${countLabel(this.plan?.passes.length ?? 0, 'pass', 'passes')}</summary><ol class="plot-pass-list">${this.plan?.passes.map((pass, index) => `<li data-pass-index="${index}"><span class="pen-swatch" style="background:${pass.tool}" aria-hidden="true"></span><span>${escape(this.penLabel(pass.tool))}</span><small data-pass-state>Upcoming</small></li>`).join('') ?? ''}</ol></details>
          ${(this.plan?.passes.length ?? 0) > this.pens.filter(pen => pen.included).length ? '<p class="field-help">Some pens repeat to preserve ordered text or fill operations.</p>' : ''}
          ${this.preferences.mode === 'source' ? '<p class="field-help">Pen order follows the artwork. Switch to Group by pen in Advanced to reorder.</p>' : ''}
        </section>
        <section class="plot-section plot-settings-section"><h3>Plot settings</h3><label>Machine profile<select data-plot-setting="profile" ${disabled}><option value="axidraw" ${this.settings.profile === 'axidraw' ? 'selected' : ''}>AxiDraw / EBB</option><option value="xylodraw" ${this.settings.profile === 'xylodraw' ? 'selected' : ''}>Xylodraw</option></select></label>
          ${this.settings.profile === 'axidraw' ? `<label>AxiDraw model<select data-plot-setting="axidrawModel" ${disabled}><option value="v3-a4" ${setupModel(this.settings.axidrawModel) === 'v3-a4' ? 'selected' : ''}>V3 · A4</option><option value="v3-a3" ${this.settings.axidrawModel === 'v3-a3' ? 'selected' : ''}>V3/A3 · A3</option></select></label>` : ''}
          <label>Plotter position<select data-plot-setting="machineRotation" data-focus-key="setup-position" ${disabled}>${PLOTTER_POSITIONS.map(({rotation,label}) => `<option value="${rotation}" ${(this.settings.machineRotation ?? DEFAULT_MACHINE_ROTATION) === rotation ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
          <p class="field-help">Position sets the machine orientation. The background follows the pen; Fit frames the paper.</p>
          ${this.numberSetting('speed', 'Drawing speed', 'mm/s', 1, 100, disabled)}
          <details data-section="advanced"><summary>Advanced</summary><div class="plot-detail-content">
            <label>Machine orientation<select data-plot-setting="machineRotation" ${disabled}>${MACHINE_ORIENTATIONS.map(({rotation, label}) => `<option value="${rotation}" ${(this.settings.machineRotation ?? DEFAULT_MACHINE_ROTATION) === rotation ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
            <p class="field-help">Standard uses the AxiDraw orientation. Other rotations are relative to Standard and use the pen origin.</p>
            <label>Color order<select data-color-mode ${disabled}><option value="group" ${this.preferences.mode === 'group' ? 'selected' : ''}>Group by pen</option><option value="source" ${this.preferences.mode === 'source' ? 'selected' : ''}>Follow artwork order</option></select></label>
            <label>Path order<select data-plot-setting="reorderMode" ${disabled || this.preferences.mode === 'source' ? 'disabled' : ''}><option value="preserve" ${this.settings.reorderMode === 'preserve' ? 'selected' : ''}>Preserve order within pen</option><option value="nearest" ${this.settings.reorderMode === 'nearest' ? 'selected' : ''}>Nearest path</option><option value="reversible" ${this.settings.reorderMode === 'reversible' ? 'selected' : ''}>Nearest + reverse</option></select></label>
            ${this.numberSetting('travelSpeed', 'Travel speed', 'mm/s', 1, 200, disabled)}${this.numberSetting('drawAcceleration', 'Draw acceleration', 'mm/s²', 1, undefined, disabled)}${this.numberSetting('travelAcceleration', 'Travel acceleration', 'mm/s²', 1, undefined, disabled)}${this.numberSetting('cornering', 'Cornering', 'mm', 0, undefined, disabled, '.001')}${this.numberSetting('maxPenDownMm', 'Maximum continuous line', 'mm', 0, undefined, disabled)}
            <p class="field-help">0 keeps lines continuous. Pen changes always pause at origin.</p><label class="check"><input type="checkbox" data-plot-setting="returnToOrigin" ${this.settings.returnToOrigin ? 'checked' : ''} ${disabled}><span>Return to origin when complete</span></label>
            <button class="button" data-plot-action="reset-pens" ${disabled}>Reset pen assignments</button>
          </div></details>
        </section>
        ${this.destination === 'machine' || this.destination === 'network' ? this.machineMarkup() : ''}
        <p class="field-help">${escape(this.documentState.paper.name)} · ${this.documentState.paper.width} × ${this.documentState.paper.height} mm</p>
        <p class="field-help" ${this.deviceLabel ? '' : 'hidden'}>${escape(this.deviceLabel)}</p>
      </div>
      <section class="plot-player" aria-label="Plot playback">
        <div class="plot-player-status" role="status" aria-live="polite" data-player-status></div>
        <p class="plot-current-pen" data-player-pen></p>
        <p class="plot-time" data-player-time></p>
        <progress max="100" value="0" aria-label="Plot progress" data-player-progress></progress>
        <div class="plot-sim-controls" ${this.destination === 'simulation' ? '' : 'hidden'}><input type="range" min="0" max="${this.plan?.duration ?? 0}" step=".01" value="0" aria-label="Simulation timeline" data-sim-timeline><label>Speed<select data-sim-rate aria-label="Playback speed">${[1, 2, 5, 10].map(rate => `<option value="${rate}" ${rate === this.rate ? 'selected' : ''}>${rate}×</option>`).join('')}</select></label></div>
        <p class="plot-error" role="alert" data-player-error hidden></p><p class="field-help" data-player-notice hidden></p>
        <div class="plot-playback-actions"><button class="button primary" data-plot-action="start">${icon('play')} <span>Start with this pen</span></button><button class="button primary" data-plot-action="pause" hidden>${icon('pause')} <span>Pause</span></button><button class="button" data-plot-action="stop" hidden>${icon('stop')} Stop</button><button class="button" data-plot-action="cancel-plan" hidden>Cancel</button><button class="button" data-plot-action="retry" hidden>Prepare again</button></div>
      </section>`;
    this.panel.querySelectorAll<HTMLDetailsElement>('details').forEach(node => { node.open = openDetails.has(node.dataset.section); });
    this.panel.querySelector<HTMLElement>('.plot-scroll')!.scrollTop = scroll;
    this.syncPlayer(); this.syncPasses();
    if (active) {
      const target = focusKey ? this.panel.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`) : focusAction ? this.panel.querySelector<HTMLElement>(`[data-plot-action="${CSS.escape(focusAction)}"]${focusPen ? `[data-pen="${CSS.escape(focusPen)}"]` : ''}`) : focusSetting ? this.panel.querySelector<HTMLElement>(`[data-plot-setting="${CSS.escape(focusSetting)}"]`) : focusDestination ? this.panel.querySelector<HTMLElement>('[data-plot-destination]') : null;
      if (target && !target.hidden && !(target as HTMLButtonElement).disabled) target.focus();
      else (this.panel.querySelector<HTMLElement>('[data-plot-action="pause"]:not([hidden]):not(:disabled)') ?? this.panel.querySelector<HTMLElement>('h2'))?.focus();
    }
  }

  private penMarkup(pen: PlotPen, index: number, disabled: string): string {
    const reorderDisabled = disabled || this.preferences.mode === 'source' ? 'disabled' : '';
    return `<div class="plot-pen-row"><div class="plot-pen-main"><input type="checkbox" aria-label="Include pen ${escape(this.penLabel(pen.color))}" data-pen-include="${pen.color}" ${pen.included ? 'checked' : ''} ${disabled}><input type="color" value="${pen.color}" aria-label="Choose pen color for ${pen.color}" data-pen-picker="${pen.color}" ${disabled}><input class="pen-hex" value="${pen.color}" aria-label="Pen hex color for ${pen.color}" data-pen-hex="${pen.color}" data-focus-key="hex-${pen.color}" maxlength="7" spellcheck="false" ${disabled}><div class="pen-order"><button class="button ghost" data-plot-action="up" data-pen="${pen.color}" aria-label="Move ${escape(this.penLabel(pen.color))} up" ${reorderDisabled || index === 0 ? 'disabled' : ''}>${icon('up')}</button><button class="button ghost" data-plot-action="down" data-pen="${pen.color}" aria-label="Move ${escape(this.penLabel(pen.color))} down" ${reorderDisabled || index === this.pens.length - 1 ? 'disabled' : ''}>${icon('down')}</button></div></div><div class="plot-pen-name"><input value="${escape(pen.name)}" placeholder="Pen name (optional)" aria-label="Pen name for ${pen.color}" data-pen-name="${pen.color}" data-focus-key="name-${pen.color}" maxlength="80" ${disabled}><button class="button ghost" data-plot-action="only" data-pen="${pen.color}" aria-label="Plot only pen ${escape(this.penLabel(pen.color))}" ${disabled}>Only</button></div>${pen.sources.length > 1 || pen.sources[0] !== pen.color ? `<small class="field-help">Source: ${pen.sources.map(escape).join(', ')}</small>` : ''}</div>`;
  }
  private numberSetting(key: keyof PlotSettings, label: string, unit: string, min: number, max: number | undefined, disabled: string, step = '1'): string {
    return `<label>${label}<div class="unit-input"><input type="number" data-plot-setting="${key}" data-focus-key="setting-${key}" aria-label="${label} ${unit}" value="${this.settings[key]}" min="${min}" ${max === undefined ? '' : `max="${max}"`} step="${step}" required ${disabled}><span>${unit}</span></div></label>`;
  }
  private machineMarkup(): string {
    const idle = this.plotter.connected && !this.locked && (this.destination !== 'network' || !!this.network?.hasControl);
    const canPen = this.plotter.connected && !this.manualBusy && this.plotter.canAdjustPen;
    const hasOrigin = this.plotter.hasOrigin(this.settings.profile);
    return `<section class="plot-section plot-machine-section"><h3>Machine controls</h3><p class="plot-origin-state">${hasOrigin ? this.plotter.originStatus === 'automatic' ? 'Origin set automatically' : 'Origin saved' : 'Origin: current pen position'}</p>
      ${!hasOrigin ? '<p class="field-help origin-reminder">Your current pen position will be used as origin. If it isn’t your intended starting point, position the carriage and choose Set origin.</p>' : ''}
      <div class="machine-actions">${[['set-origin', 'Set origin'], ['return-origin', 'Return to origin'], ['engage', 'Engage motors'], ['release', 'Release motors']].map(([action, label]) => `<button class="button" data-plot-action="${action}" ${!idle || action === 'return-origin' && !hasOrigin || action === 'engage' && this.plotter.motorsOn ? 'disabled' : ''}>${label}</button>`).join('')}</div>
      <div class="two-col"><button class="button" data-plot-action="pen-up" ${canPen ? '' : 'disabled'}>Pen up</button><button class="button" data-plot-action="pen-down" ${canPen ? '' : 'disabled'}>Pen down</button></div>
      <details data-section="heights"><summary>Pen heights & tests</summary><div class="plot-detail-content">${this.numberSetting('penUp', 'Pen up height', '%', 0, 100, idle ? '' : 'disabled')}${this.numberSetting('penDown', 'Pen down height', '%', 0, 100, idle ? '' : 'disabled')}<p class="field-help">Use Pen up and Pen down above to test the heights.</p><button class="button" data-plot-action="mark-pen-movement">Mark unexpected pen movement</button><button class="button" data-plot-action="machine-log">Download machine log</button><p class="field-help">Commands, board replies and observed movement times for troubleshooting.</p></div></details>
    </section>`;
  }

  private syncPlayer(): void {
    if (this.closed) return;
    const player = this.panel.querySelector<HTMLElement>('.plot-player'); if (!player) return;
    const setText = (selector: string, text: string) => { const node = player.querySelector<HTMLElement>(selector)!; if (node.textContent !== text) node.textContent = text; };
    const simulationActive = !!this.simulationView && !['finished', 'stopped'].includes(this.session);
    const active = this.executing || simulationActive;
    if (active && !this.root.classList.contains('plot-playing')) this.panel.querySelector<HTMLDetailsElement>('[data-section="passes"]')!.open = true;
    this.root.classList.toggle('plot-playing', active);
    this.root.classList.toggle('plot-paused', this.session === 'paused' || this.session === 'tool-change');
    this.panel.querySelector<HTMLElement>('.plot-pens-section h3')!.textContent = active ? 'Pen passes' : 'Pens & passes';
    const terminal = ['finished', 'stopped'].includes(this.session);
    const waiting = this.session === 'tool-change';
    const pass = this.currentPass();
    const color = this.plan?.passes[pass]?.tool ?? '';
    const status = this.job ? this.task?.label ?? 'Preparing preview' : this.error ? 'Plot needs attention' : waiting ? `Load ${this.penLabel(color)} — pass ${pass + 1} of ${this.plan?.passes.length}` : ({ choosing: 'Choose how to plot', ready: 'Ready to plot', running: this.destination === 'simulation' ? 'Simulating' : 'Plotting', pausing: 'Pausing…', paused: 'Paused · pen lifted', stopping: 'Stopping…', returning: 'Returning to origin', finished: 'Complete', stopped: this.destination === 'simulation' ? 'Stopped · simulation reset' : 'Stopped · returned to origin', error: 'Prepare a new job', planning: 'Preparing preview', 'tool-change': '' } satisfies Record<PlotSessionState, string>)[this.session];
    setText('[data-player-status]', status);
    setText('[data-player-pen]', color ? active || terminal ? `Pass ${pass + 1} of ${this.plan?.passes.length} · ${this.penLabel(color)}` : `Load ${this.penLabel(this.plan!.passes[0]!.tool)}` : '');
    const time = this.destination === 'simulation' ? this.simulationView?.time ?? 0 : this.hardwareView?.time ?? 0;
    const percent = this.job ? Math.round((this.task?.fraction ?? 0) * 100) : this.destination === 'simulation' ? this.plan?.duration ? Math.round(time / this.plan.duration * 100) : 0 : this.hardwareView?.percent ?? 0;
    setText('[data-player-time]', this.plan?.passes.length ? `${active || terminal ? `${clock(time)} / ` : ''}${clock(this.plan.duration)} estimated motion${active || terminal ? ` · ${percent}%` : ''}` : '');
    const bar = player.querySelector<HTMLProgressElement>('[data-player-progress]')!; bar.value = percent;
    if (this.job && this.task?.fraction === undefined) bar.removeAttribute('value');
    bar.hidden = !this.job && !active && !terminal;
    const error = player.querySelector<HTMLElement>('[data-player-error]')!; error.hidden = !(this.error || this.inputError); setText('[data-player-error]', this.inputError || this.error);
    const notice = player.querySelector<HTMLElement>('[data-player-notice]')!;
    const empty = !this.job && this.plan && !this.plan.passes.length ? this.pens.some(pen => pen.included) ? 'No drawing paths remain at the machine’s resolution.' : this.pens.length ? 'Select at least one pen to plot.' : 'Add artwork to plot.' : '';
    notice.hidden = !(empty || this.notice); setText('[data-player-notice]', empty || this.notice);
    const button = (action: string) => player.querySelector<HTMLButtonElement>(`[data-plot-action="${action}"]`)!;
    button('start').hidden = active || !!this.job || this.session === 'error';
    button('start').disabled = !this.destination || !this.plan?.passes.length || !!this.inputError || this.locked || (this.destination === 'machine' || this.destination === 'network') && !this.plotter.connected || this.destination === 'network' && !this.network?.hasControl;
    button('start').querySelector('span')!.textContent = terminal ? this.destination === 'simulation' ? 'Replay' : 'Plot again' : this.destination === 'simulation' ? 'Play simulation' : 'Start with this pen';
    button('pause').hidden = !active;
    button('pause').disabled = this.destination === 'network' && (!this.network?.hasControl || !this.network.networkConnected) || this.manualBusy || ['pausing', 'stopping', 'returning', 'finished', 'stopped', 'error'].includes(this.session) || !!this.error;
    button('pause').querySelector('span')!.textContent = waiting ? 'Continue with this pen' : this.session === 'paused' ? 'Resume' : 'Pause';
    button('pause').querySelector('svg')!.outerHTML = icon(this.session === 'running' ? 'pause' : 'play');
    button('stop').hidden = !active; button('stop').disabled = this.destination === 'network' && (!this.network?.hasControl || !this.network.networkConnected) || ['stopping', 'returning', 'finished', 'stopped'].includes(this.session);
    button('cancel-plan').hidden = !this.job;
    button('retry').hidden = this.session !== 'error' && !(this.notice === 'Preview preparation cancelled.'); button('retry').disabled = this.locked;
    const timeline = player.querySelector<HTMLInputElement>('[data-sim-timeline]')!;
    timeline.disabled = !this.simulation || !!this.job; timeline.value = String(time);
    const simControls = player.querySelector<HTMLElement>('.plot-sim-controls')!; simControls.hidden = this.destination !== 'simulation' || !this.simulation;
    this.panel.querySelector<HTMLButtonElement>('[data-plot-action="back"]')!.disabled = this.busy;
    this.root.querySelector<HTMLButtonElement>('[data-action="edit-mode"]')!.disabled = this.busy;
    // Playback updates preserve focus and never rebuild the sidebar each frame.
    this.panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-pen-include],[data-pen-picker],[data-pen-hex],[data-pen-name],[data-plot-setting],[data-color-mode],[data-plot-destination]').forEach(input => {
      const penHeight = input.getAttribute('data-plot-setting') === 'penUp' || input.getAttribute('data-plot-setting') === 'penDown';
      input.disabled = active || this.manualBusy || this.plotter.connecting || (penHeight && !this.plotter.connected) || input.getAttribute('data-plot-setting') === 'reorderMode' && this.preferences.mode === 'source';
    });
    this.panel.querySelectorAll<HTMLButtonElement>('[data-plot-action="all"],[data-plot-action="only"],[data-plot-action="up"],[data-plot-action="down"],[data-plot-action="reset-pens"]').forEach(node => {
      const action = node.dataset.plotAction;
      const index = this.pens.findIndex(pen => pen.color === node.dataset.pen);
      node.disabled = active || this.manualBusy || this.plotter.connecting || (action === 'up' || action === 'down') && (this.preferences.mode === 'source' || action === 'up' && index === 0 || action === 'down' && index === this.pens.length - 1);
    });
    this.panel.querySelectorAll<HTMLButtonElement>('[data-plot-action="pen-up"],[data-plot-action="pen-down"]').forEach(node => { node.disabled = this.manualBusy || !this.plotter.canAdjustPen; });
    const originState = this.panel.querySelector<HTMLElement>('.plot-origin-state');
    if (originState) {
      const hasOrigin = this.plotter.hasOrigin(this.settings.profile);
      originState.textContent = hasOrigin ? this.plotter.originStatus === 'automatic' ? 'Origin set automatically' : 'Origin saved' : 'Origin: current pen position';
      const reminder = this.panel.querySelector<HTMLElement>('.origin-reminder'); if (reminder) reminder.hidden = hasOrigin;
    }
  }
  private currentPass(): number {
    if (!this.plan) return 0;
    if (this.destination === 'simulation') return this.simulationView?.pass ?? 0;
    let index = 0;
    this.plan.passes.forEach((pass, i) => { if (pass.startEvent < this.progress.completed || this.progress.state === 'tool-change' && pass.startEvent === this.progress.completed) index = i; });
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
    if (this.busy || this.closed) return;
    this.closed = true; void this.network?.disconnect(); ++this.revision; this.job?.cancel(); this.simulation?.destroy(); this.live?.destroy(); this.visual?.destroy();
    this.panel.removeEventListener('click', this.onClick); this.panel.removeEventListener('change', this.onChange); this.panel.removeEventListener('input', this.onInput);
    this.panel.removeEventListener('focusout', this.onFocusOut); this.panel.removeEventListener('keydown', this.onKeyDown);
    this.panel.replaceChildren(this.savedEditor); this.panel.classList.remove('plot-sidebar'); this.panel.scrollTop = this.editorScroll;
    this.root.classList.remove('plot-mode', 'plot-running', 'plot-playing', 'plot-paused'); this.savedInert.forEach((inert, node) => { node.inert = inert; });
    this.onExit();
  }
}
