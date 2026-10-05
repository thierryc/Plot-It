# Prusa homing and calibration for Plot-it

Research reviewed 2026-10-02. This is a feasibility/design note; no device
connection, motor movement, firmware update, or homing implementation was made.
The user's EBB hardware revision, firmware version, switch wiring, and mechanical
travel remain to be confirmed.

## Conclusion

Automatic establishment of a repeatable X/Y reference is feasible with an EBB
and two suitable limit switches. Prefer a board compatible with EBB firmware
3.0 or later, which can handle the switch stop locally. Prusa's sensorless
method requires motor-driver stall detection; standard EBB hardware does not
gain that capability from a Plot-it software change.

Separate three operations in the product:

| Operation | Purpose | Required reference |
| --- | --- | --- |
| Home axes | Recover a repeatable machine coordinate system after startup or lost position | Physical switches, or supported driver stall detection |
| Set paper origin | Position artwork relative to the loaded sheet | User alignment or a registration sensor |
| Calibrate dimensions | Correct motion scale and optionally axis skew | Measured drawing or measured fiducials |

A motor's NEMA size does not provide feedback. Homing establishes a reference;
it does not prove that subsequent commanded steps were physically completed.

## What Prusa implements

The MK3 uses TMC2130 drivers and can home X/Y without physical switches.
[Prusa's hardware explanation](https://blog.prusa3d.com/original-prusa-i3-mk3-bloody-smart_7201/)
and [Analog Devices' StallGuard application note](https://www.analog.com/en/resources/app-notes/an-002.html)
describe the required driver capability and load detection.

In [MK3 `tmc2130_home_enter`](https://github.com/prusa3d/Prusa-Firmware/blob/MK3/Firmware/tmc2130.cpp),
firmware changes driver mode, homing current, threshold, and diagnostic output.
[MK3 `homeaxis`](https://github.com/prusa3d/Prusa-Firmware/blob/MK3/Firmware/Marlin_main.cpp)
makes room for a consistent approach, seeks the end, retracts and repeats probes,
reads driver microstep phase, applies its home offset, then establishes position.
Its sensorless probing speed is deliberate; blindly slowing it down is not an
equivalent implementation.

[Buddy `homing_cart.cpp`](https://github.com/prusa3d/Prusa-Firmware-Buddy/blob/master/lib/Marlin/Marlin/src/module/prusa/homing_cart.cpp)
contains repeatability checks, stored phase samples, retry speed adjustment and,
under MK4/MK3.5 configuration, sensitivity calibration based on repeated probe
results. Firmware retains successful parameters and rejects unacceptable probes.
[Buddy `homing_corexy.cpp`](https://github.com/prusa3d/Prusa-Firmware-Buddy/blob/master/lib/Marlin/Marlin/src/module/prusa/homing_corexy.cpp)
has separate calibration for coupled motors, including phase alignment and
mechanical compliance. An AxiDraw-style mixed-axis machine needs its own
kinematic configuration; copying independent-motor X/Y assumptions is incorrect.

Prusa's other calibrations use different sensors:
[MK2 geometry calibration](https://blog.prusa3d.com/first-printer-to-automatically-correct-geometry-in-all-axes_4451/)
locates induction targets to estimate bed offset and axis skew.
[MK4-family loadcell probing](https://help.prusa3d.com/article/loadcell-mk4-s-mk3-9-s-xl_401253)
establishes nozzle contact with the bed. A plotter's pen-lift servo supplies
neither of those measurements by itself.

## EBB capabilities and limitations

The [standard EBB hardware documentation](https://www.schmalzhaus.com/EBB/index.html)
describes Allegro motor drivers and general-purpose I/O, rather than StallGuard
drivers. Its documented current query measures the current setting and supply
voltage, rather than a motor-stall signal.

The [EBB 3 command reference](https://evil-mad.github.io/EggBot/ebb.html#cu)
provides a hardware-side switch mechanism:

| Configuration | Meaning |
| --- | --- |
| `CU,51` | Mask of monitored Port B inputs |
| `CU,52` | Trigger levels for those inputs |
| `CU,53` | Optional asynchronous switch notification |

Inputs are checked every 40 microseconds. A trigger interrupts motion, flushes
the motion FIFO, and blocks further stepper commands until cleared. Mask zero
clears this latch. Pin selection, input configuration and electrical conditioning
must follow the actual board schematic; no wiring pinout is prescribed here.

[Legacy EBB documentation](https://evil-mad.github.io/EggBot/ebb2.html#hm)
explains that `HM` returns to a step-counter reference. It does not seek a sensor.
Plot-it's existing `setOrigin()` and `home()` in `src/plotter.ts` implement this
manual reference/return behavior. Older firmware can read GPIO, but browser
polling alone should not replace the board-side switch stop for this design.

## Proposed homing workflow

This sequence is a Plot-it design proposal, not a copied Prusa routine:

1. Reserve exclusive machine control, lift the pen, and invalidate the previous
   position reference. Confirm the configured inputs are readable.
2. If a home switch is already active, retract a bounded distance and verify it
   releases. Abort if it remains active.
3. Arm the appropriate switch and seek one Cartesian axis with a bounded move.
   Use the machine's mixed-axis transform to drive both motors as necessary.
4. Require a matching switch event. Drain/resynchronize the transport after the
   interrupted move; never treat the planned endpoint as the achieved endpoint.
5. Clear the latch and retract with only the necessary switch temporarily
   unarmed. Verify release, rearm, and approach again at the configured latch
   speed. Require repeatability within an experimentally qualified tolerance.
6. Repeat for the second axis, move to a verified clear home offset, establish
   the coordinate reference and retain motor engagement.
7. Apply the separate paper offset for artwork placement. A sheet can move
   while the machine remains homed.

Bound every seek, retract and retry. No switch event, the wrong input, failure
to release, cancellation or disconnection must leave position unknown. A switch
hit during ordinary plotting must stop the job without automatically returning
to a potentially invalid origin. Mechanical homing must first be qualified on
the actual plotter; no repeatability figure is assumed.

Keep machine zero stable when paper registration changes. Internally distinguish
the two coordinate frames, even if the existing UI still shows one origin.

## Modularity and integration

Suggested modules:

- An independent homing state machine handles seek/retract/latch/verify states,
  limits and cancellation through an injected motion/sensor interface.
- An EBB adapter configures switches, translates Cartesian moves and consumes
  asynchronous events. The board supplies the immediate stop.
- A machine profile stores wiring, polarity, travel, offsets and qualified
  speeds. Calibration belongs to the machine, outside artwork/undo snapshots.
- The UI presents Home axes, Set paper origin and Calibrate dimensions as
  separate operations, gated by actual device capabilities.

The current serial reader assumes the next line is the command reply. Before
switch support, replace that assumption with one continuous reader routing
replies and unsolicited events separately. Resynchronize counters after a switch
interruption. Do not call motor-enable operations to recover an interrupted move
without accounting for their effects on counters and the limit latch.

For dimensional calibration, first draw a known rectangle and enter measured X/Y
lengths. The correction is `new_steps_per_mm = old_steps_per_mm * commanded_mm /
measured_mm`. Retain the existing profile values as defaults. Optional later
skew correction needs measured reference geometry and a machine-coordinate
transform; two home switches alone cannot measure skew. Check physical travel
after applying correction, not just paper clipping before transformation.

Qualify the state machine and transport with simulated events first: starting
on a switch, normal approach, bounce, stuck input, missing input, unexpected-axis
event, fragmented messages, interrupted queued moves and cancellation. Then
measure physical homing repeatability and dimensional accuracy on the machine.

The preferred first implementation is EBB 3 switch homing plus independent
paper registration and measured scale calibration. Sensorless homing would be
a separate controller/driver hardware project, with communication, diagnostic
wiring and firmware support; it is not a drop-in replacement in Plot-it.
