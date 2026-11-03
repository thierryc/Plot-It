# Hardware testing

Physical testing is optional and applies only to the exact machine, firmware and build recorded. Begin with the [alpha test guide](../ALPHA_TESTING.md) and [compatibility requirements](../COMPATIBILITY.md).

## Procedure

1. Save your document and identify the app version and source commit. Close other apps or runners using the board.
2. Match the actual profile, firmware, orientation, resolution and travel envelope. Calibrate pen Up/Down using the manufacturer's procedure. Do not treat fixture or test-code values as calibration presets.
3. Import a small fixture and restore its specified physical size in the inspector. Simulate it and inspect draw/travel paths before connecting.
4. Set the physical origin and preview bounds with the pen raised. If motors release or the carriage moves, restore origin before starting. Use conservative settings appropriate for your machine.
5. Plot one small sample. Record dimensions, closure, gaps, dots, unwanted travel marks and pen transitions. Try Pause/Resume and Stop only when the baseline is behaving correctly.
6. After the job stops, [download the machine log](../ALPHA_TESTING.md#download-and-copy-logs), save the editable document and attach reviewed evidence to a [hardware report](https://github.com/thierryc/Plot-It/issues/new?template=hardware-report.yml).

Stop if pen lift, scale or motion is wrong. Follow the machine's emergency procedure; do not repeat unsafe movement for evidence. Use Set origin after interrupted motion or released-carriage movement.

## Fixtures

| Set | Use |
| --- | --- |
| [General patterns](plotter-acceptance/README.md) | Short marks, curves, pen travel, corners and small loops |
| [SM cruise](sm-cruise-acceptance/README.md) | Long straight runs and direction changes |
| [Dynamic comparison](dynamic-acceptance/README.md) | Same-build Standard/Dynamic T3 comparison on explicit firmware 3.1.7 |
| [Dense T3](dense-t3-acceptance/README.md) | Large polyline preparation; advanced physical follow-up only |

Fixture manifests retain dimensions, geometry hashes and software checks. They do not contain physical results or establish support. For comparisons, use the same build, artwork, calibration and pen/paper; change only the feature under test and record both runs.

Use the [result template](results-template.md) or [CSV](results-template.csv). Record every attempt as passed, failed or skipped with a reason. Photographs and name credit are optional. Never prefill successful physical results from simulation.
