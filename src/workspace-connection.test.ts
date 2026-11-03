// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceConnection } from './workspace-connection';
import { Plotter } from './plotter';
import { NetworkPlotter } from './network-plotter';
import { initialState } from './model';
import { updateWorkspaceSetting } from './workspace-settings';

afterEach(() => vi.restoreAllMocks());
function setup() {
  const plotter = new Plotter(), state = structuredClone(initialState), save = vi.fn();
  const connection = new WorkspaceConnection(plotter, () => state.settings, save);
  vi.spyOn(plotter, 'configurePen').mockImplementation(() => {});
  vi.spyOn(plotter, 'connect').mockResolvedValue('EBB');
  vi.spyOn(plotter, 'disconnect').mockResolvedValue();
  return {plotter,state,save,connection};
}
describe('app connection lifetime', () => {
  it('discovers once and preserves destination when an inspector unsubscribes', async () => {
    const {connection,plotter} = setup();
    const discover = vi.spyOn(NetworkPlotter,'discover').mockResolvedValue(null);
    await Promise.all([connection.discover(), connection.discover()]); expect(discover).toHaveBeenCalledOnce();
    connection.select('machine'); await connection.run('connect');
    const notify = vi.fn(), release = connection.subscribe(notify);
    connection.changed(); release(); connection.changed();
    expect(notify).toHaveBeenCalledOnce(); expect(connection.target).toBe('machine');
    expect(plotter.disconnect).not.toHaveBeenCalled();
  });
  it('locks destination and concurrent commands while a USB picker is pending, then handles cancellation quietly', async () => {
    const {connection,plotter} = setup();
    let reject!: (reason: Error) => void;
    vi.mocked(plotter.connect).mockReturnValue(new Promise((_,no) => { reject=no; }));
    connection.select('machine'); const connecting = connection.run('connect');
    expect(connection.locked).toBe(true); expect(connection.select('network')).toBe(false);
    await connection.run('connect'); expect(plotter.connect).toHaveBeenCalledOnce();
    reject(new DOMException('Cancelled','NotFoundError')); await connecting;
    expect(connection.error).toBe(''); expect(connection.locked).toBe(false); expect(connection.target).toBe('machine');
  });
  it('synchronizes firmware and uses the current settings object after document replacement', async () => {
    const {connection,plotter,state,save} = setup();
    vi.spyOn(plotter,'firmwareLabel','get').mockReturnValue('3.1.7');
    connection.select('machine'); await connection.run('connect');
    expect(state.settings.motionFirmware).toBe('3.1.7'); expect(save).toHaveBeenCalledOnce();
    state.settings = {...state.settings,motionFirmware:undefined};
    await connection.run('connect'); expect(state.settings.motionFirmware).toBe('3.1.7');
  });
  it('preserves recovery restrictions when a machine is active', async () => {
    const {connection,plotter} = setup();
    connection.select('machine'); vi.spyOn(plotter,'active','get').mockReturnValue(true);
    expect(connection.select('network')).toBe(false); await connection.run('disconnect');
    expect(plotter.disconnect).not.toHaveBeenCalled();
  });
  it('invalidates origin for Canvas rail/model changes and retains normalization', () => {
    const {state,plotter} = setup();
    vi.spyOn(plotter,'connected','get').mockReturnValue(true);
    const invalidate = vi.spyOn(plotter,'invalidateOrigin').mockImplementation(() => {});
    const input = document.createElement('input'); input.value='180';
    updateWorkspaceSetting(state.settings,'machineRotation',input,plotter);
    expect(state.settings.machineRotation).toBe(180); expect(invalidate).toHaveBeenCalledOnce();
    input.value='2234'; updateWorkspaceSetting(state.settings,'nextdrawModel',input,plotter);
    expect(state.settings.nextdrawModel).toBe('2234'); expect(invalidate).toHaveBeenCalledTimes(2);
  });
});
