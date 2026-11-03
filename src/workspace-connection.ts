import type { PlotDestination } from './plot-destination';
import type { PlotSettings } from './model';
import type { NetworkPlotter } from './network-plotter';
import { discoverNetwork } from './network-discovery';
import { supportsHardwareProfile } from './machine-profiles';

export type ConnectionTarget = 'machine' | 'network' | null;

/** Connection lifetime follows the app, never an inspector or preview. */
export class WorkspaceConnection {
  target: ConnectionTarget;
  network: NetworkPlotter | null = null;
  busy = false;
  error = '';
  notice = '';
  deviceLabel = '';
  private listeners = new Set<() => void>();
  private discovery: Promise<void> | undefined;

  constructor(readonly localPlotter: PlotDestination, private settings: () => PlotSettings, private save: () => void) {
    this.target = localPlotter.connected ? 'machine' : null;
  }
  get plotter(): PlotDestination { return this.target === 'network' && this.network ? this.network : this.localPlotter; }
  get serverOwnsLocalUsb(): boolean { return ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) && !!this.network?.connected; }
  get locked(): boolean { return this.busy || this.plotter.connecting || this.plotter.active; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  changed(): void { for (const listener of this.listeners) listener(); }
  discover(): Promise<void> {
    return this.discovery ??= this.discoverOnce();
  }
  private async discoverOnce(): Promise<void> {
    try {
      this.network = await discoverNetwork();
      if (!this.network) return;
      this.network.onConnectionChange = () => this.changed();
      this.network.onError = message => { this.notice = message; this.changed(); };
      this.changed();
      await this.network.watch();
    } catch (error) { this.notice = (error as Error).message; this.changed(); }
  }
  select(value: string): boolean {
    if (this.locked) return false;
    this.target = value === 'machine' || value === 'network' ? value : null;
    this.deviceLabel = ''; this.error = ''; this.notice = '';
    if (!this.plotter.active && supportsHardwareProfile(this.settings().profile)) this.plotter.configurePen(this.settings());
    this.changed(); return true;
  }
  async run(action: string, allowRecovery = false): Promise<void> {
    if (this.busy || this.plotter.connecting || this.plotter.active && !allowRecovery) return;
    if (action === 'connect' && (!this.target || !supportsHardwareProfile(this.settings().profile))) return;
    this.busy = true; this.error = ''; this.notice = ''; this.changed();
    try {
      if (action === 'connect') {
        if (this.target === 'machine' && this.serverOwnsLocalUsb) throw new Error('The local Node server owns the EBB. Release server USB, then click Connect.');
        if (!(this.plotter.connected && (this.target !== 'network' || this.network?.hasControl))) this.deviceLabel = await this.plotter.connect();
        if (this.target === 'network' && this.network && !this.network.connected && !this.network.active) {
          this.checkLocalOwnership(); await this.network.connectEbb();
        }
        if (this.target === 'network' && this.network?.connected) this.deviceLabel = `Network plotter · EBB ${this.network.firmwareLabel ?? 'connected'}`;
        const firmware = this.plotter.firmwareLabel;
        if (firmware && firmware !== this.settings().motionFirmware) { this.settings().motionFirmware = firmware; this.save(); }
      } else if (action === 'disconnect') { await this.plotter.disconnect(); this.deviceLabel = ''; }
      else if (action === 'disconnect-local-usb') await this.localPlotter.disconnect();
      else if (this.network) {
        if (action === 'release-control') await this.network.releaseControl();
        else if (action === 'connect-ebb') { this.checkLocalOwnership(); await this.network.connectEbb(); }
        else if (action === 'disconnect-ebb' || action === 'release-server-usb') {
          if (!this.network.hasControl) await this.network.connect();
          await this.network.disconnectEbb(this.settings());
          this.notice = action === 'release-server-usb' ? 'Server USB released. Click Connect to use Direct USB. Set the origin again after connecting.' : 'Plotter disconnected.';
        }
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) this.error = (error as Error).message;
    } finally { this.busy = false; this.changed(); }
  }
  private checkLocalOwnership(): void {
    if (this.localPlotter.connected && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) throw new Error('Disconnect Direct USB on this computer before connecting the same EBB through the server.');
  }
}
