# PlotIt MCP for Mac

PlotIt MCP is a native macOS 14+ menu-bar companion. It bundles the plotting runtime and exposes local tools to Codex, Claude Code and Claude Desktop. No user-installed Node, npm, cloud account or public server is required. The existing browser editor remains separate; exchange SVG files with it.

## Install and connect

1. Download the signed, notarized **Universal** alpha for Apple Silicon and Intel from the [Mac companion page](https://thierryc.github.io/Plot-It/macos/). Open the DMG. Move **PlotIt MCP.app** into Applications before configuring agents.
2. Open the app. Use **Set Up…** from its menu-bar panel. Select the machine, USB device, paper format, pen heights and orientation, then save. Paper presets match the browser editor; **Custom…** accepts dimensions from 1–1,000 mm. Paper orientation and machine rotation are independent.
3. Connect the plotter. Pen tests use the saved calibration. Position the carriage at the intended origin and choose **Set Current Position as Origin**.
4. Under **Configure agent apps**, select Install for each app you want to use. Review the destination and command before saving. Existing files are backed up. A conflicting `plotit` entry requires explicit replacement.
5. Start a new agent session; completely restart Claude Desktop if necessary. **Run Server Test** verifies an actual MCP handshake and tool discovery. **Agent connected** appears only after a client identifies itself.
6. Use the single **Connect / Disconnect** toggle. Connecting allows agent use; drawing still requires saved settings, an established physical origin and the native app open. The toolbar pen gains its lightning bolt when USB is connected.

Codex uses user-level `config.toml`, respecting `CODEX_HOME`; choose a custom configuration folder under Advanced if needed. Detection includes Codex and ChatGPT desktop app bundles. Claude Code uses its CLI with user scope and respects an inherited `CLAUDE_CONFIG_DIR`. Use **Locate App…** or **Locate CLI…** if an executable cannot be found. Claude Desktop uses its local `claude_desktop_config.json`. Other clients can copy the standard stdio configuration under Advanced. Installation never changes the agent's approval policy.

The agent can inspect setup, save machine settings, connect/disconnect USB, test the saved pen heights and establish the current origin through the shared local companion. These operations require the native app open and an idle plotter. Origin capture requires confirmation that the physical carriage is positioned correctly. Loading a new pen requires local Continue. Disconnect while idle to release the plotter; use Stop to stop an accepted drawing. Stop acceptance is distinct from settled motion.

## Codex and Claude connection guides

The [website Mac guide](https://thierryc.github.io/Plot-It/docs/macos/#agents) includes screenshots, client-specific steps and manual configuration fallbacks:

- [Codex](https://thierryc.github.io/Plot-It/docs/macos/#codex): install from the Codex row, review the change, then start a new local session. The default configuration is `~/.codex/config.toml`; custom `CODEX_HOME` is supported.
- [Claude Desktop](https://thierryc.github.io/Plot-It/docs/macos/#claude-desktop): install from its row, then fully quit and reopen Claude Desktop. This is a local desktop-chat MCP connection; it is separate from claude.ai or Cowork remote connectors.
- [Claude Code](https://thierryc.github.io/Plot-It/docs/macos/#claude-code): install from its row or run `claude mcp add --scope user --transport stdio plotit -- "/Applications/PlotIt MCP.app/Contents/MacOS/plotit-mcp"`. Start a new local session and check `/mcp`.

Run **Run Server Test** in PlotIt's Test connection step; verify **Agent connected** after your client loads PlotIt. Server-test success alone does not confirm an agent is connected. Interactive cards depend on the client's MCP Apps support.

## First agent workflow

Ask: “Use PlotIt to list its stroke fonts. Make a small hello-world drawing, prepare it and show me the preview. Simulate it before starting.”

| Tool | Purpose |
| --- | --- |
| `get_status` | Machine, firmware, paper, origin, control state and active drawing |
| `get_setup` | Supported machines, saved settings, USB devices, paper presets and native-session readiness |
| `show_plotter_setup` | Interactive setup card; opening it never changes hardware |
| `configure_plotter` | Save supplied settings; use the latest `configDigest` to avoid overwriting another client's edits |
| `connect_plotter` / `disconnect_plotter` | Connect or disconnect the selected idle USB plotter |
| `test_pen` | Test saved pen Up/Down heights when requested |
| `set_plotter_origin` | Capture the carriage's current position after explicit physical confirmation |
| `list_fonts` | Bundled OpenPlotFont faces and supported text layout |
| `create_artwork` | SVG content/file, normalized paths, or stroke-font text |
| `prepare_job` | Arrange artifacts and compile an immutable job; returns a preparing ID |
| `simulate_job` | Background virtual execution without opening USB |
| `get_job` | Poll preparation, simulation and physical lifecycle; optionally include PNG preview |
| `show_plot_progress` | Open one live conversation card with the drawing preview, estimated progress and controls |
| `start_job` | Start the exact prepared job once |
| `control_job` | Pause, resume or stop the identified drawing |

All geometry and placement use millimetres. `create_artwork.source` has `kind` of `svg`, `paths` or `text`. SVG uses either `svg` content or an absolute local `.svg` `path`. Text requires `text` and `fontId`, with optional `capHeightMm` and layout settings. Custom font installation and system outline-font conversion are deferred.

`prepare_job.artwork` is a list of `{id, xMm?, yMm?, scale?, rotation?, pen?}` placements. `copies` is an optional finite integer from 1–100. Preparation uses saved settings and detected firmware when connected. Poll `get_job` until `pending`, inspect `includePreview:true`, optionally simulate, then explicitly start. A changed machine/firmware requires preparing again. An existing started job ID is never redrawn by retrying Start; a deliberate repeat requires preparing a new job.

PNG and SVG resources use `plotit://jobs/<id>/preview` and `/svg`. SVG external resources, entities, images, scripts and unoutlined SVG text are rejected. Source text can instead use the text tool. Artwork must fit the configured paper area; it is not silently clipped or scaled to fit.

## Live drawing feedback

After starting a drawing, ask the agent to show its progress. `show_plot_progress` opens a single MCP Apps card in compatible clients. It shows the full prepared drawing, estimated progress, elapsed time, estimated remaining time and the current copy. Pause, Resume and Stop act on that exact job; Stop requires a second click. Pen-change instructions point back to the companion’s physical Continue action.

The card refreshes through `get_job` every two seconds during drawing and less frequently while waiting. It pauses refresh requests while hidden and stops automatically at a terminal state. A failed refresh preserves the last visible state and reports that updates were interrupted. The card does not start or replay drawings. Its HTML and scripts are bundled locally, without external asset or network dependencies.

Progress is based on queued commands, so it is explicitly estimated and capped at 99% until the runner confirms `finished`. A full preview is shown rather than an inaccurate reveal of supposedly completed strokes. Paused and pen-change states hide the remaining-time estimate. Completion is based on settled motion, never elapsed time alone.

Clients without MCP Apps retain text/structured tool results and PNG previews. Server instructions ask the agent to avoid narrating routine checks, poll at least five seconds apart, and report meaningful milestones, attention requests and the final outcome. Actual chat rendering and message behavior depend on the host. This remains a local stdio integration; no web-accessible bridge is installed.

To review the card in a simulated host without running the companion or connecting hardware:

```sh
scripts/node-lts.sh --npm run build:companion
scripts/node-lts.sh scripts/preview-plot-progress.mjs
```

Open the printed local URL to exercise drawing, paused, pen-change, finished, dark and narrow states.

## Runtime and recovery

The app launches a persistent native client. Private, owner-only Unix sockets connect it and each agent adapter to a shared Node service. The separate runner exclusively owns USB. Preparation and simulation execute in bounded worker threads, outside motion feeding. Closing an agent does not cancel a drawing. The runner inhibits idle system sleep during a drawing, including if the UI exits unexpectedly.

The native client sends a one-second heartbeat. New starts and agent Resume require effective control with a heartbeat less than five seconds old, saved settings, connected hardware and an established origin. An expired heartbeat immediately prevents new starts and resumes. Control returns when connection readiness and a fresh native session return. There is no separate agent-permission preference. Readiness never starts or resumes a drawing automatically. Hardware setup changes wait for fresh runner telemetry before re-enabling control. There is one active physical job across all agents; commands are serialized. Local sockets trust the macOS user account and do not isolate mutually untrusted processes running as that same user.

Settings, artwork, jobs, previews, backups and logs are local. Data lives in `~/Library/Application Support/PlotIt MCP`; sockets use `/tmp/plotit-mcp-<uid>`. The app exposes no LAN or internet listener. Bounded task time, upload/geometry limits and preview dimensions constrain imported work. Agent tool stdout contains only MCP protocol data.

After USB loss or a runner restart, uncertain physical work is interrupted and never replayed. Inspect the job, restore the physical origin and prepare a new job. Quit during plotting offers Wait and Quit or Stop and Quit. Software sleep inhibition does not prevent closing a laptop lid, power loss or USB removal.

## Build and verify

From the repository with Xcode command-line tools and the pinned NVM runtime:

```sh
scripts/node-lts.sh --npm ci
scripts/node-lts.sh --npm run test:companion
swift test --package-path macos --scratch-path /tmp/plotit-swift-tests
scripts/node-lts.sh --npm run build:mac -- --arch all
```

Both `.app` bundles and development DMGs appear under `output`. Development packages are ad-hoc signed, not notarized, and are not public production releases. Packaging installs locked production dependencies for each architecture and verifies the downloaded non-host Node runtime against official checksums. Source, license notices, Node's license and runtime dependency licenses ship in the app.

`--arch all` now also creates a universal app, DMG and ZIP containing both Apple Silicon and Intel slices. `macos/release.json` controls the native version/build independently of the web editor. See [the native release guide](MAC_RELEASE.md) for final icons, signing/notarization, verification, checksums, release materials, website download metadata and independent distribution.

Run `scripts/node-lts.sh scripts/smoke-companion.mjs "output/plotit-mcp-arm64/PlotIt MCP.app"` (or the x64 path) to check the actual bundled runtime, MCP handshake, text preparation, PNG preview and simulation. The smoke test uses temporary data and sockets, never connects USB and never changes agent configuration. An Intel build can be smoke-tested under Rosetta on Apple Silicon, but that does not replace acceptance on an actual Intel Mac.

For public distribution, configure a Developer ID signing identity and an existing `notarytool` keychain profile locally, then run:

```sh
scripts/node-lts.sh --npm run build:mac -- --arch all --release
```

The release command requires `PLOTIT_SIGN_IDENTITY` and `PLOTIT_NOTARY_PROFILE`. It signs nested native modules, the Node runtime and native binaries, verifies the bundle, submits and staples the app, then signs/notarizes/staples the DMG. It never prints or embeds signing credentials. Updating v1 is manual app replacement while idle.

The automated integration suite uses a simulated EBB transport and never opens physical USB. Before advertising production support, test clean Intel and Apple Silicon Macs without Node installed, each actual agent application, and each advertised machine/profile against the physical acceptance checklist. Passing virtual checks does not establish hardware support.

## Implementation conventions

Use the **SwiftUI Expert skill** for the native menu and setup UI. Prefer native controls, focused `@Observable` state and stable view identities. Maintain keyboard access, VoiceOver labels, light/dark appearance, clear error/success states and expandable technical details. Do not add Liquid Glass without an explicit design request.

## Setup and UI behavior

Setup preserves unsaved changes across navigation, offers Save & Continue or an explicit discard action, and ends with Done and a copyable first agent prompt. USB detection distinguishes zero, one and multiple EBB devices. The orientation diagram explains paper coordinates versus machine orientation. The menu separates physical connection, agent connection and effective control readiness, and presents the next useful setup action.

The setup card and native window use the same validated, serialized companion operations. They detect concurrent settings changes; a stale card or native draft must reload before overwriting another client's edits. Native preview/test models never start a service or open USB. The About window includes version/build, support links and access to the local data folder.

Keep content readable and reserve Liquid Glass for navigation or controls on supported macOS versions, with macOS 14 fallbacks. Avoid applying glass to previews, status text and every form section.

Read [the privacy statement](PLOTIT_MCP_PRIVACY.md) before sharing logs or previews with a selected agent.

## Automatic updates

Starting with alpha 2 (build 7), the signed Mac app checks daily for published alpha and stable GitHub releases. Updates download automatically. Open **Settings… → App settings** and turn **Automatic updates** off to disable both checks and downloads. The setting is on by default and your choice is saved. **Check for Updates…** remains available there and in **About & Help**, even when automatic updates are off. Choose **Install & Restart** when convenient, or **Later** to continue working. A downloaded update can install on normal quit without reopening the app.

Installation waits until plotting, pauses, pen changes, returning/stopping, preparation and calibration have settled. Save or discard setup edits and finish any agent configuration review first. The app reserves the idle runner before closing so an agent cannot start a drawing during the update. Updates preserve local settings and never start or replay a drawing.

Build 6 and earlier need one manual upgrade: quit while idle, replace the app in Applications with alpha 2 or later, and reopen. Keep the previous release and a backup of the local data folder if you need to roll back. The website always offers a manual universal download.
