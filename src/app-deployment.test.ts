import { describe, expect, it } from 'vitest';
import { applicationDeployment, publicAssetUrl } from './app-deployment';

describe('application deployment boundaries', () => {
  it('keeps local and standalone browser builds at the root', () => {
    for (const mode of ['production', 'development', 'browser']) {
      expect(applicationDeployment(mode)).toEqual({ hosted: false, worker: '/sw.js', scope: '/', manifest: '/manifest.webmanifest' });
    }
  });
  it('scopes the hosted application separately from the website', () => {
    expect(applicationDeployment('site')).toEqual({ hosted: true, worker: '/app/sw.js', scope: '/app/', manifest: '/app/manifest.webmanifest' });
    expect(applicationDeployment('site', '/Plot-It/')).toEqual({ hosted: true, worker: '/Plot-It/app/sw.js', scope: '/Plot-It/app/', manifest: '/Plot-It/app/manifest.webmanifest' });
    expect(publicAssetUrl('/fonts/library/font.opf.json', '/Plot-It/')).toBe('/Plot-It/fonts/library/font.opf.json');
    expect(publicAssetUrl('/fonts/previews/font.svg', '/Plot-It/')).toBe('/Plot-It/fonts/previews/font.svg');
  });
});
