import { describe, expect, it } from 'vitest';
import { applicationDeployment } from './app-deployment';

describe('application deployment boundaries', () => {
  it('keeps local and standalone browser builds at the root', () => {
    for (const mode of ['production', 'development', 'browser']) {
      expect(applicationDeployment(mode)).toEqual({ hosted: false, worker: '/sw.js', scope: '/', manifest: '/manifest.webmanifest' });
    }
  });
  it('scopes the hosted application separately from the website', () => {
    expect(applicationDeployment('site')).toEqual({ hosted: true, worker: '/app/sw.js', scope: '/app/', manifest: '/app/manifest.webmanifest' });
  });
});
