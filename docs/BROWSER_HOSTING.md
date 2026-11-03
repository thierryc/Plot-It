# Portable browser build

Use this build for a standalone static editor at a server root. For the full `/Plot-It/` website and public app, follow [Website hosting](SITE_HOSTING.md).

```sh
scripts/node-lts.sh --npm ci
scripts/node-lts.sh --npm run build:browser
scripts/node-lts.sh --npm run test:browser-build
```

Output: `dist-browser/` and `output/plot-it-browser.zip`. The distribution contains the editor, fonts, WASM, workers, notices and source archive. It contains no Node server or network-runner client.

Serve `dist-browser/` over HTTPS, or preview locally:

```sh
scripts/node-lts.sh node_modules/vite/bin/vite.js preview --outDir dist-browser --host 127.0.0.1 --port 8788 --strictPort
```

Open `http://127.0.0.1:8788`. Check SVG import, text, save/load and simulation. Direct USB uses desktop Chrome/Edge and requires manual device selection. Another app or runner must release the board first. See [alpha limitations and reporting](ALPHA_TESTING.md).
