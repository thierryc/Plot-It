# EBB-first implementation notes

Plot-it's first machine backend targets EBB-based AxiDraw and Xylodraw devices directly from Chrome through Web Serial. The serial transport is implemented locally; the acceleration planner and rate calculations adapt the pinned Saxi source under AGPL-3.0-only.

## Protocol boundary

- Serial transport: 9600 baud, CR-terminated commands.
- `V`: identify and parse the firmware version.
- `EM,2,2`: enable both motors in 1/8-step mode.
- `XM,duration,xSteps,ySteps`: mixed-axis movement for AxiDraw/CoreXY-style geometry.
- `S2,position,4,rate,delay`: queued pen-servo movement.
- `QG`: idle/FIFO status on firmware 2.6.2 and newer.
- `QM`: compatibility fallback for older firmware.
- `ES,1`: immediate stop, FIFO flush, and motor disable.
- `EM,0,0`: release motors after Stop, completion, cancellation/errors, or an explicit release request. Disconnect releases an engaged idle machine before closing the port.

EBB v3 introduced an optional future response syntax. Command handling accepts both legacy `OK` responses and future command-name responses. `QG` replaces the now-deprecated `QM` query where the firmware supports it.

## Geometry and precision

The editor and plot plan use millimetres. AxiDraw uses 5 full steps/mm and Xylodraw uses 6.25 full steps/mm. With `EM` mode 2, those become 40 and 50 microsteps/mm respectively.

Standard machine orientation uses the confirmed 90° clockwise mapping for both
profiles: canvas `(x, y)` maps to mixed machine axes `(-y, x)`. LM converts those
machine deltas to motor steps using their sum and difference; XM receives the
same mixed-axis deltas directly. Position feedback applies the inverse mapping
so the canvas remains in artwork coordinates. Orientation overrides in Advanced
are rotations relative to this Standard. Origin returns use machine-space steps
or EBB HM, so they do not apply the rotation a second time.

Every move is quantized from its absolute millimetre target rather than independently rounding each delta. The emitted step delta is:

```text
round(machine_target_mm × steps_per_mm) − current_integer_step_position
```

This prevents sub-step rounding error from accumulating and guarantees that a normal return to `(0, 0)` also targets the exact starting step position.

## Plot preparation

1. Convert supported SVG geometry to sampled paths in page millimetres.
2. Clip every segment to the configured paper safe margin.
3. Normalize effective stroke/fill colors, apply plot-only pen assignments, and filter selected pens. Group eligible blocks by assigned pen rank, keeping protected PlotFont blocks intact.
4. Reorder only within a tool group using one of three modes:
   - preserve SVG order;
   - greedy nearest path;
   - greedy nearest endpoint with path reversal.
5. Optionally split continuous pen-down paths at an exact maximum length.
6. Before each subsequent different pen, raise the pen, plan travel back to origin, and wait for Continue. Explicit Start authorizes the first pen.
7. Plot through queued `LM` (or sampled `XM` for older firmware) and `S2` commands.
8. On normal completion, optionally return to step origin, raise the pen, wait for idle, then release motors. Report Complete only after the release acknowledgement.
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

The motion queue now consumes the same MotionPlan as simulation. Firmware
2.5.3+ uses LM; older firmware samples acceleration blocks into XM moves at
up to 15ms per move. Quantization uses absolute integer endpoints to carry
substep error across blocks. Tool changes and pauses drain queued motion first.

Machine controls use S2 for pen height (percent mapped to the existing servo
range), EM,0,0 for motor release, and EM,2,2 plus CS for origin capture (CS requires
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

The standard RC servo is initialized on first use, without moving it on
connection. `SC,1,1` itself queues a servo movement using the firmware's previous
pen state. Before sending it, both endpoints temporarily use the requested
height and `SC,10` sets its controlled rate. Thus neither previous state can
replay an old extreme target. Afterward, calibrated up/down endpoints and rates
are restored (`SC,4`/`SC,5`, `SC,11`/`SC,12`). The following explicit S2 supplies
the settling delay. Eight PWM slots (`SC,8,8`) and three milliseconds per slot
(`SC,9,3`) select the standard servo period. The existing
percentage mapping remains `round(28000 - 20500 * percent / 100)` on RP4.
Settings edits update the controller's configuration before manual tests or
disconnect. Changing configuration invalidates cached targets.

`pen-control.ts` supplies controlled S2 rates and transition times for both
planning and execution. The wait covers the PWM ramp plus a conservative
mechanical estimate, with a 120 ms floor. An unknown starting position uses a
full-range allowance. Requested, acknowledged, and queue-settled targets are
tracked separately; none is a physical sensor measurement. Repeated planned and direct-USB targets
are suppressed until disconnect, a transport failure, emergency stop, changed
configuration, or an idle servo power timeout invalidates the cache.

On firmware 2.6.0+, `SR,0,1` explicitly powers the servo on; an explicit up-target refresh clears any live
countdown left by the previous job or manual test. This holds servo power
throughout execution, ordinary pauses and pen changes. Cleanup restores
`SR,60000`, then sends an unchanged
up target with zero delay to refresh the countdown: SR alone changes only its
reload value. This refresh does not move an already lifted pen. Motors are
released only after motion and the lift settle. Older firmware does not receive
SR. Server pen tests explicitly enable power and resend the target, even if
its last acknowledged value matches, so a retry after Stop does not depend on
a cached position or assumed power state. Idle tests carry the current pen
calibration to the runner; paused tests retain the active job calibration.
Stepper motor release and servo power-off are distinct operations.

The shared planner omits paths that produce no integer drawing steps before
deriving pen passes. Adjacent ordinary paths with the same pen and width join
at matching endpoints; protected blocks and deliberate continuous-line splits
retain their lifts.

**Pen heights & tests → Download machine log** exports the last 500 diagnostic
entries, including monotonic timestamps in milliseconds, commands, transition
reasons, event indices, job states, target percentages and acknowledgment/failure
phases. A separate 200-entry pen/control journal retains height commands and
failures even when a long stroke evicts them from the general motion history.
The export includes configured up/down heights. History is session-only and
survives disconnect for troubleshooting.

Machine-log version 3 also captures the latest job and subsequent diagnostics,
up to 20,000 entries. A batch-trimmed log reports `droppedEntries` explicitly.
The capture begins automatically on Start and records frozen settings, firmware,
estimated duration and planned pen-event indices. Each serial exchange has a
monotonically increasing `commandId`, with separate `requested`, `written`,
`received` and `acknowledged`/`failed` phases. `written` means the USB writer
completed; it does not prove physical execution. `received` includes each actual
normalized response line, including legacy QS/ES terminators. Commands are sent
with a carriage-return terminator. `elapsedMs` is real elapsed time since job
start, including waits; planned event `start` times are estimated seconds.
Failures retain their error text. The short histories remain available alongside
the larger capture, and the pen/control journal survives motion-history trimming.

**Mark unexpected pen movement** adds an operator observation timestamp to the
log without sending a command. For a physical investigation, remove the pen,
place the carriage at the intended origin, then replay the same artwork and
settings. Mark any visible unexpected lift/lower and download the machine log
before refreshing the page. Match that observation to S2/SC/SR commands and QS/QG
replies. Absence of a matching servo command is evidence to investigate power,
PWM and mechanics; it is not, by itself, proof of a hardware fault.

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
