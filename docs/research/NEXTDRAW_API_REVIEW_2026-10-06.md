# NextDraw CLI and Python API review — 2026-10-06

Reviewed the actual distribution linked under “NextDraw APIs” on the user's
[installation page](https://support.bantamtools.com/hc/en-us/articles/28809050405011-Bantam-Tools-NextDraw-Software-Installation).
This is the CLI/Python ZIP, not an Inkscape platform installer.

The fresh download is API/core **1.7.4**, dated **2026-10-02**, with SHA-256
`809e9c276243cd67f58440b5699359ecfdff556a409225bb04bb0f3adf050688`.
It is identical to the archive used for the motor review. Code is preserved under
`output/upstream-review/nextdraw-1.7.4/`, including the Python source inside the
bundled `nextdrawcore` wheel. It was not installed. No serial access, firmware
change, or physical movement occurred. Two isolated function probes were executed;
the complete installed CLI/API and hardware behavior were not exercised.

## Findings affecting adoption

### 1. CLI offset flag is not transferred to the core — P2

`nextdraw/nextdraw_cli.py:168` defines `--offset_start`, and its flag normalization
at line 270 retains it when true. However, the CLI transfers options via
`utils.assign_option_values(..., utils.OPTION_NAMES)` at line 347, and
`nextdraw/utils.py:10` omits `offset_start` from that list.

With the normal default `offset_start=False`, the requested CLI flag never reaches
the core option. The distance does transfer. The isolated assignment probe returned:
requested offset=True, resulting core offset=False, resulting distance="5in".
The later core branch at `nextdrawcore/nextdraw.py:329` therefore remains disabled
for that path. A configuration default can take another route, and direct Python
assignment to `nd.options.offset_start` is separate; this finding is specifically
about the CLI option transfer and the corresponding helper-based updates.

There is a second transfer boundary: `nextdrawcore/nextdraw_control.py:209` also
omits `offset_start` from its selected_options list when constructing the core
instance. Repairing the CLI helper alone is therefore insufficient for the ordinary
CLI wrapper route.

Suggested upstream fix: include `offset_start` in both option-transfer lists and
test the documented CLI flag through to the core options. For Plot-it, validate that every persisted/UI/
network setting reaches the compiler; do not copy this fixed option list blindly.

### 2. Disconnected interactive verification can silently return — P2

`nextdraw/nextdraw_py.py:281` returns `self.connected` directly from
`_verify_interactive(True)`. The base core initializes `connected=False` at
`nextdrawcore/nextdraw.py:107`. When the attribute exists but is false, the verifier
returns false without reaching its `handle_errors()` and RuntimeError path.
Several callers, including `moveto`, then return without moving or reporting an error.

The isolated verifier probe with interactive mode and connected=False returned
False, raised no exception, and did not call handle_errors. This differs from the
public API documentation's stated exception behavior for unconnected interactive
motion. It is not a claim that all disconnect/error paths are silent: hardware
errors encountered during execution also have separate handling.

Suggested upstream fix: raise explicitly when connection verification is requested
and connected is false; test before connect, failed connect and after disconnect.
For Plot-it, retain an explicit disconnected error and preflight checks.

### 3. Position/pen accessors are cached state, not physical confirmation

`current_pos()` and `current_pen()` at Python API lines 532/539 return cached
`pen.phys` values. They do not issue QS/QG at the moment of the call. The feeder
updates that state from command predictions as commands are issued. This is useful
bookkeeping, but a method named “current” must not be interpreted as encoder feedback
or a paper-contact measurement.

`block()` calls `serial_utils.exhaust_queue`, which normally polls QG every 50 ms.
That helper may also return on a pause request/button press or a read failure.
It therefore needs an explicit success/error outcome when adapted into our settled
signal contract; returning from a wait must not always imply completed motion.

## Architecture

Both APIs share the same motor engine:

| Entry point | Wrapper | Shared implementation |
| --- | --- | --- |
| CLI `nextdraw` | argparse/config/output handling in `nextdraw_cli.py`; multi-device wrapper in `nextdraw_control.py` | `nextdrawcore.nextdraw`, motion/pen/homing modules, Plotink |
| Python `NextDraw()` | `nextdraw_py.py` extends the core class; adds plot and interactive methods | The same core and helpers |

The CLI is MIT-licensed; the inspected Python API/core files carry GPL-2.0-or-later
notices. Plotink's inspected helpers are MIT. The CLI wrapper's license does not
make its underlying motor planner MIT. No project license changes were made.

The official modern serial class requires **EBB firmware >=3.0.2**. The API exposes
AxiDraw model codes 1–7 and NextDraw models 8–10, but that does not provide a legacy
2.8 fallback. An upgraded AxiDraw can use the modern engine; an AxiDraw on 2.8 still
needs our separate compatibility backend. There is no dedicated Xylodraw profile
among these ten models.

## Plot lifecycle and state reset

Python plot_setup parses an SVG file/string and initializes option parsing without
starting physical plotting. plot_run calls set_defaults before entering the core.
That reset clears status flags, counters, temporary pen-height mode, warnings,
transforms and digest state. It does not reboot firmware, clear every user setting,
or by itself establish a physical origin.

Actual plot_document preparation does the following:

1. Check the connection/supply for physical plotting.
2. Run servo_init: read controller configuration markers and commanded pen state,
   apply heights/rates, and initialize servo mode as needed.
3. Raise the pen.
4. Enable the required motor resolution, avoiding unnecessary re-enables.
5. Establish/read the home reference through the homing subsystem.
6. Execute prepared path data.
7. Raise the pen and, on ordinary completion, return to the plot origin.

Model/resolution changes can invalidate homing. The homing subsystem reads native
step counters and clears fractional accumulators when synchronizing position.
Controller variable 12 records the homed state; variables 24–31 hold step offsets.
These controller variables are software markers, not a replacement for an origin
that matches the actual machine mechanics.

There is no normal per-plot R firmware reboot. The observed R command belongs to a
utility path that writes a USB nickname, not the regular plot startup.

## Whole paths versus interactive individual moves

The interactive API is useful but must be adapted at the correct level:

| API method | Behavior |
| --- | --- |
| `moveto` / `move` | Raise, then absolute/relative travel |
| `lineto` / `line` | Request drawing, then absolute/relative movement |
| `goto` / `go` | Move while preserving intended pen state |
| `draw_path` | Clip a vertex list, travel to its start, plan a full continuous stroke, then raise |
| `delay` | Queued controller-timed delay |
| `block` | Drain/check the controller queue, with early-return conditions described above |

Individual interactive segments ultimately call `go_to_position`, which passes
zero entry and exit speeds to compute_segment. Plot-it must not implement a dense
polyline by repeatedly calling that equivalent of lineto: it would plan each segment
from rest and lose continuous full-stroke motion. Use plan_trajectory for each
stroke/reload chunk, as draw_path and plot_polyline do.

The intended “turtle” coordinate/state is separate from the last command-derived
machine coordinate/state. Clipping can move/lift differently from the requested
out-of-bounds command while preserving the caller's logical destination. Our batch
planner needs explicit clipped geometry and pen boundaries rather than copying that
interactive state machine into every plot operation.

## Pen handling and the earlier failure pattern

servo_init reads encoded Up/Down configuration from controller variables 10/11 and
the QG pen bit, then writes both rates and both target pulses. It writes SC,4/SC,5
even when it later decides no extra lift/lower is required. This is stronger than
assuming a cached boolean is sufficient to establish the active calibration.

Pen transitions use queued SP plus a duration computed from servo mechanics, sweep
rate and configured extra delay. Long transitions use overlapping host pacing;
normal motor movement remains ordered after the pen command in the controller queue.
NextDraw's cached z_up is updated when the command is issued, not after a contact
sensor confirms the change. Plot-it's separate requested/queued/settled states and
full stationary pen barriers should be retained.

On pause, the feeder uses SP,3 to raise immediately and prevent queued lowering.
That also makes the Down target equal to Up. `servo_revert` at pen_handling.py:474
waits for the queue, then restores the configured Down target. Normal core plot
cleanup invokes it. This is an important behavior to reproduce, including exception
paths that need our own explicit finally/recovery handling.

The API's offline preview sets simulated state and skips serial communication.
It is not the physical raised bounding-box job provided by Plot-it. Preview state
must not be used as evidence for the next physical plot's pen state or calibration.
Our new jobs should force Up and restore calibration even if caches suggest Up.

Standard servo profile: pin B1, 9855–27831 pulse units, 24 ms cycle configuration.
Brushless narrow-band profile: pin B2, 5400–12600 pulse units, one PWM channel rather
than eight, different motion timing constants. Preserve the user's existing
Xylodraw mapping and calibration; selecting modern firmware must not select a
brushless servo configuration automatically.

## Motors, preview and pause/resume

The current core segment compiler uses T3/TD and native motor rounding. Preview
bookkeeping consumes those compiled move records and Plotink's predicted steps/
accumulators. The feeder retains an SM handler for utility/compatible operations;
this is not evidence that the whole API works on pre-3.0.2 firmware.

Connection setup uses future response syntax, FIFO depth 16, and one command owner.
Status handling distributes button, limit and power-loss events. Motor resolution
is queried before enabling to avoid losing an established origin through an
unnecessary EM command.

Resume is stored as drawn distance and settings in SVG plotdata, not simply as a
current screen position or completed animation percentage. Its queue-aware distance
tracker subtracts pending drawing when computing the pause location. TD counts as
two queued movements. Resume also constrains settings so that re-planning does not
silently change the remaining path.

The Python error configuration distinguishes connection failure, button pause,
keyboard pause, USB loss, power loss, and homing failure (codes 101–106).
Exceptions are optional for these status conditions; callers can instead preserve
returned resume data and inspect errors.code. The CLI maps recognized status codes
>=100 to a nonzero process exit. It does not expose a browser telemetry protocol.

CLI multi-device plotting uses separate core objects/document copies and threads,
with a shared pause request. This is an optional API feature, not required for the
current single-controller migration.

Statistics have mixed API units: interactive coordinates default to inches and can
select centimeters/mm; plot distance variables are returned in meters; res_dist
is mm. In physical mode Python's time_estimate is assigned elapsed execution time,
while preview mode computes a prediction. Plot-it should keep mm internally and
separate estimated duration from actual elapsed time.

## Consequences for our implementation plan

The two-backend recommendation remains appropriate. Apply these refinements:

- Separate job-state reset from user-setting reset and firmware reboot.
- Reapply both calibrated pen targets at job entry and after SP,3, regardless of
  cached pen state. Restore temporary layer/manual heights explicitly.
- Keep physical raised bounds as its own immutable prepared program.
- Plan complete strokes/reload chunks, not isolated per-vertex interactive moves.
- Give queue drain a typed outcome: idle, interrupted, disconnected or failed.
- Separate predicted position, queried step-counter position and origin confidence.
- Verify option flow across UI, documents, worker and network settings, including
  new jerk/backend fields. Add a disconnected-state test that must report an error.
- Keep resume identity/settings and pending queue distance coherent; do not equate
  queued progress with completed drawing.
- Keep model/servo choices explicit; default NextDraw model 8 is inappropriate for
  the user's Xylodraw without a separately configured physical profile.

The package is a useful behavior/numerical reference and a possible offline oracle
for the modern backend. Calling its CLI from our server would introduce a Python
runtime, SVG/config/resume translation, separate progress/control behavior, and
firmware >=3.0.2 requirements. It would not by itself add the mechanical reload
feature or preserve browser Web Serial support. Keep the planned TypeScript driver
as the application implementation.

## Evidence and limits

Isolated probes are saved in
`output/upstream-review/nextdraw-1.7.4/api-review-probes.json`.
They execute only selected option-transfer/verifier functions extracted with AST,
using stub state, without importing the hardware driver or opening a serial port.
They support the two wrapper findings; they do not establish motor quality, prove
all error paths, or certify the complete NextDraw distribution.

Source entry points: `nextdraw/nextdraw_cli.py`, `nextdraw/nextdraw_py.py`,
`nextdraw/utils.py`, `nextdrawcore/nextdraw_control.py`, `nextdrawcore/nextdraw.py`,
`nextdrawcore/pen_handling.py`, `nextdrawcore/homing.py`, `nextdrawcore/plot_status.py`
and the previously reviewed motion/Plotink modules.

Primary references:

- [User-specified installation page](https://support.bantamtools.com/hc/en-us/articles/28809050405011-Bantam-Tools-NextDraw-Software-Installation)
- [Official CLI/Python ZIP](https://software-download.bantamtools.com/nd/api/nextdraw_api.zip)
- [Python API](https://bantam.tools/nd_py/)
- [CLI API](https://bantam.tools/nd_cli/)
- [Firmware compatibility guide](https://bantam.tools/nd_migrate/)
