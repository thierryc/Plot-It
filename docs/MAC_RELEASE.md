# Releasing PlotIt MCP separately from the web app

PlotIt MCP uses its own release configuration in `macos/release.json`. The initial release candidate is **0.1.0, build 5, alpha**, minimum macOS 14. The Node/npm package version continues to describe the shared repository. The first public draft uses `plotit-mcp-v0.1.0-alpha.1`; native release tags do not trigger a web release by name alone. Building never publishes or installs the app. Signed release builds require a clean Git commit and reject source changes during the build. The sealed source archive is SHA-256 recorded in build metadata.

## Development builds

```sh
scripts/node-lts.sh --npm ci
scripts/node-lts.sh --npm run test:companion
swift test --package-path macos
scripts/node-lts.sh --npm run build:mac -- --arch all
scripts/node-lts.sh scripts/verify-mac.mjs 'output/plotit-mcp-arm64/PlotIt MCP.app'
scripts/node-lts.sh scripts/verify-mac.mjs 'output/plotit-mcp-universal/PlotIt MCP.app'
scripts/node-lts.sh scripts/smoke-companion.mjs 'output/plotit-mcp-arm64/PlotIt MCP.app'
PLOTIT_SMOKE_ARCH=x86_64 scripts/node-lts.sh scripts/smoke-companion.mjs 'output/plotit-mcp-universal/PlotIt MCP.app'
scripts/node-lts.sh scripts/prepare-mac-release.mjs
```

`--arch arm64` builds Apple Silicon only. `--arch x64` builds Intel only. `--arch universal` builds and verifies both component apps, then packages and notarizes only the combined universal app. `--arch all` packages all three architectures. The universal app contains both Swift and Node CPU slices, both resvg addons and the universal serial binding; it runs natively on either architecture. Verifying the x86 slice on Apple Silicon requires Rosetta. This does not replace testing on an Intel Mac.

Output includes DMGs, app ZIPs, a SHA-256 checksum list, release manifest, component inventories, corresponding source, bundled licenses, and a release-materials directory. Development artifacts are ad-hoc signed and use names ending in `-development`; they are not notarized public downloads.

## Final icon and version

The editable Liquid Glass icon is `macos/Assets/AppIcon.icon`, created in Apple Icon Composer with the Regular-S LitSquare symbol on vivid magenta. Packaging compiles it once with `actool`, includes `Assets.car` and `CFBundleIconName` for modern macOS, and includes the generated `.icns` fallback for macOS 14 and 15. The native menu bar uses separate monochrome PDF templates for idle and plotting states. Glyph masks must be resolved by Glyphs before exporting those vectors; raw path concatenation loses the cutouts.

Alternatively provide `AppIcon.icns`, a square PNG of at least 1024 × 1024 as `AppIcon.png`, or set `PLOTIT_APP_ICON` to a `.icon`, `.icns` or PNG file. A supplied environment path takes precedence. Signed release packaging refuses the provisional icon.

Set the version and monotonically increasing build in `macos/release.json`. Environment overrides are `PLOTIT_MAC_VERSION` and `PLOTIT_MAC_BUILD`; these affect the native package, not the web editor. Never modify an app bundle after signing it.

## Signing and notarization

Install a **Developer ID Application** certificate and private key in your local signing keychain. Confirm it is available with `security find-identity -v -p codesigning`. Store notarization credentials using Apple's `xcrun notarytool store-credentials` interactive workflow; do not put passwords or private keys in this repository or chat. Record only the keychain profile name in your local environment.

```sh
export PLOTIT_SIGN_IDENTITY='Developer ID Application: your installed identity'
export PLOTIT_NOTARY_PROFILE='your-keychain-profile-name'
scripts/node-lts.sh --npm run build:mac -- --arch all --release
scripts/node-lts.sh scripts/verify-mac.mjs 'output/plotit-mcp-universal/PlotIt MCP.app' --release
scripts/node-lts.sh scripts/verify-mac-containers.mjs
scripts/node-lts.sh scripts/prepare-mac-release.mjs
```

Packaging signs nested native modules and Node before the native executables and bundle, enables the hardened runtime, grants JIT only to Node, verifies signatures and exercises the signed runtime before upload. Intel V8 also requires `allow-unsigned-executable-memory` on Node; that exception is included in Intel and universal Node binaries. On Apple Silicon with Rosetta, pre-upload verification exercises both CPU slices. Packaging checks notarization status is Accepted, staples tickets to the app and DMG, and validates the stapled tickets. Gatekeeper assessment is part of release verification. Full notary results are retained alongside the build. Library validation remains enabled.

Apple references: [Universal binaries](https://developer.apple.com/documentation/apple-silicon/building-a-universal-macos-binary), [Developer ID](https://developer.apple.com/developer-id/), [Notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

## Candidate acceptance

- Final icon, app name, copyright, version and build reviewed.
- Companion tests, native tests, site build/link checks and package smoke tests pass.
- Verify both CPU slices, native addons, cards, licenses and source in the exact final app.
- Test clean Apple Silicon and Intel Macs without Node installed, including macOS 14 and the current release.
- Test installing from a downloaded, quarantined DMG, moving to Applications, launching, reopening, login launch, updating, uninstalling and Gatekeeper offline with the stapled ticket.
- Test actual Codex, Claude Desktop and Claude Code; record versions and whether each can render MCP Apps. Do not advertise card support from simulation alone.
- On each advertised physical profile: connect, save settings, test pen heights, establish origin, prepare/preview, plot, pause/resume, pen change, controlled stop, disconnect, heartbeat loss, restart and recovery. Retain the experimental label for untested profiles.
- Confirm Off persists, setup cannot bypass it, readiness cannot start/resume motion, and an uncertain Start never retries under a new job ID.
- Review the component inventory and bundled font notices; preserve corresponding source and notices in every distribution.
- Review the privacy statement: PlotIt stores data locally, while selected agent hosts receive requested tool results/previews under their own policies.

## Publish when the candidate is accepted

1. Commit the reviewed source, update the native release notes, and prepare a prerelease tag such as `plotit-mcp-v0.1.0-alpha.1` from that commit. Rebuild so the manifest records a clean source state.
2. Publish a separate GitHub Release with the **signed/notarized** Apple Silicon and Universal DMGs and ZIPs, SHA-256 checksums, release manifest, release notes and source archive. Do not relabel development files as release files.
3. Download the uploaded files and compare their hashes to the manifest. Verify Gatekeeper again on a clean Mac.
4. Confirm `site/macos/release.json` contains the exact published version, HTTPS download URLs and checksum URLs, then set `available` to true. A universal-only release works on both Apple Silicon and Intel; the separate Apple Silicon download is optional. The website intentionally shows no download until this metadata is enabled. Build/test the site before publishing that change.
5. Keep the browser editor's existing release and deployment workflow independent. Native app assets belong in release storage, not in the website's service-worker cache or source tree.

`.github/workflows/macos.yml` prepares development artifacts on manual dispatch. Signed release builds remain local until signing/notarization credentials and the final icon are configured. No workflow in this change publishes a release automatically.

## Updates and rollback

Quit while idle, replace the app in Applications, and reopen. The stable launcher path and bundle ID remain unchanged. Settings, jobs and configuration backups live in `~/Library/Application Support/PlotIt MCP`; back up this folder before an upgrade. Keep the previous signed release available. If a drawing was interrupted, inspect it and re-establish physical origin; never replay it automatically. Current settings have no schema migration in this alpha.

To uninstall, remove the PlotIt connection from each configured agent using the app, turn off Open at Login, quit while idle, then move the app to Trash. Local data is retained until the user deletes it. The native app does not uninstall or alter the web app.
