# Pen synchronization review — 2026-10-05

Review only. No production execution changes or physical comparison runs were made during this review.

## Evidence and limits

The supplied video reports Direct USB with 30% / 52%. The exported machine log and current controls instead show 20% / 42%. These pairs have equal travel, but different endpoints and potentially different paper contact. The log uses EBB firmware 2.8.1. It has discarded 20,000 earlier entries; its first retained entry is 82.503 seconds into the job. It cannot establish what happened in the missing interval or identify the video's exact failing transition.

Across 172 retained S2 transitions followed by an XY command, the host's written-command gap was minimum 127.1 ms, median 147.2 ms and maximum 1032.7 ms. No error/failed phases were present in the retained entries. These are host timestamps, not measurements of physical pen contact. They show no obvious missing 120 ms dwell in this sample.

## Saxi comparison

Reference: alexrudd2/saxi 0.17.1, commit `2640a3dd6c7a5261985f334255b827edb30e3109`, `src/ebb.ts`, executePenMotion. The downloaded pinned source was checked directly. Older local Saxi checkouts use rate zero; that is not the pinned version's behavior.

Current Saxi computes `rate = round(abs(finalPos - initialPos) * 24 / durationMs)` and sends S2 with that rate and the duration. Plot-it computes fixed rates (1845 raising, 1230 lowering), estimates PWM duration with an extra cycle, and chooses the maximum of that estimate, a mechanical-time estimate, and 120 ms. Both ramp; they choose ramp timing differently.

For a 22-point transition, Plot-it's pulse difference is 4510 units. Its conservative signal estimate is 120 ms lowering and 96 ms raising; the mechanical estimate is 104.18 ms. Both commands therefore request a 120 ms dwell. Saxi's corresponding 120 ms rate calculation gives 902 units per cycle. Copying Saxi's rate calculation does not by itself demonstrate a fix.

EBB's S2 rate and Delay are independent. Queue idle confirms that queued delay/motion completed; it does not measure servo position or paper contact. Plot-it's estimated mechanical settling may be insufficient for the loaded linkage, but that remains a hardware hypothesis. Adding the entire mechanical estimate after the entire PWM ramp also assumes a physical model that has not been measured.

An exploratory simulated test assumed that additive model and failed in both execution modes and both firmware paths. It was removed from the acceptance suite because an unverified model cannot prove a production bug. Its text is retained in `output/pen-sync/hypothetical-linkage-test.txt` for investigation.

## Browser versus Node server

| Behavior | Direct USB | Node runner |
|---|---|---|
| Executor and pen transitions | Shared PlotterCore | Same PlotterCore |
| Serial access | Web Serial | Native SerialPort |
| Motion compilation | During execution | Precompiled before execution |
| Position-query budget | No motion-duration budget | 30 ms minimum motion budget |
| Command acknowledgements | Ordered, awaited | Ordered, awaited |
| Frontend transport | Local callbacks | Coalesced network telemetry |

WebSocket does not stream individual motion commands to the board. The runner receives a complete plan and owns execution. Thus changing destination does not change the pen algorithm. Transport/query overhead can change host delivery timing; a matched physical test is needed to determine whether that affects this fault. Node's diagnostics also truncate job entries, so use a small test that fits available tracing and retain each export immediately.

The planner orders travel, pen down, drawing, pen up. Existing tests cover firmware command compatibility, draining motion before pen changes, fragmented replies and precompiled execution. No obvious omitted pen command was established from the retained log. The preview represents ideal commanded geometry and cannot validate physical contact.

## Proposed physical comparison

Use identical short strokes, long strokes and disconnected segments at the same speed/acceleration and confirmed pen calibration, in separate blank areas. Record each destination's commands and requested/settled timing, plus observed paper marks. Disconnect Web Serial before the Node runner opens the same EBB. Do not change timing between runs. Compare command order and dwell separately from physical appearance. Further isolation, if needed, should test pen dwell independently of transport before changing the planner.

Physical comparison is pending confirmation of calibration and clear paper area. No motion was sent by this review.

## Primary references

- [Pinned Saxi executor](https://github.com/alexrudd2/saxi/blob/2640a3dd6c7a5261985f334255b827edb30e3109/src/ebb.ts)
- [EBB S2 command and independent rate/delay](https://evil-mad.github.io/EggBot/ebb.html#S2)
- [EBB queue status](https://evil-mad.github.io/EggBot/ebb.html#QG)

## Authorized implementation after review

The user confirmed 20% / 42% and requested the current Saxi rate logic. Plot-it now computes the rate from pulse distance and transition duration in the shared pen-control module. The existing mechanical estimate and 120 ms floor remain; the fixed-rate PWM duration estimate was removed because rate now follows duration. Unknown starts retain a conservative full-range distance bound (314 ms); stationary refreshes use zero rate, avoiding division by zero. At 20% / 42%, both directions produce rate 902 and delay 120 ms. This changes execution for both browser and Node without modifying the acceleration planner. Physical improvement remains unverified until a new plot is observed.

## Follow-up: browser result worsened — contact-point review

The new Chrome export is preserved at `output/pen-sync/browser-failed-after-saxi.json`. This complete retained job has no dropped entries. It used Xylodraw, 30% / 40%, firmware 2.8.1, speed 35 mm/s; this differs from the earlier confirmed 20% / 42%. No settings were changed during inspection.

The log contains 22 down commands `S2,19800,4,410,120` and 22 corresponding up commands `S2,21850,4,410,120`. Among 43 transitions followed by XY, written-command gaps were minimum 127.4 ms, median 132.1 ms, maximum 371.4 ms. The first down command was written at 2075.6 ms; the next LM was written at 2227.2 ms. Actual physical contact was not measured.

### Actionable timing finding

The requested PWM ramp occupies the entire queue dwell. For this run, pulse distance 2050 / rate 410 = 5 PWM updates. With 24 ms periods and an arbitrary initial PWM phase, the final target pulse can arrive close to 120 ms after S2 begins. The queue delay also ends at 120 ms. Consequently the code provides **no reserved post-target settling interval** before XY is allowed. At 20% / 42%, distance 4510 / rate 902 is also exactly 5 updates, so the same timing issue applies independently of these endpoint differences.

This is a confirmed missing timing allowance in the algorithm, not proof of the particular servo's measured latency. The user's worse result is consistent with reducing the available margin; it does not establish a universal latency value. The older fixed lowering rate reached the electrical target sooner for small transitions, so replacing it with a slower full-duration ramp can reduce contact-settling margin.

`PlotterCore.waitUntilIdle()` marks the pen settled when QG/QM says the command queue is idle. That status does not observe PWM completion or physical contact. Planned travel/down/draw/up ordering and command acknowledgement ordering are intact in the inspected code. No missing or reordered pen command was found in this export.

### Correct shape of a future timing change

Separate three quantities: ramp duration, post-target settling allowance, and total queued dwell. Compute Saxi's rate from **ramp duration only**. Compute a conservative PWM completion bound, including initial phase/rounding, then add a separately calibrated settling allowance. Pass that total to S2 Delay and to the motion plan. Do not use the increased total dwell as the rate denominator: doing so slows the ramp again and consumes the very settling margin being added.

The shared planner/executor contract also needs to preserve these separate values. Currently the plan's pen-event duration is passed back to `penTransition` as its minimum duration; treating a future total dwell as a ramp duration would reproduce the error. Preparation, manual pen tests, pause/resume, pen changes and cleanup must follow the same timing contract. Unknown startup position needs its own conservative treatment rather than an assumed already-reached target.

Before changing production code, regression tests should vary PWM phase, distance, non-integral rate rounding and firmware QG/QM paths, and verify that travel/drawing cannot start before the electrical completion bound plus the configured allowance. Test precompiled Node and browser execution, as well as paused/manual/cleanup paths. Confirm physical results with a short gap/stroke pattern; software alone cannot certify paper contact.

### Preview limitation

`live-plot.ts` infers pen up/down from the sampled ideal plan. `live-position.ts` projects EBB XY counters onto queued geometry; repeated/crossing coordinates can be ambiguous, and stationary pen transitions cannot be located from XY coordinates alone. Thus a correctly placed preview marker is not evidence that the real pen has touched/lifted. The displayed state should distinguish a requested transition from a settled command; neither can be advertised as sensed contact.

Primary protocol reference for the user's firmware: [EBB 1.8–2.8.1 S2 documentation](https://evil-mad.github.io/EggBot/ebb2.html#S2). It explicitly separates slew rate from Delay and describes the 24 ms PWM period. The current upstream firmware source was inspected for corroboration, not assumed to be the exact binary installed on the board.

No additional production change or physical motion was made during this follow-up review.

## Settling implementation requested by user

Ramp and total dwell are now separate in the shared transition helper. Rate uses the ramp duration; total dwell covers rounded PWM updates, an extra PWM cycle guard, and a separate conservative settling estimate. The helper's third argument is a minimum **total dwell**, so the plan's total cannot slow the ramp on execution. At 20% / 42%, rate remains 902 and dwell becomes 249 ms. At 30% / 40%, rate remains 410 and dwell becomes 216 ms. Unknown/full-range transitions reserve 674 ms. Stationary power refreshes preserve zero-rate/zero-delay behavior where requested. Software tests cover PWM phases, rate rounding, unknown starts, manual adjustments during pause, LM/XM, and both compilation modes. These tests verify the reserved timing allowance; physical paper contact remains subject to a new hardware test.
