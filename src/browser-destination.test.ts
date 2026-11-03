// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { discoverNetwork } from './network-disabled';

it('does not probe a server or open WebSocket in the browser-only distribution', async () => {
  const fetch = vi.fn(), socket = vi.fn();
  vi.stubGlobal('fetch', fetch); vi.stubGlobal('WebSocket', socket);
  try {
    expect(await discoverNetwork()).toBeNull();
    expect(fetch).not.toHaveBeenCalled(); expect(socket).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});
