# Native SM / T3 / TD plotting core and EBB protocol

The driver is `@thierryc/plotter-core`. Browser and Node use the same session through byte-transport adapters; see [Architecture](ARCHITECTURE.md).

## Implemented protocol

- 9600 baud, CR-terminated ASCII commands; bounded fragmented-response parsing.
- `V`: version identification; firmware below 2.8.1 and unknown major families reject.
- `EM,2,2` for 8x, `EM,1,1` for 16x; `CS` establishes an explicitly captured frame.
- `SM,ms,motor1,motor2`: native motor deltas and integer durations.
- `SP,state,delay,pin`: queued Up/Down plus full host/device settlement barriers.
- `SC,4/5`, `SC,11/12`, `SC,8/9`: both targets, rates and servo timing restored.
- `SR`: hold servo power during a job, then apply the idle power timeout.
- `QG`: shared idle/status decoder; modern power-loss/limit events invalidate confidence.
- `QS`: controller step counters, separate from predicted/physical position.
- `QC`: raw supply/reference ADC readings, without assuming a hardware voltage divider.
- `ES,0`: purge leftover motor commands before a job and drain remaining legacy pen commands.
- `ES,1`: emergency motor stop/disable; no return from an uncertain position.
- `EM,0,0`: release at cleanup or explicit release, invalidating the physical origin.

Both legacy OK/data-plus-OK and future command-name/prefixed responses are parsed.
One protocol owner serializes all motor, manual, status and pen requests. A rejected
command is distinct from a lost/malformed response. Queries have bounded deadlines;
queued motor/pen acknowledgements allow longer device backpressure. A stray ES OK
is resynchronized through V and requires the actual ES status; it is not treated
as proof of a purge.

Physical Auto uses SM pending hardware acceptance. Explicit S-curve and virtual
Auto on 3.1.7 use T3/TD. CU,10,1 transition negotiation is synchronized within the
same exchange; QU,2/3 negotiates a bounded FIFO. TD occupies two entries. The
compiler and validator predict integer counters and fractional state exactly.
Older 3.x remains on SM; modern native timing acceptance is specifically 3.1.7.

## Coordinates and compilation

The editor uses millimetres; the core rotates canvas coordinates into machine
coordinates, then quantizes native endpoints with round-to-even:

```text
M1 = round_even((machine_x + machine_y) × native_steps_per_mm)
M2 = round_even((machine_x - machine_y) × native_steps_per_mm)
SM delta = native_target − previous_native_target
```

AxiDraw factory scale is 40 steps/mm at 8x and 80 at 16x; Xylodraw is 50/100.
Standard canvas rotation remains 90 degrees. Native endpoints can represent XY
half steps that the former integer XM lattice could not. Inverse conversion is
used for preview and position feedback, without rotating origin returns twice.

The first planner uses whole-stroke forward/backward speed reachability and
triangle/trapezoid ramps. Native command sampling is approximately 25 ms; integer
phase durations retain empty-interval time and enforce native rate limits.
Redundant collinear source points are removed before quantization. Compiled
records provide shared preview geometry/timing; the continuous display interpolates
between command endpoints, while the independent virtual board advances steps.

Constant drawing deliberately bypasses drawing ramps/corner slowing, while raised
travel still accelerates. Exact vendor short-move numerical policies and S-curves
remain separate acceptance work. No simulated result proves physical motion quality.

Mechanical reload splitting precedes planning; compiled drawing distance is checked
against the maximum. If step rounding would exceed it, split more conservatively.
Reloads settle motion, lift/wait/lower/wait at the same position, then start from rest.

## Pen and startup ordering

The basic plan for each separate stroke is **raised travel → stationary Down →
drawing → stationary Up**. A new job starts with a stationary Up. Return travel
is raised. These actions are explicit records in one immutable program; they
are not pen toggles driven by the simulation clock or total elapsed plot time.
Simulation samples that program without changing it or writing USB commands.
The serial owner finishes each stationary barrier before advancing to motion.
Browser simulation owns a cloned snapshot and stops scheduling frames when
paused, stopped or finished. Destroyed playback cannot emit later signals.
After simulation, hardware Start prepares a new program from the artwork and
current settings after removing playback overlays; subsequent hardware-only
repeats retain the prepared program. This applies to finished and stopped
simulation and to hardware bounds previews. USB stays connected and normal
job startup still restores pen configuration and drains the controller.

Pen percentages retain the existing AxiDraw/Xylodraw inverse pulse calibration.
All supported rates/delays are physical settings, with a 150 ms default extra Up
wait and a 50 ms lowering allowance. Long raised travel (at least 50 mm) adds a
100 ms stationary destination dwell before Down. Planned wait minima are inclusive.

A job checks power, purges/drains, restores both pen endpoints/rates and servo
configuration, holds power and forces settled Up before origin setup or XY. No R
firmware reboot occurs. If old motor motion was interrupted, origin is invalidated
and recovery is required; an arbitrary stopped carriage is not recaptured as origin.
An initial idle job can retain the established manual-origin/current-position workflow.

Each pen transition has stationary barriers before and after. Semantic Up/Down is
separate from its target percentage. Manual temporary Down heights are restored
before subsequent drawing. Bounds is a separately compiled raised-only intent;
it does not alter a normal plan's calibration or Down records.

The final idle QG response must also report the requested pen state before a
transition is marked settled. Firmware derives this bit from the target pulse's
equality to SC,4, so coincident heights and temporary manual heights are handled
the same way. A mismatch invalidates the remembered height, fails the job and
requires origin recovery; it never proceeds with drawing or a return move.
This verifies the controller's commanded state, not measured servo travel or
paper contact. An acknowledged SP and an empty queue alone are insufficient.

Pause/Stop occur at declared rest boundaries; manual pen adjustment is available
only after a paused queue settles. Cancel purges and raises, without an uncertain
home. Normal return uses the same native travel compiler while raised. Cleanup
settles Up, releases motors and schedules the configured standard-servo timeout;
brushless pen profiles retain their required configuration. Queued/settled state is not pen-contact
feedback.

Browser disconnect waits for transferred stream cancellation to release the
original readable/writable locks before closing Web Serial. The execution worker
is ended after device shutdown, so a new connection cannot retain that owner.

## Signals and verification

The editor facade retains PlotSignal source/event identity, time, position, tool,
pen height and counters. Hardware events distinguish started, queued and settled;
actual elapsed time includes pauses and serial/setup overhead. Typed package events
also expose request/write/reply/ACK/settlement phases. Format-7 direct-USB machine logs declare `ebb-native-sm-v1` or `ebb-native-t3-v2`;
the retained source plan allows comparison with playback. Diagnostics are bounded,
and observer failures cannot abort serial feeding.

Browser execution transfers the compiled program in acknowledged host pages of
at most 256 records or 64 KiB. This is independent of the negotiated controller
FIFO, which remains at most 16 entries on the current 32-entry firmware. TD uses
two FIFO entries. The existing ordered protocol owner retains device backpressure;
low-rate QU,6 occupancy and idle QU,4 hexadecimal stack high-water observations
are diagnostics, not settlement evidence. Host pages do not insert physical stops
or reset native accumulators. Whole executable storage remains memory-resident.

Core observers retain individual settled records by default. Observers opting
into `subscribe(observer, {settlementRanges:true})` receive inclusive verified
record ranges instead. The browser worker uses bounded pending telemetry and one
acknowledged batch in flight; discarded diagnostics are counted separately from
controller commands. The facade keeps the range endpoint checkpoint without
expanding the range into per-record UI updates. Rendering uses animation frames
and the sidebar is limited to 10 Hz except for state changes. Direct-USB log export
is idle-only and serializes in a separate worker; each executable appears once in
the version-7 digest-keyed program dictionary. Historical version-6 evidence is
not rewritten.

The virtual EBB parses bytes independently, models finite queues, queued pen targets,
step counters and firmware-specific stop behavior, and retains state between jobs.
Its clock permits reproducible tests without physical USB. The optional virtual CLI
runs bounds followed by drawing; `npm run plot:virtual` cannot open a real board.

The existing QC supply threshold remains 250/1023. Checks run on connect/start and
approximately every two seconds through feeding. Low supply stops execution and
invalidates origin. The fresh driver rejects malformed supply replies rather than
silently reporting a successful unavailable check.

NextDraw profiles/homing, copy/layer scheduling and recovered resume are implemented.
Modern CU,60 supply monitoring and latched QG fault handling prevent other status
queries from hiding a transient fault. QS endpoint comparison gates settled signals.
QT/ST, GPIO, model-specific limit inputs and public state/utility operations share
the same protocol owner. Physical acceptance remains pending; the numerical/control
differences are recorded in the implementation checkpoint.
