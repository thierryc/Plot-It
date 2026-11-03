# Development and local startup

Install Git and NVM, then use the pinned Node 24.21.0 LTS through `scripts/node-lts.sh`. The wrapper checks the actual executable and installs that runtime if absent. Run commands from the repository root.

```sh
scripts/node-lts.sh --npm ci
```

## Choose how to run

| Goal | Command | Open / behavior |
| --- | --- | --- |
| Edit frontend source | `scripts/node-lts.sh --npm run dev` | Vite's printed URL; hot reload, Direct USB and Simulate |
| Run local app and plotter server | Build, then `scripts/node-lts.sh --npm start` | `http://127.0.0.1:8787`; API and runner, manual USB connection |
| Preview app files | `scripts/node-lts.sh --npm run preview` | Vite's printed URL; no plotting API |
| Preview website | Build site, then `scripts/node-lts.sh --npm run preview:site` | `http://127.0.0.1:8789/Plot-It/`; static browser-only app |

`npm start` requires a successful `npm run build`; it does not rebuild silently. It launches both services, waits for a responding API/runner, prints the URL, and stops both on Ctrl+C or service failure. It forces manual USB connection for desktop startup, even with an inherited `PLOT_CONNECTION_POLICY=auto`. Pi services retain their separately configured policy.

Finish or stop a physical job before stopping the launcher. Local services use Unix sockets; macOS/Linux are the command targets. Native Windows server installation remains unqualified.

For independent processes, run each in its own terminal:

```sh
scripts/node-lts.sh --npm run server:runner
scripts/node-lts.sh --npm run server:api
```

These lower-level commands retain environment configuration and require compiled server/app files. See [Node/Pi configuration](NETWORK_PLOTTER.md).

## Why Network may be missing

Discovery fetches `/api/v1/status` from the **same origin** as the page. Vite has no proxy to port 8787. Open the API-served app on port 8787 for network plotting. `browser` and `site` modes compile discovery out, even when served locally.

Discovery runs when Plot opens. If the API starts later, switch to Edit and back to Plot, or reload. The API can advertise Network while its runner is unavailable; a disconnected EBB does not hide it. Full-stack hot reload and visible failed-discovery retry remain follow-ups.

## Build and verify

```sh
scripts/node-lts.sh --npm test
scripts/node-lts.sh --npm run build
scripts/node-lts.sh --npm run build:browser
scripts/node-lts.sh --npm run test:browser-build
scripts/node-lts.sh --npm run build:site
scripts/node-lts.sh --npm run test:site-build
```

`build` creates `dist/` and `dist-server/`; `build:browser` creates a portable static editor in `dist-browser/`; `build:site` creates the `/Plot-It/` website in `dist-site/`. Each ships matching source. Build commands do not start services.

Ordinary tests use simulated transports and do not open physical USB. Network tests require local listener/socket permissions. Device checks are opt-in; follow [acceptance instructions](NETWORK_PLOTTER.md#acceptance-record) and record them separately.

For isolated gesture checks, serve Vite on port 5184, open `/scripts/fixtures/canvas-modifiers.html`, and use **Run isolated checks**. Reload and repeat for preference restoration. `/scripts/fixtures/incremental-canvas.html` contains rendering/gesture measurements. These seed disposable state on their isolated origin; avoid your working drawing's origin. See [app UI](APP_UI.md) and [website build checks](SITE_HOSTING.md) for more verification.

The MIT OpenPlotFont library and private Apache-2.0 Plotter Core are local workspaces. Use `dev:lib` in another terminal while editing OpenPlotFont. See [architecture](ARCHITECTURE.md), [OpenPlotFont](../packages/openplotfont/README.md), and [Plotter Core](../packages/plotter-core/README.md).
