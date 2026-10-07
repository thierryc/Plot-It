# Raspberry Pi network plotter

The Pi serves Plot-it, its HTTP API, and WebSocket from one origin. A separate
runner owns USB and executes a complete, immutable motion plan. Browser closure
and API restart do not cancel an accepted drawing. Pen changes pause at origin
with motors engaged and require explicit Continue.

This release targets a **trusted LAN**, without user authentication. Keep it on
that LAN. A future public tunnel must add authentication before exposure.
Cloudflare Tunnel/ngrok installation is deliberately deferred.

## Runtime and development

The supported runtime is NVM-managed **Node 24.21.0 LTS**, pinned in `.nvmrc`.
Newer LTS majors require explicit compatibility validation; services never
download or upgrade Node during startup. Install NVM for your development user
from its official instructions: https://github.com/nvm-sh/nvm#installing-and-updating

Use the wrapper so an earlier PATH entry cannot silently select another Node:

```sh
scripts/node-lts.sh --npm ci
scripts/node-lts.sh --npm test
scripts/node-lts.sh --npm run build
```

It installs the pinned version through NVM only if absent, checks the version,
LTS designation and executable path, and launches that executable directly.
Node 26 Current and unvalidated major versions are rejected.

After building, use two terminals:

```sh
scripts/node-lts.sh --npm run server:runner
scripts/node-lts.sh --npm run server:api
```

Open `http://127.0.0.1:8787`. The default **manual** connection policy leaves USB
free when the server starts. Choose Network plotter, **Take control**, then
**Connect EBB**. Control ownership and physical USB ownership are separate.
**Release control** leaves the USB connection and accepted job running.
**Disconnect EBB · release USB** is allowed only after the job settles: it lifts
the pen, releases motors, invalidates origin and closes USB. Intentional release
suspends reconnect until another explicit Connect EBB, even in auto mode.

On a shared desktop, Direct USB and the local server cannot own the same board.
The app explains this and offers **Release server USB**, followed by a separate
**Connect** click for the browser's USB picker. A remote Pi owns its own USB
device; it does not block Direct USB on a different computer. Establish the
physical origin again after switching connections.

For a dedicated Pi, `deploy/environment.example` sets
**PLOT_CONNECTION_POLICY=auto** to connect at startup and retry unexpected USB
loss. No drawing is automatically started or replayed. Use `manual` to connect
only on demand. Firmware 2.6+ servo power is explicitly enabled for job setup
and server pen tests; an active job owns its immutable pen calibration.

For online static hosting without a Node server, use the separately compiled
[hosted beta website](SITE_HOSTING.md), with a browser-only editor at `/app/`.

## Pi release and installation

Reference target: Pi 4, Raspberry Pi OS Lite 64-bit. Pi 3 and Zero 2 W require
separate hardware/performance acceptance before being advertised as supported.
ARMv7/ARMv6 and obsolete Node versions are not supported by this installer.

Build on the development machine, then package the release:

```sh
scripts/node-lts.sh --npm run build
deploy/package-release.sh
```

Copy `output/plot-it-pi.tar.gz` to the Pi, unpack into a writable directory,
then run `sudo deploy/install-pi.sh` from that release. The Pi needs network
access for NVM/Node and production npm dependencies. The installer:

- creates the `plot-it` account with `dialout` permissions;
- installs compiled assets in `/opt/plot-it` and architecture-matched native dependencies;
- installs a pinned NVM version and Node runtime for that account;
- generates two independent systemd services with an absolute Node executable;
- provisions private job storage and runtime socket directories;
- enables services without starting hardware or overwriting existing configuration.

Native `node_modules` is never shipped from the development machine. Subsequent
release installation should happen with the runner idle and services stopped.
Keep the previous release and Node runtime until the new release is verified.

SSH is optional: these commands can run in a terminal attached directly to the
Pi. Install prerequisites once with `sudo apt install ca-certificates curl
build-essential python3`. The compiler/Python support native-module compilation
if an ARM64 prebuilt binding is unavailable. Once installed, use the HTTP status
endpoint locally on the Pi and HTTPS/WSS from LAN browsers; ongoing browser
operation does not require terminal access.

## Direct LAN HTTPS

On your administrative computer, use mkcert to create a local CA and certificate:

```sh
mkcert -install
mkcert -cert-file lan.pem -key-file lan-key.pem plot-it.local 192.168.1.50
```

Replace the hostname/IP with the Pi's actual hostname and DHCP-reserved address.
Use Raspberry Pi hostname resolution or local DNS; configuring the Node service
does not create a DNS record. See https://github.com/FiloSottile/mkcert for installation
and browser/platform trust instructions.

Copy only `lan.pem` and `lan-key.pem` to `/etc/plot-it` on the Pi. Set ownership to
`plot-it:plot-it` and permissions to 0600. Install the CA's public root certificate
on each client device that will use HTTPS/WSS. **Never copy the CA private key.**

Edit `/etc/plot-it/environment`:

```text
PLOT_ORIGINS=https://plot-it.local:8443,https://192.168.1.50:8443,http://127.0.0.1:8787,http://localhost:8787
PLOT_TLS_CERT=/etc/plot-it/lan.pem
PLOT_TLS_KEY=/etc/plot-it/lan-key.pem
EBB_DEVICE=/dev/serial/by-id/<actual-EBB-device>
```

Enumerate `/dev/serial/by-id` and use the actual stable device path. Blank
`EBB_DEVICE` selects a board only when exactly one matching EBB is detected.
USB CDC does not require enabling the Pi's GPIO UART.

Start services after configuration:

```sh
sudo systemctl start plot-it-runner plot-it-api
sudo deploy/diagnose-pi.sh
```

Open `https://plot-it.local:8443`, then Plot → Network plotter → Take control.
Load the indicated pen and explicitly Start. Only one browser can control the
machine; others may view an active job. Reconnection restores observation but
does not automatically claim control or replay a command.

The API listens on loopback HTTP 8787 and, when certificates are configured,
LAN HTTPS 8443. The runner communicates only through private Unix sockets.
Origin/Host allowlisting prevents cross-site browser controls, but is not user
authentication. Source files and user-loaded fonts remain in browser storage;
moving to another hostname creates a different browser storage origin.

## Protocol and execution

- `GET /api/v1/status`: capability discovery and the latest runner snapshot.
- `POST /api/v1/jobs`: `{version:1, requestId, plan}`. Returns the immutable job ID.
- `GET /api/v1/jobs/:id`: plan, durable state and current snapshot if applicable.
- `/api/v1/ws`: versioned requests with `requestId`, `action`, and action parameters.
  Actions include claim/release-control, start, pause, resume/continue, stop, cancel and
  permitted manual pen/origin/motor controls. Arbitrary serial commands are rejected.
- Results acknowledge request acceptance; snapshots report physical lifecycle.
  In particular, `pausing` is distinct from `paused`, and an acknowledgement of
  the last motion command does not mean the job is physically finished.

Defaults: one simultaneous upload, 32 MiB per upload, 100,000 events, at most 1,000,000 compiled commands,
64 KiB control/snapshot frames, 16 browser connections and 16 pending controls
per connection. Upload size/event limits can be configured in the environment.
Jobs contain all pen passes in their original order. Upload or Start retries
reuse request/job identities; a second drawing requires a new uploaded job.

Progress snapshots are published at 5 Hz. Slow IPC consumers retain only the
latest unsent snapshot; slow WebSocket clients are disconnected when their
buffers exceed the limit. The runner never waits for frontend receipt.
Lifecycle status is stored in small atomic sidecar files, avoiding large plan
serialization during motion. Diagnostics are bounded and downloaded while idle.
Preflight checks compiled command integers against the
[EBB v2 command reference](https://evil-mad.github.io/EggBot/ebb2.html), including
XM duration, mixed-axis step speed, and LM rate/step/acceleration fields.
Optional EBB position queries use longer motion windows; short move streams
do not incur a USB query merely to update the display.

The frontend distinguishes EBB connection from network connection, labels
interpolation as estimated, and excludes all `/api/` responses from PWA caching.
EBB counters are commanded position and cannot detect skipped steps.

After USB loss or runner restart, uncertain motion is not replayed. Interrupted
jobs remain inspectable; establish a physical origin explicitly and submit a
new job. API/tunnel failure is separate from runner failure. Ordinary Stop settles,
lifts and returns to known origin; emergency failure does not initiate a return.

## Acceptance record

The normal automated suite uses simulated EBB transports and never moves physical hardware.
They cover USB regression, firmware fallback, job validation/deduplication,
ownership, telemetry backpressure, API death, runner death, and recovery without
replay. Network integration tests require local socket/listener permissions.

Six real-device connection tests in `server/ebb-hardware.test.ts` are deferred:
ordinary `npm test` skips them even if a board is attached. Run them only after
connecting the EBB, from a development checkout (or unpacked corresponding source
with development dependencies installed). Missing hardware in an explicitly
selected mode fails the checks rather than silently skipping them.

For a board connected directly to the computer running the tests:

```sh
scripts/node-lts.sh --npm run test:ebb -- usb
```

This checks USB discovery, the firmware handshake, repeated serial replies,
exclusive ownership, and close/reopen cycles. Stop the runner and disconnect
other USB applications first. `EBB_DEVICE` may select a particular serial path;
otherwise exactly one EBB must be discoverable. The test account needs serial
device permissions. Only firmware queries (`V`) are written: no motion, pen,
motor-enable, or origin-reset commands are issued.

For the EBB attached to a Pi whose runner is already running, test remotely
without SSH or taking control:

```sh
PLOT_EBB_URL=https://plot-it.local:8443 scripts/node-lts.sh --npm run test:ebb -- network
```

This checks live HTTP status and authoritative WebSocket feedback, requiring
the Pi to report an actual connected EBB and advancing state revisions. Use an
HTTP origin only where the service is reachable over HTTP (default HTTP is Pi
loopback); LAN control remains HTTPS/WSS. For a local CA, set
`NODE_EXTRA_CA_CERTS=/absolute/path/to/rootCA.pem` before launching if Node does
not trust that CA. TLS verification remains enabled. Network checks are viewers
and never claim control or submit jobs.

Real Pi/EBB acceptance is pending until performed. Verify ARM64 native SerialPort,
HTTPS/WSS from another LAN client, reboot/service recovery, continuous curves,
ordered pen changes, Stop and origin handling. Exercise uploads and live preview
during motion. Record request-to-runner/acceptance latency separately from board
settling and the next safe pause boundary; no physical timing guarantee is implied
by a passing mock test.

## Shared-core prepared jobs

Schema-2 jobs carry normalized geometry, layers, compiler `native-v3`, profile and
firmware target, executable records, repeats and optional drawing-distance start.
The runner recompiles and compares the digest before admitting/starting them;
firmware must match the prepared target. The portable SDK client can submit a
prepared job without editor data. Version-1 SM jobs retain their validated timed
compatibility adapter and diagnostic readability; started/interrupted identities
are never automatically reinterpreted or resumed.

Snapshots advertise capabilities, copy/countdown and settled checkpoints. Tiny
sidecars persist progress roughly once per second without rewriting the program.
A restart marks active work interrupted and requires explicit origin recovery.
Optional completion delivery is a host callback; it cannot affect feeding or
trigger another plot. CLI `--runner URL` uses the existing claim/control API.
