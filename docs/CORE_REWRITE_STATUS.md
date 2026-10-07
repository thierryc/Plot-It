# Plotting candidate — offline implementation completed

2026-10-06. Software milestones are implemented and exercised without opening a
physical port. Hardware acceptance and modern Auto rollout remain pending for the
user's device test on 2026-10-07 afternoon. This is an independent TypeScript
planner/compiler with explicitly attributed MIT math and homing adaptations, not a
claim of byte-for-byte NextDraw or Python parity.

## Recovery and package boundaries

The previous workspace remains recoverable at
`archive/2026-10-06-before-plotter-core-rewrite/workspace.tar.gz`; all 952 files were
verified against its SHA-256 manifest. An offline probe of six extracted pure
modules produced `output/core-rewrite/archived-xm-baseline.json`: 338 XM commands,
ending at zero, with the archived settings. None of those modules is on the active
execution path. Current editor work from other chats is preserved.

`@thierryc/plotter-core` has pure root, browser, Node, client and virtual entry
points. The pure root builds without DOM/Node libraries. Browser execution owns
transferred serial streams in one worker. Node/CLI use the same session, compiler,
pen/origin services and scheduler. `serialport` is confined to the Node adapter.
The package remains a private workspace package; publishing it is separate work.

Prepared jobs use schema 2 and compiler `native-v3`. Admission recompiles normalized
geometry, layers, settings and offsets and compares a canonical SHA-256 digest.
Version-1 SM jobs retain the validated compatibility adapter and diagnostic
readability; started jobs are immutable and never restart automatically after a
runner crash. V2 jobs require the exact declared firmware at Start.

## Motion and pen execution

- Native SM: full-stroke corner look-ahead, forward/backward reachability, 25 ms
  sampling, short constant/boosted-entry/reduced-acceleration policies, ties-even
  endpoints, preserved empty-interval time and checked native motor rates.
- Modern 3.1.7: acceleration- and jerk-limited whole-stroke planning, exact BigInt T3
  prediction, carried fractional accumulators, endpoint fitting, checked native
  rates and TD only when its two-half expansion is exactly equivalent. Tiny phases
  are extended when endpoint rounding would exceed the selected vector speed.
  Unrepresentable very low jerk is rejected before movement.
- Constant drawing is a separate policy on both backends. Travel remains profiled.
  Resolution 8×/16× is part of the profile/frame and job identity.
- Every job/copy restores servo configuration and forces settled Up before XY.
  A raised move of 50 mm or more adds 100 ms destination settling before Down.
  Lowering includes its own mechanical/rate timing and a 50 ms allowance.
- Reloads are split before planning, use an in-place Up/wait/Down cycle and are
  checked against compiled, quantized drawing distance. No correction jog is added.
- NextDraw 8511/1117/2234 and standard/brushless pen profiles are implemented.
  AxiDraw V3/SE A4 and A3 physical envelopes are explicit; the decorative editor
  model is a separate setting. XyloDraw retains its existing calibration.
- Profile-specific NextDraw homing has independent virtual freewheel/limit inputs
  and selects the bed corner corresponding to canvas orientation. It requires an
  explicit Home action; firmware alone never enables homing.
- Servo timeout, manual pen control, bounded jog and interactive move/draw/path/
  delay/settled-wait utilities share the same serial owner. Optional B3 follows
  settled pen changes and is cleared on cancellation.

Graceful Pause/Stop completes the next compiled rest boundary (stroke/reload) and
uses its existing deceleration. It does not splice an unverified brake into a
moving path. Thus a long stroke can take time to pause. Cancel queues ES immediately,
purges and raises, and requires origin recovery after interrupted motion. Requested,
queued, settled, queried-counter and physical-contact states are distinct.

Settlement now compares QS counters with compiled endpoints. Transient supply and
unexpected limit faults are retained across polling. Modern supply monitoring is
armed with CU,60,250; QC is checked on connect/start and during execution. Faults,
disconnects and interrupted purges invalidate origin; automatic recapture is refused
until explicit recovery. Observers cannot interrupt feeding, including rejected
async observers.

## Application and API features

Implemented in the shared core/adapters: finite/continuous repeats, mandatory raised
origin returns before gaps, frozen countdown on Pause, Continue gates after timers,
seeded per-copy closed starts, source/empty layer barriers, layer selection,
speed/height overrides, waits/pauses and `+G` optimization annotations. Partial vendor
`+M` metadata influences curve sampling, not per-layer resolution/motor handling.

Resume checkpoints include settled record, digest, native position, drawing distance,
copy/layer/seed, source identity and active settings. Resume and signed overlap
adjustment replan from rest, approach Up and preserve subsequent layer settings and
barriers. The editor offers checkpoint-derived start distance and clearing; the CLI
supports checkpoint files and signed adjustment. Origin recovery remains explicit.

Geometry adapters support physical-unit SVG paths/basic shapes, affine transforms,
curves/arcs, inline paint and user-space clipping. Optional paint-order occlusion,
automatic page placement without scaling, page clipping, mandatory known machine
bounds, strict order, protected fills/fonts, draw/travel/all display and SVG export
are exposed. Node rejects text/use/images/masks/filters/stylesheets, nested viewports,
rounded rectangles and objectBoundingBox clips rather than pretending to support
them. Existing browser text and generated fill geometry are retained by its editor
adapter.

Statistics include settled completed/remaining drawing distance, lifts/lowers,
per-copy/aggregate estimates and scheduled waits. Continue/continuous schedules have
no fictional total ETA. Preview repetition uses the shared copy-boundary policy;
virtual and physical execution use JobSequence.

The portable client exposes runner job/control contracts. The CLI prepares path JSON
or SVG, exports validated JSON/SVG, executes virtually, uses an explicit local device
or submits to a runner. Device names, firmware/capabilities and state utilities are
available. Completion callbacks/webhooks live outside feeding; delivery failure
cannot restart a plot or alter its result. Runner persistence uses small sidecars
and O(1) settled checkpoints, coalesced while running. Machine logs are format 6.

## Virtual EBB and verification

The emulator consumes real serial bytes independently of the production compiler
and sampler. It models SM/XM, literal T3/TD ISR arithmetic, finite FIFO/backpressure,
queued motor enables, servo pulse/rate progression, legacy/future framing, SP,3
side effects, ES, GPIO, counters, power and profile-specific homing mechanics.
State survives jobs and transport reconnects. Traces and command journals are bounded.
A deterministic clock handles exact timer boundaries; real-time pacing continues
while the host waits. Compatibility firmware fixtures cover 2.8.1, 3.0.2, 3.1.0,
3.1.6 and 3.1.7; modern native timing acceptance is specifically 3.1.7.
It is a protocol/state emulator, not a complete PIC or missed-step/contact simulator.

- Full offline suite: **706 passed, 0 failed, 10 hardware tests skipped**.
- Production browser/worker/server build passes; CLI SVG → three copies with
  10-second gaps ends at M1=0/M2=0, pen Up.
- Exact Plotink reference vectors and separate literal ISR tests pass.
- Browser worker stream-transfer probe runs a virtual job and releases both streams.
- Regressions cover manual Down → bounds → first/second drawing; pen settling,
  reloads, queue backpressure, Pause/Stop/Cancel, framing/reply faults, supply loss,
  origin recovery, layers, timers, resume and immutable admission.
- `scripts/plotter-benchmark.mjs` records an 18,000-vertex corpus, compilation,
  10,000 bounded display samples, native speed bounds and Python short-move deltas
  in `output/core-rewrite/benchmark.json`.

The independent SM timings for the pinned 0.025/0.1/1/6 mm examples are
12/90/283/362 ms, versus Python 11/89/283/336 ms. Integer ceilings and the explicitly
conservative local acceleration policy explain these differences. Neither those
numbers nor virtual success establish physical plotting quality.

## Inspecting the virtual board

Open `/virtual.html` on the local development app. It shows observed X/Y, native
steps/accumulators, pen pulse/state and lift/lower counts, FIFO, supply ADC, elapsed
time and copy/countdown, plus a simple path trail. Load exported prepared JSON to
inspect your own job. It has no Web Serial permission or physical USB path.

```sh
scripts/node-lts.sh --npm run plot:virtual -- --modern --monitor --trace
scripts/node-lts.sh --npm run plot:virtual -- --modern --realtime --monitor --trace
scripts/node-lts.sh --npm run plot:virtual -- --modern --copies 3 --gap-ms 10000
scripts/node-lts.sh --npm run plot:cli -- --input drawing.svg --virtual --scurve --export output/job
```

Use [the device checklist](HARDWARE_ACCEPTANCE_2026-10-07.md) for tomorrow. Physical
Auto remains SM until actual 3.1.7/model combinations pass; explicit S-curve and
virtual 3.1.7 use the modern backend. No firmware was flashed and no physical port
was opened during this implementation.
