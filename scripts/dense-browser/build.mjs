import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
const out='output/dense-wave-investigation-2026-11-02/browser-harness';
await mkdir(out,{recursive:true});
await build({entryPoints:['scripts/dense-browser/main.ts'],outfile:`${out}/main.js`,bundle:true,format:'esm',target:'es2022'});
for(const file of ['index.html','worker.js'])await copyFile(`scripts/dense-browser/${file}`,`${out}/${file}`);
console.log(out);
