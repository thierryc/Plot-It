# Network plotter implementation brief

The local-first Node 24 LTS implementation now uses separate API and runner
processes, complete ordered multi-pen jobs, HTTP uploads, and WebSocket controls
and snapshots. It preserves direct USB and simulation.

Shared desktops start with on-demand EBB connection. Dedicated Pi deployments
can choose automatic connection. Browser control ownership is separate from
USB ownership, with an explicit idle-only USB release for handoff. Server pen
tests carry edited calibration, refresh the target and explicitly enable servo
power; job calibration remains immutable through pauses and Stop cleanup.

A separately compiled browser-only release targets **plot-it.litsquare.com**
on GitHub Pages. It is built locally, contains Direct USB and Simulation only,
and includes no server discovery or network client. See
[local build and hosting](BROWSER_HOSTING.md).

The original one-pass-per-job proposal is superseded: complete drawings retain
pen changes and explicit Continue while preserving origin between passes.

See [setup, architecture, protocol and acceptance](NETWORK_PLOTTER.md).

Pi 4 with Raspberry Pi OS Lite 64-bit is the reference target. Pi 3 compatibility
requires hardware validation. Tunnel installation and authentication are deferred;
this release is for a trusted LAN. A future tunnel must add authentication.

Automated acceptance uses simulated EBB transports. Physical Pi/EBB motion
acceptance must be completed separately; software tests do not establish it.
