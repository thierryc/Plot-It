# Architecture

Plot-it intentionally has no runtime framework dependencies. The small TypeScript codebase is split at the boundaries that matter for a plotter:

| Module | Responsibility |
| --- | --- |
| `model.ts` | Paper, artwork, transform, and plot-setting types |
| `svg.ts` | SVG sanitization, import/export, DOM curve sampling, and path ordering |
| `plot-font.ts` | Original single-line Plot Sans glyph geometry |
| `typography.ts` | Local font storage, HarfBuzz shaping, OpenType settings and contour extraction |
| `packages/plotter-core` | Platform-neutral SM/T3/TD planner/compiler, EBB session, pen/origin services and virtual board |
| `trajectory.ts` / `motion-plan.ts` | Editor compatibility types and command-derived preview; planning delegates to the package |
| `motion.ts` / `motion-command.ts` | Reachable step geometry, coordinate mapping, native motor rate and command bounds |
| `plot-job.ts` / `planner.worker.ts` | Immutable job preparation and worker planning |
| `pens.ts` | Physical pen palette, assignments, selection, and ordered path blocks |
| `path-optimization.ts` | Endpoint joining, bounded polyline reduction, closed-start selection and reproducible random starts |
| `plot-workspace.ts` | Plot session, sidebar, connection, preparation, and shared player |
| `simulation.ts` / `live-plot.ts` | Simulation clock and hardware position visualization |
| `plotter.ts` / `plotter-core.ts` | Browser selection and editor/runner facade over the package's byte-transport session |
| `main.ts` | Editor state, interactions, dialogs, persistence, and orchestration |

The plot pipeline is:

```text
SVG objects → transformed browser SVG → sampled millimetre paths
            → margin clipping → pen assignment/filtering → ordered blocks
            → pen ranking → endpoint joining → vertex reduction → closed starts
            → within-pen path ordering → continuous-line splitting
            → reachable step geometry → worker motion plan
            → native SM or T3/TD records with shared integer timing
            → simulation / browser worker / Node runner
```

## Current boundaries

SVG elements and Bézier nodes are editable. Jog, layers, repeats and checkpoint-derived resume are implemented in the shared core/adapters; their physical acceptance is separate. Loaded TTF/OTF fonts use HarfBuzz, while OpenPlotFont retains original operations. See [typography](TYPOGRAPHY.md) and [plot controls](PLOT_CONTROLS.md).

Browser execution owns serial streams in a worker; Node/CLI reuse the core. Permission/device discovery belongs to adapters. Simulation uses the compiled program, but virtual success does not establish pen contact or exclude missed steps.

Firmware and machine limits are maintained in [Compatibility](COMPATIBILITY.md). The [core package](../packages/plotter-core/README.md) documents its public boundaries; [Development](DEVELOPMENT.md) lists build and verification commands.

Pen tuning and reload waits are shared by `pen-control.ts`, planning and SP execution.
`plot-statistics.ts` derives executable distances; `bounds-preview.ts` creates raised
placement plans for simulation and either USB adapter. `ebb-power.ts` decodes QC
readings; the shared core serializes supply checks with its feeder. Settings and
runner power/elapsed telemetry cross the existing network protocol. See
[plot controls](PLOT_CONTROLS.md).

## App presentation

The editor's native TypeScript UI uses `src/ui/design-system` for reusable controls
and `src/ui/app` for application views and DOM event adapters. Controllers retain
editing/persistence and hardware execution. CSS Module ownership is explicit at render
time; generic panel styles never size checkbox inputs. See [app UI](APP_UI.md) for
component contracts, surface lifecycle, the development showcase, and verification.
The website keeps its separate design.
