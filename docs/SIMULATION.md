# Simulation and positioning

The pinned Saxi algorithm models constant acceleration with triangular or
trapezoidal speed profiles and corner velocity constraints. The planner operates
in millimeters; motor encoding scales to 40 microsteps/mm (AxiDraw) or 50
(XylowDraw) at eighth-step resolution. Both machines use the EBB backend.

The canvas animation samples the shared physical plan, not serial acknowledgments.
Timing is estimated: integer step/rate rounding, sampled XM fallback, servo
variation, queue starvation, USB latency and mechanical slip can affect hardware.
A perfect physical EBB/machine emulator is not claimed.

Pen transitions use the same calibrated travel-dependent timing as execution;
the initial lift conservatively assumes an unknown pen height. Geometry below
machine step resolution is omitted before deriving passes, and touching ordinary
same-pen paths may share a continuous stroke. Protected operations and deliberate
line splits retain their lifts. Pen transitions and initial lift delays are included; manual tool-change waiting
is excluded. Playback pauses at color changes. Scrubbing acknowledges earlier
color-change stops and pauses playback. Restart resets all stops. Completed
strokes and pen-up travel are temporary overlays; serialization reads artwork
items only. Editing is frozen during simulation and restored on exit.

Connection, errors, cancellation, motor release, and profile changes invalidate
the origin. The next explicit Start captures the current carriage position, or
you can explicitly use Set origin beforehand. Positioning the carriage by hand while motors are
engaged also requires setting origin again: no software can detect that movement.
Hardware Pause takes effect at the next planned rest boundary, drains the queue,
lifts the pen, and holds XY. Every different assigned pen parks at origin and
waits for Continue; that travel is included in the shared motion plan.
Hardware completion and Stop release motors after the pen lift and motion settle,
invalidating the reference. The next Start captures the current position again.
Pause and pen-change waits keep motors engaged to preserve job alignment.
Return to origin raises the pen before moving.

Tests cover analytical timing, pinned planner blocks, degenerate geometry,
rounding, firmware command selection, serial transport, pause/tool-change drains,
cancellation, servo percentages, origin capture, home and release. Real machines
have not been exercised; use conservative settings for the first physical run.
