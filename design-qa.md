# Compact inspector implementation QA — 2026-10-06

final result: passed

## Visual target and implementation evidence

Source: `/Users/thierryc/.codex/generated_images/01a111dc-5f56-7581-af80-955489a33dcf/exec-01da8159-67d2-4d42-a353-91a3e160033e.png` (selected third concept, 1536 × 1024).

Implementation:
- Hosted app preview: `http://127.0.0.1:5185/app/`
- Local production preview: `http://127.0.0.1:5186/`
- Full Edit: `output/ui-review/compact-property-hosted-edit-final.jpg` (1276 × 979).
- Focused Edit: `output/ui-review/compact-property-edit-detail.jpg` (288 × 810, crop x988/y70).
- Full Plot: `output/ui-review/compact-property-hosted-plot-final.jpg` (1276 × 979).
- Local Edit/Plot: `output/ui-review/compact-property-local-edit-final.jpg`, `output/ui-review/compact-property-local-plot-final.jpg`.
- Phone: `output/ui-review/compact-property-phone-320-edit.jpg`, `output/ui-review/compact-property-phone-320-plot.jpg` (320 × 844); `output/ui-review/compact-property-phone-390-plot.jpg` (390 × 844).
- Dark states: `output/ui-review/compact-property-showcase-dark.jpg` (1280 × 720).
- Before: `output/ui-review/property-fields-before.jpg`.

State: hosted app has the existing SpaceRocks text selection, light theme, left rail, no hardware connection. Local app has the existing Rectangle selection, light theme, right rail. Tests restored geometry and typography with Undo. Simulation was stopped. No physical connection or motion was initiated.

Density normalization: browser DPR is 2, but screenshot output is one pixel per CSS pixel. The source is an illustrative design board whose pictured panels are approximately 384px wide despite its stated 288px target; it is not a calibrated CSS capture. Review uses the specified 288px desktop width and real 14px/30px controls as the scale contract. Concept panels and implementation panel regions were compared as corresponding regions, not treated as pixel-exact copies. The actual desktop dock is 288px including its border. Tablet breakpoints retain the existing 260px dock. The native modal drawer is 340px at a 390px viewport and 288px at 320px.

Full source and first implementation captures were opened together in one comparison input. Final source, focused Edit crop, full Plot capture and dark component evidence were opened together in another comparison input. The focused crop makes prefixes, values, units, caret and help alignment directly readable.

## Comparison history

1. Initial comparison: P2 checkbox copy wrapped on one side of a paired row; P2 Typography heading lacked the matching disclosure caret; P1 arrow selection restored focus to the previous icon after the controller rebuilt its view. Evidence: `compact-property-hosted-edit.jpg` and manual keyboard observation (selected Center, focused Left).
2. Corrections: shortened visible checkbox copy to Boundary/Connect while retaining full accessible names; added native Typography disclosure and aligned its contextual help; reduced excess nested-section spacing; moved focus to the destination radio before activation, allowing the rerender to restore that option. Added a regression test for synchronous activation focus.
3. Final comparison: the Edit crop and Plot screenshot show aligned column edges and trailing units. Keyboard observation shows selected Center and focused Center after ArrowRight. No actionable P0/P1/P2 findings remain.

## Required fidelity surfaces

- **Typography:** existing system UI font retained; control text 14px, regular 400 button/radio weight. Quiet prefixes are 12px and units 11px. Values use tabular figures and right alignment. Names and multiline content stay left aligned. Long font names retain truncation and a full accessible name.
- **Spacing/layout:** 30px desktop property rows; 6px shared column/row gaps; 12px app panel padding. Geometry, typography and fill share the same tracks. Measured paired fields are 128.5px wide, with unit right edges at 1120.5px and 1255px in the desktop capture. No prefix chip or separator. Native disclosures/help share header alignment. Floating workspace mode switch remains small.
- **Colors/tokens:** existing light/dark colors, focus and theme behavior retained. Dark property background is rgb(35,35,41), value rgb(227,227,232), prefix rgb(170,170,183). Disabled and invalid states remain legible; focus outline surrounds the whole property row.
- **Assets/icons:** Lucide alignment/upload/rotate/copy/delete vectors match the existing app icon family. No raster UI assets were introduced. Existing plotter canvas illustration remains the app's original renderer.
- **Copy/content:** compact X/Y/W/H, Deg, Cap/Line/Track/Word, Profile/Model/Rail and Draw/Travel labels have full accessible names. Product content and selection names remain real. No concept annotations or design instructions appear in the app.

Intentional product constraints: the existing calibration presets and editable pen name/hex controls remain accessible. Plot settings keep their existing section structure and Advanced controls. Motors/Pen sections follow actual destination/connection state. Physical Start remains disabled when disconnected. Fill shows Overlap for None/Solid and Gap for hatch modes according to the existing model. Generated concept text does not change those behaviors.

## Validation

- Local production build and hosted site build passed, including TypeScript checking. Existing bundle-size and HarfBuzz browser-externalization warnings remain.
- 28 UI tests passed; 36 Plot workspace tests passed; 2 hosted-artifact tests passed. Initial failures during concurrent plotting-core edits resolved on the final runs without changing those core files for this UI task.
- Browser: arrow selection/rerender focus, native font upload Tab access, help Escape/focus restoration, numeric keyboard editing/Undo and simulation/Stop passed.
- Responsive: 320px and 390px modal drawer, 640px and 768px tablet dock, and desktop reviewed. Property rows stay 44px on touch layouts. Plot scroll width equals client width at both phone sizes; no page horizontal overflow at tablet sizes. Escape returns focus to Inspector. Temporary viewport overrides were reset.
- Current production preview console error lists are empty for local and hosted apps. The development tab retains earlier module-export errors logged while the separate core migration was underway; none were generated by the final component showcase navigation.
- Hosted artifact tests confirm `/app/` asset routing/service-worker scope and separation from website styles. No deployment, push or publication was performed.

## Completion checklist

- [x] Reusable native property field and icon radio component behavior.
- [x] Both Edit and Plot compositions updated.
- [x] Accessibility and rerender focus verified.
- [x] Component showcase and ownership/usage documentation updated.
- [x] Both local preview builds refreshed and left available.

P3 follow-up: calibration presets could eventually move into a dedicated calibration composition if a separate workflow redesign is requested. They remain available in this pass.

## Diagnostics monitor button follow-up

Replaced the Virtual EBB monitor text link with the shared native pill button (400 weight, 9999px radius). Tab focus and Enter activation were verified in the local production preview; the resulting `/virtual.html` tab loaded the monitor and was closed after verification. Evidence: `output/ui-review/virtual-monitor-button.jpg`. Local and hosted builds pass; 36 Plot workspace tests pass. The existing site-mode exclusion is preserved because the hosted artifact does not package the monitor page. Both previews were refreshed. No publication occurred.

## Machine select alignment follow-up

Profile, Model and Rail now opt into the shared `propertyField` left alignment variant in Edit and Plot. Their quiet label slot is 42px, so all three selected values begin at x1058 in both desktop previews. Select padding is 4px vertically with a 20px line height; control/prefix centers have zero offset. Numeric fields retain right alignment. Evidence: `output/ui-review/select-alignment-local.jpg` and `output/ui-review/select-alignment-hosted.jpg`. Both builds and four property/machine-profile tests pass. Both app previews were refreshed; no publication occurred.
