# Plot-it

A local-first browser workspace for SVG artwork, single-line typography and EBB pen plotting.

**Early alpha.** Editing and simulation are available to try. Hardware profiles are experimental; independent AxiDraw, NextDraw and Pi validation is pending.

[Open the app](https://thierryc.github.io/Plot-It/app/) · [First drawing](docs/GETTING_STARTED.md) · [Alpha testing and logs](docs/ALPHA_TESTING.md) · [Report a bug](https://github.com/thierryc/Plot-It/issues)

## Use it

Import SVG, draw paths and shapes, add text, arrange pen passes and prepare fills. Preview with **Plot → Simulate**, then save an editable `.plit.json` document or export SVG. No plotter or installation is needed for editing and simulation.

Artwork and fonts stay in your browser; save document backups. Direct USB requires desktop Chrome or Edge. Check [compatibility and limits](docs/COMPATIBILITY.md) before connecting a machine.

## Run locally

Install Git and [NVM](https://github.com/nvm-sh/nvm#installing-and-updating), then use the pinned Node runtime:

```sh
scripts/node-lts.sh --npm ci
scripts/node-lts.sh --npm run build
scripts/node-lts.sh --npm start
```

Open `http://127.0.0.1:8787`. The launcher starts the API and runner; USB connection remains manual. For frontend development, use `scripts/node-lts.sh --npm run dev` and Vite's printed URL; it does not start the plotter server.

[Development](docs/DEVELOPMENT.md) · [Node/Pi setup](docs/NETWORK_PLOTTER.md) · [Mac companion](docs/PLOTIT_MCP.md) · [Website hosting](docs/SITE_HOSTING.md)

## Contribute and license

Test the alpha, suggest a feature, improve documentation or contribute code. See [Contributing](CONTRIBUTING.md), [Contributors](CONTRIBUTORS.md) and the [documentation index](docs/README.md).

Original application/core code and documentation: **Apache-2.0** ([LICENSE](LICENSE)). OpenPlotFont code: **MIT**. Fonts and third-party components retain their own terms; see [third-party notices](THIRD_PARTY_NOTICES.md) and [distribution notes](docs/LICENSING.md).
