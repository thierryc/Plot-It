# Alpha testing

[Open Plot-it](https://thierryc.github.io/Plot-It/app/) · [Issue tracker](https://github.com/thierryc/Plot-It/issues)

Plot-it is an early alpha. Start with editing and simulation; no plotter or installation is needed. Save a `.plit.json` backup of any work you want to keep.

## Limitations

- Hardware profiles are experimental. AxiDraw, NextDraw and Raspberry Pi setups still need independent physical validation. A successful connection is not a compatibility test. See [model and firmware requirements](COMPATIBILITY.md).
- Direct USB needs desktop Chrome or Edge with Web Serial. Safari and Firefox can be used to try editing and simulation. The public app has no network runner; that requires a [local installation](NETWORK_PLOTTER.md).
- Browser storage can be cleared and is separate for each website address. Save document files; SVG export does not preserve every editable text or fill setting.
- SVG images, native text, masks, filters and unsupported paints are not general plotting inputs. Convert imported text to paths, or use the built-in Text tool. Complex drawings may take time to prepare.
- Outline fonts draw contours; stroke fonts draw centerlines. There is no automatic font fallback, paragraph wrapping or mixed-direction paragraph layout. Fonts retain their own licenses.
- Simulation cannot establish dimensional accuracy, pen contact, missed steps or physical line quality. Plot estimates exclude manual pen-change time. Advanced motion, repeats, fills and recovery need configuration-specific testing.

## A short test

1. Follow [Your first drawing](GETTING_STARTED.md): import the starter, restore its 80 × 80 mm object size and run **Simulate**.
2. Try Pause, Resume and Stop. Return to **Edit**, make a change and undo it.
3. Save a `.plit.json` document, reload it and check your artwork and settings. Export SVG and check it separately.
4. Note anything confusing or missing. A useful feature suggestion is welcome too.

Physical tests are optional. Match your actual profile, firmware, pen calibration and origin before moving a machine. Use [the hardware test procedure](validation/README.md), start small, and stop if pen lift, scale or motion is wrong. Do not upgrade firmware just to join the alpha.

## Report a bug

1. [Search existing issues](https://github.com/thierryc/Plot-It/issues), including closed ones. Add evidence to a matching report instead of opening a duplicate.
2. Open a [bug report](https://github.com/thierryc/Plot-It/issues/new?template=bug-report.yml) for editing, saving, simulation or startup, or a [hardware report](https://github.com/thierryc/Plot-It/issues/new?template=hardware-report.yml) for a physical test. Use one issue per problem.
3. Give a short title, exact steps, the expected result and what happened. Include your browser/OS and whether you used the hosted app, a local app or the Pi runner.
4. In **Plot → Diagnostics**, copy the **App** version. For a hosted build, [release.json](https://thierryc.github.io/Plot-It/release.json) gives `sourceCommit`; for a local checkout, use `git rev-parse HEAD`. Say “unknown” if unavailable.
5. Attach a small reproducible example, screenshot or log when useful. For hardware, include model/modifications, board/firmware, profile, motion settings, pen heights and measurements. List checks you skipped.

## Download and copy logs

**Machine log:** after a physical job finishes or stops, stay in the same session and open **Plot → Diagnostics → Download log**. Wait for “Machine log downloaded.” The file is `plot-it-machine-log.json`. With a network plotter, this action first fetches diagnostics from the runner. Do not reload or start another job before collecting evidence. A failure before execution may have little or no machine trace.

Attach the JSON file to the issue. To copy an excerpt, open it in a text editor, copy the relevant error and nearby entries, and paste them into the issue's log field or a fenced code block. Attach the complete reviewed file when possible. There is no in-app Copy log button.

**Browser errors:** in Chrome or Edge, open **More tools → Developer tools → Console**. Reproduce an editing/startup problem, then copy the error text into the issue. If a refresh is needed, enable **Preserve log** first. Do not rerun unsafe hardware motion just to collect a log.

**Local server errors:** copy the relevant output from the terminal running Plot-it. For a Pi service, `journalctl -u plot-it-api -u plot-it-runner -n 100 --no-pager` shows recent output.

Review files and excerpts before posting: machine logs can include drawing coordinates, commands and settings; documents may embed artwork and fonts; terminal output can contain local paths or network details. Remove secrets and private details, and share only material you have permission to publish. Photos and public name credit are optional.
