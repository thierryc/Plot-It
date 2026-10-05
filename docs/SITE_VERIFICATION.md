# Hosted beta verification

Verified locally on 2026-10-05 with the pinned Node 24.21.0 LTS executable.

The automated suite covers real HTML entries, required content, build separation,
app-only worker scope and cache cleanup, compiled assets and source downloads.
A publication integration test publishes twice to a temporary Git repository and
rolls back while preserving the source checkout and release history.

Run the final checks after building all three targets:

```sh
scripts/node-lts.sh --npm run build
scripts/node-lts.sh --npm run build:browser
scripts/node-lts.sh --npm run build:site
PLOT_SITE_BUILD_DIR=dist-site PLOT_BROWSER_BUILD_DIR=dist-browser scripts/node-lts.sh --npm test
scripts/node-lts.sh --npm run publish:site -- --dry-run
```

Browser checks used the locally served production site. Landing, documentation,
and self-hosting pages had no horizontal overflow at widths 320, 390, 768, 1024,
and 1440 pixels. Direct route loads and refreshes worked. The keyboard skip link
moves focus to the main content. Light and dark themes render; the saved theme
survives navigation into the editor and refresh.

The hosted editor offered Direct USB and Simulation. Font loading and text drawing
worked, as did SVG import, simulation, pause, resume, and stop. Saved drawings
survived navigation and refresh. These checks do not constitute a complete
accessibility audit or physical hardware acceptance.

Custom-domain DNS, certificate issuance, and live HTTPS must be checked after
publication. Hardware checks remain opt-in. Pi hardware acceptance and vendor
machine compatibility have the pending status described in the documentation.
