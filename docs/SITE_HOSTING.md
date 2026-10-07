# Hosted alpha website

The public site is https://thierryc.github.io/Plot-It/. Its landing page is `/Plot-It/`,
the browser-only editor is `/Plot-It/app/`, and documentation is under `/Plot-It/docs/`.
These are real HTML directories, with a genuine `404.html`; no SPA rewrites
or server API are required. The normal local/Pi build and standalone browser
build keep the app at `/`.

## Build and verify locally

Use NVM and the pinned Node 24.21.0 LTS executable:

```sh
scripts/node-lts.sh --npm ci
scripts/node-lts.sh --npm test
scripts/node-lts.sh --npm run build
scripts/node-lts.sh --npm run build:browser
scripts/node-lts.sh --npm run test:browser-build
scripts/node-lts.sh --npm run build:site
scripts/node-lts.sh --npm run test:site-build
scripts/node-lts.sh --npm run preview:site
```

Preview on http://127.0.0.1:8789/Plot-It/, separate from the server on 8787.
Check direct loading and refresh of every route, fonts, SVG import, text,
simulation, navigation, themes, keyboard focus, and compatibility notes.
Connecting USB must be an explicit action and must not start a plot.
Hardware acceptance is independent of passing software tests.

`dist-site/` is the complete static website; `output/plot-it-site.zip` contains
those files. The hosted editor has its own manifest and service worker under
`/Plot-It/app/`, with fallback restricted to that scope. Its worker only removes caches
with its own prefix. Documents, fonts and themes retain their original
origin-based browser-storage keys. The site does not call the Node API.

Marketing/documentation pages use static HTML and the existing theme helper.
Their AP.CX footer uses the vanilla API of `@ap.cx/gl-marquee` pinned to `0.1.0`,
with the bundled Square Bot Sans font and local CSS Module styles. It uses
OpenPlotFont's layout: top links and motion control, a full-width marquee, then
AP.CX branding, project license/source links, and the privacy statement.
It follows the page theme, honors reduced motion, offers a pause control, and releases its
canvas when offscreen. Canvas 2D and regular HTML text provide fallbacks.
Keep hardware statements dated, link primary sources, and distinguish
documented controller protocol from actual machine testing. No private
design-system package or new site framework is required.

## Publish

Source is public at https://github.com/thierryc/Plot-It on `main`.
Commit source, push `main`, then rebuild so `release.json` identifies that commit.
Runtime jobs, logs, output, local configuration and certificates are not source
publication inputs. The corresponding-source archive includes the website,
backend, deployment scripts, notices and build instructions.

```sh
scripts/node-lts.sh --npm run build:site
scripts/node-lts.sh --npm run publish:site -- --dry-run
scripts/node-lts.sh --npm run publish:site
```

The publisher verifies the artifact and matching published source revision.
It prepares `gh-pages` in a temporary checkout, leaving the source branch
and working files alone. Pushes use ordinary Git credentials and fast-forward
history; the script does not force-push. Concurrent publication fails safely.
Keep the previous commit printed by the script for rollback:

```sh
scripts/node-lts.sh --npm run publish:site -- --rollback <previous-gh-pages-commit>
```

Rollback creates a new commit restoring the previous branch tree, including
its source archive and release metadata. It does not rewrite history.

Configure GitHub Pages to **Deploy from a branch**, `gh-pages`, `/(root)`.
Leave the custom-domain field empty for now. The build uses `/Plot-It/` for
GitHub's default project URL, includes `.nojekyll`, and omits `CNAME`.
Custom-domain configuration and DNS are deferred.

No application build or custom GitHub Actions workflow is included.
GitHub uses its own Pages deployment workflow internally for branch publication.

Verify live HTTPS for `/Plot-It/`, `/Plot-It/app/`, `/Plot-It/docs/`, `/Plot-It/docs/self-hosted/`, static assets,
and a missing route. Confirm the custom 404 is returned as HTTP 404 and the
editor's service worker never replaces documentation with application HTML.

- [GitHub branch publication](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [GitHub custom domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)
