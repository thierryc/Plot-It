import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => ({
  root: mode === 'site' ? 'site' : '.',
  publicDir: mode === 'site' ? '../public' : 'public',
  appType: mode === 'site' ? 'mpa' : 'spa',
  resolve: { alias: ['browser', 'site'].includes(mode) ? [{ find: './network-discovery', replacement: fileURLToPath(new URL('./src/network-disabled.ts', import.meta.url)) }] : [] },
  // Keep Emscripten's import.meta-relative WASM URL beside its original module
  // in development; dependency prebundling would resolve it under .vite/deps.
  optimizeDeps: { exclude: ['harfbuzzjs'] },
  build: {
    rollupOptions: {
      input: mode === 'site' ? Object.fromEntries(['index.html', 'app/index.html', 'docs/index.html', 'docs/self-hosted/index.html', '404.html'].map(path => [path, fileURLToPath(new URL(`./site/${path}`, import.meta.url))])) : {app:fileURLToPath(new URL('./index.html',import.meta.url)),virtual:fileURLToPath(new URL('./virtual.html',import.meta.url))},
      output: {
        // A shared helper in a top-level-await entry can deadlock lazy HarfBuzz imports.
        manualChunks(id) { if (id.includes('vite/preload-helper')) return 'preload-helper'; }
      }
    }
  }
}));
