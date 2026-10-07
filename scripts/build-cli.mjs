import {build} from 'esbuild';
await build({entryPoints:['scripts/plot-cli.mjs'],outfile:'dist-cli/plot-cli.js',bundle:true,packages:'external',platform:'node',format:'esm',target:'node24',sourcemap:true});
