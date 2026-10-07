# Plot-it license review — 2026-10-05

The application currently declares **AGPL-3.0-only**, not MIT or ordinary
GPL-3.0. Removing the Saxi modules does not automatically change that declaration
or establish that every replacement can be released under MIT. MIT is a feasible
target for a future release, subject to clearing replacement-code provenance and
the rights to the original application contributions.

This is a repository provenance assessment, not a legal determination of whether
particular similarities constitute a derivative work. No application code,
licenses, or notices were changed by this review.

## Evidence and scope

Reviewed the current working tree, including uncommitted changes, against Git
HEAD `dcb3fe9`; package metadata and lockfile; third-party notices; the planner,
compiler, and pen-control files; bundled font notices; source-archive packaging;
and locally preserved upstream snapshots under `output/upstream-review`.
The current source is materially different from committed HEAD. Conclusions about
the working tree do not certify a deployed website or an existing build archive.

The snapshot manifest pins:

| Reference | Revision | License relevant to reuse |
| --- | --- | --- |
| alexrudd2/saxi | `2640a3dd6c7a5261985f334255b827edb30e3109` | AGPL-3.0-only, as recorded by the earlier vendored headers/notices; upstream license is AGPL v3 |
| fogleman/axi | `a5a12f01633076232be84a4e3321c80c7b9656b5` | MIT, corroborated by upstream repository metadata |
| evil-mad/axidraw | `a0df054f41f8e3ae8d408e08e7b2656968e375f1` | The inspected `motion.py`, `pen_handling.py`, and `dripfeed.py` headers say GPL version 2 or later |
| evil-mad/plotink | `4976b86080c25a10a9f979b870669dc62a1741fa` | MIT; verified in the preserved `ebb_motion.py` header |

Some pinned license URLs could not be retrieved through the web tool. The AxiDraw
and Plotink file headers were checked locally; Fogleman's pinned standalone MIT
notice still needs to be acquired before using it as a replacement source.
Do not treat the entire Evil Mad Scientist software collection as one license.

## How much Saxi remains?

- **Zero current Saxi imports or package dependencies found** in application,
  server, scripts, package manifest, or lockfile.
- **Two removed vendored files, totaling 876 lines** relative to HEAD:
  `src/vendor/saxi/planning.ts` (803) and `vec.ts` (73).
- Two current source mentions remain: a paper-size comment in `src/model.ts:81`
  and connection troubleshooting text in `src/plotter-core.ts:159`. These mentions
  do not establish code reuse.
- Old Saxi code remains in Git history and the ignored local workspace archive.
  `scripts/source-archive.mjs` does not package that archive or Git history.
- HEAD's notices also record that the earlier `src/motion-plan.ts` adapted Saxi
  rate calculations. Removal of the vendor directory alone is therefore not a
  sufficient provenance test for all surviving application code.

There is no defensible percentage of remaining Saxi-derived copyrightable
expression from this inspection. Direct dependency count and derivation are
different questions; text matching does not resolve translated or restructured
code ancestry.

## Remaining obstacles to an MIT release

The current notices describe the replacement planner and compiler as original.
The following evidence requires a more precise provenance record before relying
on that statement for relicensing:

1. `src/trajectory.ts:19–32` reproduces the reviewed AxiDraw policy's combination
   of the cruise-distance margin, four 25 ms slice threshold, 0.9 crossover
   adjustment, averaged initial-speed boost, and bounded fallback acceleration.
   These correspond to the preserved GPL `motion.py` around lines 650, 771, 802,
   and 860. General acceleration equations are not the issue; the specific
   implementation choices and their source need examination.
2. `src/pen-control.ts:23–29` uses AxiDraw's mechanical/sweep fourth-power timing
   blend, 0.9 distance cutoff, 45/2.69/200 parameters, and the `>50` / `-30` host
   pacing rule. Its implementation differs, including rounding and extra settling
   time, but the comments explicitly identify the Python timing model.
3. `src/ebb-pen.ts` consumes that timing policy and references Python feeder
   pacing. Also check `src/motion-plan.ts` and `src/motion-command.ts` for residual
   adaptation from the previous Saxi compiler and the vendor driver.

These are provenance review targets, not findings that every listed file is
legally GPL-derived. The US Copyright Office distinguishes protected expression
from functional algorithms and logic. Implementing the documented EBB protocol,
using factual hardware limits, or using standard kinematics does not by itself
require the reference implementation's license. Conversely, translating protected
Python implementation into TypeScript does not make it MIT.

The lockfile declares no GPL/AGPL/LGPL third-party package dependency. The root
application is the AGPL entry; the local OpenPlotFont package is already MIT. Other
declared package licenses are permissive (MIT, MIT-0, ISC, BSD, Apache, Boost).
This metadata scan is not a file-by-file audit of every transitive package.

Font assets remain separately licensed. In particular,
`pf-cad-iso3098` and `pf-cad-iso3098-i` carry GPL v2-or-later notices. OFL, Hershey,
CC0 and Apache ancestry also remain. An MIT application does not relicense those
assets. To simplify distribution, consider removing/replacing the two GPL font
assets or distributing them separately with their required source and notices;
keep the other asset licenses explicit. Converted font geometry retains provenance.

## Recommended route

Keep the current AGPL declaration until provenance is resolved. If distributing
adaptations of the GPL Python files, retain their copyright and license notices
and assess the applicable GPL/AGPL combination requirements; the current notice's
statement that upstream implementations are not vendored is not enough by itself.

For a future MIT application release:

1. Document independent authorship of the replacements, or replace uncertain
   parts using a specification based on public protocol documentation and standard
   mathematics. A documented independent implementation gives stronger evidence
   than renaming or reformatting existing GPL/AGPL code.
2. Alternatively port directly from MIT **Fogleman axi** for planning and MIT
   **Plotink** for EBB helpers. Verify the exact source files and retain the full
   upstream copyright/permission notices. MIT ancestry in Fogleman's planner does
   not permit copying Saxi's later AGPL additions under MIT.
3. Obtain separate permissive permission from relevant upstream rightsholders if
   retaining protected GPL/AGPL adaptations is preferable to replacement.
4. Confirm rights to original application contributions. Git lists one author,
   but that does not establish sole copyright ownership. Original code owned by
   the project rightsholder may be offered under MIT; third-party contributions
   require a sufficient grant or their holders' permission.
5. Update LICENSE, package metadata/lockfile, README, notices, UI/site labels and
   distribution artifacts together once cleared. Past AGPL grants remain valid;
   old Saxi-containing releases/history are not converted to MIT by a new release.

Both MIT and AGPL permit commercial use without a license purchase. MIT's main
reuse condition is preserving its copyright and permission notice. AGPL requires
the applicable copyleft/source obligations, including section 13 for modified
programs supporting remote network interaction.

## Primary sources

- [Saxi license](https://raw.githubusercontent.com/alexrudd2/saxi/main/LICENSE)
- [Fogleman Python axi repository](https://github.com/fogleman/axi)
- [AxiDraw pen-handling file and GPL header](https://github.com/evil-mad/axidraw/blob/master/inkscape%20driver/pen_handling.py)
- [Plotink MIT license](https://raw.githubusercontent.com/evil-mad/plotink/master/LICENSE)
- [MIT license text](https://opensource.org/license/mit)
- [US Copyright Office, computer programs, Circular 61](https://www.copyright.gov/circs/circ61.pdf)

Current upstream links corroborate license families; local pinned source headers
and the revision manifest supply the version-specific evidence described above.
