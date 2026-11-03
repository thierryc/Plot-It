# PlotIt MCP 0.1.0 · alpha

PlotIt MCP is a separate macOS 14+ menu-bar application for using a local USB pen plotter from an MCP-compatible agent. The browser editor remains available independently. This alpha does not establish production hardware support.

The first public prerelease is `plotit-mcp-v0.1.0-alpha.1`, app version 0.1.0 build 5. Its universal package includes both Apple Silicon and Intel runtimes, is Developer ID signed and notarized, and includes its corresponding source and notices.

## Included

- Native machine setup with paper presets, custom dimensions, pen calibration, machine orientation and accurate USB detection.
- Save & Continue, unsaved-change handling, a readiness checklist, copyable first prompt, and About/help.
- Agent setup tools for settings, USB connection, pen tests and explicit current-position origin capture.
- Interactive setup and live progress cards in compatible local MCP Apps clients; useful text and PNG results elsewhere.
- Automatic agent control when the machine is ready, a fresh native session is present and the saved preference permits it. An explicit Off choice persists.
- Drawing preview, estimated progress, elapsed and remaining time, Pause/Resume/Stop and physical pen-change instructions.
- Apple Silicon, Intel and universal packages with a bundled pinned Node runtime and native dependencies. No separate Node installation is required.
- Liquid Glass app icon on vivid magenta, with mask-resolved Regular-S LitSquare symbols and a separate menu-bar symbol while plotting.

## Install

Choose Apple Silicon for an M-series Mac or Universal for either Apple Silicon or Intel. Move PlotIt MCP.app to Applications, open it, and use Set Up. Configure your agent app, then start a new agent session. Ask it to check setup or open the setup card. Review a prepared drawing before requesting a physical plot.

The software is experimental. AxiDraw, NextDraw and other profile compatibility must be validated on the actual hardware. Simulation is not evidence of physical compatibility. There is no automatic job replay after interruption and no automatic drawing when readiness returns.

## Known limits

- macOS only; no Mac App Store or automatic updates in this release.
- Local stdio integration. A remote ChatGPT web bridge is not included.
- Interactive card rendering depends on client capabilities. Terminal-only clients retain tools and text/PNG feedback.
- Physically positioning the carriage, securing paper and loading a pen remain user tasks. Capturing origin does not home the machine.
- Progress is estimated from queued commands and remains below 100% until settled completion.
- The app and editor exchange SVG; they are separate workspaces.

For setup, recovery, updates and uninstalling, see [the Mac guide](../PLOTIT_MCP.md). Report issues at [GitHub](https://github.com/thierryc/Plot-It/issues) with app version/build, macOS version, CPU architecture, agent/client version and plotter profile. Review logs before sharing them.
