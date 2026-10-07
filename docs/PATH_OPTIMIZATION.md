# Path optimization

Controls are under **Plot → Advanced → Path optimization**. They change the
prepared plotting paths; editable source artwork stays intact. Simulation,
Direct USB and the Node runner use the same prepared plan.

| Control | Behavior | Default |
| --- | --- | --- |
| Join endpoints within (mm) | Join open strokes of the same assigned pen and line width whose endpoints are within this distance. The gap becomes a drawn straight connector. | 0: gap joining disabled |
| Simplify within (mm) | Remove dense polyline vertices while bounding the deviation from the sampled path by this distance. Keep open endpoints and explicit ring closure. | 0: reduction disabled |
| Closed path start | Retain the original start, choose the nearest existing vertex, or choose a random existing vertex. Rotation keeps the contour edges and direction. | Original start |
| Random seed | Reproduce random closed starts across preparation, simulation and hardware. Change the seed to change the chosen contact points. | 1 |

The existing **Path order** modes still apply: preserve, nearest, and nearest
with reversal. Grouped plotting starts each pen's travel ordering from origin.
Nearest closed starts participate in that selection and use the current cursor.
In **Follow artwork order**, tool changes reset that cursor to origin, while
path and color order stay intact. The random seed is saved with the document;
random preparation does not depend on the clock or a browser-specific RNG.

Joining in nearest modes grows a stroke at either end using the closest eligible
endpoint. Only **Nearest + reverse** allows reversing a candidate stroke. In
preserved path/source order, only consecutive forward strokes can join. Exact
touching ordinary paths retain the existing motion planner's joining behavior.
Existing closed contours remain separate from open strokes.

Protected OpenPlotFont operation blocks retain their internal order and geometry.
Generated fill paths retain their geometry so optimization cannot draw a new
connector across a hole or replace a contained fill route with a chord. Joining
does not cross either kind of protected operation or an existing closed contour.
Grouped ordering can move protected blocks as units, as before.

Preparation clips to safe bounds and assigns/excludes pens first, joins eligible
paths, reduces vertices, chooses seeded random starts, then orders paths and
chooses nearest starts from the actual travel cursor. **Pen reload distance**
splits the resulting full drawn length, including gap connectors. Optimization
cannot rejoin reload chunks because splitting is last and the motion planner
keeps those chunk boundaries when reload distance is enabled. Step rounding
still introduces the machine's existing step-resolution tolerance.

Old documents and network plans that omit these controls receive their original
behavior. Native document loading, planning and network admission reject invalid
tolerances, start modes and non-integer/out-of-range seeds.

The original TypeScript functions live in `src/path-optimization.ts`. The
behavior inventory was checked against the pinned AxiDraw
[optimization module](https://github.com/evil-mad/axidraw/blob/a0df054f41f8e3ae8d408e08e7b2656968e375f1/inkscape%20driver/plot_optimizations.py).
The reduction algorithm and seeded random generator are independent
implementations; command streams need not match Python byte for byte.
