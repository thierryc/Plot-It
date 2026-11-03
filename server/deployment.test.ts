import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkRuntime } from './runtime';

describe('pinned LTS deployment', () => {
  it('uses the verified NVM-managed Node 24 LTS executable', () => {
    expect(readFileSync('.nvmrc', 'utf8').trim()).toBe('24.21.0');
    expect(checkRuntime().lts).toBe('Krypton');
    expect(checkRuntime().version).toBe('v24.21.0');
    expect(() => checkRuntime('26.8.1')).toThrow('LTS');
  });
  it('keeps API and runner independently supervised and pins the service executable', () => {
    const api = readFileSync('deploy/plot-it-api.service', 'utf8'), runner = readFileSync('deploy/plot-it-runner.service', 'utf8');
    expect(api).not.toContain('Requires=plot-it-runner');
    expect(api).toContain('@NODE@'); expect(runner).toContain('@NODE@');
    expect(api).toContain(' main.js api'); expect(runner).toContain(' main.js runner');
  });
  it('packages the server and its deployment source with the corresponding source archive', () => {
    const script = readFileSync('scripts/source-archive.mjs', 'utf8');
    expect(script).toContain("'server'"); expect(script).toContain("'deploy'"); expect(script).toContain("'.nvmrc'");
  });
});
