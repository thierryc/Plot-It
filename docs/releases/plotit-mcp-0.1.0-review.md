# PlotIt MCP 0.1.0 build 5 review

Reviewed on 2026-11-03 for the first public alpha draft, `plotit-mcp-v0.1.0-alpha.1`.

The review covered SwiftUI setup and state ownership, paper presets and custom dimensions, agent-control readiness and remembered Off, shared native/MCP setup operations, conversation-card lifecycle and progress accuracy, vector masks, signing, universal runtime packaging, source provenance and release materials.

## Findings resolved

- Clear physical-origin confirmation when the connection, origin state or saved machine configuration changes. A confirmation from an earlier connection cannot silently carry forward.
- Ignore an old in-flight progress response after a card is retargeted to another drawing, and ignore results after teardown. Controls and progress stay attached to the current job.
- Require a clean source commit for signed releases and reject source changes during the build. Record the sealed source archive's SHA-256 and take the release-kit archive from the app itself.
- Support a universal-only public download, which works on Apple Silicon and Intel. Keep website downloads disabled while the release is an unpublished draft.
- Retain mask-resolved vector artwork and the Node-only JIT entitlements required by both CPU runtimes. Verify signed runtimes before notarization.

No remaining code findings block preparation of this alpha candidate.

## Validation

- 1,873 unique automated tests passed; 33 conditional tests skipped. Four socket integration suites were rerun with local socket permission after sandbox `EPERM` errors; all 25 tests in those suites passed.
- Seven native Swift tests passed.
- Production website build and both route/assets tests passed.
- Both glyphs matched independent mask subtraction above 99.98% coverage.
- Final signed-runtime, notarization, container, checksum and installed-app results are recorded in the release kit after the clean build.

## Acceptance still requiring physical environments

Actual plotter/profile behavior, card rendering in each supported agent client, and clean installation on separate Intel and Apple Silicon Macs remain manual acceptance items. The alpha retains experimental hardware labels and does not infer physical compatibility from simulation. Readiness never starts or resumes a drawing automatically.
