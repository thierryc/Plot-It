# EBB-first implementation notes

Plot-it's first machine backend targets EBB-based AxiDraw and Xylodraw devices directly from Chrome through Web Serial. The serial transport, polyline planner and timed motion compiler are implemented locally from the documented protocol. Saxi is no longer used.

## Protocol boundary

- Serial transport: 9600 baud, CR-terminated commands.
- `V`: identify and parse the firmware version.
- `EM,2,2`: enable both motors in 1/8-step mode.
- `XM,duration,xSteps,ySteps`: mixed-axis movement for AxiDraw/CoreXY-style geometry.
- `SP,state,delay,1`: queued pen Up (1) / Down (0) on RB1.
- `SC,4/5`: calibrated Up/Down pulse widths. `SC,11/12`: independent raise/lower rates.
- `QG`: idle/FIFO status on firmware 2.6.2 and newer.
- `QM`: compatibility fallback for older firmware.
- `ES,1`: immediate motor stop and disable; queued pen commands still require draining on legacy firmware.
- `ES,0` (or `ES` before 2.8.0): startup motor-command purge without disabling motors, followed by an idle barrier for remaining pen commands.
- `EM,0,0`: release motors after Stop, completion, cancellation/errors, or an explicit release request. Disconnect releases an engaged idle machine before closing the port.

EBB v3 introduced an optional future response syntax. Command handling accepts both legacy `OK` responses and future command-name responses. `QG` replaces the now-deprecated `QM` query where the firmware supports it.

## Geometry and precision

The editor and plot plan use millimetres. AxiDraw uses 5 full steps/mm and Xylodraw uses 6.25 full steps/mm. With `EM` mode 2, those become 40 and 50 microsteps/mm respectively.

Standard machine orientation uses the confirmed 90° clockwise mapping for both
profiles: canvas `(x, y)` maps to mixed machine axes `(-y, x)`. XM receives these mixed-axis deltas directly, and the board drives the
motors using their sum and difference. Position feedback applies the inverse mapping
so the canvas remains in artwork coordinates. Orientation overrides in Advanced
are rotations relative to this Standard. Origin returns use machine-space steps
or EBB HM, so they do not apply the rotation a second time.

Every move is quantized from its absolute millimetre target rather than independently rounding each delta. The emitted step delta is:

```text
round(machine_target_mm × steps_per_mm) − current_integer_step_position
```

This prevents sub-step rounding error from accumulating and guarantees that a normal return to `(0, 0)` also targets the exact starting step position.

Redundant points on an exactly straight segment are removed before step
rounding, preserving corners and reversals. Path vertices are rounded to those
reachable XM endpoints before trajectory planning. Consecutive vertices on the same step position are omitted, while
accumulated small moves still reach their absolute target. Distances and
forward/backward reachability use the attainable geometry. Corner speed limits
retain the source directions, so rounding a gentle curve to a staircase of step
endpoints does not introduce artificial corner slowdowns.
Simulation displays the same geometry; the maximum coordinate change from source
artwork is half an XM step per axis (0.0125 mm AxiDraw / 0.01 mm Xylodraw).

`planSegment` resolves each reachable segment. Normal moves retain acceleration,
cruise, and deceleration. Near the triangle/cruise crossover, local acceleration
is reduced to avoid a tiny cruise phase, while preserving endpoint reachability.
If a triangle provides at most four 25 ms ramp slices, a boosted-entry linear
profile is used. If that profile has fewer than two slices, a single constant
speed profile is used. Explicit `stopBefore` metadata preserves rest boundaries
for Pause/Stop even when a short approximation begins at a nonzero speed.

Command sampling uses 15 ms intervals and cumulative absolute step targets.
Empty intervals are coalesced with their elapsed time retained. Moving commands
are kept above 2 native motor steps/second; excess slow time becomes a queued
dwell. Rounding-induced overspeed lengthens a command to keep both native motors
at or below 24,995 steps/second. Integer-millisecond and rate corrections are
applied to the shared plan's clock before simulation or execution. Preview
interpolates the profile; the board executes constant-speed sampled commands.
Native sum/difference rate and integer bounds are validated before plotting.

This implements the reviewed Python short-move policies independently. It keeps
the existing XM lattice and 15 ms sampling, rather than Python's native-axis SM
rounding and 25 ms sampling. Elapsed time for empty intervals is preserved here,
so individual command streams and timing are not byte-identical to Python.
See [AxiDraw parity](AXIDRAW_PARITY.md) for the remaining feature work.

## Plot preparation

1. Convert supported SVG geometry to sampled paths in page millimetres.
2. Clip every segment to the configured paper safe margin.
3. Normalize effective stroke/fill colors, apply plot-only pen assignments, and filter selected pens. Group eligible blocks by assigned pen rank, keeping protected PlotFont blocks intact.
4. Apply the configured [path optimization](PATH_OPTIMIZATION.md) before reload
   splitting: nearby same-pen/same-width endpoint joining, bounded vertex
   reduction, and original/nearest/seeded random closed starts. Generated fills
   and protected text operations retain their geometry. Reorder only within a tool group using one of three modes:
   - preserve SVG order;
   - greedy nearest path;
   - greedy nearest endpoint with path reversal.
5. Optionally reload a mechanical pen at the configured **Pen reload distance**:
   stop after that much drawn path length, lift and settle, lower and settle at
   the same XY position, then continue the stroke. No origin return or pen-change
   prompt is used for these cycles. A value of 0 disables distance-based reloads.
6. Before each subsequent different pen, raise the pen, plan travel back to origin, and wait for Continue. Explicit Start authorizes the first pen.
7. At origin, explicitly raise the pen and wait for it to settle before the first travel or drawing move, regardless of prior manual pen adjustment. Plot through timed `XM` and explicit `SP` commands.
8. On normal completion, raise the pen and wait for it to settle, optionally return to step origin with the pen raised, then release motors. Report Complete only after the release acknowledgement.
9. Sidebar Stop stops feeding the job at a planned rest boundary, drains queued motion, raises the pen, returns to the established origin, and releases motors. Emergency cancellation/errors use `ES,1` and attempt release without initiating a return move.

## Safety decisions

- The final-return preference applies to successful completion; Stop and every pen change always return to origin. Fresh jobs return to the established origin before starting. Manual Return to origin is also available while idle.
- Paper bounds are enforced before planning.
- Tool changes wait until queued motion is idle and keep the pen raised.
- Idle waits allow the estimated remaining queued motion duration plus ten seconds. Long straight moves are not treated as stalled after ten seconds; completion still requires an actual idle response from the board. Idle confirmation, emergency stop, and disconnect clear the queued-duration estimate.
- Mock serial transport tests cover command execution, origin handling, pause/tool changes and cancellation. Physical hardware testing remains necessary.

## Public references

- EBB v3 command set: <https://evil-mad.github.io/EggBot/ebb.html>
- EBB legacy command set: <https://evil-mad.github.io/EggBot/ebb2.html>
- AxiDraw Python API behavior: <https://axidraw.com/doc/py_api/>
- Bantam Tools NextDraw layer control: <https://support.bantamtools.com/hc/en-us/articles/29473928061971-NextDraw-Layer-Control>

## Shared accelerated execution and positioning

The motion queue consumes the same MotionPlan as simulation. `trajectory.ts`
plans the original polyline using junction speed limits, forward/backward
acceleration reachability, and triangular/trapezoidal segments. Vertices and
stroke boundaries are preserved. No vendor planner is loaded.

`compileMotion` samples these segments into documented timed XM commands at
intervals no longer than 15 ms. Rounded cumulative millisecond boundaries avoid
per-command duration drift. Absolute integer endpoints carry substep error
across commands and close precisely at origin. All supported firmware uses the
same XM path. Pen changes and pauses drain queued motion first.

Machine controls use configured SP endpoints for pen height (percent mapped
to the existing servo range), EM,0,0 for motor release, and EM,2,2 plus CS for origin capture (CS requires
2.4.3; enabling motors resets counters on earlier firmware). Return to origin
uses HM on firmware 2.6.2+, with a tracked-position XM fallback on older firmware.
No motor re-enable is sent immediately before HM: doing so can reset its origin.
Stop and successful plotting release motors after motion settles; every motor
release invalidates origin. Pause and pen-change waits keep motors engaged.

Evil Mad Scientist's `axidraw.py` manual walk_home implementation was reviewed:
it drains motion, queries QS, converts mixed motor positions to XY, and moves
back to the origin where motors were enabled. Plot-it uses the EBB HM utility
command for this operation rather than importing Python code.
https://github.com/evil-mad/axidraw/blob/master/inkscape%20driver/axidraw.py

Only the pen-up/down, origin and motor controls requested here are exposed;
no sensor homing or arbitrary out-of-bounds jogging is implied.

## Interactive plotting

The Plot sidebar remains in place from preparation through execution and completion.
It is the only owner of Pause/Resume, Continue, Stop, and Back to editing. Hardware
Back is unavailable until execution and cleanup finish. Simulation adds scrubbing,
speed, and replay. Pen controls are available after a hardware pause settles.

On firmware 2.4.3+, QS counter readings drive the canvas marker and revealed
progress. Queries are serialized with commands, throttled during motion, and
refreshed at idle boundaries; legacy QS acknowledgements are consumed. Older
firmware uses estimated progress. Counters are commanded steps rather than
physical encoders, so skipped steps cannot be detected.

Pause drains the queue at a planned rest boundary, raises the pen, and holds XY.
Resume restores the pen height required by the next XY motion; a pending pen
event executes directly, avoiding a down/up tap immediately before a lift.
A different assigned pen has a mandatory
tool event after planned pen-up travel to origin; Continue authorizes only the
next pass. Stop drains motion, lifts the pen, and returns using HM or tracked XM,
without resetting counters. Error handling uses ES and never initiates return.

Without a valid profile-matched origin, Start captures the current position using
the existing EM/CS origin operation and records it as automatic. Explicit Set
origin uses the same operation and records it as explicit. Origin is never loaded
from storage. Engage motors is a no-op when a valid origin or an engaged session
is already known, avoiding counter resets. Release, disconnect, profile changes,
and failures invalidate the reference. Successful jobs release motors and
invalidate it as well.

## Pen state and servo timing

The plotting process is compiled in full before hardware preparation for both
Direct USB and the Node runner. `compilePlotProcess` validates a private plan
snapshot, including startup Up, pen settling durations, final Up and the requested
origin return. It rejects excessive commands and firmware integer/rate limits
before hardware moves. `executePlotProcess` queues continuous XY sections and
waits before and after pen transitions. Pause/Stop are serviced at planned rest
boundaries; cancellation uses ES without returning from an uncertain position.

`ebb-pen.ts` owns EBB pen configuration and movement. Before the first SP, it
configures the calibrated Up and Down pulses using SC,4 and SC,5, separate rates
using SC,11 and SC,12, and the 24 ms PWM period with SC,8,8 and SC,9,3. It does not
send SC,1, whose implicit state replay could move to an old target. Pen movements
use SP,1 (Up) and SP,0 (Down), with Port B pin 1: the same physical RB1 output
formerly addressed as RP4 by S2. No S2, TP or LM is used for normal plotting.

Percentage calibration remains `round(28000 - 20500 * percent / 100)`. The
default raising and lowering rates are 1845 and 1230 PWM units per cycle, corresponding
to 75% and 50% rates with a 200 ms full-range sweep. Rates are independently adjustable
from 1–100%; SC increments are rounded from `24.6 * rate`. Raising and lowering have
separate timing estimates. `penTransition` combines mechanical time
`45 + 2.69 * distancePercent` and rate-limited sweep time with a fourth-power norm,
rounded upward to integer milliseconds. Independent extra Up/Down delays are adjustable
from -500 to 10000 ms; resulting total is at least 1 ms. The defaults are Up 150 ms
and Down 0 ms, including startup and forced origin returns. Reload lifts add an
optional 0–10000 ms extra raised wait before the next down transition. Unknown
startup uses a full-range bound. All these durations are in the shared plan.
This is an estimate from the reviewed Python policy, not a contact measurement.
Simulation uses these same event durations.

SP's delay begins with the servo move and blocks subsequent queued motion. The
host overlaps this with a wait of duration minus 30 ms for transitions over
50 ms, following the Python feeder. The idle barrier then enforces the remaining
SP allowance on the host and checks the board's QG/QM status. Thus an early idle
reply cannot remove the configured pen wait. Neither ACK nor QG senses contact.

Every job forces an Up at origin, regardless of cached or manually adjusted
height. Every manual or interrupted-job origin return also forces Up and waits
before XY. Manual intermediate heights temporarily configure the Down endpoint;
the next plot transition restores the configured calibration before SP.

Every physical job, including a bounding-box preview, first removes old motor
commands with ES, then waits for remaining servo commands to drain while the
carriage is stationary. EBB 2.8.1 ES does not remove servo commands. Host pen,
power, motion-duration and setup caches are cleared. The working servo PWM and
GPIO configuration is preserved: startup does not send R or RB. SC,2,0 selects
the internal motor drivers; both
calibrated heights, both servo rates, and the 8 × 3 ms PWM schedule are reapplied
before servo power is enabled. EM,2,2 and CS establish the motor configuration and
counter reference when no valid origin is available. An existing idle origin and
its counters are preserved. The first planned Up receives its full settling
allowance before any travel.
Interrupted old motion invalidates the old reference, so the current carriage
location is established as the automatic origin, as for a fresh connection.
No factory calibration replaces the document's settings. Startup stages are
recorded in the machine log. Rejected purge/setup commands prevent drawing.

An unexpected stale OK before ES status triggers a V synchronization marker and
still requires the actual ES status/terminator and matching firmware reply.
An OK alone never establishes that the queue was purged.

This compatibility behavior was verified against the
[tagged 2.8.1 ES implementation](https://github.com/evil-mad/EggBot/blob/343eefb9daff49ca872dceb28bd94015f123489d/EBB_firmware/app.X/source/ebb.c)
and [its reset/servo timer initialization](https://github.com/evil-mad/EggBot/blob/343eefb9daff49ca872dceb28bd94015f123489d/EBB_firmware/app.X/source/UBW.c).
The newer 3.x firmware flushes more command types; test fixtures must not assume
that behavior for a 2.8.1 machine.

On firmware 2.6.0+, SR,0,1 holds power through plotting and pauses. A forced SP
clears the old idle countdown. After the final Up settles, SR,60000,0 powers down
the servo, followed by EM,0,0 to release motors. Older firmware receives no SR.

References used for behavior review: [EBB command documentation](https://evil-mad.github.io/EggBot/ebb2.html),
[AxiDraw pen handling](https://github.com/evil-mad/axidraw/blob/a0df054f41f8e3ae8d408e08e7b2656968e375f1/inkscape%20driver/pen_handling.py),
and [Python command feeder](https://github.com/evil-mad/axidraw/blob/a0df054f41f8e3ae8d408e08e7b2656968e375f1/inkscape%20driver/dripfeed.py).
The original TypeScript implementation vendors neither Python nor Saxi source.
Plot-it's existing application license remains unchanged.

Simulation and hardware emit `PlotSignal` objects using the same plan event
indices, positions, target coordinates, pen state/height, tool and cumulative
up/down counts. Simulation emits every crossed event even when a fast frame
skips a stroke. Hardware distinguishes started, queued and queue-settled phases;
its elapsed milliseconds include real waits. Compare settled signals by
`eventIndex` and `planTime`, rather than matching wall-clock times or inferring
pen changes from XY coordinates. The live marker updates at the start of a pen transition; its settled signal
still means the configured wait and queue checks have completed.

The paper SVG dispatches `plot-execution-signal` CustomEvents for either mode:

```js
paper.addEventListener('plot-execution-signal', ({ detail }) => {
  console.log(detail.source, detail.eventIndex, detail.phase,
    detail.position, detail.penDown, detail.penCounts);
});
```

Simulation displays cumulative Pen up/Pen down counts, current X/Y coordinates
and pen state above the top-left corner of the paper, outside the plotted SVG.
Scrubbing recomputes counts from the plan; Stop resets them, and Replay starts
a new count. The initial raise counts as an up event.

**Pen heights → Download machine log** exports format version 4. It includes
frozen settings, the full plan, a separate execution signal journal, and serial
exchanges with requested/written/received/acknowledged/failed phases. The signal
journal preserves the first 1,000 entries and recent tail when its 20,000-entry
limit is reached, with explicit `droppedSignals`. Serial history has its own
20,000-entry bound and `droppedEntries`; the recent 500-entry log and dedicated
200-entry pen journal remain available. Neither journal claims sensed contact.
History survives disconnect until a new job replaces it.

The Node runner coalesces live XY telemetry to keep short motion blocks free
of socket work. Its complete retained diagnostics are exported through HTTP
after execution, rather than truncated to fit the 64 KiB control frame.

## Connection recovery

Connect uses the existing EBB USB filter and 9600 baud. The board is only
considered connected after a valid firmware identification, with a five-second
handshake timeout. Both `EBB Firmware Version …` and the observed legacy
`EBBv13_and_above EB Firmware Version …` formats are accepted.
Failed handshakes cancel the pending read, release stream locks and close the
port. USB removal clears the connection and origin. Disconnect is available
only while idle. Connection sends only `V`, without changing pen or motor state.

If the board appears in the browser picker but cannot open, close Saxi or any
other app/browser tab using it. On macOS, `lsof /dev/cu.usbmodem* /dev/tty.usbmodem*`
can identify another process holding the serial port. Plot-it cannot inspect or
stop external processes from the browser.

## Supply and placement checks

QC is supported from firmware 2.2.3. Legacy responses contain two ADC values
followed by OK; future mode prefixes QC and has no OK. The raw 10-bit supply
value is reported, without assuming a hardware divider revision. The reviewed
Plotink threshold is 250: lower values block job startup before any motion.
Checks occur on connection, at startup, and approximately every two seconds
between serial motion commands or at stationary boundaries. They never compete
with feeding on a separate timer. A low supply during execution uses the
existing ES/cancel cleanup, invalidates origin and avoids a home move. Unsupported
or malformed readings are shown as unavailable. Idle users can explicitly check
the supply; there is no separate idle background poll.

Bounding-box preview compiles the extents of all prepared pen-down XY paths
into a single raised-pen perimeter, with travel acceleration/speed and a mandatory
origin return. Normal stop/pause/cleanup and USB/network control ownership apply.
See [plot controls](PLOT_CONTROLS.md) for settings and statistics.
