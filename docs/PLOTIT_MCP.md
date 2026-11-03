# PlotIt MCP for Mac

PlotIt MCP is a native macOS 14+ menu-bar companion. It bundles the plotting runtime and exposes local tools to Codex, Claude Code and Claude Desktop. No user-installed Node, npm, cloud account or public server is required. The existing browser editor remains separate; exchange SVG files with it.

## Install and connect

1. Open the DMG matching your Mac: **arm64** for Apple Silicon or **x64** for Intel. Move **PlotIt MCP.app** into Applications before configuring agents.
2. Open the app. Use **Set Up…** from its menu-bar panel. Select the machine, USB device, paper area, pen heights and orientation, then save.
3. Connect the plotter. Pen tests use the saved calibration. Position the carriage at the intended origin and choose **Set Current Position as Origin**.
4. Under **Configure agent apps**, select Install for each app you want to use. Review the destination and command before saving. Existing files are backed up. A conflicting `plotit` entry requires explicit replacement.
5. Start a new agent session; completely restart Claude Desktop if necessary. **Run Server Test** verifies an actual MCP handshake and tool discovery. **Agent connected** appears only after a client identifies itself.
6. Enable **Agent control** when the machine, paper and pen are ready. This permission expires when the companion restarts or loses its native connection. Preparation and simulation work while control is disabled.

Codex uses user-level `config.toml`, respecting `CODEX_HOME`; choose a custom configuration folder under Advanced if needed. Detection includes Codex and ChatGPT desktop app bundles. Claude Code uses its CLI with user scope and respects an inherited `CLAUDE_CONFIG_DIR`. Use **Locate App…** or **Locate CLI…** if an executable cannot be found. Claude Desktop uses its local `claude_desktop_config.json`. Other clients can copy the standard stdio configuration under Advanced. Installation never changes the agent's approval policy.

The tools do not arm control, calibrate the pen, or establish origin. These operations belong to the local companion. Loading a new pen requires local Continue. Disabling control blocks new starts; use Stop to stop an accepted drawing. Stop acceptance is distinct from settled motion.

## First agent workflow

Ask: “Use PlotIt to list its stroke fonts. Make a small hello-world drawing, prepare it and show me the preview. Simulate it before starting.”

| Tool | Purpose |
| --- | --- |
| `get_status` | Machine, firmware, paper, origin, control state and active drawing |
| `list_fonts` | Bundled OpenPlotFont faces and supported text layout |
| `create_artwork` | SVG content/file, normalized paths, or stroke-font text |
| `prepare_job` | Arrange artifacts and compile an immutable job; returns a preparing ID |
| `simulate_job` | Background virtual execution without opening USB |
| `get_job` | Poll preparation, simulation and physical lifecycle; optionally include PNG preview |
| `start_job` | Start the exact prepared job once |
| `control_job` | Pause, resume or stop the identified drawing |

All geometry and placement use millimetres. `create_artwork.source` has `kind` of `svg`, `paths` or `text`. SVG uses either `svg` content or an absolute local `.svg` `path`. Text requires `text` and `fontId`, with optional `capHeightMm` and layout settings. Custom font installation and system outline-font conversion are deferred.

`prepare_job.artwork` is a list of `{id, xMm?, yMm?, scale?, rotation?, pen?}` placements. `copies` is an optional finite integer from 1–100. Preparation uses saved settings and detected firmware when connected. Poll `get_job` until `pending`, inspect `includePreview:true`, optionally simulate, then explicitly start. A changed machine/firmware requires preparing again. An existing started job ID is never redrawn by retrying Start; a deliberate repeat requires preparing a new job.

PNG and SVG resources use `plotit://jobs/<id>/preview` and `/svg`. SVG external resources, entities, images, scripts and unoutlined SVG text are rejected. Source text can instead use the text tool. Artwork must fit the configured paper area; it is not silently clipped or scaled to fit.

## Runtime and recovery

The app launches a persistent native client. Private, owner-only Unix sockets connect it and each agent adapter to a shared Node service. The separate runner exclusively owns USB. Preparation and simulation execute in bounded worker threads, outside motion feeding. Closing an agent does not cancel a drawing. The runner inhibits idle system sleep during a drawing, including if the UI exits unexpectedly.

The native client sends a one-second heartbeat. New starts and agent Resume require an armed session with a heartbeat less than five seconds old. A restarted native session disarms control. There is one active physical job across all agents; commands are serialized. Local sockets trust the macOS user account and do not isolate mutually untrusted processes running as that same user.

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

Run `scripts/node-lts.sh scripts/smoke-companion.mjs "output/plotit-mcp-arm64/PlotIt MCP.app"` (or the x64 path) to check the actual bundled runtime, MCP handshake, text preparation, PNG preview and simulation. The smoke test uses temporary data and sockets, never connects USB and never changes agent configuration. An Intel build can be smoke-tested under Rosetta on Apple Silicon, but that does not replace acceptance on an actual Intel Mac.

For public distribution, configure a Developer ID signing identity and an existing `notarytool` keychain profile locally, then run:

```sh
scripts/node-lts.sh --npm run build:mac -- --arch all --release
```

The release command requires `PLOTIT_SIGN_IDENTITY` and `PLOTIT_NOTARY_PROFILE`. It signs nested native modules, the Node runtime and native binaries, verifies the bundle, submits and staples the app, then signs/notarizes/staples the DMG. It never prints or embeds signing credentials. Updating v1 is manual app replacement while idle.

The automated integration suite uses a simulated EBB transport and never opens physical USB. Before advertising production support, test clean Intel and Apple Silicon Macs without Node installed, each actual agent application, and each advertised machine/profile against the physical acceptance checklist. Passing virtual checks does not establish hardware support.

## Implementation conventions

Use the **SwiftUI Expert skill** for the native menu and setup UI. Prefer native controls, focused `@Observable` state and stable view identities. Maintain keyboard access, VoiceOver labels, light/dark appearance, clear error/success states and expandable technical details. Do not add Liquid Glass without an explicit design request.
