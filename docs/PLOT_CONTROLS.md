# Pen timing, plot statistics, power and placement

In Plot → Advanced → Pen timing and rates:

| Control | Default | Range | Effect |
| --- | --- | --- | --- |
| Raise rate | 75% | 1–100%, integer | Servo lifting speed |
| Lower rate | 50% | 1–100%, integer | Servo lowering speed |
| Extra wait after raising | 150 ms | -500–10000 ms, integer | Adjust calculated lift time before travel |
| Extra wait after lowering | 0 ms | -500–10000 ms, integer | Adjust calculated lowering time before drawing |
| Extra reload wait | 0 ms | 0–10000 ms, integer | Additional raised dwell between consecutive mechanical-pen reload chunks |

Settings are saved in the document and browser state. Older documents and network
plans retain the defaults. The transition model uses the chosen rate and distance;
extra waits adjust that modeled duration, with a minimum of 1 ms. Negative waits
intentionally shorten the allowance. Execution uses the planned duration as an
inclusive minimum, so the extra wait is never added twice. Changing a rate updates
SC,11/12 before the next SP. Hardware movement never begins automatically when
editing settings. The same durations appear in simulation and execution signals.
The supported extra-delay range extends Python's positive limit for slow pens;
Python's independent rates and signed-delay behavior are retained.

Drawing also includes a 50 ms baseline settling allowance after lowering, in
addition to the modeled mechanical transit and adjustable extra lowering wait.
Before lowering after a pen-up travel of at least 50 mm, the carriage waits
100 ms at its destination while still raised. This stationary zero-step XM dwell
is included in the shared plan, simulation, statistics and machine signals;
it adds no pen toggle and no drawing/travel distance.

Reload distance remains under Advanced. The extra reload wait applies to an
in-place Up immediately followed by Down when reload splitting is enabled. It does
not add a dwell to the final lift, startup, tool changes, or ordinary travel.
Coincident consecutive source paths with reload enabled receive the same allowance.

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
Plotink `queryVoltage` policy recorded in [parity tracking](AXIDRAW_PARITY.md).

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

Diagnostics exports format-6 logs and draw/travel/all SVG paths. The local Virtual
EBB monitor is `/virtual.html`: numeric observed counters/pen/FIFO/power, a simple
trail, scenario controls, saved prepared-job input and bounded trace download. It
cannot open USB. See `CORE_REWRITE_STATUS.md` and tomorrow's device checklist.
