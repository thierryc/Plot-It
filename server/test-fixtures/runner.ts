import { PlotterCore } from '../../src/plotter-core';
import { startRunner } from '../runner';
import { fakeTransport } from './fake-ebb';
let reportedMotion = false;
const fixture = fakeTransport('2.8.1', async command => { if (command.startsWith('SM,') && !reportedMotion) { reportedMotion = true; process.send?.({ moving: true }); await new Promise(resolve => setTimeout(resolve, 1500)); } });
const service = await startRunner({ connectionPolicy: 'auto', directory: process.env.PLOT_DATA_DIR!, socketDirectory: process.env.PLOT_SOCKET_DIR!, core: new PlotterCore(fixture.transport) });
process.send?.({ ready: true });
process.on('SIGTERM', () => { void service.close().then(() => process.exit(0)); });
