# Motor implementation plan

Prepared 2026-10-06. Status: software candidate implemented through Milestone 6;
full offline regression/virtual acceptance passes. Milestone 7 remains the user's
real-device test. See [the implementation checkpoint](CORE_REWRITE_STATUS.md).
Checked software items indicate their declared implemented scope, not physical or
byte-for-byte vendor acceptance.
Implement one reusable TypeScript Plotter Core with a native-motor execution model
and two motion backends: legacy SM and modern jerk-controlled T3/TD. The browser
and Node runner use the same library; CLI and desktop clients reuse its contracts.
Validate the modern backend on EBB 3.1.7 first. Keep the existing XM implementation
in the verified archive for comparison. Following the user's fresh-start instruction,
there is no production XM fallback or retained old planner/pen executor.

The [core architecture decision](PLOTTER_CORE_ARCHITECTURE.md) defines the package,
API, platform adapters, homing/pen/feeder boundaries and migration order. A private workspace package implements this architecture with browser, Node, client,
CLI and virtual adapters. Public distribution is separate; hardware acceptance is pending.

The source investigation and pinned references are in
[the motor review](research/MOTOR_IMPLEMENTATION_REVIEW_2026-10-06.md).
The [CLI/Python API review](research/NEXTDRAW_API_REVIEW_2026-10-06.md) additionally
traces plot lifecycle, whole-path versus individual-move behavior, pen restoration,
and two isolated wrapper issues. Its implementation consequences are listed below.
The [NextDraw feature-gap review](research/NEXTDRAW_FEATURE_GAP_REVIEW_2026-10-06.md)
adds handling/constant-speed modes, repeats with timers, layers, recovered resume,
geometry options and application/API utilities to this migration, with upstream
partial features and intentional differences identified explicitly.
The latest supplied physical log reports firmware 2.8.1 on hardware marked EBB 2.7.
An upgrade has not been confirmed. No flashing or hardware movement is part of
writing this plan.

## Scope and compatibility policy

| Firmware | Initial release behavior | Validation target |
| --- | --- | --- |
| Below 2.8.1 | Outside the new supported scope; reject before movement | Existing older-firmware branches are not a promise of continued support |
| 2.8.1 through remaining 2.x | SM with acceleration-limited planning | AxiDraw and Xylodraw profiles; exact legacy command/numerical fixtures |
| 3.0.0–3.0.1 | SM compatibility path | Do not require the modern protocol/backend |
| 3.0.2–3.1.6 | SM by default during rollout; modern becomes available after version-specific tests | These versions support the commands, but precede relevant timing/pulse fixes |
| 3.1.7 | T3/TD after modern acceptance gates pass; SM remains selectable | Main modern firmware target |
| Later 3.x | Use the declared capability policy after compatibility tests | Never infer different motor mechanics from firmware alone |
| Unknown firmware family | Retain a supported compatibility path or reject before movement | Do not assume an unknown major version is compatible |

3.0.2 is the protocol floor for official NextDraw software. It is not a claim that
all 3.x versions have identical motion timing. Extend modern Auto selection to
3.0.2+ only after the affected firmware families have explicit passing fixtures.
The user must see which motion mode prepared the preview.

The supported target is 2.8.1 through the current 3.1.7, not only NextDraw hardware.
Future releases extend this matrix after review; a greater firmware version number
does not establish validation. The current 2.8.1 machine does not require an upgrade
to use the planned SM backend.

Machine selection is separate: AxiDraw, Xylodraw, and NextDraw retain their own
scale, orientation, bounds, resolution and pen-servo configuration on any supported
firmware. Add NextDraw 8511/1117/2234 profiles from the pinned vendor definitions;
use the correct narrow-band/brushless pen configuration. Initially support the
existing explicit/manual origin workflow first. Add automatic NextDraw homing through
the profile-specific service in this migration; never enable it merely from firmware 3.x.

Deliver motor compatibility and common simulation first within this migration,
then complete the added feature work in Milestones 5/5B/6 before final acceptance.
Constant drawing speed is part of both compiler milestones. Repeats with timed
intervals, layers, recovered resume and capability-gated homing are explicit work,
not an unspecified later parity project. Current status remains tracked in
AXIDRAW_PARITY.md. Vendor file-format interoperability and firmware flashing are
separate specifications; a working JSON job API does not establish those features.

## Design decisions

1. Physical position is represented by integer native motor steps M1/M2. Canvas
   positions are derived using the machine profile and rotation. Keep original
   geometry directions for junction calculations, independently of rounded endpoints.
2. Planning selects a backend before preview preparation. Connecting to another
   firmware/profile invalidates the prepared program and requires re-preparation.
3. An immutable, versioned ExecutablePlan is the source of commanded positions,
   timing, statistics and signals for simulation and hardware. A mathematical
   trajectory alone is not the final executable result.
4. The SM planner has declared legacy policies; the modern planner has explicit
   speed, acceleration and jerk limits. Both consume the same optimized paths and
   stationary pen/reload/tool-change boundaries. They need not produce identical
   trajectories or elapsed times.
5. Preserve the current speed/acceleration units and values. Add separate drawing
   and travel jerk in mm/s³. Do not translate a vendor acceleration percentage
   directly into mm/s² or copy a NextDraw model's jerk defaults onto Xylodraw.
6. Use exact checked integer arithmetic for EBB tick/accumulator math. BigInt stays
   inside math functions; persisted/wire values use bounded integers or explicitly
   validated decimal strings. Performance must be measured with large drawings.
7. One serial owner handles motion, queries and controls. Acknowledgement means
   accepted/queued. Settlement means the device is idle and pen waits have expired;
   neither is evidence of physical pen contact.
8. Firmware capability changes and source licenses are recorded explicitly. Use
   pinned Python calculations as references; retain MIT notices for adapted Plotink
   helpers. A direct GPL Python translation must keep its provenance and notices.
   Do not describe a direct translation as clean-room work.
9. Extract a workspace package before rewriting the motor engine. Keep pure root
   exports independent of DOM/Node/editor dependencies; isolate browser, Node and
   remote-client adapters. Inject transport and monotonic clock into execution.
10. Keep machine mechanics, firmware capabilities, plot settings and transport as
    separate inputs. Homing is a machine capability/service, not a consequence of
    firmware 3.x. The session owns all pen, status and motion serial operations.
11. Reset transient job state and restore device configuration before every physical
    job while preserving user calibration. Bounds is a separate raised-only intent;
    it cannot mutate a later drawing program's pen configuration.
12. Build a stateful virtual EBB behind the same byte transport as physical hardware.
    It consumes actual serialized commands and independently models firmware state,
    queues and elapsed execution. Keep it separate from the preview sampler and
    validate its behavior against pinned firmware/reference fixtures.
13. Separate drawing policy (profiled/constant), motor backend, handling preset and
    repeat schedule. Constant drawing intentionally bypasses drawing ramps/corner
    slowing; pen-up travel remains profiled. Do not apply S-curve limit invariants
    to its deliberate drawing-rate jumps or call an ordinary cruise phase this mode.
14. Model copies, timed waits, layer barriers and recovered checkpoints explicitly.
    The job scheduler lives above the serial feeder and shares the injected clock;
    it never queues an unbounded continuous run or treats accepted steps as completed.

## Proposed pure functions and records

The implemented package and its actual filenames are recorded in [the implementation checkpoint](CORE_REWRITE_STATUS.md).
The conceptual module names below map to the concrete smaller service files. Core
modules belong under `packages/plotter-core/src/`; current `src/` files become
application adapters or migrate behind compatibility facades.

| Module | Responsibilities / functions |
| --- | --- |
| `types.ts`, `geometry.ts`, `prepare-job.ts` | Core-owned units/types, clipping, tool IDs, ordering and reload splitting; no SVG DOM |
| `machine-profile.ts` | Physical model, native scale, bounds, polarity, servo configuration, resolution and homing capabilities |
| `ebb-capabilities.ts` | Parse firmware; select protocol and backend; report validation status and FIFO capabilities |
| `motor-coordinates.ts` | `canvasToNative`, `nativeToCanvas`, `quantizeNativeEndpoint`; canonical rounding and residual policy |
| `ebb-math.ts` | `predictT3Axis`, `predictTDAxis`, `finalRate`, `maximumRate`, signed truncation and accumulator initialization |
| `legacy-planner.ts`, `scurve.ts` | Backend-specific look-ahead, ramp and short-move policies |
| `motor-compiler.ts` | `compileSM`, `compileT3`, `coalesceTD`, checked motor commands and endpoint correction |
| `executable-plan.ts` | `compileExecutionPlan`, `sampleExecutionPlan`, stationary boundaries, command/event indexing and digest |
| `session.ts`, `feeder.ts`, `ebb-protocol.ts` | One serial owner, lifecycle, framed replies, scheduling, queue control and diagnostics |
| `pen-controller.ts`, `homing.ts` | Calibration/timing/restoration, origin confidence and supported homing procedures |
| `handling-presets.ts`, `layer-settings.ts` | Model-aware recipes and immutable per-layer settings/event resolution |
| `job-sequence.ts`, `resume-checkpoint.ts` | Lazy copy scheduling, cancellable waits, completed checkpoints and drawing-distance slicing |
| Browser/Node/client entry points | Discovery, opened byte-channel adapters, clocks and high-level remote job/control facade |
| Optional `virtual` entry point | Firmware emulator, deterministic clock, byte transport, fault scenarios and execution trace; excluded from production root imports |

Record the following in a program snapshot: format/compiler version, backend,
firmware capability fingerprint, machine profile and microsteps, settings, native
origin-frame/start-state requirements, source event identity, and compiled motor/pen
records. Motor records contain tick duration,
native start/end positions, initial/final accumulator state, rate/acceleration/jerk,
and any required rest boundary. Pen records contain target, calibrated pulse,
settling/reload time and expected Up/Down state. Serialize commands only at the
transport boundary; validate typed records rather than trusting arbitrary strings.

Use integer 40 us ticks for common timing; an SM millisecond is 25 ticks, while TD
duration is twice the tick count specified for one half. A TD record represents
two queued motion commands. Endpoint/rate prediction must use actual rounded
parameters, not the unrounded mathematical profile.

## Milestone 0 — Baseline and archive

- [x] Save the current dirty workspace in a recoverable archive with a manifest and
      hashes, following the existing archive convention. Do not reset unrelated work.
- [x] Pin the reviewed NextDraw archive and Plotink/EBB revisions and preserve notices.
- [x] Capture current XM output for the reference corpus and current machine settings.
- [x] Record baseline test/build results and the existing first-plot-after-bounds case.

Acceptance: the current version is recoverable; expected legacy behavior and known
physical uncertainties are distinguished. No physical success is inferred from mocks.

## Milestone 1 — Core extraction, native coordinates and executable model

Touch `motion.ts`, `motion-plan.ts`, `plot-process.ts` and their consumers. The
user's fresh-start instruction supersedes the earlier extraction-only sequence:
the independent core and native SM backend are now active behind application
facades. Continue expanding the typed model and capabilities in reviewable stages.

- [x] Create the core workspace package with ESM/types and explicit browser, Node
      and client entry points. Keep `serialport` out of pure/browser imports.
- [x] Extract core geometry/settings types from editor state; separate pure clipping
      and splitting from DOM SVG parsing, and resolve colors in input adapters.
- [x] Replace execution with fresh byte-transport/clock services and browser/server
      compatibility facades; use native SM rather than retaining the old XM driver.
- [x] Define PreparedJob, target/start requirements, structured session errors,
      job admission/completion and bounded event contracts.
- [x] Define profiled/constant drawing, Custom/technical/handwriting/sketching recipes,
      8x/16x resolution, sampling tolerance, layer metadata and repeat-schedule types.
      Resolve presets into physical units and preserve source sampling provenance.
- [x] Preserve layer/empty-event barriers and source scene metadata in input adapters.
      Keep preset-driven curve sampling separate from polyline simplification; do not
      claim a normalized polyline can recover detail lost by earlier coarse sampling.
- [x] Verify pure imports without DOM/Node types, browser bundles without native
      Node dependencies and equivalent current browser/runner execution traces.
- [x] Define profile conversion independently from firmware selection.
- [x] Quantize native motor endpoints and preserve source geometry directions.
- [x] Track native integer positions and fractional accumulators separately.
- [x] Define compiler versions, typed command records, limits and serial encoders.
- [x] Preserve the old XM code in the verified archive, with its tests/settings;
      replace the active path with the fresh native SM core (updated user instruction).
- [x] Define a bounded display sampler; do not loop through all 25,000 ticks per
      second for every animation frame. Use exact state prediction/checkpoints.

Acceptance: axis/diagonal/negative/rotated coordinates and 8x/16x resolution conversions
pass; package boundaries preserve current execution behavior; repeated tiny moves
do not accumulate uncontrolled endpoint drift; short moves can reach native endpoints
that the integer XM grid could not represent.

## Milestone 1B — Virtual EBB foundation and staged firmware models

Create an optional `@thierryc/plotter-core/virtual` entry point, initially under
`packages/plotter-core/src/virtual/`. Run it in Node tests, the browser and the CLI.
Deliver the legacy transport/state foundation before Milestone 2; add modern
command execution alongside Milestones 3–4. This is a protocol/state emulator,
not a complete PIC instruction-set emulator or a physical-mechanics simulator.

The existing `server/test-fixtures/fake-ebb.ts` is useful for small reply/error tests,
tracks accepted SM counters but uses simplified immediate idle/reply behavior.
Retain those focused fixtures; use the virtual board for stateful integration tests.

- [x] Implement a board model independently of the compiler and preview sampler.
      Accept framed serial bytes, parse supported commands, validate parameters,
      and produce the selected firmware's actual response format. Unknown or
      unsupported commands must produce the appropriate error, not generic OK.
- [x] Define explicit firmware models starting with 2.8.1 and 3.1.7. Compatibility fixtures also cover 3.0.2/3.1.0/3.1.6 with SM. Their historically
      different T3 timing is outside modern activation; native timing acceptance is
      3.1.7. A version string alone does not establish additional native coverage.
- [x] Model finite FIFO capacity, command acceptance versus execution, queue-full
      behavior and backpressure. Advance active commands over simulated time and
      report idle only when motion and queued pen/dwell operations have completed.
- [x] Implement V, supported CU negotiation, motor enable/resolution, SC/SP servo
      setup and timing, SM and temporary XM motion, position/status/power queries,
      and firmware-specific ES behavior. Add T3/TD with native step counters,
      signed rates/acceleration/jerk and fractional accumulator state in Milestone 4.
      TD must occupy two motion entries with the correct two-half duration.
- [x] Track configured Up/Down pulses, rates, queued pen changes, logical pen state
      and modeled servo pulse progression separately. Reproduce the relevant SP,3
      calibration/queue side effects and legacy versus modern emergency-stop rules.
      A modeled settled pen is not a simulated paper-contact sensor.
- [x] Provide a shared deterministic clock with manual advance/run-until-idle for
      fast tests, plus real-time pacing for interactive inspection. The session and
      board share that clock; board execution is independent of session predictions.
- [x] Preserve virtual board state across bounds jobs, subsequent plots and transport
      reconnects. Reset it only through modeled commands or an explicit fixture reset;
      otherwise repeated-plot tests would hide the stale-state failures being studied.
- [x] Add reproducible fault scenarios: delayed/fragmented replies, stale responses,
      read/write failures, disconnection, full queue, pause-button input and supply
      loss. Limit/homing inputs are profile-specific additions when that feature ships.
      Record the seed/scenario so failures can be replayed.
- [x] Compare compiled-preview records against the virtual board's independently
      observed native positions, pen transitions, execution durations and queue state.
      Emit planned/written/accepted/started/completed traces with command identities;
      compare nominal timing separately from injected latency or pauses.
- [x] Expose an explicit Virtual EBB destination in development/test browser controls
      and a CLI virtual mode once those adapters exist. Allow firmware/profile and
      scenario selection, live motor/pen/queue inspection, and bounded trace export.
      Virtual selection must never open a real USB port; label traces as virtual.
- [x] Verify emulator semantics with pinned firmware traces/reference vectors and a
      separate literal tick model for modern integer math. Shared types are allowed,
      but using the production compiler/sampler as the only emulator oracle is not.

Acceptance is staged: the foundation passes legacy startup, finite-queue, pen and
SM/XM tests before Milestone 2 acceptance; modern T3/TD fixtures pass before modern
software acceptance. Required full-session regressions include manual Down -> plot,
bounds -> first plot -> second plot, long travel -> Down, reloads, pause/resume,
cancel -> next plot, reply faults, disconnect and supply loss. Each checks state and
command ordering, not just successful return. The same scenario produces reproducible
results in browser and Node, and the session needs no emulator-specific execution
branch. Physical acceptance in Milestone 7 remains required.

## Milestone 2 — Legacy SM compiler and command-derived simulation

- [x] Implement native SM serialization and legacy duration/rate validation.
- [x] Implement the declared AxiDraw-compatible ramp sampling and short-move policy;
      test round-to-even, cumulative timestamps, float32 reference effects, final
      endpoints, zero-step intervals and slow-axis behavior explicitly.
- [x] Specify intentional timing differences, including preserved dwell time and
      application pen waits; do not silently claim byte-for-byte parity everywhere.
- [x] Make `simulation.ts`, `plot-signals.ts`, `plot-statistics.ts`, `live-plot.ts`
      and overlay sampling consume the compiled execution timeline.
- [x] Keep pen counters based on real transition records, not animation frames.
- [x] Compile constant drawing as native constant-rate SM with the declared rounding
      and rate limits. Keep accelerated pen-up travel, stationary pen barriers and
      reloads. Test rate jumps at drawing starts/stops/corners as deliberate semantics.

Acceptance: full motor-step/duration sequences match pinned Python fixtures where
exact legacy policy is the target; intentional exceptions have named tests. Simulation
and compilation agree at every command boundary. The 0.025/0.1/1/6 mm examples,
nonzero entry/exit rates and asymmetric native-axis moves are covered.

## Milestone 3 — Firmware protocol, queue and pen preparation

Touch `plotter-core.ts`, `ebb-pen.ts`, `pen-control.ts`, `server/serial.ts`, and the
fake EBB transport. Capability state is available to both browser and server clients.
Use the stateful virtual EBB for full-session queue/pen regressions as its command
coverage becomes available; keep small reply fixtures for isolated parser tests.

- [x] Split protocol, feeder, pen controller and origin/homing services inside the
      shared package; all queries/manual controls use the same command owner.
- [x] Implement explicit legacy and future-response parsers with framing/error checks.
- [x] For modern operation negotiate CU,10,1 only on supported firmware and account
      for its special transition response. Reset parser/cache state on reconnect.
- [x] Query supported FIFO depth, choose a bounded working depth, and account for TD
      expansion. Preserve cancellation/pause responsiveness instead of filling an
      arbitrarily long time horizon.
- [x] Decode QG once and dispatch idle, pen, pause-button, power-loss and limit flags.
      A transient power-loss/limit event invalidates position when appropriate; normal
      idle polling must not consume and discard it.
- [x] Keep polling and UI work outside critical short-command feeding, using a
      measured schedule. Retain existing QC supply checks and profile-specific limits.
- [x] Specify backend-valid braking for graceful pause/stop separately from emergency
      cancel. Do not treat an arbitrary nonzero-speed queue tail as a planned rest.
- [x] Use the existing compiled deceleration to the next declared rest for graceful
      Pause/Stop, and log its control state. Recovered resume recompiles from rest.
      Offline decision: synthetic mid-stroke braking is not part of this candidate;
      cutting a nonzero-speed tail without a validated recovery path is inappropriate.
      This deliberate policy can delay Pause on long uninterrupted strokes.
- [x] Before every job, stop/drain prior commands using the firmware's rules, restore
      calibrated servo configuration and force a stationary Up with full settling
      time before any return/homing or plot travel. Establish/preserve the required
      start at origin, and seed fractional accumulators at rest where required without
      resetting known position. Do not reboot firmware per plot.
- [x] Implement modern cancellation with ES/SP,3 ordering and guaranteed cache
      invalidation. SP,3 changes the Down target to Up: restore SC,4/SC,5 and rates
      before any later Down command. Preserve a distinct legacy cancellation path.
- [x] Make resolution changes, supported servo timeout and standard/brushless settings
      explicit configuration operations at rest. Recover/invalidate the origin frame
      where scale/enable changes cannot preserve it; never reinterpret queued steps.
- [x] Integrate the physical pause button through the single status decoder, including
      queue drains and timed scheduler waits. Define its pause/stop behavior explicitly.
- [x] Implement bounded jog, align/motor release, pen cycle and profile-supported
      homing through the session. Add virtual homing inputs before physical validation.
- [x] For profiles supporting optional synchronized B3 output, define default-off
      typed tool-output records, stationary synchronization and cancel cleanup; all
      writes share the feeder. Do not infer output state from a cached pen bit.

Acceptance: repeated jobs, stale replies, connection loss, full queue, manual Down
before Start, interrupted origin, bounds->normal, and cancel->next job pass on the
firmware-aware fixtures. No XY command precedes the initial settled Up. No pen query
is treated as a mechanical contact sensor.

## Milestone 4 — S-curve planner and T3 compiler

- [x] Implement drawing/travel jerk-aware forward and backward reachability passes.
- [x] Build constant-jerk phases with optional constant-acceleration plateaus; honor
      speed and acceleration caps as well as jerk caps.
- [x] Handle long accel/cruise/decel moves, reduced-peak moves, near-equal entry/exit
      speeds, and short moves where rate/jerk quantization dominates.
- [x] Evaluate vendor corner rules against the existing geometric corner parameter.
      Preserve deliberate sharp/reversal stops; document the selected modern policy.
- [x] Implement integer T3 parameters and predict each motor's actual steps and
      accumulator. Carry state through all commands and direction changes.
- [x] Correct endpoints within the declared native-step tolerance while staying within
      limits; if quantized parameters cannot make a valid command, slow/replan or fail
      before motion. Do not append an uncontrolled correction jog.
- [x] Implement TD coalescing only after T3 passes: each TD must predict exactly the
      same endpoint, rates, accumulators and duration as its two T3 halves.
- [x] Keep modern motion/dwell accumulator transitions predictable. Any utility
      movement outside the executable program requires reseeding or invalidating
      the predicted state before the next program.
- [x] Extend the virtual EBB with independent T3/TD execution and firmware timing
      cases; compare compiler predictions against its observed state and queue trace.
- [x] Compile modern constant drawing as constant-rate T3 with zero acceleration/jerk
      and explicit accumulator initialization. Preserve profiled travel and queue
      responsiveness; compare endpoints/timing with the independent virtual board.

Acceptance: Plotink tick-math fixtures match exactly; planner tests establish reachable
rates and endpoint/limit invariants. Compare matched NextDraw examples, documenting
differences caused by our explicit acceleration caps. Total queued ticks include the
correct TD factor of two and firmware-specific end-time behavior. Modern activation
remains gated on the later physical milestone.

## Milestone 5 — Reloads, bounds, machine profiles and UI

- [x] Split optimized drawing paths at reload boundaries before speed planning.
- [x] Verify compiled drawing-distance accounting against the configured reload
      maximum; shorten/replan a chunk if rounding would exceed its allowed budget.
      Define the distance as planned quantized drawing length, not sensed physical
      travel. Reject an impossible limit below supported move resolution explicitly.
- [x] Require zero velocity and acceleration at every reload. Emit Up -> reload
      wait -> Down -> lower settling at the same location, then restart from rest.
- [x] Build bounds previews as raised-only intents using the selected backend and
      travel limits. Do not convert already compiled drawing records by changing a
      penDown flag; do not mutate the normal plot's snapshot.
- [x] Add actual NextDraw model profiles and standard/brushless servo configurations.
      Preserve AxiDraw/Xylodraw calibration; test servo mappings separately.
- [x] Add motion preference Auto / Compatibility / S-curve, with clear availability.
      Show the resolved mode and firmware next to the prepared preview. Unknown
      offline capability uses an explicitly labeled compatibility preview.
- [x] Add drawing/travel jerk under advanced controls; disable them for SM planning.
- [x] Expose profiled/constant drawing, model-aware handling recipes and Custom, plus
      selectable 8x/16x resolution and curve accuracy. Disable drawing jerk controls
      in constant mode while retaining the travel settings that still apply.
- [x] Add automatic portrait/landscape placement independently from physical machine
      rotation, and a page-clipping option within mandatory machine bounds. Include
      the resolved placement in normal/bounds previews and job fingerprints.
- [x] Add optional hidden-line removal and SVG clipping through a browser/Node geometry
      adapter retaining paint order/fills/clip rules. Run it before tool ordering and
      reload splitting; preserve generated-fill and protected-operation behavior.
- [x] Add strict original-order mode that disables joining and preserves source/layer
      barriers; retain existing least/nearest/reversible and seeded closed starts.
- [x] Add preview draw/travel/all filters and SVG path export from executable records.
      Keep preview, virtual execution and physical status clearly identified.
- [x] Invalidate/reprepare on backend, machine, resolution, speed, acceleration, jerk,
      drawing policy, preset, sampling, geometry/placement or pen-timing changes.
      Schedule/layer changes invalidate the sequence snapshot too. Do not alter
      executable records already queued during plotting.
- [x] Update local storage and document validation/defaults together. Existing documents
      retain their calibration and have no assumed new jerk setting until migrated.

Primary integration files: `model.ts`, `main.ts`, `document-file.ts`, `plot-job.ts`,
`planner.worker.ts`, `plot-workspace.ts`, `bounds-preview.ts`, `ui/app/plot-views.ts`
and `ui/app/shell.ts`. The existing `axidrawModel` field still controls decoration. The new explicit
`axidrawHardwareModel` selects V3/SE A4 or A3 bounds; it is a separate authority.

Acceptance: changing destination/firmware causes a matching preview reprepare;
reload counts/distances and pen waits are shared by simulation and execution;
NextDraw profiles use the correct pen pulse configuration; the first normal plot
after bounds restores normal calibration and lowers before drawing.

## Milestone 5B — Repeats, timers, layers and recovered resume

These are part of this migration and shared by browser, Node, CLI and virtual EBB
execution. Use the scheduler above the feeder, not UI timers or a prefilled FIFO.

- [x] Add finite copies and explicit repeat-until-stopped, defaulting to one copy.
      Compile copies lazily and reuse matching prepared templates with bounded memory.
- [x] Add an inter-copy timer and optional require-Continue gate for paper changes.
      After each nonfinal copy, settle Up and return raised to origin before starting
      the countdown. Do not delay after the last finite copy. Keep the final-copy
      return preference separate from required inter-copy origin returns.
- [x] Show copy index/count, remaining timer and next action. Pause freezes the timer;
      Resume continues it; Stop/Cancel prevents another copy. A Continue gate does not
      implicitly skip the timer. Physical pause inputs work during every wait.
- [x] Run full startup/pen restoration before every copy. Keep the same origin/settings;
      require recovery after disconnect, release or target changes. Reload accounting
      resets only at a real lift/reload boundary, not merely a new copy number.
- [x] Default to identical drawing geometry across copies. Optional varied closed starts
      derive a deterministic seed from base seed/copy index; persist each seed and
      identify variants in preview. Do not use wall-clock randomization.
- [x] Preserve structured source layers and empty-layer delay/pause events. Support
      layer selection, documentation/hidden-layer exclusion, speed and pen-height
      overrides, delays, forced pauses and per-layer optimization levels.
- [x] Parse supported SVG Layer Control annotations at import; offer equivalent typed
      UI controls. Define setting precedence and resolve immutable per-layer snapshots.
      Restore default pen/settings afterward and prevent optimization across barriers.
- [x] Preserve upstream partial `+M` metadata without claiming full layer-specific
      motion handling: the pinned code uses it for curve tolerance and official docs
      call it forthcoming. Full per-layer handling is an explicit extension requiring
      resolution/origin transition work, not an assumed current vendor feature.
- [x] Add versioned executed checkpoints containing source/path cursor, drawing
      distance, compiled identity, copy/layer/seed, settings and origin confidence.
      Determine completed progress from drain/status/position evidence, not ACK counts.
- [x] Implement recovered resume, checkpoint read/clear/adjust and start-at-distance.
      Distances follow the selected optimized drawing, excluding travel/waits. Slice
      within a path, travel Up to the splice, lower/settle and replan from rest.
      Negative resume adjustments deliberately redraw overlap; offsets are not XY shifts.
- [x] Preserve handling, resolution, geometry, reload and pen settings across resume.
      Reject stale/corrupt/incompatible checkpoints; require origin recovery on legacy
      hardware when needed. Never launch the next copy automatically after a crash.
- [x] Complete public absolute/relative move/draw, full-path drawing, delay, settled
      wait and state access. Separate intended and queried position; support clip-and-
      lift for out-of-bounds interactive travel and changes only at settled boundaries.
- [x] Extend statistics with completed/remaining distance, lifts/reloads, per-copy and
      aggregate totals, and separate motion/pen/layer/inter-copy/user-wait time. Finite
      estimates include scheduled waits; continuous mode has no fictional total ETA.
- [x] Exercise schedules in simulation and on the virtual EBB: three copies with a
      10-second gap, pause at 4 seconds remaining, continuous Stop, cancellation
      during a wait, per-layer restoration and resume inside a reload-limited path.

Acceptance: all copies lower correctly on their first stroke, stay raised during
waits/returns, and share the same core schedule across local/remote/virtual execution.
No timer fires a new copy after Stop, Cancel or origin invalidation. Layer events
survive optimization, checkpoints are portable and validated, and reload budgets
remain correct across repeat/resume boundaries. Validate geometry preprocessing
with source-scene fixtures separately from firmware emulation.

## Milestone 6 — Network jobs, persistence and diagnostics

Touch `network-protocol.ts`, `network-plotter.ts`, `server/api.ts`, `server/jobs.ts`
and `server/runner.ts`. The current version-1 envelope assumes linear acceleration.

- [x] Introduce a version-2 prepared-job schema containing prepared paths/settings,
      target capabilities, compiler version and the validated executable snapshot,
      with a bounded schedule/segment model for copies, layers, delays and resume.
- [x] Publish capabilities in the network snapshot before client preparation.
- [x] Have the server validate/recompile with the same shared compiler and compare
      the program digest. Reject incompatible/stale compiler, profile or firmware
      snapshots before movement; never silently substitute another backend at Start.
- [x] Keep version-1 jobs readable for diagnostics. Reprepare unstarted compatible
      jobs through the legacy path; never reinterpret started/interrupted jobs as a
      new program or auto-resume them on a different backend.
- [x] Include backend, microsteps, command index, native requested/observed position,
      accumulator predictions, tick timing and pen requested/queued/settled state in
      bounded diagnostic logs. Update the machine-log format version.
- [x] Preserve existing request idempotency, immutable execution identities, control
      ownership and telemetry coalescing; avoid per-command socket/JSON overhead.
- [x] Expose the high-level runner job/control contract through the shared client
      entry point. Keep HTTP hosting, database/files and UI outside the core.
- [x] Persist sequence identity, copy/layer index, completed checkpoint and remaining
      timer in the runner. Observers cannot restart execution/countdowns; runner
      crashes mark interruption and require explicit recovery instead of auto-repeat.
- [x] Carry mode/preset/resolution, source sampling/placement, layer overrides, repeats
      and resume fields through typed config, document storage, worker, job admission
      and CLI; reject conflicting or unsupported settings before serial writes.
- [x] Add portable prepared-geometry JSON export/import, digest-only preparation and
      cache validation. Vendor Plob/SVG resume interoperability is separately specified.
- [x] Complete explicit device selection, list/read names, supported rename, firmware/
      capability/config information and diagnostics; avoid silently choosing a second
      device when the requested one is missing. Raw measurements need documented units.
- [x] Add host completion-event/optional webhook adapters outside the feeder. Delivery
      errors cannot stall motion, change plot success or trigger a duplicate plot.
- [x] Deliver the thin CLI on the public API, first with path-job JSON, then a Node
      SVG/scene adapter for the agreed import/geometry features. Verify compatible
      source preparation across browser and Node; retain explicit unsupported cases.

Acceptance: local USB and server produce the same executable digest for the same
prepared job. Saved jobs and reconnects cannot run with a different motion profile
than their preview. Malformed commands, excessive command counts, huge durations,
unsafe ranges and incompatible versions fail before serial writes.

After browser/runner integration, the thin Node CLI reuses the same session locally
or submits to the runner. Its first input is normalized path-job JSON; SVG support
uses the Node geometry adapter in this milestone. A future Swift/WKWebView shell uses a
managed local runner/helper and the same job API. Neither a new Swift motor planner
nor a desktop app is required for the initial motor migration.

## Milestone 7 — Hardware acceptance and rollout

Archive and build each candidate. Run appropriate focused tests, then the complete
test suite and `scripts/node-lts.sh --npm run build`. Browser verification exercises
the local Chrome app with the stateful virtual EBB/disconnected device first.
Passing virtual tests is a prerequisite for hardware trials, not evidence of physical
pen contact, missed-step behavior or plotting quality. Physical tests use the
user's established origin, paper area and calibration, and are run with the user's
participation rather than inferred from an offline result.

| Case | Required observation |
| --- | --- |
| Manual Down -> new plot | Initial Up settles before any travel; first stroke lowers before drawing |
| Bounds -> first normal plot -> second plot | Bounds stays Up; both normal plots have the same correct pen behavior |
| Long raised travel -> drawing | Raised destination wait, then full lower wait, then drawing |
| Long axial/diagonal moves | Correct endpoints, no lost position, controlled start/stop |
| Tiny moves, near-zero motor axis, negative direction | Stable endpoints and no unexpected jogs |
| Dense curves and gentle/sharp/reversal corners | Correct geometry and appropriate slowing; record observed vibration/marks |
| Mechanical reload within a long stroke | Same-position Up/Down, correct wait, no connector, budget respected |
| Pause/resume and multi-pen changes | Rest boundaries and correct restored pen state |
| Graceful Stop and emergency Cancel -> next plot | Expected return/position invalidation; calibration restored after SP,3 |
| USB interruption or supply loss | Stop, report uncertain position, require origin recovery |
| Constant drawing on SM and T3 | Drawing uses the selected constant-rate policy; travel ramps; quantify corner/start artifacts |
| Preset/resolution changes | Correct scale/rate limits, sampled geometry and origin recovery; no stale counter reinterpretation |
| Three copies with 10-second intervals | Settled Up at origin during each gap, visible countdown and correct first Down on every copy |
| Pause/Stop/Cancel during repeat delay | Timer freezes on Pause, resumes correctly, and never starts another copy after Stop/Cancel |
| Layer overrides and empty delay/pause layers | Correct speed/height/order, stationary waits, and restored settings outside the layer |
| Resume/start offset inside a stroke | Correct splice/overlap, raised approach, restored settings and reload distance accounting |
| Supported automatic homing | Correct profile-specific procedure, preserved calibration and recovered origin before plot travel |

Compare SM and modern outputs on matched geometry, scale, resolution, speed and pen
settings. Record elapsed time and QS endpoint errors as measurements; record pen
contact/line quality through observation. Expand the modern default only after the
target firmware/model combinations pass. Do not claim all NextDraw feature parity
from one successful plot.

## Rollback and completion

### API-review refinements

- Reset per-job status/counters/temporary heights without erasing user calibration
  or rebooting firmware. Always restore both pen targets for a new physical job.
- Use full-stroke planning for drawing. Repeated API-style individual moves from
  zero entry/exit speed must not replace the polyline planner.
- Make queue drain return idle/interrupted/disconnected/failed explicitly; an
  early-returning wait must not emit a settled signal unconditionally.
- Distinguish cached/predicted position, queried controller steps and physical origin
  confidence. No accessor or commanded pen bit confirms physical contact.
- Add option-flow coverage for new backend/jerk fields through every persistence
  and UI/network layer. The inspected CLI omits its offset flag from its transfer list.
- Keep disconnected motion an explicit error. The inspected Python verifier can
  return False before reaching its documented exception path.
- Use mm consistently, separate actual elapsed time from predicted duration, and
  avoid inheriting the Python API's mixed units or physical-run time_estimate meaning.

Compatibility mode remains available throughout. On a preparation or compilation
failure, reject before motion; do not automatically retry a partially executed plot
with SM. Archive diagnostics and establish origin before any fresh program. The
old XM implementation remains recoverable in the verified workspace archive;
restoring it is an explicit rollback, not an automatic runtime backend choice.

The implementation is complete when both backends use the shared executable model;
simulation and physical execution consume identical command identities/timing;
legacy AxiDraw/Xylodraw and the declared modern model/firmware combinations pass their
gates; the virtual EBB passes its independent firmware/state regression corpus;
pen/reload/bounds controls retain their behavior; constant drawing, handling presets,
resolution, repeats/timers, layers, recovered resume and the agreed feature inventory
pass their applicable gates; saved/network jobs migrate
explicitly; and protocol, architecture, plot-controls and parity documentation match
the shipped behavior.

The software items above are implemented with the explicit numerical/control
policies in the checkpoint. Physical quality, mechanism behavior, and modern Auto
rollout require Milestone 7. Firmware flashing and vendor file interoperability
remain separate specifications.
