import './check-runtime.mjs';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const outfile=resolve('node_modules/.cache/plot-it-font-previews.mjs');
await build({entryPoints:['scripts/font-previews-entry.ts'],outfile,bundle:true,platform:'node',format:'esm',packages:'external',target:'node24',plugins:[{name:'raw-font-json',setup(build){build.onResolve({filter:/\.json\?raw$/},args=>({path:resolve(args.resolveDir,args.path.replace(/\?raw$/,'')),namespace:'raw-font'}));build.onLoad({filter:/.*/,namespace:'raw-font'},async args=>({contents:await readFile(args.path,'utf8'),loader:'text'}));}}]});
await import(pathToFileURL(outfile).href);
