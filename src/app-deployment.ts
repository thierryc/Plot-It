/** Compile-time mode keeps public hosting separate from local USB/network installs. */
export function applicationDeployment(mode: string) {
  return mode === 'site'
    ? { hosted: true, worker: '/app/sw.js', scope: '/app/', manifest: '/app/manifest.webmanifest' }
    : { hosted: false, worker: '/sw.js', scope: '/', manifest: '/manifest.webmanifest' };
}
