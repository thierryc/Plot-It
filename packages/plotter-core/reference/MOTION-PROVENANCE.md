# Motion and pen model sources

The constant-acceleration planner in `../src/planner.ts` and the junction equation
in `../src/junction.ts` adapt the `triangle`, `trapezoid`, and `corner_velocity`
mathematics from Michael Fogleman's axi `axi/planner.py`, revision
`a5a12f01633076232be84a4e3321c80c7b9656b5`, copyright 2017 Michael Fogleman (MIT).
The full permission notice is [AXI-LICENSE](AXI-LICENSE).

Preserved local input SHA-256 values:

- `axi/planner.py`: `496a6b6aed6ac49c9816180a150521d7380a79eb6dcf7da2d73d39aebdc1555d`
- `LICENSE.md`: `d0e3d214cf65baa8a4b376c2f8c5712fbe45e640b8b533d90e7a8697f97e2375`

The adaptation uses two bounded reachability passes, rejects infeasible fixed boundary speeds, retains source-edge indices through duplicate compaction and compiles separately. The axi throttler, sampling tuning and backtracking implementation are not used.

The nominal contract is `v1² <= v0² + 2*a*d`, followed by analytical triangular
or trapezoidal phases. `constant` denotes a target cruising speed with the same
bounded starts, stops and corners. A zero cornering parameter stops at every
retained vertex. Nonzero corner velocity approximates a polyline corner; it does
not bound instantaneous physical vector acceleration at that corner.

Source-collinear samples may be compacted when cornering is enabled, using the
existing numerical cross-product threshold (`1e-10` relative to edge lengths).
This preserves the dense straight-line behavior contract; cornering zero retains
every stop vertex. It is a floating-point collinearity policy, not a general
curve simplification or permission to relax the corpus geometry tolerance.
Triangular profiles have exactly zero cruise; analytical branch selection avoids
turning floating subtraction residue into fictitious one-millisecond waits.

SM sampling uses a maximum nominal interval of 25 ms, never crosses a phase or
source vertex, preserves zero-step time and final native endpoints, and rounds
durations upward as necessary to meet both the scalar speed and native rate
limits. This retains the existing interval as an explicit compiler throughput
choice, not a short-move motion policy. Native quantization error is checked
against `sqrt(2)/stepsPerMm` in the independent corpus. Nominal acceleration
bounds and piecewise-constant SM command limits are separate contracts; SM does
not provide continuous acceleration. Unsupported sub-minimum native rates are
rejected rather than exceeding the requested scalar speed.

The retained S-curve uses the same attributed junction equation. Its transition
time is `2*sqrt(dv/j)` below the acceleration plateau, otherwise `dv/a+a/j`;
distance is mean endpoint speed times transition time. Cubic phases integrate
constant jerk. The existing T3 quantizer changes phase rates to reach exact motor
endpoints and may extend duration to respect speed. Plotink MIT discrete math and
NextDraw MIT homing remain separately attributed in their existing source headers
and notices. Tests use independently specified geometry, equations and protocol
constraints.


## Pen electrical timing and lifecycle

`ebb-pulse-v1` uses the integer calibration endpoints and rounded `SC,11/12` rates
actually sent to the controller. Rates are pulse timer counts per refresh. With
refresh `P = channels * slotMs`, known pulse delta `D`, and positive rounded rate
`R`, `ceil(D/R)` target updates plus one refresh guard bound the end of the final
target pulse. The firmware updates the pulse before emitting that cycle. A pulse
width is at most its slot duration; therefore final completion is no later than
`ceil(D/R)*P + pulseWidth <= (ceil(D/R)+1)*P`. The supported profile contract
restricts slot duration to 1–6 ms, pulses to `1..min(65535, slotMs*12000)`, known
deltas to at most 32767, and rates to at most 32767. This is not an assertion that
every unsigned-16-bit pulse/rate combination is monotone in the firmware.

A rounded zero rate is an immediate target update on the next refresh, with one
additional refresh guard. A confirmed unchanged energized pulse requires no new
electrical travel. Unknown, expired, released, disconnected or reconfigured state
is different: after draining, the feeder disables the supported pen outputs RP4
and RP5, configures SC endpoints/rates/slots, then lets SP initialize directly at
target. Clearing boot's RP4 and the prior RP5 ownership before shrinking SC8
avoids allocating a brushless output outside its single active slot. Unknown
startup does not pretend its old pulse was between today's selected Up/Down
values. Startup signaling requires physical acceptance.

The explicit profile rate scales define the effective commands across all
integer rate settings: 24.6 for AxiDraw/XyloDraw, 21.5712 for standard NextDraw,
and 3.085714285714286 for brushless NextDraw. These are electrical compatibility
mappings, not measured servo sweep times. These scales are not a mechanical response model.

The selected profile allowances are 100 ms after raising, 100 ms after lowering,
and an additional 250 ms for unknown startup. These are **provisional engineering
choices**, not measured calibration and not a guarantee of paper contact or
mechanical completion. User extra settling and reload waits are nonnegative and
added independently; total duration is the maximum of the prepared/requested
minimum and the full electrical + settling + startup + reload sum. Values beyond
the queue duration range are rejected. A runtime recovery that needs longer emits
a `timing-extension` session event; it does not remove the reload allowance or
silently start XY early. Host deadlines start before SP dispatch and are checked
together with controller idle/PEN status, without adding the entire dwell twice.

The retained 120 ms manual minimum and 100 ms after travel of at least 50 mm are
separate existing operator/travel policies. Neither is presented as calibration
of the new electrical model. Extra waiting never changes SC rate.

The standard RB1 power timer is armed by SP/S2, not by SR alone. Manual commands
set a finite SR reload before SP, extending very short requested timeouts to at
least transition duration plus one refresh. If this exceeds 65535 ms the operation
is rejected. Timeout zero means indefinite power. Jobs request held policy before
the initialized SP. Switching an already known pulse from finite to held power,
or rearming finite power after a held job, uses SR then a same-target
`S2,pulse,4,0,1` and its queue barrier. It does not add a semantic SP lift/lower
count; it adds a one-millisecond queue operation outside the drawing program.
Before awaited configuration, an energized finite pulse is rearmed under held
power; knowledge is retained only if the complete transaction finishes before
the old expiry. Otherwise initialization includes the startup allowance.
Known pulse state expires conservatively from the pre-dispatch host timestamp;
expired state requires initialization and startup allowance. Brushless RB2 does
not use the RB1 switched-power timer. Pulse state is invalidated after uncertain
writes, purge, power loss, release and configuration identity changes.

These protocol facts were checked against official EBB SP/S2/SC/SR documentation
and the preserved pinned firmware evidence recorded in `upstream-revisions.json`.
No firmware expression was copied into production. `pen-contract.test.ts` uses an
independently written discrete refresh/phase model and a small channel-allocation
and live-power-counter stub. VirtualEbb remains a queue-order simulator with a
continuous pen sweep; it is not evidence of mechanical settling or PWM phase.

## Executable identities

Current plan identities are defined in `../src/version.ts`: `native-v5` compilation, `axi-ca-junction-v1` Standard planning, `axi-ca-sm-cruise100-v1` for qualified modern SM, `dynamic-scurve-flow-v1` for Dynamic and `ebb-pulse-v1` pen timing. Admission rejects missing or mismatched identities; recompile editable geometry for the current settings.

Tests cover analytical distance/time, reachability, continuity, geometry order, native rates, pen refresh phases and execution lifecycle. T3 checks independently evaluate every tick of small original fixtures. Larger sampled corpora are finite checks, not proofs for every possible curve. Physical stroke quality and mechanical settling require configuration-specific acceptance.
