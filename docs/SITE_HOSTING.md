# GitHub Pages deployment

The public site is hosted at https://thierryc.github.io/Plot-It/ with the app at `/Plot-It/app/` and contributor page at `/Plot-It/contributors/`. GitHub Pages serves the static app over HTTPS; the optional Node/Pi service runs separately on the user’s computer.

The `Publish Plot-it` workflow tests and builds the site on every push to `main`, verifies the built routes and notices, and deploys the artifact with GitHub Pages Actions. Configure the repository Pages publishing source as **GitHub Actions**. Run the workflow manually to redeploy the current commit.

## Local verification

```sh
scripts/node-lts.sh --npm ci
scripts/node-lts.sh --npm run build:site
scripts/node-lts.sh --npm run test:site-build
scripts/node-lts.sh --npm run preview:site
```

The Vite site base is `/Plot-It/`. Production includes the landing page, app, documentation, self-hosting guide, contributor page, fonts, notices and source archive. Private files and Node server code are excluded. `release.json` identifies the source commit. Source archives retain LICENSE, NOTICE and third-party attribution.

## Recovery

Revert a faulty source change and push the correction to `main`, or rerun the workflow for the desired reviewed commit. Keep deployments tied to the tested source commit recorded in `release.json`.

No paid hosting account or server credentials are needed for the public static app.
