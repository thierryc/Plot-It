# PlotIt MCP native UI

Use the `swiftui-expert:swiftui-expert-skill` skill when implementing or reviewing the menu-bar UI, setup dialogs, app state, and native tests. Follow the skill's native-control, accessibility, observation, and API-availability guidance. The deployment target is macOS 14.

Keep hardware execution and agent configuration operations in the shared companion service. Native views present state and explicit user actions. Connecting the plotter allows agent use; there is no separate permission switch or saved Off preference. The shared service still requires saved settings, connected hardware, established origin and a fresh native heartbeat before drawing. Readiness never starts or resumes a drawing. Preview/test models must never start a live service, configure an agent, or connect USB.

Do not add Liquid Glass without an explicit user request. Preserve native light/dark appearance, keyboard access, VoiceOver labels, and clear loading/error/success states.
