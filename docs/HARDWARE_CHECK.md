# Local EBB check — 2026-10-02

Device: `/dev/cu.usbmodem21201`, EBB firmware 2.8.1. The user authorized
hardware checks and stated that the carriage was at origin.

Read-only preflight returned `QS: 0,0` and `QM,0,0,0,0` (idle).
The check raised the pen with `S2,17750,4,0,300`, selected 1/8 steps with
`EM,2,2`, and captured origin with `CS`. It then moved 5 mm along the
machine's positive mixed X axis (`XM,1000,200,0`) and returned with
`HM,200`. After settling, `QM` again reported idle and `QS` returned `0,0`.
Motors were left engaged and the pen raised.

This verifies communication and a settled return for this small axis check.
The user subsequently confirmed that the 90° clockwise plotting correction
should be Standard. Both machine profiles now default to that mapping, and old
Standard settings migrate to it. The check does not constitute acceptance of
full plotting, pen-height calibration, Pause, Stop, or pen-change playback.
