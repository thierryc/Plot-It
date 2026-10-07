# Plotter Core

Fresh TypeScript motion and EBB execution core. The root build uses ES2022 without
DOM or Node types. `./browser`, `./node` and `./virtual` are explicit adapters;
importing the root never discovers USB or loads native serial bindings.

The first implementation supports native SM, whole-stroke acceleration planning,
constant drawing with accelerated travel, 8x/16x native coordinates, mechanical
reloads, pen settling, raised-only bounds jobs and manual origin handling. Firmware
below 2.8.1 is rejected. The 3.x path currently uses SM; S-curves/T3/TD and the
remaining feature milestones are still pending.

```ts
import {compileJob, machineProfile, defaultPen, PlotterSession} from '@thierryc/plotter-core';
import {VirtualClock, VirtualEbb} from '@thierryc/plotter-core/virtual';

const clock = new VirtualClock();
const board = new VirtualEbb(clock, {firmware: '2.8.1', fragmentBytes: 1});
const profile = machineProfile('xylodraw');
const options = {
  profile, pen: {...defaultPen, up: 30, down: 52},
  speed: 35, travelSpeed: 60, acceleration: 200, travelAcceleration: 300,
  cornering: .127, maxPenDownMm: 30, returnToOrigin: true,
  drawingMode: 'profiled' as const,
};
const session = new PlotterSession(board.createTransport(), clock, profile);
await session.connect();
await session.run(compileJob([{tool: 'black', points: [{x:10,y:10},{x:50,y:10}]}], options));
await session.disconnect();
```

The session composes a serial protocol owner, feeder, pen configuration and origin
service. Connect does not move the machine. Every run restores servo settings and
settles Up before origin setup/travel. Pen transitions drain motion on both sides;
ACK and settlement have separate events. Observer exceptions are isolated;
callbacks should stay lightweight because browser execution shares the event loop.
Cancellation invalidates origin; no uncertain return is attempted. One connection
owns all commands and queries.

The virtual board parses actual serial bytes with its own step/queue interpreter.
It retains board state between connections/jobs and supports finite queues,
fragmented replies, injected reply delay and supply loss. Its 3.1.7 model currently
covers the implemented SM/servo command subset, including modern emergency-stop
semantics and SP,3 target rewriting; it does not yet emulate T3/TD. Virtual results
do not establish physical pen contact or line quality.

Run `npm run plot:virtual` from the repository, optionally with `-- --modern`,
`-- --constant`, or a JSON file containing normalized millimetre paths. This command
is virtual-only and cannot open physical hardware. Build with `npm run build:lib`.

License: AGPL-3.0-only, as specified by the parent project's LICENSE. Source review
references remain outside this package. This first planner uses an independent
triangle/trapezoid policy; exact vendor short-move policies remain a separate
acceptance item in the motor implementation plan.
