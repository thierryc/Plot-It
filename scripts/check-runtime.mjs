import { readFileSync } from 'node:fs';
const pin = readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim();
if (process.versions.node !== pin || !process.release.lts || process.versions.node.split('.')[0] !== '24') {
  throw new Error(`Use NVM Node ${pin} LTS. Found ${process.version} at ${process.execPath}. Run scripts/node-lts.sh --npm <command>.`);
}
console.info(`Node ${process.version} LTS (${process.release.lts}) · ${process.execPath}`);
