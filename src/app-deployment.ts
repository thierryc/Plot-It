/** Compile-time mode keeps public hosting separate from local USB/network installs. */
export function publicAssetUrl(path: string, base = import.meta.env?.BASE_URL ?? '/') {
  return base + path.replace(/^\//, '');
}
export function applicationDeployment(mode: string, base = '/') {
  return mode === 'site'
    ? { hosted: true, worker: publicAssetUrl('/app/sw.js', base), scope: publicAssetUrl('/app/', base), manifest: publicAssetUrl('/app/manifest.webmanifest', base) }
    : { hosted: false, worker: '/sw.js', scope: '/', manifest: '/manifest.webmanifest' };
}
