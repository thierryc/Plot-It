import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

function launch(args: string[]) {
  return spawnSync(process.execPath, ['scripts/test-ebb.mjs', ...args], {
    encoding: 'utf8', timeout: 3000,
    env: { ...process.env, PLOT_EBB_TEST_MODE: '', PLOT_EBB_URL: '' },
  });
}
describe('deferred EBB test opt-in', () => {
  it('requires an explicit USB or network mode before launching hardware tests', () => {
    const result = launch([]);
    expect(result.status).toBe(1); expect(result.stderr).toContain('usb | network');
  });
  it('rejects automatic selection and unexpected arguments', () => {
    for (const args of [['auto'], ['usb', 'extra']]) {
      const result = launch(args);
      expect(result.status).toBe(1); expect(result.stderr).toContain('usb | network');
    }
  });
  it('requires a Pi URL before launching network hardware checks', () => {
    const result = launch(['network']);
    expect(result.status).toBe(1); expect(result.stderr).toContain('PLOT_EBB_URL');
  });
});
