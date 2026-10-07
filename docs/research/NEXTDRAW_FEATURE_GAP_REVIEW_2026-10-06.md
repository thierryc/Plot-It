# NextDraw plotting feature gaps and integration scope

Reviewed 2026-10-06 against NextDraw API/core 1.7.4, its current official option
references and Layer Control documentation, and the current Plot-It sources.
This is an inventory and implementation decision, not completed functionality.
The [motor plan](../MOTOR_IMPLEMENTATION_PLAN.md) now includes these features in
the same migration instead of leaving core plotting parity as an unspecified sequel.

The user's repeat request means repeating the same prepared drawing with a
configurable timer between copies, plus optional continuous repetition. It does
not mean scheduling a Codex automation.

## Sources and confidence

The pinned official archive and hashes are recorded in the
[API review](NEXTDRAW_API_REVIEW_2026-10-06.md). This review reads:
`nextdraw_conf.py`, `nextdraw_options/models.py`, `motion.py`, `path_objects.py`,
`digest_svg.py`, `plot_optimizations.py`, `nextdraw.py`, `dripfeed.py`,
`plot_status.py`, and the public wrapper/options. The reviewed source is available
under `output/upstream-review/nextdraw-1.7.4/` for offline inspection.

The [Python reference](https://bantam.tools/nd_py/),
[CLI reference](https://bantam.tools/nd_cli/) and
[Layer Control reference](https://support.bantamtools.com/hc/en-us/articles/29473928061971-NextDraw-Layer-Control)
provide the public behavior. API-only features such as digest output and CLI
progress are identified as such rather than described as Inkscape GUI options.
The guide landing page lists version 1.5; the web reader could not fetch its large
PDF, so this review does not claim a tab-by-tab audit of that PDF.

## Feature inventory

The status column records the pre-rewrite inventory. The fresh core has since
implemented the agreed software inventory, with explicit differences and hardware
acceptance still pending; see
[the implementation checkpoint](../CORE_REWRITE_STATUS.md) for current status.
Neither inventory implies successful physical acceptance. Milestone references
are to the motor plan.

| Feature | Current Plot-It status / gap | Work in this migration |
| --- | --- | --- |
| Smooth full-stroke motion | Acceleration look-ahead exists; current XM compiler differs | Native SM and modern S-curves/T3/TD, M2–4 |
| Constant drawing speed | Missing; short constant profiles are not this mode | Explicit drawing policy for both backends; accelerated travel retained, M2/4/5 |
| Technical drawing / handwriting / sketching presets | Missing as coherent presets | Typed recipes resolving speed/jerk, resolution and curve tolerance; custom settings retained, M1/4/5 |
| High/low microstepping | Missing selectable setting; current native scale uses fixed 8x | Resolution-aware profile, enable/position/limits, snapshots and tests, M1/3/5 |
| Adjustable curve sampling accuracy | Browser flattening and simplification exist; no handling-linked contract | Explicit input-adapter sampling tolerance, separate from polyline simplification, M1/5 |
| Pen heights, rates, extra Up/Down waits | Implemented; old parity table understated this | Preserve calibration and timing; finish profile-specific standard/brushless configuration, M3/5 |
| Servo power timeout | Existing fixed policy | Configurable supported timeout, applicability per board/servo, M3/5 |
| Mechanical reload distance/wait | Implemented additional Plot-It feature | Exact compiled-budget policy with every mode/copy/resume, M2/4/5B |
| Physical pause button | Not integrated into normal plotting controls | One status consumer; pause during motion and timed waits, M3/5B |
| Repeated copies / repeat-until-stopped | Missing | Shared bounded sequence scheduler, M5B/6 |
| Delay between copies | Missing | Raised return, countdown, pause/resume and stop, M5B |
| Layer selection | Pen/source selection exists; not layer semantics | Preserve layer IDs/order, selected layers, hidden/documentation layers, M1/5B |
| Layer speed/height overrides | Missing | Resolve settings per layer, restore outside it, M5B |
| Layer delays / forced pauses | Missing | Empty-layer events and stationary waits, M1/5B |
| Per-layer optimization levels | Global options exist | Layer-bounded least/basic/full/strict policy with protected operations, M1/5B |
| Per-layer handling (`+M`) | Upstream partly implemented / documented coming soon | Preserve parsed metadata; see source caveat below, not a full motion-parity prerequisite |
| Persistent resume | Live pause/resume and interrupted-job records exist; insufficient for recovered motion | Versioned executed checkpoints and explicit position recovery, M5B/6 |
| Resume read/adjust/clear and start offset | Missing | Drawing-distance slicing, signed resume adjustment, remaining-path recompile, M5B |
| Automatic homing | Missing; manual origin exists | Profile-specific service and virtual inputs, M3/5B, hardware gated |
| Auto portrait/landscape placement | Manual machine rotation exists; different behavior | Explicit automatic page-orientation option and identical placement preview, M1/5 |
| Page clipping policy | Margin/machine clipping exists; no separate policy | Optional page clip, mandatory machine envelope, interactive clip-and-lift, M1/5B |
| Hidden-line removal / SVG clipping | Missing; generated fills do not perform occlusion | Source paint-order/clip preprocessing before motion preparation, M1/5 |
| Strict original order without joining | Preserve mode can still join paths | Separate strict policy that retains path/layer barriers and disables joins, M1/5 |
| Seeded closed starts | Implemented | Optional deterministic per-copy variation and checkpointed seed, M5B |
| Prepared plot digest | Immutable jobs exist; no portable prepared-geometry cache API | Versioned JSON export/import, digest-only compilation and validation, M1/6 |
| Preview display/export | Playback, raised travel and pen counters exist | Draw/travel/all filters, SVG path export and copy/delay-aware estimates, M5/6 |
| Statistics / progress | Distances and estimated/elapsed time exist | Completed/remaining distance, pen lifts, per-copy/total counts and delay totals, M5B/6 |
| Jog / align / cycle utilities | Pen controls, origin and motor controls exist; jog incomplete | Bounded jog, explicit align/release and pen-cycle operations, M3/5B |
| Device models and discovery | AxiDraw/Xylodraw profiles; NextDraw absent | Validated recent AxiDraw/NextDraw model bounds, custom Xylodraw; explicit device selection, M1/3/5 |
| Device names / system information | Firmware and raw supply shown; limited utility API | List/read names, explicit rename, capability/config report and supported raw readings, M3/6 |
| Interactive drawing API | Internal controls exist; no reusable public coverage | Absolute/relative move/draw, full path, delay, settled wait and state access, M3/5B/6 |
| Saved configuration / option precedence | Document settings exist | Typed config/presets and explicit layer overrides across browser/CLI/runner, M1/5/6 |
| Completion notifications / webhook | Missing | Nonblocking host event adapter, user-configured delivery and separate failures, M6 |
| Synchronized B3 output | Missing optional upstream configuration | Optional typed tool-output records/profile capability, stationary synchronization, M3/5B |
| Bootloader / firmware update utilities | Outside normal plot migration | Inventory separately; never run as job startup or automatic recovery |

Merge/mail-merge, artwork creation, fonts and hatch filling are separate products or
editor features, not additional motion-core parity requirements. Keep Plot-It's
existing text, generated fills, multi-pen tool changes, bounds preview and reloads.

## Constant speed: a distinct drawing policy

NextDraw's handling mode 4 sets its drawing constant-speed policy; `motion.py`
applies it only with the pen down, assigns entry/exit speed to the drawing limit,
and takes the constant-rate branch. Its normal cruise sections and tiny-move
approximations do not mean this option is already implemented in Plot-It.
Pen-up motion continues to use the selected smooth planner.

Expose `drawingMode: profiled | constant` separately from `motionBackend` and
handling presets. Legacy compilation uses native SM at the declared rate; modern
compilation uses constant-rate T3 with zero acceleration/jerk and correct state
initialization. Apply native-axis rate/resolution limits and rounding in both.
Retain chunking for queue responsiveness. If a requested constant speed cannot be
represented exactly, expose the quantization/limit policy rather than promise exact
mechanical velocity.

For vendor-like constant mode, drawing ramps and ordinary corner slowing are
deliberately bypassed. This introduces abrupt starts/stops and direction changes;
it is a low-speed specialist option, not an S-curve with a renamed button. Shared
acceleration/jerk invariants must explicitly exempt constant drawing rate jumps.
At pen, reload, tool and control boundaries, settle motion before changing the pen;
travel still ramps. A future mode that limits corner speed would be a different
policy, not exact constant-mode parity.

## Handling presets, resolution and layer caveat

NextDraw's four handling recipes resolve several settings together. The current
TypeScript speed/acceleration controls alone cannot represent that behavior.
Define model-aware typed recipes plus Custom; display the resulting physical
units and do not blindly apply vendor machine speeds to Xylodraw. Resolve recipes
before SVG curve sampling and compilation, and include those choices in job identity.
A normalized polyline input cannot recover detail removed by an earlier coarse
sampling pass; its declared tolerance/provenance must remain explicit.

Resolution changes affect motor scale, speed limits, position counters and origin
confidence. Change at a settled boundary through the origin service; invalidate or
recover the frame when the hardware transition cannot preserve it. Never reinterpret
old step counters under a new scale while motion remains queued.

The pinned parser recognizes `+M` and geometry digestion uses it for curve tolerance,
but the inspected `eval_layer_props` does not apply it as a layer-specific motion
handling mode. Official Layer Control calls it “Coming soon.” Do not report full
per-layer handling as an already working vendor feature. Implement the documented
speed/height/delay/pause/reordering controls first. Full per-layer handling, if
added, is an explicit extension with resolution/frame-transition tests.

## Repeats and the timer between copies

Add a job-level schedule with a finite copy count or an explicit continuous mode,
an inter-copy delay, and optional require-Continue behavior for paper changes.
Default to one copy; preserve existing documents. A timer example is three copies
with 10 seconds between: plot 1 → settled Up at origin → 10-second countdown →
plot 2 → settled Up at origin → 10-second countdown → plot 3 → final Up. Do not
add a delay after the last finite copy.

The scheduler owns copy index, timer and control state outside the serial FIFO.
It uses a monotonic cancellable clock; Pause freezes the remaining timer, Resume
continues it, and Stop/Cancel prevents another copy. Continue acknowledges a manual
paper-change gate; it does not implicitly skip an unfinished timer. These are our
explicit interactive semantics, not a claim to copy every upstream pause detail.
Physical pause inputs work during delays as well as drawing.

Before each copy run the same startup/pen-restoration service. Copies use the same
origin and resolved settings; an intervening release/disconnect/profile change
requires origin/target recovery. Raised return between copies is part of the
schedule even when single-copy final-return preference is disabled. Distinguish
that return from the user's final-copy preference. Reload budgets restart only at
an actual modeled lift/reload boundary, never just by changing a copy counter.

Same drawing means identical prepared geometry by default. An optional vary-starts
setting derives each copy's seed from the base seed/index and stores it with the
checkpoint; it does not use wall-clock randomness. Preview/stats identify the
copy variant. Compile copies lazily, reuse matching templates, and never allocate
an unbounded command array for continuous mode. For continuous plotting show
per-copy estimates and completed totals rather than a fictitious total end time.

The runner owns a remote repeat schedule so observer disconnects do not restart its
countdown or copies. Persist copy index, sequence identity, completed checkpoint
and remaining timer. A crashed runner marks execution interrupted and requires
explicit recovery; restarting cannot automatically launch an unattended next copy.

## Layers, resume, geometry and utilities

Add structured layer events before flattening paths into pen groups. Layer barriers,
delays and overrides cannot disappear through global optimization; an empty layer
may still contain a wait/pause. Tool assignment and physical pen changes remain
orthogonal to source layers. During import parse supported Inkscape annotations;
typed UI controls need no special name syntax. Snapshot each layer's resolved
settings and restore defaults afterward without mutating other prepared records.

Start/resume offsets are distances along the selected optimized drawing geometry,
excluding raised travel and waits; they are not XY shifts. Store source/path cursor,
compiled progress, drawing distance, settings and copy/layer/seed state together.
Never use accepted command count as completed distance. Slice a path at an interior
offset, travel raised to that point, lower/settle and replan from rest. A negative
resume adjustment deliberately redraws an overlap. Recover position first on legacy
hardware; do not copy NextDraw's arbitrary-position resume assumptions onto Xylodraw.
Separate an interrupted checkpoint from a confirmed in-session paused checkpoint.

Hidden-line preprocessing requires source paint order, fills, clipping geometry and
visibility metadata before ordinary path flattening/ordering. Do not infer it from
pen colors or the existing hatch generator. Use a browser/Node-compatible geometry
adapter with documented clipping/opacity limits and provenance. For selected-layer
plots, decide occlusion from the relevant visible scene before discarding nonselected
drawing layers. Auto-orientation changes page placement; manual machine rotation
still maps page coordinates to the physical axes. Both transformations must appear
in prepared geometry and bounds preview.

Host utilities and completion hooks consume core events outside feeding. A failing
webhook cannot stall motion or retry a plot. Optional B3 output is separately typed
and synchronized at declared stationary boundaries, with default off; it must not
be inferred from cached pen state. Firmware bootloader/update tools and vendor
Plob/SVG-resume file interoperability need separate specifications and are not
silently included in generic JSON job support.

## Acceptance and completion

This migration includes constant speed and presets, resolution, layer controls,
repeats/timers, persistent resume/offsets, placement/occlusion and public utility API
coverage as the specified submilestones. Hardware-specific homing/output features
remain capability-gated. Optional vendor-format interoperability and firmware
flashing are tracked separately rather than claimed by motor feature parity.

The virtual EBB regression suite covers both motion policies on 2.8.1/3.1.7,
three timed copies, continuous Stop, pause during a countdown, first Down on every
copy, layer restoration, resumed reload budgets and corrupted/stale checkpoints.
Source-scene geometry fixtures test clipping/hidden lines/strict ordering; the
virtual board alone cannot detect a wrongly selected SVG path. Physical tests still
establish pen behavior, constant-speed artifacts, resolution/frame correctness and
supported automatic homing.
