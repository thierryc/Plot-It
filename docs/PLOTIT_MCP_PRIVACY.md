# PlotIt MCP privacy and local data

PlotIt MCP does not require a PlotIt account and does not collect product analytics, crash reports or usage telemetry. It exposes local owner-only Unix sockets; it does not start a LAN or internet listener.

Machine settings, jobs, artwork, previews, agent configuration backups and logs are stored in `~/Library/Application Support/PlotIt MCP`. Agent app configuration lives in each application's normal configuration location. Installation changes only the reviewed PlotIt entry and makes a backup. The app can register a macOS login item if the user enables it.

The selected MCP agent receives tool requests and results, settings and drawing previews as requested. If the selected agent uses a cloud service, that service's privacy and retention policies apply. PlotIt cannot promise that agent conversation content stays on this Mac. The bundled setup/progress cards load locally and do not need external assets or analytics.

The signed app checks a public update feed on GitHub Pages once a day and downloads signed release archives from GitHub. These requests disclose normal connection metadata (such as IP address) to GitHub under its privacy policy. They do not include settings, drawings, jobs or agent conversations. Sparkle system profiling is disabled. Automatic checks and downloads can be turned off separately in About & Help; a manual Check for Updates remains available. Development builds and previews do not check for updates.

Signing/notarization is a developer release process that submits the built application to Apple; the installed app does not submit user drawings to Apple. Visiting support/documentation links opens external sites under their own policies. Review local logs and drawings before attaching them to a support issue.

Deleting the app does not remove local artwork, jobs or backups. Users may remove these local files after quitting the app and ensuring hardware motion has settled. No application-level cloud deletion request is needed because PlotIt operates no account or user-data backend.
