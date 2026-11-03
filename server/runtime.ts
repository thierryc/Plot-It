import { readFileSync } from 'node:fs';
export function checkRuntime(pin = readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim()) {
  if (process.versions.node !== pin || !process.release.lts || Number(process.versions.node.split('.')[0]) !== 24) throw new Error(`Use the pinned Node ${pin} LTS through NVM; found ${process.version} at ${process.execPath}`);
  return { version: process.version, lts: process.release.lts, executable: process.execPath };
}
