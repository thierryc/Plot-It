# Plot workspace

`PlotWorkspace` owns a single sidebar session. Editing controls are inert while
it is open, but canvas zoom and scrolling remain usable. The editor DOM and
selection are restored on exit. The browser's USB picker is the sole unavoidable
connection dialog; connecting only identifies the firmware.

The top-right **Edit / Plot** segmented control shows the selected workspace.
**Plot** enters this workspace and **Edit** returns to the editing inspector.
It does not start plotting. Execution starts
from the sidebar player; Edit is disabled while hardware or manual motion is busy.

## Job snapshot

`prepareJob` captures paper, settings, and pen preferences. It waits for generated
fills, samples the source drawing, and resolves CSS paints to canonical uppercase
RGB before sending geometry to the planning worker. No assignment modifies the
source SVG. Revision checks reject obsolete results, cancellation terminates the
worker, and only a completed current plan can start.

Starting preparation clears the previous plan immediately. Worker startup,
runtime, message-decoding, and invalid-response failures settle the job and clean
up the worker. The sidebar retains available error details and offers Prepare
again; a failed plan is not presented as empty artwork.

The worker clips paths, discovers available pens, filters excluded source colors,
applies assignments, schedules blocks, splits long lines, and compiles motion.
With Group by pen, a protected source block is ranked by its first retained
assigned pen. Its internal sequence and directions stay intact, even if they
introduce repeated passes. Ordinary paths are ranked by pen then optimized within
that rank. Source-order mode keeps the filtered drawing sequence unchanged.

`MotionPlan.passes` records contiguous assigned-pen runs using event indices and
motion times. Every tool transition includes pen-up travel to origin before the
zero-duration tool event. Thus simulation, hardware, pass labels, and estimates
share one schedule. Final return is independently configurable. Manual pen-change
waiting time is absent from the motion estimate.

Advanced **Machine orientation** uses the confirmed 90° clockwise mapping as
**Standard** for AxiDraw and Xylodraw: canvas `(x, y)` becomes machine `(-y, x)`.
The other choices rotate relative to Standard. All rotations use the physical
origin and change only hardware coordinates; editing, exports, simulation
geometry, and motion times remain unchanged. Both LM and XM use the same
transform and track machine-space step targets. QS feedback uses the inverse
transform, and fallback returns negate the actual machine-space steps.

Orientation values remain absolute in storage: Standard is 90, an additional
clockwise quarter-turn is 180, a half-turn is 270, and an additional
counterclockwise quarter-turn is 0. `machineOrientationVersion: 2` marks the new
convention. Loading older documents upgrades the former 0-degree Standard,
missing settings, and invalid values to 90, while preserving existing 90, 180,
or 270 corrections. New explicit 0-degree choices remain 0 on subsequent loads.

## Persistence and execution

Optional `AppState.pens` stores assignments by canonical source color, excluded
source colors, ordered assigned colors, and group/source mode. Old documents use
identity assignments, all pens, and first-appearance grouping. Old false
pauseOnToolChange settings are ignored; all different pens require a wait.
Connection, origin provenance, and execution progress are session-only.

Simulation's clock emits running, paused, tool-change, stopped, and finished
snapshots. The workspace owns its drawing and transport. Hardware position
tracking owns only visualization; sidebar updates preserve playback focus rather
than rebuilding controls every frame. Destination and setup are frozen during
playback. Stop can interrupt a pen-change wait, and hardware Back waits for
cleanup. Transport failure requires a fresh prepared job and explicit Start.

Stop returns to origin before releasing the motors. Completion honors the saved
final-return preference, settles the pen lift and all motion, then releases.
Terminal progress is reported only after the board acknowledges motor release.
Release invalidates the origin, so each subsequent Start captures the current
carriage position. Pause and pen-change waits retain motor engagement for
alignment. Disconnect also releases an engaged idle machine before closing USB.
Execution errors attempt release without claiming a successful return; rejected
release keeps the motor status engaged and surfaces an error.

The serial tests use mocked EBB streams and never select a real USB port. A local
EBB 2.8.1 pen-up axis check is recorded separately; physical acceptance of the
whole workflow still requires checks of pause, pen swaps, and Stop on the intended
machine.
