# Device acceptance — 2026-10-07 afternoon

The offline candidate is ready for the user's real-device test. Start with the
current XyloDraw calibration and **Compatibility / SM on firmware 2.8.1**. Read the
connected firmware rather than assuming an upgrade. Only use explicit S-curve on
an actual 3.1.7 controller. No upgrade is needed to test SM.

Before each initial test, place the carriage at the established physical origin,
use Set origin, load the correct paper and check the saved pen heights. If motors
were released or the carriage was moved, restore that origin. Home is only for the
supported NextDraw mechanism/model and uses the selected orientation's bed corner.
Changing resolution/model/orientation invalidates the existing frame.

| Order | Test | What to record |
| --- | --- | --- |
| 1 | Manual Down, then a small ordinary plot | Actual initial lift before travel; Down contacts paper before the first drawing |
| 2 | Bounds, first normal plot, second normal plot | Bounds remains Up; both drawing runs lower identically |
| 3 | Raised travel ≥50 mm followed by a short mark | Destination settles, then lowering wait, then a complete mark |
| 4 | Axial/diagonal lines and a closed shape | Requested endpoint versus QS counters, closure, physical missed steps |
| 5 | Tiny marks, near-zero motor axis, curves/corners/reversal | Geometry, vibration and contact; photograph the paper |
| 6 | Long stroke with a 15–30 mm reload maximum | Stationary lift/wait/lower, no connector or missing beginning |
| 7 | Pause/Resume at a stroke or reload; graceful Stop | Declared rest deceleration, settled Up, correct continuation/return |
| 8 | Cancel, restore origin, start a fresh plot | Purged queue; no unexpected lowering; explicit recovery required |
| 9 | Three copies, 10-second gaps; Pause at four seconds remaining | Up at origin, frozen countdown, correct first Down on every copy; no final gap |
| 10 | Stop/Cancel during a gap; Continue gate after its timer | No new copy after stop/cancel; Continue cannot skip the timer |
| 11 | Layer speed/height override and empty delay/pause layer | Correct order, stationary waits, restored normal height |
| 12 | Resume distance inside a stroke; negative overlap adjustment | Raised approach, correct splice, no duplicate connector, reload budget retained |
| 13 | Constant mode at modest drawing speed; 8×/16× | Drawing policy versus profiled travel; correct scale after re-establishing origin |
| 14 | NextDraw only: standard/brushless calibration and Home | Correct pen mapping and appropriate physical origin corner |

Save a format-6 machine log after each failed case. It includes the executable
program, native parameters, ACK versus settlement signals and the completed
checkpoint. Record physical paper/contact observations separately: reported steps
and the controller's pen bit cannot prove contact or exclude missed steps.

Pause/Stop finishes the next planned rest; a long uninterrupted stroke can take
time. Emergency Cancel purges immediately and invalidates interrupted position.
Do not compare a cancelled job with a graceful rest as though they were the same.

Archive test logs and photographs before tuning. A change to settings requires
Prepare again. Test SM and T3 with matching paper geometry, profile, resolution,
speeds and pen calibration; record their elapsed times separately. Keep physical
Auto on SM until the relevant modern hardware combinations have passed.
