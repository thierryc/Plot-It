# Pen-control review — 2 October 2026

This is a review, without application-code changes or commands to the physical
plotter. The reference is Evil Mad Scientist's public AxiDraw/Inkscape driver
and EBB firmware. A separate repository called “MadEvil CIPS” has not been
identified; that comparison remains conditional on the intended reference.

## Reproduced findings

### P1: Resume can lower the pen without any drawing to resume

[plotter.ts](/Users/thierryc/Dev/Plot-It/src/plotter.ts:228)

`waitWhilePaused()` lifts to `currentPenUp`, then always restores `plannedPen`
after Resume. `plannedPen` describes the preceding event, not what the next
event needs. If Pause lands after the last XY block of a stroke and before its
planned lift, the remembered state is down. Resume lowers the pen at that
stroke's endpoint, then the next event immediately lifts it. There is no XY
motion between those two commands; this can leave a dot or briefly press the
paper. Which boundary catches the pause depends on timing, explaining why the
symptom can be intermittent.

Actual command sequence from the unchanged executor with a simulated EBB:

```text
... last drawing LM command ...
Pause requested
S2,17750,4,0,120  # lift
Paused / Resume
S2,15700,4,0,120  # restore down
S2,17750,4,0,120  # immediately execute the planned lift
S2,17750,4,0,120  # final cleanup lift
EM,0,0
```

Recommendation: restore the down state only when the next operation actually
continues drawing. Let pending pen transitions execute directly. Preserve the
restoration needed when pausing midway through a stroke, and manual adjustment
serialization. Stop must still prevent any subsequent lowering.

### P2: Tiny paths lower the pen even when quantization removes every draw move

[motion-plan.ts](/Users/thierryc/Dev/Plot-It/src/motion-plan.ts:46)
and [compileMotion](/Users/thierryc/Dev/Plot-It/src/motion-plan.ts:88)

The planner inserts down/up around each path before checking whether its
geometry yields any hardware steps. LM compilation later removes zero-step
moves independently, leaving their pen events intact.

Reproduction through the normal pen preparation and clipping code: a black
path from `(20,20)` to `(20.001,20)` mm survives preparation and creates one
pass. It produces zero drawing LM commands but still commands down and up at
the starting point. A path containing two identical points can similarly
produce a pass with only pen events.

Recommendation: filter geometry with no executable draw movement before
deriving passes and pen events. Preserve cumulative rounding across valid
paths and consider both LM and XM. This should be reflected in the shared
preview/simulation plan, rather than patched only in the hardware executor.

### P2: Disconnect can use a stale pen-up height

[disconnect](/Users/thierryc/Dev/Plot-It/src/plotter.ts:150),
[setPen](/Users/thierryc/Dev/Plot-It/src/plotter.ts:321), and
[plot initialization](/Users/thierryc/Dev/Plot-It/src/plotter.ts:391)

Disconnect lifts using `currentPenUp`, which is initialized to 50 and updated
only when a plot starts. Editing the pen-up setting and testing that height do
not update this field. With motors engaged, Disconnect can therefore command
an old height rather than the current configured up position.

Reproduction: engage motors, test up at 70%, disconnect. The servo targets are
`13650` (70%) and then `17750` (stale 50%), followed by `EM,0,0`.

Recommendation: use one current pen configuration for manual tests, disconnect,
release, and execution. Keep the immutable job's settings frozen during a job;
do not accidentally replace them with changing editor preferences.

## Additional sources of visible movement

| Situation | Current implementation | Assessment |
| --- | --- | --- |
| Touching ordinary paths using the same pen | Unconditional lift then lower at their shared endpoint | Reproduced. Possible optimization, rather than necessarily a bug: protected operations and deliberately split lines may require lifts. |
| Maximum continuous line greater than zero | Splits paths, introducing a down/up pair per piece | Intentional behavior of this setting; can resemble unexplained movement. Default is zero. |
| Pen tests during a settled pause | Manual buttons remain enabled and send real servo commands | Explicitly supported. Resume then restores the job state, so a manual height can be overridden. |
| Starting, homing, pen changes, completion, release | Several unconditional lift commands, with no remembered confirmed target | Repeated equal targets do not by themselves explain a full up/down cycle. They can reapply servo power after a timeout. |
| Large lift/lower changes | Raw target jump with rate zero and normally 120 ms delay | Timing/configuration concern; mechanical settling is not measured by the idle query. |
| Long pauses or continuous strokes | No explicit servo-power timeout policy | Power-off/re-power is a hardware-dependent hypothesis, not reproduced physical twitching. |

The UI input/change handlers update settings and prepare the preview; they do
not themselves call `setPen`. Simulation playback and canvas overlay updates
do not write serial commands. The physical servo commands converge on the
private `pen()` method, called by playback, pause/resume, manual tests,
home/release/disconnect, and cleanup.

## Comparison with Evil Mad Scientist

The [AxiDraw pen handler](https://github.com/evil-mad/axidraw/blob/master/inkscape%20driver/pen_handling.py)
tracks pen state, suppresses repeated raises/lowers, calculates transition
duration from travel and rates, and initializes servo configuration.
[Plotink](https://github.com/evil-mad/plotink/blob/master/plotink/ebb_motion.py)
sends configured `SP` up/down commands. Plot-it uses raw `S2` targets and lacks
equivalent state/configuration management.

The [AxiDraw configuration](https://github.com/evil-mad/axidraw/blob/master/inkscape%20driver/axidraw_conf.py)
also distinguishes standard and narrow-band servos. Plot-it currently uses a
fixed standard-servo pin/range and its inherited Saxi percentage direction.
Its percentages are not interchangeable with AxiDraw's. Changing that mapping
would require preserving or migrating existing physical target positions.

According to the [EBB protocol](https://evil-mad.github.io/EggBot/ebb.html#S2),
S2 is queued and rate zero jumps the target on the next PWM cycle. The
[SR command](https://evil-mad.github.io/EggBot/ebb.html#SR) normally powers off
the standard servo after 60 seconds without a servo command. A later command
can power it again. Actual behavior depends on board version and retained
configuration. [QG](https://evil-mad.github.io/EggBot/ebb.html#QG) reports command
execution, not measured mechanical settling. Plot-it correctly masks its low
four bits to drain the motion queue; that does not prove the pen has physically
reached its target.

Raw S2 is a valid protocol choice. Replacing it with SP alone would not fix
the Resume or tiny-path cases; target state, configuration, and timing still
need to be coordinated.

## Recommended implementation order

1. Add regression coverage for Resume immediately before a lift, sub-step
   geometry, and edited up height followed by Disconnect. Fix those cases.
2. Centralize pen configuration and last confirmed target. Invalidate that
   knowledge on disconnect, failures, configuration changes, and power loss.
   Keep requested, acknowledged, and settled states distinct; there is no
   physical pen-height sensor to confirm position.
3. Initialize a supported servo profile deliberately. Use controlled rates
   and calculated settling durations in both the motion plan and executor.
4. Optimize joins only where path semantics allow. Retain required color
   stops, protected operations, and deliberate continuous-line limits.
5. Add a bounded diagnostic trace recording command, reason, job event,
   requested/acknowledged time, and pause/stop state. If movement occurs during
   a truly idle interval with no servo command, examine power, PWM setup,
   wiring, supply, and the servo mechanically.

Separately, command/query reads after connection have no response deadline.
The 500-attempt idle loop cannot bound a single silent read. A transport stall
can therefore prevent cleanup and motor release from completing; this should
receive a regression test and recovery design during the controller work.

## Initial review verification (before changes)

All 279 existing tests pass across 27 files. Temporary probes used the actual
planner and executor with a simulated Web Serial EBB; no production source was
modified. The EBB mocks normally return idle immediately and do not model
servo travel, PWM, power-off, or mechanical bounce. The reproduced findings
prove unnecessary target commands, not the cause of every physical twitch.
Hardware acceptance should correlate the physical symptom with a command
trace before changing servo calibration or timing.

## Implemented fixes and retest — 2026-10-02

The five pen-control recommendations above are implemented. Resume follows the
next operation instead of restoring a previous down state before a pending
lift. Quantization-empty paths are removed before deriving passes. Plot setup,
manual controls, release and disconnect share the latest calibrated heights.
A centralized target state suppresses redundant transitions and invalidates
its knowledge after configuration changes, disconnect, failures, emergency
stop and idle power expiry.

Planning and execution share travel-dependent, controlled-rate standard-servo
timing while preserving the existing physical percentage mapping. Firmware
2.6.0+ holds servo power during a job (including pauses), then restores the idle
timeout with an unchanged up-target refresh before releasing motors. Matching
ordinary path endpoints join; protected sequences, pen changes and deliberate
line splits retain their lifts. A bounded session trace is downloadable from
Pen heights & tests.

`npm test`: **306 tests pass across 28 files**, including **27 added
regressions**. Tests cover Resume before a lift and before drawing, Stop without
lowering, tiny geometry, protected joins, changed calibration and disconnect,
reconnect, rejected commands, delayed idle status, long-pause power policy,
shared large-travel timing, trace bounds, and sidebar integration. `npm run
build` passes. The build retains its existing large-chunk and HarfBuzz browser
externalization warnings.

These are software and mock-EBB checks, not a physical acceptance test. A real
run is still needed to verify servo travel, clearance, PWM behavior and supply
stability. The separate silent serial-read deadline/recovery issue noted above
remains open; these pen-transition fixes do not solve an unresponsive transport.

## Follow-up: full down/up movement during uninterrupted drawing

The physical report is not reproduced by the uninterrupted-stroke executor test:
over 100 drawing commands are sent with no intervening S2, SC, SR, SP or TP.
That is not proof that the physical symptom is resolved. Correlating the movement
with the actual job's machine log remains necessary.

Two additional firmware-side bugs in the preceding implementation were reproduced
with command side effects modeled, rather than an OK-only mock:

- `SC,1,1` calls `process_SP(PenState,0)` in the
  [EBB firmware](https://github.com/evil-mad/EggBot/blob/master/EBB_firmware/app.X/source/ebb.c).
  Previously it ran before setting calibrated endpoints, replaying any stored
  endpoint, including an extreme. Setup now temporarily sets both endpoints to
  the requested target with a controlled rate before enabling servo mode, then
  restores calibrated endpoints. The explicit S2 supplies the settling delay.
- `SR,0` updates the reload but does not clear an existing live countdown. With a
  cached up target, a long pause during origin preparation could therefore still
  lose power. Job setup now explicitly refreshes the up target after SR,0 even
  when the height itself has not changed.

These cases happen during setup/preflight, not halfway through an uninterrupted
stroke, so neither is asserted as the cause of the reported mid-stroke incident.
The download now retains a separate bounded pen/control journal so long motion
streams cannot erase the relevant transition commands. Four further regressions
pass; total **310 tests across 28 files**, and production build passes. No
physical motion was commanded by this investigation.


## Server pen controls and USB handoff — October 4, 2026

The reported server failures led to test-first fixes for these reproduced
software gaps:

- Edited manual-test calibration stayed in the browser. Server pen requests
  now carry it, and the idle runner applies it before issuing S2. Active plans
  retain their own calibration during settled pauses and pen changes.
- Capability changes after cleanup did not refresh idle frontend controls.
  Authoritative snapshots now refresh pen, origin and motor availability.
- Validation errors could lose the request ID and appear as a timeout. The API
  and runner preserve a valid ID before validation, returning an immediate
  matching error.
- Shutdown could close USB during a manual servo operation. The runner now
  waits for its settling and cleanup before closing the serial connection.

Firmware 2.6+ receives the explicit SR power-on state for job setup and server
pen tests. Server test buttons resend S2 even when the cached target matches;
planned and direct-USB transition deduplication remains in place. This makes
server retries independent of an assumed cached position/power state. See the
[primary SR command reference](https://evil-mad.github.io/EggBot/ebb2.html#SR).

The existing stopped-job trace already contained acknowledged down/up S2
commands, so it does not establish the cause of missing physical motion. Real
Chrome server pen-only commands were also acknowledged at the saved 1%/52%
heights. The requested follow-up calibration is 30%/52%; physical clearance
and pen contact still require visual observation. No encoder feedback exists.

The updated runner starts with USB free in manual mode. Real USB firmware
tests and live HTTP/WebSocket tests passed. Chrome successfully switched to
Direct USB after the front end explicitly released server USB and then started
a user-initiated drawing. Dedicated Pi services can opt into automatic
connection; intentional USB release suspends reconnect in either policy.
