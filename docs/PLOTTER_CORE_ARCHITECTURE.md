# Plotter Core architecture decision

Reviewed 2026-10-06. Status: implemented offline candidate; see [the implementation checkpoint](CORE_REWRITE_STATUS.md). Hardware acceptance remains pending. “Nextflow” refers to NextDraw. No firmware was flashed
and no physical hardware commands were sent during this rewrite.

## Decision

Build one reusable TypeScript **Plotter Core**, with NextDraw-like separation of
path planning, motor compilation, pen handling, homing and command feeding. Use
that core from the browser and existing Node runner; use the thin CLI and client entry point. A desktop shell can reuse that API. Keep two motion backends inside it: native SM for compatibility,
and jerk-controlled T3/TD for validated modern firmware.

The support target is **EBB firmware 2.8.1 through the current 3.1.7**, across
recent AxiDraw, Xylodraw and NextDraw profiles. This is broader than current
NextDraw software, which requires 3.0.2. No upgrade is required to use the planned
SM backend on the user's current 2.8.1 machine. Hardware marked EBB 2.7 and firmware
2.8.1 are different version numbers; neither identifies the machine's mechanics.

The migration also includes the remaining core plotting features identified in the
[NextDraw feature-gap review](research/NEXTDRAW_FEATURE_GAP_REVIEW_2026-10-06.md):
constant drawing speed, handling presets/resolution, repeats with inter-copy timers,
layers and recovered resume, placement/occlusion and public utilities. Those features
use the same package and scheduler; they do not become separate browser-only engines.

Use the generic name Plotter Core rather than implying this is Bantam Tools'
NextDraw core. Source-derived code retains its actual license/provenance. The app
is currently AGPL-3.0-only; extracting a package does not make that code MIT.

## What the source review establishes

The pinned NextDraw API 1.7.4 archive, dated 2026-10-02, contains shared
`nextdrawcore` modules used by the Python and CLI wrappers. The Inkscape-facing
controller and CLI share an additional wrapper. Its useful boundaries are:

| NextDraw source | Responsibility | Our corresponding component |
| --- | --- | --- |
| `path_objects.py`, `plot_optimizations.py` | Prepared geometry, ordering and plot digest | Prepared paths, optimization and job identity |
| `motion.py`, `plan_utils.py` | Whole-stroke look-ahead and segment motion compilation | Planner plus separate native-motor compiler |
| `pen_handling.py` | Servo calibration, timing, status and restoring pen configuration | Pen controller and immutable pen records |
| `homing.py` | Origin, controller position, supported automatic homing | Profile-specific homing/origin service |
| `dripfeed.py`, `serial_utils.py` | Feeding, status polling, serial operations and queue draining | Feeder plus EBB protocol session |
| `preview.py`, `plot_status.py` | Preview, statistics, progress and resume bookkeeping | Executable-plan sampler and structured events |
| `nextdraw_py.py`, `nextdraw_cli.py`, `nextdraw_control.py` | Public interfaces, settings and application orchestration | TypeScript API, CLI, editor and runner adapters |

However, its main class inherits `inkex.Effect`; geometry depends on XML tooling;
motion and feeding receive the mutable main object, and feeding also updates
preview/progress/resume state. It is a useful functional reference, not an already
platform-neutral architecture to translate literally. Our design makes those
dependencies explicit and keeps UI progress and document storage outside execution.

See the [API review](research/NEXTDRAW_API_REVIEW_2026-10-06.md) and
[motor review](research/MOTOR_IMPLEMENTATION_REVIEW_2026-10-06.md) for pinned sources,
offline evidence, license notices and known wrapper defects. A directly translated
GPL module must be described as a port, not as clean-room work.

## What we already have, and what needs moving

The browser's `src/plotter.ts` already wraps `src/plotter-core.ts`; the Node runner
uses that same executor through `server/serial.ts`. Preserve this single-device
ownership model. The worker already calls reusable planning functions, and the
process/pen modules already enforce stationary transitions.

The missing boundary is a supported library contract:

- `plotter-core.ts` combines connection selection, EBB framing, feeding, origin,
  pen state, timing, power and job lifecycle. Injected sleep exists, but clock calls
  still use global `performance.now()`.
- Plot settings and geometry types live with editor state in `model.ts`.
- `plot-job.ts` takes an SVG DOM element. `pens.ts` imports clipping/splitting from
  `svg.ts`, which also contains DOM parsing and curve sampling. Color resolution
  can use a canvas. These responsibilities need separate pure modules.
- Simulation uses an animation-frame clock and an analytical plan. The new pure
  sampler must use compiled motor records; the browser keeps only rendering/clock
  control. Network version 1 also assumes the current linear-acceleration plan.

The user subsequently requested a fresh start rather than preserving old driver
logic. The current first stage keeps the editor/runner interfaces through thin
adapters, but replaces the active motion planner/compiler and pen/device executor.
The old XM implementation is preserved only in the verified archive. Later sections
describe the complete target, including features not yet implemented.

## Package and dependency boundaries

Start with **one workspace package**, proposed as `packages/plotter-core` with
name `@thierryc/plotter-core`, following the existing openplotfont workspace pattern.
Its public root is platform-neutral; explicit subpath exports provide adapters.
Do not create a separate package for every internal module.

```text
Editor SVG/font/fill adapter ──┐
CLI geometry/file adapter ────┼── normalized paths in mm
Programmatic drawing API ────┘             │
                              prepare → plan → compile
                                          │
                                immutable ExecutablePlan
                                  │                 │
                            pure sampler       PlotterSession
                                  │                 │
                           preview renderer   pen + homing + feeder
                                                    │
                                               EBB protocol
                                                    │
                                         opened byte transport
                                          /                \
                                   Web Serial          Node serialport
```

| Proposed entry point | Contents | Dependency rule |
| --- | --- | --- |
| `@thierryc/plotter-core` | Types, profiles, capabilities, pure preparation/planning/compilation/sampling, session | No editor imports, DOM globals, Node built-ins, USB discovery, filesystem or HTTP |
| `@thierryc/plotter-core/browser` | Web Serial opening/discovery and browser clock adapter | Browser APIs isolated here; port permission stays in a user action |
| `@thierryc/plotter-core/node` | `serialport` discovery/opening and Node clock adapter | Node dependency loaded only by this entry point |
| `@thierryc/plotter-core/client` | Versioned job/control DTOs and remote client facade | High-level runner operations, not serial byte forwarding |
| `@thierryc/plotter-core/virtual` | Stateful virtual EBB, byte transport, deterministic clock and fault scenarios | Optional development/test entry point; excluded from production root imports |

Make the Node dependency optional or a peer dependency so using the pure/browser
entry point does not require native serial bindings. Build ESM with declarations;
target ES2022 and the project's Node 24 runtime initially. Use separate TypeScript
configurations for the pure root and platform adapters. The pure root must compile
without DOM or Node type libraries. Browser and Node import/bundle checks must prove
that root imports do not accidentally load `serialport` or editor modules.

SVG import, typography, fill generation, `.plit` files, local storage, databases
and HTTP hosting remain application adapters. Core input is normalized polylines
with stable source/tool IDs, clipping bounds and explicit units. Resolve CSS colors
outside the core. Move pure clipping, reload splitting and optimization into it.
The first CLI can accept this path-job JSON format; complete SVG support needs a
Node-compatible geometry adapter. `.plit` input alone does not eliminate the need
to resolve artwork, fonts and fills. Do not assume browser SVG measurement works
unchanged in Node.

## Internal modules and responsibilities

| Component | Contract |
| --- | --- |
| Geometry/preparation | Normalize, clip, assign tools, optimize, split at reload limits; no serial I/O |
| Machine profiles | Bounds, coordinate matrix, motor scale/microsteps, servo pin/pulse/rate mapping and supported homing method |
| Firmware capabilities | Version parsing, response dialect, FIFO behavior, available commands and validation policy |
| Motion planners | Whole-stroke junction look-ahead; SM acceleration policy or modern speed/acceleration/jerk policy |
| Motor compiler | Native M1/M2 endpoints, durations, rounded SM or T3/TD parameters, accumulator prediction and checked encoders |
| Executable model | Versioned records, source IDs, stationary boundaries, timing, digest and checkpoints |
| Pen controller | Desired/queued/settled state, calibration, timing and restoration after emergency Up |
| Homing/origin | Manual origin, queried controller steps, coordinate frame confidence and optional supported automatic homing |
| Feeder | One command owner, bounded queue horizon, TD queue accounting, scheduled queries, drain and controls |
| EBB protocol | Framed replies, negotiation, firmware-specific commands/errors and one status decoder |
| Session | Public lifecycle, validation, job handles and structured events; composes the above |
| Sampler/statistics | Command-derived preview, pen counters, drawing/travel distances and predicted duration |
| Handling/layer settings | Typed model-aware recipes, sampling accuracy and resolved immutable layer overrides |
| Sequence/checkpoints | Lazy repeat scheduling, cancellable timers, layer events and verified recovered resume |

The transport accepts an already-open channel: asynchronous byte reads, ordered
`write(bytes)`, `close()` and disconnect notification. Stream conversions and
device discovery belong to adapters. Inject a monotonic clock and cancellable
sleep so protocol deadlines and feeder timing can be tested without real time.
Every serial operation, including manual pen controls, position/power queries and
homing, must go through the session's command owner.

Separate four inputs: **MachineProfile**, **FirmwareCapabilities**, **PlotSettings**,
and **Transport**. Changing the USB transport does not change mechanics; changing
firmware does not turn an AxiDraw/Xylodraw into a NextDraw. Existing AxiDraw model
decoration is not an authoritative travel bound.

## Virtual EBB

Add a stateful firmware emulator as another opened byte transport. The production
session sends the same serialized commands to it as to a real board; it independently
parses those bytes and advances motor, pen and FIFO state. It must not consume the
ExecutablePlan directly or return the compiler's predicted position as its own result.
This exercises framing, command encoding, feeding, startup and pen restoration as
well as motion math.

Start with explicit 2.8.1 and 3.1.7 models, expanding version-specific behavior as
the corresponding backends are implemented. Model finite queues, accepted versus
completed commands, native step counters, servo settings and waits, emergency-stop
side effects, status/power responses and T3/TD accumulator state. Keep board state
across jobs/reconnects so bounds -> first normal plot and cancel -> next plot can
expose stale state. Unknown commands must not be silently acknowledged.

Use an injected deterministic clock for reproducible fast tests and an optional
real-time mode for browser/CLI inspection. Script reply fragmentation/latency, full
queues, disconnects, pause inputs and supply faults. The virtual destination is
explicitly selected and never opens physical USB. Export bounded virtual traces and
compare their observed state with preview records and pinned firmware/reference
fixtures. Keep emulator execution independent of the production compiler/sampler;
otherwise matching results could simply repeat the same bug.

The current fixed-response fake remains useful for focused parser tests. The new
virtual EBB is the full-session integration target, not a PIC CPU emulator or proof
of mechanical pen contact, missed steps or physical line quality. Its staged work
and acceptance cases are in Milestone 1B of the motor plan; hardware gates remain.

## Firmware and machine scope

| Firmware | Compatibility backend | Modern backend policy |
| --- | --- | --- |
| Below 2.8.1 | Outside the new supported scope | Reject before motion with a version explanation |
| 2.8.1 through remaining 2.x | Native SM | No T3/TD |
| 3.0.0–3.0.1 | Native SM | Excluded from initial modern support |
| 3.0.2–3.1.6 | Native SM default | Enable only after version-specific timing fixtures and acceptance |
| 3.1.7 | Native SM remains selectable | First target for modern Auto, after acceptance gates pass |
| Later releases | Extend the published matrix after review | Do not infer validation from a greater version number |

T3/TD availability and validated behavior are different facts. Current NextDraw
software's floor is 3.0.2; firmware 3.1.0 and 3.1.7 include relevant motion fixes.
Do not create a third motion architecture for those versions: vary protocol/math
rules by capabilities and keep the two backends. LM/LT can remain future optional
compilers, but are unnecessary for the initial compatibility goal.

Profiles cover recent AxiDraw variants, the current Xylodraw calibration, and
NextDraw 8511/1117/2234. Confirm real scales, travel bounds, orientation and resolution
individually. Preserve Xylodraw's inverse servo calibration. Standard and brushless
pen configurations are separate profile data. Automatic homing requires the
machine's actual hardware and supported procedure; firmware 3.x alone cannot enable
it. Implement the explicit/manual-origin workflow first. Capability-based NextDraw
homing uses the same service within the feature milestones and remains gated on
its virtual and physical acceptance.

## Drawing policies and job sequences

Motion backend, drawing policy and handling preset are independent settings.
Profiled drawing uses acceleration/corner look-ahead on SM or jerk-controlled
planning on T3/TD. Constant drawing deliberately bypasses drawing ramps and ordinary
corner slowing; pen-up travel still uses the smooth planner. Account for that
exception in rate/acceleration assertions and preserve stationary pen/reload/control
barriers. Handling recipes resolve model-aware speed, jerk, resolution and source
curve tolerance; Custom preserves explicit physical-unit settings.

Add an immutable job-sequence specification above individual ExecutablePlans.
It contains a prepared template, finite copy count or explicit continuous mode,
inter-copy delay, optional paper-change Continue gate, layer events and checkpoint
policy. The scheduler lazily compiles/executes immutable segments and never fills
memory/FIFO with an infinite command list. No UI timer owns execution.

Between copies finish settled Up at origin, then start the countdown; apply the
startup/pen-restoration service again before drawing. Pause freezes the remaining
timer, Resume continues it, and Stop/Cancel prevents another copy. No delay follows
the last finite copy. Same geometry/seed is the default; optional per-copy closed
starts use derived deterministic seeds recorded with each copy. Show count/countdown
and per-copy/aggregate statistics; continuous mode has no total ETA.

Layer settings and empty delay/pause layers are structured input, not incidental
SVG text retained after flattening. Resolve overrides before affected compilation;
restore settings outside the layer and prohibit optimization across control barriers.
Optional occlusion/clipping needs source paint-order/fill/clip metadata in geometry
adapters before normal tool ordering. Preset changes can require source resampling
and resolution/origin recovery, not just changing a number in an existing plan.

Recovered checkpoints store source cursor, completed drawing distance, execution
identity, copy/layer/seed, origin confidence and timer state. Offsets slice drawing
geometry; they are not XY translations. Recover position, travel raised to the
splice and compile the remainder from rest. Runner restart marks interruption and
requires recovery rather than automatically starting the next scheduled copy.

## Preparation, execution and preview contracts

Preparation produces immutable **PreparedJob** geometry/settings. Compilation
resolves a specific target and produces **ExecutablePlan**: compiler/schema version,
backend, capability/profile/calibration fingerprints, native frame/start-state
requirements, tool records, motor parameters, initial/final accumulator states,
command/source IDs, distances and timing. Use a canonical serialization and a
common digest algorithm; hashing may be provided by host adapters over identical
canonical bytes. Serialize bounded integers/decimal strings, not raw BigInt.

Both backends use integer 40 µs timeline ticks; SM milliseconds map to 25 ticks.
TD records represent two FIFO entries and twice their specified half-duration.
Sampling predicts the actual rounded commands, using checkpoints rather than
iterating through every controller tick for each frame.

The session validates the origin frame and seeds the declared accumulator state
at rest before executing. Preparation does not pretend it knows the physical start
position. A stale target, setting, profile, origin-frame or compiler fingerprint
requires explicit re-preparation. The server validates/recompiles with the same
library and compares the executable digest; it never silently replaces the preview's
backend. Queries of EBB step counters still do not establish measured physical
position or pen contact.

Preview and execution share record identities, pen transitions and nominal timing.
Physical elapsed time includes preparation, pauses, serial latency and other waits;
it must remain a separate statistic. Requested, written, accepted and settled are
distinct event phases. UI observers receive bounded/coalesced telemetry and cannot
block the feeder. Preserve sufficient command detail in bounded diagnostic logs.

## Job lifecycle and pen requirements

Every drawing or bounds job follows the same startup service:

1. Confirm the session owns the connected device and the target matches the plan.
2. Stop/drain leftovers using that firmware's rules; distinguish idle from interrupted,
   disconnected or failed drain. Check origin confidence without moving the axes.
3. Restore both calibrated servo targets, rates and profile configuration; clear
   transient job state and seed motor accumulators where required. Keep user settings.
4. Force stationary Up and wait for it to settle before any XY movement.
5. Establish the required start at origin while raised: use a known return or an
   explicitly supported homing policy; otherwise require origin recovery. Validate
   the program's start frame before execution. Never attempt recovery travel before Up.
6. Execute the immutable program. At every drawing start: finish raised travel,
   apply the configured long-travel dwell, lower, wait fully, then draw.
7. Finish with Up; when returning to origin, travel raised and finish settled Up.

Do not reboot the board before each plot. Do not erase calibration when resetting
job state. Modern `SP,3` can replace the configured Down target with Up, so subsequent
normal plotting must restore calibration even when cached pen state says Up.

Bounds preview is a separate **raised-only job intent**, compiled through the same
travel planner. It contains no Down records and cannot mutate a normal job's pen
settings. This directly addresses the first-normal-plot-after-bounds failure class.

Mechanical reloads split optimized strokes before motion planning, stop at zero
speed/acceleration, perform stationary Up → reload wait → Down → lower wait, then
restart. The maximum is checked against compiled drawing distance and has an
explicit resolution/tolerance policy. Reloads, pen counters, long-travel dwell and
statistics belong in the core so every client gets the same behavior.

Graceful Pause/Stop request a backend-valid stopping sequence and an explicit
completion result. Emergency Cancel may invalidate the origin/accumulator state;
it cannot silently resume or return from an uncertain position. Never assume a
queue-drain return proves motion completed. Persistent resume needs its own verified
checkpoint/origin design, especially on machines without automatic homing.

Control-induced braking is a separately compiled execution segment with its own
IDs/logs; it does not mutate the prepared job. Resume uses the resulting verified
checkpoint and recompiles the remaining motion from rest. Pen/tool/calibration
changes permitted during a settled pause require a fresh segment snapshot, rather
than editing motor records already in the FIFO.

## Public API direction

Use NextDraw's useful operations, but specify asynchronous outcomes and units
clearly. This is a proposed interface, not a promise of Python signature compatibility.

```ts
const prepared = prepareJob(pathsInMm, settings, tools);
const plan = compileExecutionPlan(prepared, target, startRequirements);
const preview = sampleExecutionPlan(plan, elapsedTicks);

const session = new PlotterSession(openedTransport, clock);
await session.connect();                 // handshake; no implicit movement
await session.setOrigin(profile);        // explicit stationary origin capture
const handle = await session.start(plan); // validated/admitted; not completed
const result = await handle.completion;  // finished/stopped/cancelled/failed
```

Also provide `drawPath`, `moveTo`, `penUp`, `penDown`, `returnToOrigin`, optional
`home`, `pause`, `resume`, `stop`, `cancel`, `status` and event subscription.
Interactive pen/move promises resolve only after settlement; job admission and job
completion remain separate. `drawPath` plans a whole stroke, while independent
`moveTo` calls are point-to-point operations with declared rest boundaries. Do not
draw a dense path by repeatedly issuing zero-speed moves.

Errors are structured (unsupported firmware/profile, stale plan, unavailable origin,
protocol failure, disconnection, supply issue). Disconnected motion must fail
explicitly, rather than copy the inspected Python verifier's silent return path.
Cached, predicted and queried positions have distinct fields. Diagnostic raw serial
access, if retained, is an idle-only developer operation and invalidates affected
state; it is not the public remote job API.

## Browser, Node, CLI and Swift ownership

**Browser direct USB:** UI requests port permission in a user action. A dedicated
worker can run execution with Web Serial; planning/rendering must not compete with
feeding on the UI thread. Availability is feature-detected. Worker execution does
not guarantee survival after a tab closes or avoid every background/sleep delay.
The [Web Serial specification](https://serial.spec.whatwg.org/) defines secure-context,
worker exposure and permission behavior.

**Node runner:** retain the existing headless runner, single serial owner, idempotent
job requests, persistence and coalesced status. It imports the Node adapter and core;
HTTP/WebSocket hosting stays outside the core. Browser clients submit whole jobs and
controls, not a network round trip for each motor command. Closing an observer page
does not own or terminate the runner's execution.

**CLI:** a thin Node application using the same compiler/session. It can drive an
explicit local device or submit to the runner. It must not open a serial device
already owned by that runner. JSON path jobs and `preview`, `plot`, `bounds`, `pen`,
`status` are first useful commands; complete SVG import and persistent resume follow
their own adapter/feature work.

**Future macOS Swift/WKWebView app:** prefer the existing web UI plus a managed local
Node runner/helper. Swift manages windows/files/helper lifetime; TypeScript retains
planning and execution. Reuse the high-level job API via loopback or native IPC.
Safari's [current compatibility data](https://github.com/mdn/browser-compat-data/blob/main/api/Serial.json)
does not expose Web Serial; do not design WKWebView around Chrome's USB API.
Apple's [WKScriptMessageHandlerWithReply](https://developer.apple.com/documentation/webkit/wkscriptmessagehandlerwithreply)
supports requests/replies between page JavaScript and Swift when a native bridge is
needed. Bridge job/control messages, not thousands of timed motor commands.

Swift native serial plus a JavaScriptCore-hosted core is a later alternative if
bundling Node is undesirable. It needs adapters for timers, byte I/O and missing
host facilities, runtime/numerical validation, and native job lifetime management.
It is not automatically achieved by loading a browser bundle. Running the core
inside the WebView through a native byte bridge is possible, but ties execution to
WebView lifetime; it is not the recommended first desktop architecture.

## Delta from the earlier motor plan and delivery order

Keep native coordinates, compiled preview, SM/T3-TD backends and modern acceptance
gates. Add package/API extraction before the motor rewrite; raise the explicit
supported floor to 2.8.1; separate homing/profile/pen services; make the network job
contract reusable by CLI and desktop clients. No second planner in Swift or server.

1. Archive the baseline; document known physical uncertainties and exact fixtures.
2. Extract pure types/geometry and the package entry points. Move current execution
   behind injected transport/clock without changing motor behavior. Preserve adapters.
   Add the virtual EBB's legacy byte transport, clock and state model at this boundary.
3. Introduce the native executable model, SM compiler and command-derived sampler.
4. Separate EBB session/feeder/pen/origin services and pass startup/bounds/cancel cases.
5. Implement and validate S-curves, T3, then TD; activate modern Auto on 3.1.7 only
   after independent virtual-board fixtures and physical acceptance. Extend virtual
   modern execution alongside the compiler; broaden the firmware matrix with evidence.
6. Complete handling/constant modes, layer controls, repeats/timers, recovered resume,
   geometry options and capability-gated homing in their feature milestones; validate
   them through both backends, shared schedules and the virtual board.
7. Migrate browser/runner to versioned shared jobs, then deliver the thin CLI and its
   geometry adapter. Implement a Swift shell only when requested, reusing the runner
   contract.

Verification must cover pure-root Node imports without DOM types, browser bundles
without Node dependencies, identical Node/browser compiled digests, portable schema
round-trips, firmware-aware framing/queue fixtures, clock-controlled startup/pen
tests, independent virtual EBB state/trace comparisons and profile-specific hardware
acceptance. If Swift is delivered, test its
actual host runtime and UI reload behavior. Mathematical/mocked agreement alone
does not establish physical quality or a working pen transition.

The [motor implementation plan](MOTOR_IMPLEMENTATION_PLAN.md) remains the execution
checklist. This document decides the module and platform boundaries; it does not
claim all NextDraw features have already been implemented.

## Primary references

- [NextDraw software installation and official API download](https://support.bantamtools.com/hc/en-us/articles/28809050405011-Bantam-Tools-NextDraw-Software-Installation)
- [NextDraw API 1.7.4 archive](https://software-download.bantamtools.com/nd/api/nextdraw_api.zip), reviewed locally with SHA-256 `809e9c276243cd67f58440b5699359ecfdff556a409225bb04bb0f3adf050688`
- [NextDraw API migration: hardware and firmware floor](https://bantam.tools/nd_migrate/)
- [NextDraw firmware](https://support.bantamtools.com/hc/en-us/articles/28809123473043-Bantam-Tools-NextDraw-Firmware)
- [EBB command documentation](https://evil-mad.github.io/EggBot/ebb.html)
- [Plotink](https://github.com/evil-mad/plotink), exact revision and numerical fixtures in the motor review
- [Web Serial specification](https://serial.spec.whatwg.org/)
- [Apple JavaScript-to-Swift message/reply interface](https://developer.apple.com/documentation/webkit/wkscriptmessagehandlerwithreply)

## Implemented candidate

See `CORE_REWRITE_STATUS.md` for the module/API inventory, virtual monitor, reference
provenance, measured benchmark and numerical/control differences. Browser serial
streams transfer to a dedicated execution worker; the shared core never imports the
editor, DOM or Node USB bindings. Native SM and 3.1.7 T3/TD, schedules/layers/resume,
profiles/homing and prepared-job admission are active. Swift/WKWebView remains a
possible shell over the same runner contract, not another motor implementation.
