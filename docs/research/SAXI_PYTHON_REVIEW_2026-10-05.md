# Saxi, Python driver and Plot-it review — 2026-10-05

Review only. No production code/settings changes, new dependencies or hardware motion were made. Public reference files and diagnostic probes are under `output/upstream-review/`.

## Findings that matter for the remaining defects

The supplied photograph shows incomplete drawing strokes and unwanted connectors. It does not establish whether any particular connector was an intended pen-up move: that requires matching the segment to the actual plan. Missing contact and unintended contact must be investigated separately.

The latest Chrome log (`latest-machine-log.json`) confirms that the rebuilt dwell code ran: 62 retained down commands were `S2,19800,4,410,216`, with 62 corresponding up commands `S2,21850,4,410,216`. The actual job settings were Xylodraw, 30% / 40%, drawing speed 35, travel speed 80, accelerations 200/400, rotation 90, margin 10 and reversible ordering. Among 124 retained pen transitions followed by XY, the minimum written-command gap was 225.6 ms, median 246.55 ms, maximum 255.3 ms. There were no retained failed commands or mid-stream configuration changes; the retained SR command was the final idle timeout restoration.

This confirms the configured queue allowance was honored in the retained sample. It does not establish paper contact. The journal discarded **54,000 earlier entries**. Its separate full planned-pen-event schedule lacks corresponding full geometry and early command replies. A first-shape fault cannot be diagnosed from the retained tail. The diagnostic system needs a bounded dedicated transition journal retaining the first transition and enough neighboring XY endpoints/replies to match photographed artifacts; accumulating every QS reply and evicting the relevant beginning is inadequate.

### Confirmed clipping condition

The selected `Plot-me!` artwork in Chrome has bounding X 8.265 mm, width 192.85 mm, on A4 portrait (210 mm wide) with a 10 mm margin. Its nominal right edge is 201.115 mm. `preparePenPaths` clips to X 10–200 mm and Y 10–287 mm before ordering/planning. Thus boundary portions of this item's geometry can be omitted deliberately: the bounding box extends 1.735 mm past the left safe boundary and 1.115 mm past the right safe boundary. This does not prove which visible stroke is missing, because the complete font geometry was not exported, and it cannot explain long unwanted connectors.

The next geometry check should expose clipped areas in preparation and compare the full original artwork with the actual clipped motion plan. Keep margin clipping distinct from servo synchronization.

### No omitted fundamental execution step established

Plot-it orders travel → down → drawing → up, waits for queue idle at stroke boundaries, initializes PWM to 24 ms, holds servo power during plotting, and uses ordered serial acknowledgements. Preparation, manual control, pause/resume, Stop and cleanup share the pen transition helper. The new duration no longer feeds back into the ramp denominator. No further missing mandatory command was established by this review.

Queue-settled state remains a commanded-state estimate. Neither Saxi, the Python drivers, nor this EBB standard servo protocol provides a paper-contact sensor through these commands. The remaining fault needs a short matched test with complete tracing; successful ACK or queue idle cannot establish contact. In particular, long unwanted connectors should not be attributed to a small delay error without examining their geometry and adjacent up command.

## Source ancestry and pinned references

Saxi explicitly credits/inlines a planner derived from Michael Fogleman's Python **axi**, rather than directly porting Evil Mad Scientist's AxiDraw planner. The vendor Python driver is a separate comparison, and Plotink provides its EBB helpers. We reviewed both Python sources.

| Source | Reviewed revision |
|---|---|
| alexrudd2/saxi | `2640a3dd6c7a5261985f334255b827edb30e3109` (0.17.1) |
| fogleman/axi | `a5a12f01633076232be84a4e3321c80c7b9656b5` |
| evil-mad/axidraw | `a0df054f41f8e3ae8d408e08e7b2656968e375f1` |
| evil-mad/plotink | `4976b86080c25a10a9f979b870669dc62a1741fa` |
| nornagon/optimize-paths | `a7d0b2b43743372f8eff6f4b72c19320e0871053` (1.2.2) |

These are source snapshots checked on the review date, not a claim that all represent the latest downloadable vendor binary. The inspected AxiDraw Python trajectory module calls itself legacy. No NextDraw hardware compatibility is established by this review.

## Default settings comparison

All speeds below are XY mm/s; accelerations are XY mm/s². Python figures are calculated from its options and physical-unit scaling, not copied from percentage controls. Its default resolution is 16× microstepping; Plot-it uses 8×.

| Setting | Plot-it initial defaults | Saxi defaultPlanOptions | AxiDraw Python default, high resolution |
|---|---:|---:|---:|
| Drawing speed | 35 | 50 | ≈50.21 |
| Pen-up travel speed | 80 | 200 | ≈150.63 |
| Drawing acceleration | 200 | 200 | 762 |
| Travel acceleration | 400 | 400 | 1143 |
| Cornering | 0.127 mm | 0.127 mm | 10 option units, mapped to 0.0508 mm |
| Pen heights | 50 / 60 | 50 / 60 | 60 / 30, opposite percentage direction/range |
| Path reordering | nearest + reversal | enabled | 0: joining only; no nearest reordering |
| Nearby path joining | only matching endpoints, with protections | 0.5 mm | 0.006 in = 0.1524 mm |
| Extra pen-up/down delay settings | absent | absent in defaultPlanOptions | independently available, defaults 0 / 0 ms |

Plot-it's default acceleration already matches Saxi. Higher vendor accelerations are not evidence that the user's Xylodraw should run at those values. Pen calibration must not be copied between these percentage systems: Plot-it/Saxi map percent using 7500–28000 PWM units with decreasing pulse width; Python's standard-servo range is 9855–27831 with increasing pulse width. That difference also means the vendor's empirical per-percent mechanical coefficient cannot be assumed to be calibrated to the custom linkage and wider pulse range (Plot-it's full range is about 14% larger).

Python's cornering option is converted from its control scale; raw `10` is not interchangeable with Plot-it's `0.127`. Both use related junction-speed reasoning, but their trajectory subdivision and firmware delivery differ. Fogleman's planner ancestry is already represented by the pinned Saxi planner in Plot-it; another wholesale planner transplant is not justified by these symptoms.

## Python pen handling: meaningful differences

The AxiDraw driver has independently adjustable raise/lower rates and extra delays. It estimates motion time using a fourth-power blend of mechanical travel time and rate-limited signal sweep time, then adds the chosen extra delay. At a 22-point standard-servo transition with default rates, its model gives about 106 ms raising / 115 ms lowering; these apply to its own range and mechanism. Plot-it currently uses Saxi-style distance/duration rates plus a conservative separate tail, 249 ms at 20% / 42% (216 ms at 30% / 40%). The systems are not timing-equivalent.

Python also tracks startup pen state/configuration and establishes an up state when required, suppresses redundant moves, handles standard versus narrow-band output, and avoids zero-step trajectory pen toggles. Plot-it has corresponding standard-servo startup/caching/zero-step protections. Brushless-specific behavior must not be copied into the current standard-servo configuration.

The Python host sleep after a pen command is roughly its command delay minus 30 ms; it overlaps the queued delay. It is **not** an additional complete settling delay to add on top. Plot-it's queue-idle barrier serves a related sequencing purpose. Its absence as a literal host sleep is not an established missing behavior.

A useful addition would be separately configured extra down/up settling milliseconds, included identically in plan estimates and executor controls, while retaining the same ramp rate. Use a measured short pattern to choose them rather than guessing from a photograph. Keep startup settling independently testable.

## Path optimization: what can actually help

Plot-it already optimizes travel in its production `src/pens.ts` `orderUnits`, invoked from the planning worker. It uses greedy nearest endpoints, optional reversal, color buckets starting at origin, and atomic protected PlotFont blocks. `src/svg.ts` has additional similar helpers, but replacing only those helpers would miss the production path.

Saxi's `optimize-paths` uses greedy nearest endpoints with an RBush spatial index and reversals. Its first path is kept in source order. Fogleman's sorter similarly keeps the first path; the vendor Python sorter uses a spatial grid and starts each layer's selection from origin. These are not global shortest-tour solvers. An indexed search can reduce planning time while keeping the existing route rule; it does not automatically shorten the route compared with equivalent greedy selection. Preserve origin selection, tie ordering, tool boundaries, endpoint metadata and protected blocks when adapting it.

Saxi also optionally joins adjacent endpoints within 0.5 mm and filters short paths. Its defaults do **not** filter short paths (`minimumPathLength = 0`). Joining reduces lifts and can shorten physical job time, but changes geometry and can remove initial vertices inside the tolerance. Importing it wholesale while diagnosing missing lines/unwanted connectors would confound the investigation. Do not reorder/reverse the internal PlotFont schedule or turn intentional gaps into drawing strokes. Exact-endpoint joins are already supported where unprotected paths permit them.

For a later optimization implementation, use an endpoint spatial index in the worker for each unprotected path/atomic block, retain color/pen boundaries and original IDs, and keep joining as a separately explicit geometry option. Bounded route improvement can be evaluated afterward by estimated **travel time plus pen transitions**, not only travel distance. Avoid asserting a fixed speed gain on Pi hardware without measurement.

### Reproducible local probe

A deterministic synthetic set of 1500 independent two-point strokes was passed through the actual `preparePenPaths` and `buildMotionPlan` under Node 24.21.0. Results are illustrative, not measurements of the user's drawing or physical plot time:

| Mode | Ordering time on this Mac | Planned travel | Estimated job duration |
|---|---:|---:|---:|
| Preserve | 2.7 ms | 172433.9 mm | 3421.3 s |
| Nearest | 40.0 ms | 8215.0 mm | 1297.3 s |
| Nearest + reverse | 55.0 ms | 6682.0 mm | 1249.9 s |

All modes retained 1500 paths and 3001 pen events. This demonstrates that the existing optimizer already reduces travel dramatically on unordered independent strokes. It does not compare spatial-index runtime, prove global optimality, or predict savings for protected text.

The actual latest plan has 465 pen events and an estimated total of 272.124 s. At the current 30/40 calibration, 216 ms per event is roughly 100 s of modeled waits (the initial unknown transition differs). Pen cycles are therefore a substantial cost. They should only be eliminated when the geometry and drawing order truly permit it; higher travel speed alone cannot remove that cost.

## Next verification sequence

1. Preserve a compact plan plus transition traces covering the beginning and both ends of each disputed segment. Show drawing/travel geometry separately and report clipping.
2. Reproduce with a short pattern fully inside the margin. Compare first transition versus later transitions; test lowering and raising separately with the confirmed calibration.
3. If traces show correct target/dwell yet contact changes late, calibrate separate up/down tail delays. If a supposed travel line is in pen-down geometry, fix geometry preparation instead of pen timing. If target commands are absent/reordered, fix that demonstrated sequencing issue.
4. Only after contact behavior is understood, add indexed path search and measure it on representative drawings/Pi. Keep speed/acceleration changes independently testable.

133 existing targeted tests for pen state, execution, planning and pen/path ordering passed under pinned Node 24 LTS. No production changes were made, so no new full production build was required. The previous 530-test/build validation remains the validation of the current implementation, not proof of physical correctness.

## Primary references

- [Saxi planner and defaults](https://github.com/alexrudd2/saxi/blob/2640a3dd6c7a5261985f334255b827edb30e3109/src/planning.ts)
- [Saxi preparation/optimization](https://github.com/alexrudd2/saxi/blob/2640a3dd6c7a5261985f334255b827edb30e3109/src/massager.ts)
- [Saxi optimizer](https://github.com/nornagon/optimize-paths/blob/a7d0b2b43743372f8eff6f4b72c19320e0871053/src/index.ts)
- [Fogleman Python planner](https://github.com/fogleman/axi/blob/a5a12f01633076232be84a4e3321c80c7b9656b5/axi/planner.py)
- [AxiDraw Python pen handling](https://github.com/evil-mad/axidraw/blob/a0df054f41f8e3ae8d408e08e7b2656968e375f1/inkscape%20driver/pen_handling.py)
- [AxiDraw Python defaults](https://github.com/evil-mad/axidraw/blob/a0df054f41f8e3ae8d408e08e7b2656968e375f1/inkscape%20driver/axidraw_conf.py)
- [AxiDraw speed scaling](https://github.com/evil-mad/axidraw/blob/a0df054f41f8e3ae8d408e08e7b2656968e375f1/inkscape%20driver/axidraw.py)
- [AxiDraw path optimization](https://github.com/evil-mad/axidraw/blob/a0df054f41f8e3ae8d408e08e7b2656968e375f1/inkscape%20driver/plot_optimizations.py)
- [Plotink EBB helpers](https://github.com/evil-mad/plotink/blob/4976b86080c25a10a9f979b870669dc62a1741fa/plotink/ebb_motion.py)
