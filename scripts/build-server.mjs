import { build } from 'esbuild';
await build({ entryPoints: ['server/main.ts'], outdir: 'dist-server', bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24', sourcemap: true });
