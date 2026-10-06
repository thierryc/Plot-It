# AxiDraw plotting feature parity

Target: the plotting capabilities of Evil Mad Scientist's AxiDraw Python driver,
plus a maximum continuous drawing distance that reloads a mechanical pen with
an in-place lift/lower cycle. Feature parity is the target; it is not yet complete.

Behavior reference: AxiDraw revision
`a0df054f41f8e3ae8d408e08e7b2656968e375f1`, with Plotink revision
`4976b86080c25a10a9f979b870669dc62a1741fa`. These are reviewed references,
not vendored runtime dependencies. The active implementation is TypeScript.

| Capability | Current status | Remaining work |
| --- | --- | --- |
| Full-stroke acceleration and cornering | Implemented | Physical tuning on both device profiles |
| Forward/backward speed reachability | Implemented | Broader physical validation |
| Separate drawing/travel speed and acceleration | Implemented | Per-layer overrides below |
| Triangle, trapezoid, short linear/constant profiles | Implemented | Independent 15 ms sampling differs from Python's 25 ms stream |
| Rounded movement distance and cumulative endpoint correction | Implemented for XM | Native-axis SM parity and half-step XY endpoints depend on resolution work |
| Minimum/maximum native motor rate handling | Implemented | Physical checks at speed extremes |
| Explicit pen state and settling before XY | Implemented | Adjustable raise/lower rates and extra Up/Down delays; default extra Up delay 150 ms. Reload waits configurable; see [controls](PLOT_CONTROLS.md) |
| Startup/origin return with pen raised | Implemented | Physical verification of new motion profiles |
| Mechanical pen reload distance | Implemented | Distance splitting precedes step rounding, so physical chunk length has step-resolution tolerance |
| Multi-pen selection/order and origin tool changes | Implemented | Per-layer settings and pause/delay annotations |
| Live Pause/Resume, graceful Stop, emergency cancel | Implemented | Persistent resume from saved position/drawn distance after interruption |
| Physical pause button | Pending | Query button state during feeding and draining; integrate with Pause/Resume |
| Supply voltage and power monitoring | Implemented | QC raw supply status on connect/start, during feeding and manual check; unsupported reads explicit, low supply cancels; physical validation remains |
| High/low selectable microstep resolution | Pending | Resolution-aware motor enable, geometry scale, speed limits, position feedback and persisted settings |
| Constant drawing speed mode | Pending | Plan mode and UI setting; retain pen-up acceleration |
| Narrow-band/brushless servo configurations | Pending | Capability-specific calibration, command configuration and timing |
| Per-layer speed, pen height, delays and selection | Partial | Pen selection exists; layer overrides and annotations remain |
| Repeated copies and delay between copies | Pending | Shared job scheduling, controls and progress |
| Path optimization options | Implemented | Configurable nearby endpoint joining, bounded vertex reduction, original/nearest/seeded random closed starts; see [path optimization](PATH_OPTIMIZATION.md) |
| Bounding-box preview | Implemented | Raised perimeter of selected, prepared drawing; shared simulation/USB/network executor and origin return |
| Jog controls | Pending | Individual axis controls |
| Plot statistics | Partial | Drawing/travel distances, estimated motion time and actual elapsed time implemented; copy/resume statistics remain |
| Device/model and API coverage | Partial | AxiDraw/Xylodraw EBB profiles exist; additional model bounds/options and Python API/CLI-equivalent controls need a separate inventory |

Recommended next work: physical pause button; selectable resolution and constant-speed mode; persistent resume;
layer/copy controls; remaining device/API coverage. Each change
must retain shared simulation/execution plans, stationary pen barriers, and
reload-distance behavior.

## Short-move comparison

The pinned Python `compute_segment` was run offline with 200 mm/s² drawing
acceleration, 35 mm/s maximum drawing speed, and 40 steps/mm. Reference examples:

| Segment | Entry / exit speed | Python queued time | TypeScript policy |
| --- | --- | --- | --- |
| 0.025 mm | 0 / 0 mm/s | 11 ms | Single constant-speed short profile |
| 0.1 mm | 0 / 0 mm/s | 89 ms | Boosted-entry linear deceleration |
| 1 mm | 0 / 0 mm/s | 283 ms | Boosted-entry linear deceleration |
| 6 mm | 0 / 0 mm/s | 336 ms | Reduced local acceleration, triangular profile |
| 0.05 mm | 5 / 3 mm/s | 10 ms | Single constant-speed short profile |
| 0.05 mm | 3 / 5 mm/s | 10 ms | Single constant-speed short profile |

TypeScript rounds each shared phase duration upward to integer milliseconds,
retains empty-interval time, and uses XM step endpoints. These choices can
change queued milliseconds and intermediate step placement. Neither simulated
nor mock-serial results establish physical motion quality.

References:

- [Motion policies](https://github.com/evil-mad/axidraw/blob/a0df054f41f8e3ae8d408e08e7b2656968e375f1/inkscape%20driver/motion.py)
- [Driver configuration](https://github.com/evil-mad/axidraw/blob/a0df054f41f8e3ae8d408e08e7b2656968e375f1/inkscape%20driver/axidraw_conf.py)
- [Pen handling](https://github.com/evil-mad/axidraw/blob/a0df054f41f8e3ae8d408e08e7b2656968e375f1/inkscape%20driver/pen_handling.py)
- [Path optimization](https://github.com/evil-mad/axidraw/blob/a0df054f41f8e3ae8d408e08e7b2656968e375f1/inkscape%20driver/plot_optimizations.py)
- [EBB XM specification](https://evil-mad.github.io/EggBot/ebb2.html#XM)
