# Architecture

Plot-it intentionally has no runtime framework dependencies. The small TypeScript codebase is split at the boundaries that matter for a plotter:

| Module | Responsibility |
| --- | --- |
| `model.ts` | Paper, artwork, transform, and plot-setting types |
| `svg.ts` | SVG sanitization, import/export, DOM curve sampling, and path ordering |
| `plot-font.ts` | Original single-line Plot Sans glyph geometry |
| `typography.ts` | Local font storage, HarfBuzz shaping, OpenType settings and contour extraction |
| `motion-plan.ts` / `vendor/saxi` | Shared physical-mm acceleration plan, sampling and EBB command compilation |
| `plot-job.ts` / `planner.worker.ts` | Immutable job preparation and worker planning |
| `pens.ts` | Physical pen palette, assignments, selection, and ordered path blocks |
| `plot-workspace.ts` | Plot session, sidebar, connection, preparation, and shared player |
| `simulation.ts` / `live-plot.ts` | Simulation clock and hardware position visualization |
| `plotter.ts` | Web Serial connection and EBB command queue |
| `main.ts` | Editor state, interactions, dialogs, persistence, and orchestration |

The plot pipeline is:

```text
SVG objects → transformed browser SVG → sampled millimetre paths
            → margin clipping → pen assignment/filtering → ordered blocks
            → pen ranking and within-pen path ordering → continuous-line splitting
            → worker acceleration plan → simulator / EBB LM (or sampled XM) queue
```

## Deliberate MVP constraints

- Imported objects are transformed as units; direct Bézier-node editing is a later milestone.
- Plot Sans is a compact uppercase stroke font. Loaded TTF/OTF fonts use HarfBuzz and the same `ArtworkItem` path output; see [typography](TYPOGRAPHY.md) for the supported run layout and remaining limits.
- Acceleration planning and simulation share Saxi-derived motion blocks. Physical motion accuracy still requires real-device calibration.
- Start can capture the current position as origin; explicit origin capture, pen tests, return, and motor controls live in the Plot sidebar. Jog controls remain future work.

## Further work

Physical calibration on both devices, jog/bounds preview, and layer management.
See [SIMULATION.md](SIMULATION.md) for motion and positioning behavior.
