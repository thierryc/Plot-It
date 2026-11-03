# Plotter Core

TypeScript motion and EBB execution core. The root build uses ES2022 without
DOM or Node types. `./browser`, `./node` and `./virtual` are explicit adapters;
importing the root never discovers USB or loads native serial bindings.

The core supports native SM, whole-stroke acceleration planning,
constant drawing with accelerated travel, 8x/16x native coordinates, mechanical
reloads, pen settling, raised-only bounds jobs and manual origin handling. Firmware
below 2.8.1 is rejected. Explicit S-curve/T3/TD targets firmware 3.1.7; physical Auto remains SM pending acceptance. NextDraw model-specific lift and homing, layers, repeats and settled checkpoints are implemented. Hardware support is experimental; see [compatibility](../../docs/COMPATIBILITY.md).

```ts
import {compileJob, machineProfile, defaultPen, PlotterSession} from '@thierryc/plotter-core';
import {VirtualClock, VirtualEbb} from '@thierryc/plotter-core/virtual';

const clock = new VirtualClock();
const board = new VirtualEbb(clock, {firmware: '3.1.7', fragmentBytes: 1});
const profile = machineProfile('xylodraw');
const options = {
  profile, pen: {...defaultPen, up: 30, down: 52},
  speed: 35, travelSpeed: 60, acceleration: 200, travelAcceleration: 300,
  cornering: .127, maxPenDownMm: 30, returnToOrigin: true,
  drawingMode: 'profiled' as const,
  backend: 't3' as const, firmware: '3.1.7',
};
const session = new PlotterSession(board.createTransport(), clock, profile);
await session.connect();
await session.run(compileJob([{tool: 'black', points: [{x:10,y:10},{x:50,y:10}]}], options));
await session.disconnect();
```

Standard is the default strategy, including this modern virtual example. To opt
into Dynamic, add `motionStrategy: 'dynamic'`, optionally with
`dynamicCurveAcceleration` (mm/s², defaults to `min(100, acceleration / 2)`) and
`dynamicAnticipationMm` (0–20 mm, default 3). Dynamic requires profiled drawing,
T3 and explicit firmware 3.1.7. Pen-up motion remains Standard. Its fixed-distance
curvature envelope and S-curve timing preserve geometry and nominal scalar
speed/acceleration continuity through source vertices; they do not certify vector
jerk at polyline turns or integer command boundaries. `planDynamicMotion` exposes
nominal phases, speed spans and required stops for inspection. See the
[same-build physical comparison](../../docs/validation/dynamic-acceptance/README.md).

Long strokes remain continuous unless `workloadCheckpoints` is supplied:

```ts
const checkpointOptions = {
  ...options,
  workloadCheckpoints: {
    maxDrawingRecords: 2000,
    maxDrawingMs: 10000,
    maxDrawingMm: 250,
  },
};
```

These budgets apply to actual compiled drawing chunks. The compiler splits source
geometry, replans rest-to-rest, and lifts/lowers at shared endpoints; it never
cuts arbitrary native commands to force a stop. Mechanical reloads remain separate.
`program.workloadCheckpoints` reports preview cuts, chunk count and added duration;
chunk/source identity is retained in records and settled checkpoints. Impossible
budgets and inconsistent layer policies are rejected explicitly. Feature-off
compilation retains its existing path. Physical restart quality requires testing.

`session.subscribe(observer, {settlementRanges:true})` opts into inclusive
`record-range` settlement events (`recordId` through `recordEndId`). They follow
idle and matching native-position verification. Default core observers still
receive individual record events. A command ACK does not imply settlement.

The session composes a serial protocol owner, feeder, pen configuration and origin
service. Connect does not move the machine. Every run restores servo settings and
settles Up before origin setup/travel. Pen transitions drain motion on both sides;
ACK and settlement have separate events. Observer exceptions are isolated;
callbacks should stay lightweight because browser execution shares the event loop.
Cancellation invalidates origin; no uncertain return is attempted. One connection
owns all commands and queries.

The virtual board parses actual serial bytes with its own step/queue interpreter.
It retains board state between connections/jobs and supports finite queues,
fragmented replies, injected reply delay and supply loss. Its 3.1.7 model includes literal T3/TD arithmetic, FIFO/backpressure, servo progression, emergency-stop semantics, GPIO and model-specific homing inputs. Virtual results
do not establish physical pen contact or line quality.

Run `npm run plot:virtual` from the repository, optionally with `-- --modern`,
`-- --constant`, or a JSON file containing normalized millimetre paths. This command
is virtual-only and cannot open physical hardware. Build with `npm run build:lib`.

License: Apache-2.0 for original core code. MIT axi, Plotink and NextDraw adaptations retain their complete notices in `reference/`. See [motion sources](reference/MOTION-PROVENANCE.md) and [distribution notes](../../docs/LICENSING.md).
