# Motor implementation review and upgrade plan — 2026-10-06

Recommendation: build one motor-command execution model, with an SM backend for
legacy firmware and a jerk-controlled T3/TD backend for validated EBB 3.x firmware.
Use current Bantam Tools NextDraw as the modern behavior reference and Plotink as
the numerical reference. Keep the existing XM backend during migration for
comparisons. Do not introduce LM as a mandatory intermediate implementation.

This is a source review and implementation plan. No production driver, settings,
dependencies, server process, or device firmware were changed. No hardware commands
were sent. The most recent supplied log still reports firmware 2.8.1; the user has
identified the controller's printed hardware revision as EBB 2.7. A firmware upgrade
has not been confirmed.

## Sources and version evidence

Public repository HEADs were checked through GitHub's API during this review.
Downloaded reference files retain their original headers and are under the ignored
`output/upstream-review` research directory, outside the application runtime.

| Source | Exact reference | Files reviewed / role |
| --- | --- | --- |
| Evil Mad Scientist AxiDraw | `a0df054f41f8e3ae8d408e08e7b2656968e375f1`; public HEAD dated 2024-01-24 | `motion.py`, `dripfeed.py`, previously reviewed configuration and pen handling |
| Bantam Tools NextDraw | Official API/core 1.7.4; API header dated 2026-10-02 | `motion.py`, `plan_utils.py`, `dripfeed.py`, `serial_utils.py`, `pen_handling.py`, model settings |
| Evil Mad Scientist / Bantam Plotink | `4976b86080c25a10a9f979b870669dc62a1741fa`; public HEAD dated 2026-10-02 | `ebb_motion.py`, `ebb3_motion.py`, `ebb3_serial.py`, `ebb_calc.py` |
| Saxi | Previously pinned `2640a3dd6c7a5261985f334255b827edb30e3109` | `planning.ts`, `ebb.ts`; no claim that this is today's upstream HEAD |
| Michael Fogleman's Python axi | `a5a12f01633076232be84a4e3321c80c7b9656b5`; public HEAD dated 2019-11-26 | `planner.py`, `device.py`, MIT license; planner ancestor of Saxi, separate from the vendor AxiDraw driver |
| EBB firmware / EggBot | `8f7fb319ec6507b2f1a60d9a9acd4e5f1ff95f71`; public HEAD dated 2026-10-01 | `app.X/source/ebb.c`, `ebb.h`, `RCServo2.c`, `UBW.c`, and EggBot's Python host driver |

The NextDraw archive SHA-256 is
`809e9c276243cd67f58440b5699359ecfdff556a409225bb04bb0f3adf050688`.
Its bundled core-wheel SHA-256 is
`8b7e5090d704f0158cd9dc893d185a19c1cf379fb65cdfae5f6563511a4d3945`.
See `output/upstream-review/nextdraw-1.7.4/review-manifest.json`.

## What each implementation sends to the motors

| Implementation | Planning | Delivered commands | Rounding / time |
| --- | --- | --- | --- |
| Older vendor AxiDraw Python | Acceleration-limited lookahead, corner limits, short-move policies, triangle/trapezoid profiles | Native motor `SM` | Nominal 25 ms ramp sampling; variable fitted intervals; cruise commands can be 500 ms; rounded cumulative timestamps and motor endpoints |
| Fogleman Python axi | Constant-acceleration blocks, geometric corner limits, backtracking, and a sampling-related speed throttler | `XM` | 10 ms samples; fractional XY error carried between moves |
| Reviewed Saxi | Constant-acceleration blocks and geometric corner limits | `LM` on firmware >= 2.5.3; `XM` otherwise | XY fractional residuals; LM native motor rates computed from entry/exit speed; XM fallback samples at 15 ms |
| Current Plot-it | Forward/backward acceleration reachability, geometric corner limits, independent short-move approximations | `XM` on every supported firmware | Absolute XY grid; approximately 15 ms analytical samples; integer duration ceiling; empty time retained |
| NextDraw 1.7.4 | Jerk-aware forward/backward reachability, different corner rules, symmetric S-curves and short-move exceptions | Current segment compiler emits `T3` and `TD`; feeder also retains an SM handler | Native motor rounding, 40 us time units, controller accumulator predictions carried across commands |

SM and XM are constant-speed timed moves. XM converts A/B steps into native motor
steps using M1=A+B and M2=A-B, then uses the same underlying timed motion system.
Changing only the command name does not add acceleration. Host-generated successive
constant-speed commands approximate a changing speed.

LM specifies native motor step targets and changing rates. Each motor finishes when
its own target is reached; integer rates can cause different finish times. It needs
careful synchronization. Saxi explicitly converts XY steps and rates to M1/M2.

LT is the time-limited, constant-acceleration relative of LM, available since 2.7.
T3 adds jerk to that time-limited model: both motors execute for a shared number of
40 us ticks. TD schedules two specially constructed T3 halves, used for symmetric
S-curves. T3 is available from 3.0; TD from 3.0.1. The official NextDraw software and
Plotink's EBB3 connection class require at least 3.0.2. Firmware 3.1.0 fixed end-time
accounting for LT/T3/TD; 3.1.7 improved command-loading/pulse timing. The live Bantam
updater page now offers 3.1.7. Its earlier cached search excerpt advertised 3.0.3.

The EggBot host also uses Plotink's SM helper, with integer durations and pacing for
long commands. Its egg/spindle mechanics and motion path are not a replacement for
an XY plotter's complete stroke planner. Plotink is shared motor/serial infrastructure,
not a full SVG/stroke planner on its own.

## Material differences in our implementation

### Motor coordinates and small moves

`src/motion.ts:quantizePoint` rounds the machine-space X and Y coordinates separately.
Python rounds the native sum/difference axes. At 40 steps/mm, the requested position
(0.0125, 0.0125) mm corresponds to native motor steps (1,0). Our current rounding
produces XM=(1,1), which converts to motor steps (2,0). This is a concrete small-move
difference, not proof that an entire plot accumulates position error. Our absolute
endpoint policy already prevents ordinary independently rounded delta drift.

Native motor endpoints can correspond to half-integer XY step coordinates. The new
execution state should hold integer M1/M2 positions and fractional controller
accumulators; preview coordinates are derived from those values. Preserve source
directions separately so quantization does not invent staircase corners. Keep the
Xylodraw scale (50 steps/mm at 8x) distinct from AxiDraw (40 steps/mm at 8x), and
preserve the selected rotation, motor polarity, and physical origin.

### Profile and corner behavior

Our current event model has position, initial speed, and constant acceleration:
`s(t)=v0*t+a*t²/2`. It cannot represent a jerk segment, which needs
`s(t)=v0*t+a0*t²/2+j*t³/6`. Network validation also assumes the quadratic model.

NextDraw does not simply add TD to the old AxiDraw planner. It replaces v²-based
reachability with S-curve distance/time calculations. Its corner policy uses angular
projection, cos and cos⁴ reductions in different speed ranges, and an 80%-of-limit
cap at internal junctions. These are different from our half-angle/geometric corner
parameter. They must be compared on matched polylines before choosing defaults.

Its S-curve utility starts and ends a collinear speed-change ramp at zero acceleration.
That does not make a sharp geometric corner globally jerk-continuous: changing the
direction of motion still requires a suitable junction speed or a stop.

NextDraw's `accel` UI option scales model-specific jerk by the cube of its percentage.
It is not equivalent to our explicit mm/s² acceleration settings. Its special-case
solvers sometimes allow leniency beyond nominal jerk. Do not copy device defaults or
claim those values are strict physical limits for Xylodraw. Our design should expose
separate drawing/travel jerk in mm/s³ and retain the existing acceleration settings
as actual caps; any difference from NextDraw's policy must be documented and tested.

### Step generation and precision

The legacy Python compiler rounds native cumulative endpoints and timestamps, stores
some sampled distances in float32 arrays, and has specific low-rate/short-move rules.
Our compiler uses JavaScript float64, Math.round, analytical interpolation, phase-time
ceilings, and retained empty intervals. Python's round-to-even is not Math.round.
These differences explain why related profile equations do not yield identical commands.

NextDraw predicts actual native steps with Plotink's `move_dist_t3`, carries each
motor's fractional accumulator, and derives the second TD-half entry rate from the
first half's discrete final rate. Equal ideal midpoint speeds alone are insufficient:
one-tick corrections matter. A raw floating-point cubic is not an exact controller model.

Use explicit integer math (BigInt or equally exact checked arithmetic) for the
TypeScript execution model. Match signed truncation, initialization, floor division,
rate/acceleration updates, accumulator clearing, and range limits. Represent serialized
wide values as bounded integers/strings, not JSON BigInt values.

### Preview, telemetry, and feeding

Our simulation samples the analytical MotionPlan. Normalization aligns summed integer
durations, but the simulation does not replay intermediate compiled motor endpoints.
NextDraw derives its preview bookkeeping from generated T3/TD motor commands, including
accumulator-aware positions. Neither preview measures carriage slip or physical pen contact.

Our shared USB/server executor already validates a complete plan, uses ordered command
acknowledgements, distinguishes queued/settled signals, and waits on both sides of pen
transitions. Keep those boundaries. An ACK means accepted/queued, not completed.

NextDraw explicitly enables future response syntax (CU,10,1), uses FIFO depth 16, and
paces long commands with a host sleep overlapping their motion. Reviewed Saxi requests
a configurable deeper FIFO for 3.x. Our current core does not configure a deeper FIFO.
A deep queue buffers host stalls; it also makes pause latency and buffer accounting
important. TD occupies two motion slots, even though it is one serial command.

The new feeder must consume QG status once and distribute all flags to consumers.
QG power-loss and limit flags in 3.x are latched/cleared by querying; our idle polling
currently ignores them. QC-only supply checks can miss a transient loss of motor position.
Queries must use the same serial owner as motion, with a measured time budget.

### Pen setup, cancellation, and mechanical reload

The inspected 3.x firmware's ES clears the current command and the entire FIFO;
our observed 2.8.1 clears motor moves and can leave servo commands to drain. Retain
firmware-aware startup handling and always send a stationary, settled Up before travel.
Avoid a full firmware reboot at every job.

SP,3 immediately raises the pen, changes SC,5's effective Down target to the Up target,
and rewrites queued pen-servo targets to Up. This is useful for cancellation, but it
requires invalidating the configuration cache and restoring SC,4/SC,5 plus rates
before any subsequent normal plot. Failure to restore them can leave a logically
Down pen physically at the Up height. This is a forward-looking 3.x risk, not an
established explanation for the prior 2.8.1 physical failure.

Keep the user's Up=30%, Down=52% mapping, extra lift/lower settling, and raised wait
after long travel. Do not replace calibration with NextDraw's different percentage
and standard/brushless servo defaults.

Split a stroke for mechanical reload before trajectory planning, then bring velocity
and acceleration to zero at each reload. Execute Up -> reload wait -> Down -> lower
wait at that same point. Quantized drawing-distance error must be measured and bounded
by resolution; cumulative native step distance should enforce the configured maximum.
Replan from rest after each reload instead of inserting a lift into a moving profile.

## Offline evidence from this review

Reran the current TypeScript compiler, at 200 mm/s², 35 mm/s, 40 steps/mm, rotation 0.
Python values below are the earlier recorded pinned-driver reference, not a new Python run.

| Distance (mm) | Entry / exit (mm/s) | Python reference (ms) | Current TS (ms) | TS commands |
| --- | --- | --- | --- | --- |
| 0.025 | 0 / 0 | 11 | 12 | 1 |
| 0.1 | 0 / 0 | 89 | 90 | 5 |
| 1 | 0 / 0 | 283 | 283 | 18 |
| 6 | 0 / 0 | 336 | 362 | 26 |
| 0.05 | 5 / 3 | 10 | 10 | 1 |
| 0.05 | 3 / 5 | 10 | 10 | 1 |

These are isolated-segment queued durations, not whole-job performance or physical
quality measurements. Equal milliseconds do not imply equal intermediate step timing.
Results and the coordinate example are saved in `typescript-comparison.json` alongside
the NextDraw research snapshot.

An independent integer-per-tick Python model matched Plotink's T3 endpoint and
accumulator predictions in 10 bounded cases: positive/negative motion, acceleration,
jerk, nonzero accumulators, and one-tick moves. This validates the numerical reference
for those cases only. It is not a TypeScript port, full planner validation, or physical
test. Results are in `plotink-tick-probe.json`.

## Proposed architecture and delivery order

Pipeline: prepared paths -> reload splits -> trajectory planner -> native motor
compiler -> immutable ExecutablePlan -> simulation and USB/server executor.

Use typed command records, not raw strings as the only source of execution metadata.
Each record should identify its command/event, tick duration, native start/end steps,
accumulators, rates, acceleration/jerk, pen state, and required stationary boundary.
Derive artwork coordinates and statistics from the executable records. Store the
backend, firmware capabilities, resolution, units, and settings in the job snapshot.

| Order | Deliverable | Acceptance gate |
| --- | --- | --- |
| 1 | Native motor coordinates, pure integer controller math, backend-neutral executable records | Python/Plotink fixtures match exact steps, rates and accumulators; orientation and scale preserved |
| 2 | SM compatibility compiler and command-derived simulation | Legacy short/long move corpus matches its declared reference policy; every timing exception explained; command endpoint replay agrees with compiler |
| 3 | 3.x handshake, response parser, queue/status integration, controlled startup/cancel | Legacy/future replies, stale ACK, full queue, power-loss, interrupted origin, SP,3 restoration, and bounds->normal plot sequences verified |
| 4 | Jerk-aware stroke planning and T3 compiler, then TD coalescing | Full-stroke reachability, endpoint tolerance, speed/acceleration/jerk limits, direction changes and tick counts checked; TD equals its two T3 halves |
| 5 | UI/settings, network schema, saved jobs, statistics and reload integration | Local and server execution select the same backend and preview; old settings/jobs handled explicitly; bounds stays Up and reload restarts at rest |
| 6 | Physical comparison and default selection | Repeatable dry runs and drawing trials pass on the actual machine, including the first plot after a bounds preview |

Suggested testable functions/modules (proposals, not implemented files):

- `motor-coordinates.ts`: canvasToNative, nativeToCanvas, quantizeNativeEndpoint.
- `ebb-math.ts`: predictT3Axis, predictTDAxis, finalRate, maximumRate, checked rounding.
- `trajectory.ts` / `scurve.ts`: junction limits, reachable entry/exit speeds,
  acceleration/jerk-limited ramps, short-move policy.
- `motor-compiler.ts`: compileSM, compileT3, coalesceTD, validateMotorProgram.
- `executable-plan.ts`: compileExecutionPlan, sampleExecutionPlan, indexSignals.
- `ebb-capabilities.ts`: select backend and protocol by firmware and validated support.
- Existing plotter core, pen helper, shared process, network validators and simulation:
  consume the typed executable records while keeping one serial owner.

For the initial modern backend, validate against 3.1.7. Keep SM available for 2.8.1
and other legacy/unvalidated firmware. Do not silently activate a different trajectory
on connection: prepare/recompile against the selected backend and update the preview
and estimates before execution. A server receiving an incompatible profile must
reprepare explicitly or reject it before movement. Migrate the network plan schema;
today's version-1 linear event validator cannot accept a jerk plan as-is.

LM/LT remain useful optional alternatives if firmware stays at 2.8.1. If that becomes
the long-term constraint, LT's common duration is worth evaluating against LM's
independent per-motor finish times. Building all four backends now would multiply the
validation work without advancing the selected NextDraw-style target.

## Physical acceptance corpus

Use matched geometry, speed, resolution, servo calibration, and reload settings:
long axial and diagonal moves, short diagonals, near-zero motion on one motor, dense
curves, acute/right/gentle turns, reversals, closed paths, and sub-step segments.
Test startup after manual Down, bounds->first normal plot, repeat plots, long raised
travel->Down, same-point reloads, pause/resume, graceful stop, emergency cancel, and
the subsequent job. Compare issued commands, QS native endpoints, queue status,
elapsed time, marks and observed pen motion. Never infer contact from QG alone.

The modern backend becomes the default only after these pass. Keep the legacy backend
selectable for comparisons and recovery. First enable the protocol/queue changes on
the existing profile, then test S-curves so failures can be attributed to a specific
change. No firmware flashing is part of this review or implicitly authorized by it.

## Source reuse and licensing

Plotink and Fogleman axi carry MIT notices. The inspected AxiDraw and NextDraw core
files carry GPL-2.0-or-later notices; reviewed Saxi carries AGPL. The project currently
declares AGPL-3.0-only. A direct Python translation is a port, not automatically a
clean-room or MIT implementation. Keep source provenance and notices explicit.
Implement documented motor mathematics independently where appropriate and use pinned
Python outputs for comparisons; do not present that workflow as proof of legal
independence. No licensing changes were made here.

## Primary links

- [NextDraw Python API and official source distribution](https://bantam.tools/nd_py/)
- [NextDraw 1.7.4 archive](https://software-download.bantamtools.com/nd/api/nextdraw_api.zip)
- [NextDraw migration requirements](https://bantam.tools/nd_migrate/)
- [Official firmware updater](https://support.bantamtools.com/hc/en-us/articles/28809123473043-Bantam-Tools-NextDraw-Firmware)
- [EBB 3.x protocol](https://evil-mad.github.io/EggBot/ebb.html)
- [EBB release notes](https://evil-mad.github.io/EggBot/EBBReleaseNotes.html)
- [AxiDraw motion at the reviewed revision](https://github.com/evil-mad/axidraw/blob/a0df054f41f8e3ae8d408e08e7b2656968e375f1/inkscape%20driver/motion.py)
- [Plotink controller calculations](https://github.com/evil-mad/plotink/blob/4976b86080c25a10a9f979b870669dc62a1741fa/plotink/ebb_calc.py)
- [Saxi motor executor](https://github.com/alexrudd2/saxi/blob/2640a3dd6c7a5261985f334255b827edb30e3109/src/ebb.ts)
- [Fogleman axi device](https://github.com/fogleman/axi/blob/a5a12f01633076232be84a4e3321c80c7b9656b5/axi/device.py)
- [Inspected EBB firmware implementation](https://github.com/evil-mad/EggBot/blob/8f7fb319ec6507b2f1a60d9a9acd4e5f1ff95f71/EBB_firmware/app.X/source/ebb.c)
