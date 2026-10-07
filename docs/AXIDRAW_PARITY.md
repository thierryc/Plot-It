# AxiDraw / NextDraw capability coverage

2026-10-06 software candidate. Physical acceptance is pending; the implementation
is independent TypeScript, with named numerical/control differences. See
[the checkpoint](CORE_REWRITE_STATUS.md), [motor plan](MOTOR_IMPLEMENTATION_PLAN.md)
and [device checklist](HARDWARE_ACCEPTANCE_2026-10-07.md).

Pinned references: AxiDraw `a0df054f41f8e3ae8d408e08e7b2656968e375f1`, Plotink
`4976b86080c25a10a9f979b870669dc62a1741fa`, NextDraw 1.7.4 (2026-10-02) and EBB
`8f7fb319ec6507b2f1a60d9a9acd4e5f1ff95f71`. Archive hashes and MIT adaptation notices
are in `packages/plotter-core/reference/`. No Python or Saxi runtime is imported.

| Capability | Software coverage | Physical / intentional limits |
| --- | --- | --- |
| Whole-stroke look-ahead, corners, forward/backward passes | SM acceleration planner and modern S-curve planner | Explicit mm/s² caps differ from vendor recipes; tuning remains |
| Short moves, integer endpoints and native rates | Constant/boosted-entry/reduced-acceleration SM policies; ties-even rounding and empty-time retention | Float64/ceil policies and conservative local acceleration change some Python timings |
| Native modern motion | BigInt T3 predictions, carried state, bounded native speed, equivalent TD pairs | Modern target 3.1.7; older supported firmware uses SM |
| Constant drawing | Both backends; profiled travel | Deliberate rate jumps at drawing starts/corners; not perfectly constant mechanical velocity |
| Pen heights/rates/waits/timeout | Restored every job/copy, stationary barriers, long-travel destination wait | Controller bits do not prove paper contact; brushless setup differs from standard servo |
| Reload maximum and wait | Split before planning; verify compiled quantized drawing length; in-place Up/Down | Measures commanded centerline distance, not sensed motion |
| Machine models/resolution | AxiDraw V3/SE A4/A3, existing XyloDraw, NextDraw 8511/1117/2234; 8×/16× | Hardware model/orientation/calibration must match the mechanism |
| Handling/curve accuracy | Custom, technical, handwriting, sketching; independent curve/simplification tolerances | Recipes use physical units; NextDraw jerk is not applied to XyloDraw |
| Pause/Stop/Cancel and button | Single status owner, waits/queue drains, fault cleanup and origin recovery | Graceful controls finish the next planned rest; no synthetic mid-stroke brake |
| Supply and origin confidence | QC plus armed modern CU,60; latched faults; QS endpoint checks | Neither QS nor virtual execution excludes missed steps |
| Repeats and timed gaps | Finite/continuous, raised origin returns, frozen timer, Continue gate, seeded variants | No fictional continuous/manual-wait ETA; no automatic repeat after crash |
| Layers | IDs/order, selection, speed/height overrides, empty waits/pauses, optimization annotations | `+M` retains partial upstream sampling semantics, not per-layer motor resolution |
| Recovered resume / start offset | Settled digest/cursor/native/settings checkpoint; drawing-distance slicing and signed overlap | Restore physical origin explicitly; reject stale/corrupt checkpoints |
| Geometry | Placement without scaling, page/machine clipping, optional opaque-fill occlusion, strict order | CLI supports an explicit SVG subset; unsupported rendering is rejected |
| Preview and statistics | Command-derived sampling, repeat countdowns, pen counters, completed/remaining distance, SVG filters/export, aggregates | Nominal program time excludes setup/serial and unbounded user waits |
| Device/API utilities | Explicit Node device selection, names/rename, firmware/capabilities, jog/move/draw/path/delay/wait, supported homing | Homing is NextDraw-specific; rename is explicit |
| Runner/CLI/prepared jobs | V2 recompilation/digest/target validation, sidecar checkpoints, public client, JSON/SVG CLI | Package is private workspace; vendor Plob/SVG-resume interchange is separately specified |
| Completion / B3 | Detached host delivery, optional default-off synchronized B3 | Delivery cannot alter success or start another job; B3 is controller output, not contact feedback |
| Virtual EBB | Independent byte parser, FIFO, ISR, servo/pen, counters/faults, homing fixture, CLI/browser monitor | Declared subset, not complete PIC/mechanics simulation |

## Pinned short-move comparison

Reference Python was run offline at 200 mm/s², 35 mm/s and 40 steps/mm. The
candidate benchmark compiles the same isolated geometry with native SM:

| Distance (mm) | Entry/exit (mm/s) | Python (ms) | TypeScript (ms) |
| --- | --- | --- | --- |
| .025 | 0 / 0 | 11 | 12 |
| .1 | 0 / 0 | 89 | 90 |
| 1 | 0 / 0 | 283 | 283 |
| 6 | 0 / 0 | 336 | 362 |
| .05 | 5 / 3 | 10 | 10 |
| .05 | 3 / 5 | 10 | 10 |

The candidate uses upward integer duration rounding and retains empty-interval time.
Its near-cruise local acceleration rule is deliberately conservative; it is not an
exact port of the vendor's reduced-profile timing. Modern T3 phases may also be
extended to keep rounded endpoints within the selected native vector speed. Those
policies are explicit and tested; passing numerical tests is not physical acceptance.

References: [AxiDraw motion](https://github.com/evil-mad/axidraw/blob/a0df054f41f8e3ae8d408e08e7b2656968e375f1/inkscape%20driver/motion.py),
[configuration](https://github.com/evil-mad/axidraw/blob/a0df054f41f8e3ae8d408e08e7b2656968e375f1/inkscape%20driver/axidraw_conf.py),
[EBB command documentation](https://evil-mad.github.io/EggBot/ebb.html).
