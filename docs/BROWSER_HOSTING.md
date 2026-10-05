# Browser-only GitHub Pages release

The online app at **https://plot-it.litsquare.com/app/** connects to an EBB using
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
**output/plot-it-browser.zip**. It includes `CNAME` for `plot-it.litsquare.com`
and `.nojekyll`, plus fonts, WASM, workers, icons and the corresponding source
archive. Upload the contents of the directory, including hidden `.nojekyll`,
to the root of your Pages publishing branch. Do not upload the enclosing
`dist-browser` folder. The custom domain serves the app at `/`; this build is
not configured for a repository-name URL subdirectory.

In the repository's **Settings → Pages**, select **Deploy from a branch** and
choose your publishing branch and **/(root)**. Set the custom domain to
`plot-it.litsquare.com`, configure its DNS CNAME to your account's
`<owner>.github.io` hostname, and enable **Enforce HTTPS** once the certificate
is available. Keep the domain configured on GitHub as well as in `CNAME`.

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
