# Licensing and distribution

Thierry Charbonnel owns the original Plot-it application, core, companion, website and documentation and licenses that work under [Apache-2.0](../LICENSE). [NOTICE](../NOTICE) identifies the project. The OpenPlotFont workspace remains separately [MIT licensed](../packages/openplotfont/LICENSE). Dependencies, font assets and attributed adaptations retain their own terms.

## Retained sources

- Core planner/junction equations: Michael Fogleman's MIT `axi`, revision `a5a12f01633076232be84a4e3321c80c7b9656b5`.
- Discrete EBB math: Plotink `ebb_calc.py` 1.1.0, MIT, revision `4976b86080c25a10a9f979b870669dc62a1741fa`.
- Homing adaptation: NextDraw 1.7.4 `homing.py`, MIT.
- Protocol facts and controller behavior: public EBB command documentation. Hardware specifications are not evidence of physical acceptance.

Exact notices, hashes and implementation boundaries are in the core [reference directory](../packages/plotter-core/reference/) and [third-party notices](../THIRD_PARTY_NOTICES.md). Per-font attribution and source hashes remain alongside each bundled asset. Required notices must remain intact.

## Distribution checks

Browser/site builds include `public/licenses/` and a source archive containing LICENSE, NOTICE and third-party records. Packaging tests compare their bytes. Native/Node packages must also carry the licenses of the actual runtime and target-specific binaries they distribute. Source pins do not by themselves certify an npm WASM or native binary's complete build provenance.

Remaining evidence to verify for a distribution:

- HarfBuzz npm WASM build/toolchain constituents and individual source notices.
- Platform-specific SerialPort, Node and companion runtime/native component notices.
- Full applicable copyright statements for supplied OFL templates; pin the Roboto/Noto test-fixture sources.
- Exact correspondence of embedded Clipper JSBN portions to the preserved Tom Wu permission notice; the original Stanford endpoint was unavailable.
- Origin records for original adapters, geometry and emulator code where source-level review is still needed.

These are open evidence items, not a statement that the entire dependency tree has been independently cleared. Apache-2.0 applies to the rights held in original work and does not replace third-party permissions.
