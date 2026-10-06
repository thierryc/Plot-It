# Pen execution audit — 2026-10-05

This audit follows the A3 hardware trials. The user requested a consistent
review and simplification, rather than further timing workarounds. The initial
audit made no production change; the subsequent requested rollback and its
verification are recorded below. No cause is described as confirmed without
physical evidence.

## What the drawing pipeline actually sends

The supplied `a.svg` has two closed contours in one SVG path: the outside A and
a separate rectangular horizontal bar. Both survive contour parsing and motion
planning. The Direct USB job includes a down transition at event 824 followed by
200 bar motion commands. Its full journal has 6,018 entries and no truncation.

The pair fixture contains four contours in source order: first outside, first
bar, second outside, second bar. The runner journal confirms four down commands.
Thus the reported missing bars are not explained by dropping the second `M`
contour or by omitting its pen-down command in these trials.

Preview geometry is an ideal plan. Neither its pen indicator, EBB XY counters,
QP's commanded pen state nor QR's power state measures actual pen contact.

## Comparison with pinned Saxi

The inspected Saxi revision is
`2640a3dd6c7a5261985f334255b827edb30e3109`.

* The acceleration planner is already adapted from that revision. Plot-it's LM
  axis-rate equations and CoreXY step conversion correspond to Saxi's
  `moveWithAcceleration` and `axisRate` implementation.
* Both arrange each stroke as travel, down, drawing and up. Plot-it adds machine
  controls, pen changes, cancellation and physical-idle checks around the same
  ordered execution. Node precompilation and browser on-demand compilation use
  the same `compileMotion` and `PlotterCore` functions.
* Current Saxi computes an S2 slew rate from the requested pulse difference and
  pen-motion duration. Plot-it additionally estimates mechanical settling,
  rounds/guards PWM cycles, keeps cached requested/accepted/queue-settled pen
  state, and performs explicit startup and power-timeout handling. This is not
  a literal copy of Saxi's pen policy.
* Plot-it also writes SC,11/12 rates even though ordinary movements use S2's
  explicit rate. Those values serve firmware SP behavior; they do not override
  the explicit S2 rate. They are a possible simplification after one pen policy
  is selected, not evidence that an S2 command was missing.

Do not transplant Saxi path joining or change acceleration while isolating pen
contact: either would change the comparison geometry.

## Hardware evidence and controlled comparison

Confirmed settings for these A tests are 30% up / 44% down, drawing 50 mm/s,
travel 200 mm/s. The machine is using firmware 2.8.1. Reserved test coordinates
remain inside the common 297 mm square of the A3 sheet; no full-page test is used.

1. The first browser A printed its bar but left a short ink trail after the
   outside contour. Its up-to-travel command gap was about 251 ms. A missing
   inner-left stroke was also visible in the photograph.
2. A server A with 600 ms queued pen holds removed the visible travel trail and
   printed its bar. The inner-left stroke was still absent in the photograph.
3. Two smaller As with the same 600 ms holds had missing bars according to the
   user. Their down-to-next-motion gaps were 621–633 ms. Repeating the same pair
   with 1,200 ms down holds did not make the pen lower according to the user.
   Increasing a delay alone has therefore not established a fix.
4. A stationary diagnostic issued direct S2 targets with rate zero: 44% down for
   five seconds, then 30% up, twice. No XY command was sent. The user explicitly
   confirmed that the pen lowered, rose and touched the paper. QP changed 1/0
   and QR stayed 1, but the physical confirmation is the useful evidence.
5. A controlled pair replay then used the production executor, identical
   complete drawing and original 600 ms holds. Only S2's explicit slew-rate
   field was set to zero in an isolated diagnostic wrapper. The two journals
   contain the same 110 hardware commands after replacing that field with a
   placeholder. All nine differences are S2 rates. SC setup, SR policy, XY
   commands, targets, holds and cleanup are identical. The runner finished and
   returned counters to 0,0. The user reported that neither horizontal bar
   printed, then clarified that no carriage movement was observed in that
   automatic comparison. Rate zero is therefore not an established plotting
   fix, despite the successful stationary lift test.
6. A subsequent fresh server job repeated the pair. The user reported that
   the pen did not lower and asked to stop. At the Stop check, the runner was
   already idle, with motors released and counters 0,0; its USB connection was
   released. No further drawing trials should be initiated without renewed
   user authorization after the requested stop.

The read-only board check before that retry returned QC `0348,0299`, QR `0`,
QP `1`, QE `0,0` and QS `0,0`. On firmware 2.8.1, QC has two ADC fields, not
the three expected by current Saxi's `queryVoltages()` helper; its second field
corresponds to approximately 11 V at the motor supply. QR zero was read after
an idle timeout and does not establish a power loss during execution. A
commanded-position counter cannot establish physical carriage movement.

Local diagnostic artifacts are intentionally not shipped with the app:

* `output/hardware-a3/a-pair-test-notes.json`
* `output/hardware-a3/a-pair-down1200-plan.json`
* `output/hardware-a3/stationary-direct-results.json`
* `output/hardware-a3/a-pair-direct-target-log.json`
* `output/hardware-a3/slew-comparison.json`

## Decision boundary

Do not call the arbitrary 600/1,200 ms trial holds a new default or measured
servo latency. The successful stationary check changes more than the rate
relative to a full plot; it cannot alone isolate the ramp as the cause. The
matched pair is the test that isolates the explicit S2 slew rate.

If that comparison restores both bars, reduce the shared pen policy to one
consistent direct-target transition plus its queued settling interval, remove
the custom slew calculation and redundant SP rate setup, and write regression
tests before the implementation. Then verify browser and runner through the
same production path. If the bars are still missing, do not pretend removing
the slew calculation has solved it: inspect physical contact during motor
execution and startup state separately, without rewriting the planner.

## Primary sources inspected

* [Saxi EBB executor](https://github.com/alexrudd2/saxi/blob/2640a3dd6c7a5261985f334255b827edb30e3109/src/ebb.ts)
* [Saxi planner](https://github.com/alexrudd2/saxi/blob/2640a3dd6c7a5261985f334255b827edb30e3109/src/planning.ts)
* [EBB 2.8.1 firmware](https://github.com/evil-mad/EggBot/tree/343eefb9daff49ca872dceb28bd94015f123489d/EBB_firmware/app.X/source)
* [EBB 1.8–2.8.1 command reference](https://evil-mad.github.io/EggBot/ebb2.html)

## Requested rollback and clean reference test

After the user requested the earlier simpler code, `pen-control.ts` and
`plotter-core.ts` were restored to their prior committed implementations. The
distance/duration rate changes and additive settling estimate were removed.
Regression expectations were written and failed before the rollback, then
passed afterward. Existing safeguards for origin, command acknowledgement,
physical-idle checks, Stop and USB ownership remain part of that baseline.

The queued-delay tests now assert what firmware actually exposes rather than
treating an assumed additive mechanical model as measured physical contact.
No new servo timing setting, execution layer or production delay workaround
was added.

A clean diagnostic uses three centreline As in the unused strip x170–274,
y130–154 mm. Each A has one continuous two-leg stroke and one independent
horizontal bar. All six pen-down strokes and all raised travels are checked
before use, and the plan returns to origin. Its reference loop sends an ordered
FIFO stream, matching pinned Saxi's pulse-distance/duration rate formula and
existing LM step conversion. It does not call PlotterCore.plot/pen/home, use its
target cache, poll positions during drawing, or route through HTTP/WebSocket.
Startup enables motors before holding servo power and establishes the safe up
target. This diagnostic is distinct from the restored production baseline;
neither implementation is described as physically fixed until observed.

The user authorized this new test after their earlier Stop. Its preparation,
plan, expected command sequence and read-only snapshots are retained under
`output/hardware-a3/three-a-reference*`. Full suite and build verification are
performed with pinned Node 24.21.0 LTS. Physical results are pending the user's
photograph.

### Physical result and retained implementation

The repeated reference test in the left strip x10–34, y140–244 was reported
"completed but wrong". Its photograph shows the intended legs and bars plus
ink on raised travel paths, including links between letters. The current Saxi
rate/duration loop is therefore not a demonstrated fix for this setup.

Three further As at x40–64, y180–284 then ran through the **restored production
PlotterCore**, with no command override and no experimental holds. The journal
contains all six down commands `S2,18980,4,1230,120` and all six planned lifts
`S2,21850,4,1845,120`. No entries were dropped. The board finished up, with
counters 0,0, and the user reported "good" for that run.

Keep that earlier implementation. This is acceptance of the small three-A
test, not a measurement of the servo's full response curve or validation of
every font, device and drawing. The tests use different paper positions, so
they do not establish a universal mechanical root cause for the failed ramps.

Verification after rollback: 534 regression tests passed under Node 24.21.0
LTS, plus four browser/site artifact checks. Local/server, browser-only and
hosted-site production builds succeeded. The API and runner were restarted
with the restored code and manual USB ownership. A fresh Chrome server tab
prepared successfully after an older tab retained a stale worker-load error.
The server document's pen heights were returned from the earlier diagnostic
20/43 settings to the physically tested 30/44; speeds remain 50/200. Server
USB was released after this configuration update.

## Review after the shared text-path fix

The text extraction correction consumes each shared generated batch once. It
does not modify pen events, PWM targets, rate calculation or the executor.
The three subsequent user jobs still contain correctly ordered 30% / 44%
commands, with 120 ms queued holds before their following drawing/travel
commands. The user reports that manual controls work but plotting transitions
are wrong. This does not establish that the SVG correction caused a new servo
regression; reduced retracing can expose problems previously hidden by repeated
contours.

The retained timing calculation used `max(signalTime, physicalTime, minimum)`.
EBB's S2 delay begins when the queued servo move starts, while PWM ramps. This
does not reserve the mechanical estimate after the final PWM target arrives.
A conservative model that allows that settling interval fails the previous
120 ms calculation in both browser/runner execution and LM/XM tests. These are
model-based tests, not measurements of this servo's response.

The candidate correction changes only the dwell combination to
`max(signalTime + physicalTime, minimum)`. Percentage mapping and the restored
1845/1230 up/down slew rates remain unchanged. The shared planner and executor
both use it: at 30% / 44%, down is 179 ms and up is 155 ms. Stationary zero-delay
power refreshes remain unchanged. No path optimization, acceleration change,
alternate command or extra control layer is introduced.

Physical acceptance of this correction is pending. Earlier failed long-hold
experiments mean timing alone cannot yet be claimed as the complete cause of
the user's fault. The calibration remains 30% / 44%, drawing 50 mm/s and travel
200 mm/s. A stationary manual check with motors engaged was sent and the pen
then lifted; motors were released afterward. Its physical result awaits the
user's observation.
