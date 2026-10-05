import type { NetworkPlotter } from './network-plotter';
/** Static hosting has no server capability and makes no network discovery request. */
export async function discoverNetwork(): Promise<NetworkPlotter | null> { return null; }
