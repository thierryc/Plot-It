# Browser-only GitHub Pages release

The online app at **https://thierryc.github.io/Plot-It/app/** connects to an EBB using
the user's computer and Chrome/Edge Web Serial. Simulation is also available.
Users do not install Node, a server, or a PWA. The browser asks them to select
their USB plotter. HTTPS is required. Close any other connection to that EBB
before using Direct USB.

The public site adds a landing page and documentation through the separate
[hosted-site build](SITE_HOSTING.md). This standalone browser build keeps the
editor at `/`; use `build:site` and `dist-site` to publish the full website.

This distribution makes no Node server discovery requests and contains no
network plotter client, backend executable or native SerialPort modules.
The download of corresponding AGPL source includes the complete project.

## Build locally

```sh
scripts/node-lts.sh --npm ci
scripts/node-lts.sh --npm run build:browser
scripts/node-lts.sh --npm run test:browser-build
```

The locally compiled site is **dist-browser/**. The ready-to-upload archive is
**output/plot-it-browser.zip**. It includes `.nojekyll`, fonts, WASM, workers,
icons and corresponding source, without a `CNAME`. This portable standalone
build targets a server root. To publish at the default GitHub Pages project URL
`https://thierryc.github.io/Plot-It/`, use `build:site` and `dist-site` as described
in [site hosting](SITE_HOSTING.md). The custom domain and DNS are deferred.

No application build or custom GitHub Actions workflow is needed or included.
Rebuild locally and replace the published static files for each release.
GitHub Pages itself uses a built-in deployment workflow internally, even for
branch publication; that does not compile this application.

GitHub's instructions:
- [Publishing from a branch](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [Managing a custom domain](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)

## Check before publication

```sh
scripts/node-lts.sh node_modules/vite/bin/vite.js preview --outDir dist-browser --host 127.0.0.1 --port 8788 --strictPort
```

Open http://127.0.0.1:8788 in Chrome. Plot must offer only **Direct USB · this
computer** and **Simulation**. Connecting must not start a plot. Check imported
SVG, text/font loading and simulation before uploading the directory. A local
Node runner must release its EBB before this separate browser app can open it.

The normal `npm run build` still builds **dist/** and **dist-server/** for the
local or Pi network application. Keep those artifacts separate from this site.
