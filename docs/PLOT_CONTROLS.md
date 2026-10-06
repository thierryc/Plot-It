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
Machine controls → Check motor supply performs an idle check on demand.

Plot → Preview bounding box · pen up traces the rectangle around all included
prepared drawing paths, including all selected pens. It uses the selected destination:
simulation, direct USB, or the owned network plotter. With no destination chosen it
uses simulation. Hardware preview starts by forcing the pen raised at origin, uses
travel speed/acceleration, keeps it raised throughout, returns to origin even if
normal drawing's final-return preference is off, and releases motors. Stop and Pause
use the same executor as plotting. The original drawing remains available for Start
or Replay afterward. Bounds describe the prepared centerline geometry, excluding
stroke width; a straight-line drawing produces a degenerate rectangular perimeter.

Every physical Start/Replay and bounding-box preview removes remaining motor
commands, drains queued pen commands while stationary, and clears the driver's
cached setup. It reapplies the selected pen calibration, rates, PWM timing and
motor drivers, establishing step resolution when a new origin is needed. The pen
is forced up and allowed to settle before travel. The working firmware servo
engine and an idle origin reference are preserved, along with document tuning.

Original TypeScript implementation, behavior references:
[AxiDraw pen options](https://axidraw.com/doc/py_api/#pen_rate_lower),
[EBB QC protocol](https://evil-mad.github.io/EggBot/ebb.html#QC), and the pinned
Plotink `queryVoltage` policy recorded in [parity tracking](AXIDRAW_PARITY.md).
