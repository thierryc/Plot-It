# Pen timing, plot statistics, power and placement

In Plot → Advanced → Pen timing and rates:

| Control | Default | Range | Effect |
| --- | --- | --- | --- |
| Raise rate | 75% | 1–100%, integer | Servo lifting speed |
| Lower rate | 50% | 1–100%, integer | Servo lowering speed |
| Extra wait after raising | 150 ms | 0–10000 ms, integer | Add settling time before travel |
| Extra wait after lowering | 0 ms | 0–10000 ms, integer | Add settling time before drawing |
| Extra reload wait | 0 ms | 0–10000 ms, integer | Additional raised dwell between consecutive mechanical-pen reload chunks |

Settings are saved in the document and browser state. The `ebb-pulse-v1` model
uses the actual rounded pulse distance, configured refresh period and electrical
rate to bound the final target pulse. Mechanical settling is a separate allowance.
Extra waits are nonnegative additions; old negative offsets migrate once to zero
when an older document/browser setting is restored. Positions and selected rates
are preserved. Old prepared programs must be prepared again; old timed event
snapshots cannot be relabeled with the new model.

Stock profiles currently use **provisional engineering allowances**, not measured
servo-response claims: 100 ms after raising/lowering plus 250 ms for unknown-output
startup, in addition to the relevant electrical bound and user extra waits. These
values require physical acceptance on each supported servo/linkage. Unknown state
uses explicit output initialization rather than assuming the prior position lies
between today's Up/Down settings. Changing a rate configures SC,11/12 independently
of the dwell; adding extra wait does not slow the ramp.

Execution treats a prepared dwell as an inclusive minimum. It recomputes recovery
bounds if pulse knowledge is lost and reports timing extensions; simulation shows
the prepared estimate. Reload allowance is composed once even on recovery. Firmware
acknowledgement and the pen state bit do not measure paper contact. Settings edits
never automatically start hardware movement.

Before lowering after a pen-up travel of at least 50 mm, the carriage waits
100 ms at its destination while still raised. This stationary zero-step SM dwell
is included in the shared plan, simulation, statistics and machine signals;
it adds no pen toggle and no drawing/travel distance.

Reload distance remains under Advanced. The extra reload wait applies to an
in-place Up immediately followed by Down when reload splitting is enabled. It does
not add a dwell to the final lift, startup, tool changes, or ordinary travel.
Coincident consecutive source paths with reload enabled receive the same allowance.

SM on explicit EBB 3.1.7 can use bounded 100 ms straight cruise commands. Ramps,
pen targets/waits and reload boundaries keep their existing policy. If the source
corridor cannot be certified within the bounded work budget, the compiler retains
the original complete command stream. Other/unknown firmware uses compatibility SM. Prepared wrappers use `native-v5`; editable documents must be prepared for the selected configuration.

The playback area displays totals for drawing and raised travel in millimetres,
computed from the prepared, clipped, optimized and step-rounded centerline plan.
Travel includes tool-change and final origin returns. Estimated motion time includes
pen/reload waits, excluding user waits at pen changes. Actual hardware elapsed time
includes pauses, pen changes, serial overhead and cleanup; it freezes after completion
or failure. Network elapsed time comes from the runner. Simulation reports plan time,
which follows seeking and playback speed. Distances are job totals, not measured
physical distances or live completed-distance counters.

For USB or network plotting, the playback area displays motor supply status and
its raw ADC value. QC supports both legacy and future responses. As in the reviewed
Plotink code, values below 250 are low/missing supply. Startup is blocked before
motor or pen commands; a drop during plotting cancels and clears origin without
attempting an uncertain home move. Check the adapter/cable before restarting.
No voltage conversion is guessed: EBB hardware revisions have different dividers.
Unsupported or malformed readings are explicitly unavailable. Checks run at
connection/start and about every two seconds through the active serial feeder.
Motors → Check supply performs an idle check on demand.

Plot footer → Preview bounds traces the rectangle around all included
prepared drawing paths, including all selected pens. It uses the selected connection:
direct USB or the owned network plotter. With no destination chosen it
uses simulation. Hardware preview starts by forcing the pen raised at origin, uses
travel speed/acceleration, keeps it raised throughout, returns to origin even if
normal drawing's final-return preference is off, and releases motors. Stop and Pause
use the same executor as plotting. The original drawing remains available for Start
or Simulate afterward. Bounds describe the prepared centerline geometry, excluding
stroke width; a straight-line drawing produces a degenerate rectangular perimeter.

Every physical Start and bounding-box preview removes remaining motor
commands, drains queued pen commands while stationary, and clears the driver's
cached setup. It reapplies the selected pen calibration, rates, PWM timing and
motor drivers, establishing step resolution when a new origin is needed. The pen
is forced up and allowed to settle before travel. The working firmware servo
engine and an idle origin reference are preserved, along with document tuning.

Original TypeScript implementation, behavior references:
[AxiDraw pen options](https://axidraw.com/doc/py_api/#pen_rate_lower),
[EBB QC protocol](https://evil-mad.github.io/EggBot/ebb.html#QC), and the pinned
Plotink `queryVoltage` reference identified in the [core source pins](../packages/plotter-core/reference/upstream-revisions.json).

## Plot action layout

The connection area contains a hardware destination picker and Connect button. Connect
is disabled until a supported destination is selected, then highlighted. Choosing an
option does not connect or start a job. Network Connect acquires control and connects the
server EBB when it is idle; Disconnect releases server USB. Ownership controls remain
available under Connection options.

Start with this pen is the primary footer action. Simulate and Preview bounds are
secondary footer actions; Simulate never changes the selected hardware connection.
During playback, Pause/Resume/Continue and Stop replace the idle actions. Numeric
progress, elapsed time, drawing/travel estimates, supply status and notices appear next
to the canvas connection/object status. Frequent numeric updates are silent; process
changes are announced politely and actionable errors remain in the playback footer.

The top-level Destination, Plot settings, Pens & passes, Motors and Pen blocks
are collapsible. They initially open and preserve their state while settings or
previews refresh. Use the Edit/Plot segmented control to return to editing.

Motors provides Set origin, Return, Engage, Release and Check supply. Pen provides
Up/Down on one row and direct Up/Down height fields. These retain the existing
connection, ownership and playback restrictions. Pens & passes has no nested
collapse; multiple passes show their order directly. Diagnostics starts collapsed
and holds Download log, app/firmware versions, device information and paper details.

Bantam Tools NextDraw is selectable in Edit and Plot, with 8511/A4, 1117/A3 and
2234/A1 models. The core has model-specific pen setup and explicit Home controls; NextDraw
requires EBB 3.0.2 or newer. Explicit S-curve requires 3.1.7 and remains a hardware
acceptance candidate. Model selection is independent of the document's paper.
Existing AxiDraw/EBB and XyloDraw hardware behavior stays the same.

## Dynamic motion and comparison

**Standard remains the default.** Dynamic is an optional deterministic flow strategy
for explicit **S-curve/T3 on EBB 3.1.7** with **Accelerated** drawing selected. It
anticipates slower curves and fits the selected drawing speed, acceleration and jerk
limits without rounding or reordering the drawing. SM and older firmware retain
Standard; the app does not silently substitute another strategy or backend.

Dynamic adds **Curve acceleration target** in mm/s² (initially the smaller of 100 and
half the selected draw acceleration) and **Anticipation distance** in mm (initially 3,
range 0–20). Lower curve targets slow tighter curves; anticipation advances the
curve-related slowdown. Required stops include stroke/reload ends, reversals and
source turns of at least 60°. Timing is planned in physical-distance cells, then
split at drawing vertices without restarting acceleration. Nominal scalar jerk is
bounded; polyline direction changes and integer endpoint fitting do not establish
a bound on physical vector jerk. Pen-up travel and pen transitions keep their
existing behavior. Geometry/settings/firmware changes require fresh preparation.

**Compare motion** prepares Standard T3 and Dynamic T3 from the same geometry and common
settings, with a shared speed-color scale and actual-time playback. Its estimates
are prepared plan time, not measured hardware time. Select **Use Standard** or
**Use Dynamic** to leave comparison and prepare the chosen strategy for plotting.
Comparison itself is preview-only. The [modern physical run sheet](validation/dynamic-acceptance/README.md)
records the same-build test; no software preview establishes ink quality.

## Shared-core controls

Advanced controls now include backend, Custom/technical/handwriting/sketching
recipes, curve accuracy, 8×/16× resolution, constant drawing, jerk, servo timeout,
repeats/gaps/Continue, strict order, page placement/clipping, occlusion and path
filters. Physical AxiDraw travel model is separate from decoration. Layer controls
include selection, speed/height overrides, waits and pauses. Native program records
are the preview authority; settings/destination changes require preparation again.

Motors additionally offers bounded raised jog and NextDraw-only Home. Start distance
uses drawing millimetres, excluding travel and waits. Use a settled checkpoint to
fill it, reduce it for overlap, or clear it; establish physical origin after an
interruption. Resume preserves subsequent layer settings and barriers.

Copies wait Up at origin before the inter-copy timer; Pause freezes it, Continue
only applies after it expires, and Stop/Cancel prevents another copy. The final
finite copy has no gap. Preview and virtual execution expose copy/countdown.

Graceful Pause/Stop finishes the next planned rest boundary. Cancel purges; a
partially moved machine requires explicit origin recovery. Releasing motors or
manual carriage movement requires the user to restore the established origin.

Diagnostics exports format-7 machine logs while idle, and draw/travel/all SVG paths. Each executable is stored once in a digest-keyed program dictionary; serialization runs in a separate worker. See [download and copy logs](ALPHA_TESTING.md#download-and-copy-logs) for tester instructions.

The local Virtual EBB monitor is `/virtual.html`: observed counters, pen/FIFO/power, scenario controls and prepared-job input. It cannot open USB. Physical acceptance follows the [hardware test procedure](validation/README.md).

## Long strokes and workload checkpoints

**Long strokes → Continuous** remains the default for Standard and Dynamic.
Execution transfers use bounded host pages without adding stops, lifting the pen,
or changing the compiled motor commands. Visual progress updates are coalesced;
the exact last confirmed checkpoint advances only after idle and position checks.

Choose **Periodic checkpoints** to add planned physical stops at the earliest
verified budget: 2,000 compiled drawing records, 10 seconds of planned drawing,
or 250 mm of drawing. The planner may cut earlier to use a low-turn source vertex.
It replans to rest, lifts, verifies, lowers at the same point, and accelerates again.
Reload distance and reload waits remain separate settings. Very small custom SDK
budgets can be rejected when the motor grid cannot support them.

Preparation shows cut counts, chunk counts, added time, cut coordinates and amber
cut markers in the path preview. Stops can leave dots; inspect physical seams
before relying on this mode for finished work. This setting does not replace the
selected motion algorithm or change the default to Dynamic.

The live pen display distinguishes requests from confirmed controller state.
After communication failure it reports unknown; neither an Up request nor a
command acknowledgement proves a physical lift. Reconnect and recover the pen
and physical origin before another plot. Software cannot guarantee pen-up after
USB communication has failed.
