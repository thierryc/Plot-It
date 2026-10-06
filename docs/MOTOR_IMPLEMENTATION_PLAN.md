# Motor implementation plan

Prepared 2026-10-06. Status: planned; production implementation has not started.

Implement one reusable TypeScript Plotter Core with a native-motor execution model
and two motion backends: legacy SM and modern jerk-controlled T3/TD. The browser
and Node runner use the same library; CLI and desktop clients reuse its contracts.
Validate the modern backend on EBB 3.1.7 first. Keep the existing XM implementation
available during migration so regressions can be isolated.

The [core architecture decision](PLOTTER_CORE_ARCHITECTURE.md) defines the package,
API, platform adapters, homing/pen/feeder boundaries and migration order. These are
proposed changes; the current shared executor has not yet been extracted into a
published package.

The source investigation and pinned references are in
[the motor review](research/MOTOR_IMPLEMENTATION_REVIEW_2026-10-06.md).
The [CLI/Python API review](research/NEXTDRAW_API_REVIEW_2026-10-06.md) additionally
traces plot lifecycle, whole-path versus individual-move behavior, pen restoration,
and two isolated wrapper issues. Its implementation consequences are listed below.
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
existing explicit/manual origin workflow. Automatic NextDraw homing is a subsequent
feature and must not be silently enabled by detecting firmware 3.x.

Deliver motor compatibility, common simulation, and existing plot controls first.
Persistent resume, layer overrides, copies, automatic homing, and the rest of the
Python API feature inventory remain separately tracked in AXIDRAW_PARITY.md.

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

## Proposed pure functions and records

These filenames and interfaces are proposals, not implemented APIs. New core
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
| Browser/Node/client entry points | Discovery, opened byte-channel adapters, clocks and high-level remote job/control facade |

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

- [ ] Save the current dirty workspace in a recoverable archive with a manifest and
      hashes, following the existing archive convention. Do not reset unrelated work.
- [ ] Pin the reviewed NextDraw archive and Plotink/EBB revisions and preserve notices.
- [ ] Capture current XM output for the reference corpus and current machine settings.
- [ ] Record baseline test/build results and the existing first-plot-after-bounds case.

Acceptance: the current version is recoverable; expected legacy behavior and known
physical uncertainties are distinguished. No physical success is inferred from mocks.

## Milestone 1 — Core extraction, native coordinates and executable model

Touch `motion.ts`, `motion-plan.ts`, `plot-process.ts` and their consumers. Introduce
the proposed coordinate, capabilities and executable-plan modules without activating
a new hardware backend yet. Extract existing behavior first, then introduce the
native representation; keep those changes independently reviewable.

- [ ] Create the core workspace package with ESM/types and explicit browser, Node
      and client entry points. Keep `serialport` out of pure/browser imports.
- [ ] Extract core geometry/settings types from editor state; separate pure clipping
      and splitting from DOM SVG parsing, and resolve colors in input adapters.
- [ ] Move existing execution behind an opened byte transport and injected clock;
      retain browser/server compatibility facades without changing XM behavior.
- [ ] Define PreparedJob, target/start requirements, structured session errors,
      job admission/completion and bounded event contracts.
- [ ] Verify pure imports without DOM/Node types, browser bundles without native
      Node dependencies and equivalent current browser/runner execution traces.
- [ ] Define profile conversion independently from firmware selection.
- [ ] Quantize native motor endpoints and preserve source geometry directions.
- [ ] Track native integer positions and fractional accumulators separately.
- [ ] Define compiler versions, typed command records, limits and serial encoders.
- [ ] Preserve the current XM path as a temporary comparison adapter.
- [ ] Define a bounded display sampler; do not loop through all 25,000 ticks per
      second for every animation frame. Use exact state prediction/checkpoints.

Acceptance: axis/diagonal/negative/rotated coordinates and 8x/16x resolution conversions
pass; package boundaries preserve current execution behavior; repeated tiny moves
do not accumulate uncontrolled endpoint drift; short moves can reach native endpoints
that the integer XM grid could not represent.

## Milestone 2 — Legacy SM compiler and command-derived simulation

- [ ] Implement native SM serialization and legacy duration/rate validation.
- [ ] Implement the declared AxiDraw-compatible ramp sampling and short-move policy;
      test round-to-even, cumulative timestamps, float32 reference effects, final
      endpoints, zero-step intervals and slow-axis behavior explicitly.
- [ ] Specify intentional timing differences, including preserved dwell time and
      application pen waits; do not silently claim byte-for-byte parity everywhere.
- [ ] Make `simulation.ts`, `plot-signals.ts`, `plot-statistics.ts`, `live-plot.ts`
      and overlay sampling consume the compiled execution timeline.
- [ ] Keep pen counters based on real transition records, not animation frames.

Acceptance: full motor-step/duration sequences match pinned Python fixtures where
exact legacy policy is the target; intentional exceptions have named tests. Simulation
and compilation agree at every command boundary. The 0.025/0.1/1/6 mm examples,
nonzero entry/exit rates and asymmetric native-axis moves are covered.

## Milestone 3 — Firmware protocol, queue and pen preparation

Touch `plotter-core.ts`, `ebb-pen.ts`, `pen-control.ts`, `server/serial.ts`, and the
fake EBB transport. Capability state is available to both browser and server clients.

- [ ] Split protocol, feeder, pen controller and origin/homing services inside the
      shared package; all queries/manual controls use the same command owner.
- [ ] Implement explicit legacy and future-response parsers with framing/error checks.
- [ ] For modern operation negotiate CU,10,1 only on supported firmware and account
      for its special transition response. Reset parser/cache state on reconnect.
- [ ] Query supported FIFO depth, choose a bounded working depth, and account for TD
      expansion. Preserve cancellation/pause responsiveness instead of filling an
      arbitrarily long time horizon.
- [ ] Decode QG once and dispatch idle, pen, pause-button, power-loss and limit flags.
      A transient power-loss/limit event invalidates position when appropriate; normal
      idle polling must not consume and discard it.
- [ ] Keep polling and UI work outside critical short-command feeding, using a
      measured schedule. Retain existing QC supply checks and profile-specific limits.
- [ ] Specify backend-valid braking for graceful pause/stop separately from emergency
      cancel. Do not treat an arbitrary nonzero-speed queue tail as a planned rest.
- [ ] Log control-induced braking as separate compiled segments. Resume from a verified
      checkpoint and compile the remainder from rest; do not mutate queued job records.
- [ ] Before every job, stop/drain prior commands using the firmware's rules, restore
      calibrated servo configuration and force a stationary Up with full settling
      time before any return/homing or plot travel. Establish/preserve the required
      start at origin, and seed fractional accumulators at rest where required without
      resetting known position. Do not reboot firmware per plot.
- [ ] Implement modern cancellation with ES/SP,3 ordering and guaranteed cache
      invalidation. SP,3 changes the Down target to Up: restore SC,4/SC,5 and rates
      before any later Down command. Preserve a distinct legacy cancellation path.

Acceptance: repeated jobs, stale replies, connection loss, full queue, manual Down
before Start, interrupted origin, bounds->normal, and cancel->next job pass on the
firmware-aware fixtures. No XY command precedes the initial settled Up. No pen query
is treated as a mechanical contact sensor.

## Milestone 4 — S-curve planner and T3 compiler

- [ ] Implement drawing/travel jerk-aware forward and backward reachability passes.
- [ ] Build constant-jerk phases with optional constant-acceleration plateaus; honor
      speed and acceleration caps as well as jerk caps.
- [ ] Handle long accel/cruise/decel moves, reduced-peak moves, near-equal entry/exit
      speeds, and short moves where rate/jerk quantization dominates.
- [ ] Evaluate vendor corner rules against the existing geometric corner parameter.
      Preserve deliberate sharp/reversal stops; document the selected modern policy.
- [ ] Implement integer T3 parameters and predict each motor's actual steps and
      accumulator. Carry state through all commands and direction changes.
- [ ] Correct endpoints within the declared native-step tolerance while staying within
      limits; if quantized parameters cannot make a valid command, slow/replan or fail
      before motion. Do not append an uncontrolled correction jog.
- [ ] Implement TD coalescing only after T3 passes: each TD must predict exactly the
      same endpoint, rates, accumulators and duration as its two T3 halves.
- [ ] Keep modern motion/dwell accumulator transitions predictable. Any utility
      movement outside the executable program requires reseeding or invalidating
      the predicted state before the next program.

Acceptance: Plotink tick-math fixtures match exactly; planner tests establish reachable
rates and endpoint/limit invariants. Compare matched NextDraw examples, documenting
differences caused by our explicit acceleration caps. Total queued ticks include the
correct TD factor of two and firmware-specific end-time behavior. Modern activation
remains gated on the later physical milestone.

## Milestone 5 — Reloads, bounds, machine profiles and UI

- [ ] Split optimized drawing paths at reload boundaries before speed planning.
- [ ] Verify compiled drawing-distance accounting against the configured reload
      maximum; shorten/replan a chunk if rounding would exceed its allowed budget.
      Define the distance as planned quantized drawing length, not sensed physical
      travel. Reject an impossible limit below supported move resolution explicitly.
- [ ] Require zero velocity and acceleration at every reload. Emit Up -> reload
      wait -> Down -> lower settling at the same location, then restart from rest.
- [ ] Build bounds previews as raised-only intents using the selected backend and
      travel limits. Do not convert already compiled drawing records by changing a
      penDown flag; do not mutate the normal plot's snapshot.
- [ ] Add actual NextDraw model profiles and standard/brushless servo configurations.
      Preserve AxiDraw/Xylodraw calibration; test servo mappings separately.
- [ ] Add motion preference Auto / Compatibility / S-curve, with clear availability.
      Show the resolved mode and firmware next to the prepared preview. Unknown
      offline capability uses an explicitly labeled compatibility preview.
- [ ] Add drawing/travel jerk under advanced controls; disable them for SM planning.
- [ ] Invalidate/reprepare on backend, machine, resolution, speed, acceleration, jerk,
      or pen-timing changes. Do not alter the executable snapshot during plotting.
- [ ] Update local storage and document validation/defaults together. Existing documents
      retain their calibration and have no assumed new jerk setting until migrated.

Primary integration files: `model.ts`, `main.ts`, `document-file.ts`, `plot-job.ts`,
`planner.worker.ts`, `plot-workspace.ts`, `bounds-preview.ts`, `ui/app/plot-views.ts`
and `ui/app/shell.ts`. The existing `axidrawModel` field controls decorative machine
size rather than physical travel bounds; do not reuse it as a bounds authority.

Acceptance: changing destination/firmware causes a matching preview reprepare;
reload counts/distances and pen waits are shared by simulation and execution;
NextDraw profiles use the correct pen pulse configuration; the first normal plot
after bounds restores normal calibration and lowers before drawing.

## Milestone 6 — Network jobs, persistence and diagnostics

Touch `network-protocol.ts`, `network-plotter.ts`, `server/api.ts`, `server/jobs.ts`
and `server/runner.ts`. The current version-1 envelope assumes linear acceleration.

- [ ] Introduce a version-2 prepared-job schema containing prepared paths/settings,
      target capabilities, compiler version and the validated executable snapshot.
- [ ] Publish capabilities in the network snapshot before client preparation.
- [ ] Have the server validate/recompile with the same shared compiler and compare
      the program digest. Reject incompatible/stale compiler, profile or firmware
      snapshots before movement; never silently substitute another backend at Start.
- [ ] Keep version-1 jobs readable for diagnostics. Reprepare unstarted compatible
      jobs through the legacy path; never reinterpret started/interrupted jobs as a
      new program or auto-resume them on a different backend.
- [ ] Include backend, microsteps, command index, native requested/observed position,
      accumulator predictions, tick timing and pen requested/queued/settled state in
      bounded diagnostic logs. Update the machine-log format version.
- [ ] Preserve existing request idempotency, immutable execution identities, control
      ownership and telemetry coalescing; avoid per-command socket/JSON overhead.
- [ ] Expose the high-level runner job/control contract through the shared client
      entry point. Keep HTTP hosting, database/files and UI outside the core.

Acceptance: local USB and server produce the same executable digest for the same
prepared job. Saved jobs and reconnects cannot run with a different motion profile
than their preview. Malformed commands, excessive command counts, huge durations,
unsafe ranges and incompatible versions fail before serial writes.

After browser/runner integration, a thin Node CLI can reuse the same session locally
or submit to the runner. Its first input is normalized path-job JSON; complete SVG
support needs a Node geometry adapter. A future Swift/WKWebView shell should use a
managed local runner/helper and the same job API. Neither a new Swift motor planner
nor a desktop app is required for the initial motor migration.

## Milestone 7 — Hardware acceptance and rollout

Archive and build each candidate. Run appropriate focused tests, then the complete
test suite and `scripts/node-lts.sh --npm run build`. Browser verification exercises
the local Chrome app with a mock/disconnected device first. Physical tests use the
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
with SM. Archive diagnostics and establish origin before any fresh program. Remove
the temporary XM adapter only after legacy SM acceptance, preserving its archived
reference corpus.

The implementation is complete when both backends use the shared executable model;
simulation and physical execution consume identical command identities/timing;
legacy AxiDraw/Xylodraw and the declared modern model/firmware combinations pass their
gates; pen/reload/bounds controls retain their behavior; saved/network jobs migrate
explicitly; and protocol, architecture, plot-controls and parity documentation match
the shipped behavior.

All milestone checkboxes remain pending. This document is the implementation plan,
not a report that the driver migration, firmware update, or hardware validation has
already happened.
