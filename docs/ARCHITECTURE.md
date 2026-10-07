# Architecture

Plot-it intentionally has no runtime framework dependencies. The small TypeScript codebase is split at the boundaries that matter for a plotter:

| Module | Responsibility |
| --- | --- |
| `model.ts` | Paper, artwork, transform, and plot-setting types |
| `svg.ts` | SVG sanitization, import/export, DOM curve sampling, and path ordering |
| `plot-font.ts` | Original single-line Plot Sans glyph geometry |
| `typography.ts` | Local font storage, HarfBuzz shaping, OpenType settings and contour extraction |
| `packages/plotter-core` | Fresh platform-neutral native SM planner/compiler, EBB session, pen/origin services and virtual board |
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
            → reachable step geometry → worker acceleration/short-move plan
            → native motor SM records with shared integer timing
            → simulator / fresh EBB SM + SP session
```

## Deliberate MVP constraints

- Imported objects are transformed as units; direct Bézier-node editing is a later milestone.
- Plot Sans is a compact uppercase stroke font. Loaded TTF/OTF fonts use HarfBuzz and the same `ArtworkItem` path output; see [typography](TYPOGRAPHY.md) for the supported run layout and remaining limits.
- Acceleration planning and simulation share original polyline acceleration blocks. Physical motion accuracy still requires real-device calibration.
- Start can capture the current position as origin; explicit origin capture, pen tests, return, and motor controls live in the Plot sidebar. Jog controls remain future work.

## Further work

Physical calibration on both devices, jog controls, and layer management.
See [SIMULATION.md](SIMULATION.md) for motion and positioning behavior.
The plotting target is AxiDraw Python feature parity plus mechanical-pen reloads;
the current status and remaining work are tracked in [AXIDRAW_PARITY.md](AXIDRAW_PARITY.md).

The proposed reusable browser/Node/CLI architecture is documented in
[Plotter Core architecture](PLOTTER_CORE_ARCHITECTURE.md), with the pending migration
checklist in [the motor implementation plan](MOTOR_IMPLEMENTATION_PLAN.md). That
design targets native SM and modern T3/TD backends, with firmware 2.8.1 through
current 3.1.7. The shared package/session, browser execution worker, SM/T3/TD backends and
CLI/client/virtual adapters are active. Hardware acceptance remains pending. See the
[implementation checkpoint](CORE_REWRITE_STATUS.md) for implemented scope and limits.

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
