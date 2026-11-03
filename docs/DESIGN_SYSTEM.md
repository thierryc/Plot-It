# Plot-It lean design system

Project files are authoritative. The optional [Figma companion](https://www.figma.com/design/pB3xCCLSiRu6EGJurHeJMF) is refreshed explicitly from code. Changes in Figma are proposals until implemented and validated in this repository.

## Foundations

- `src/ui/design-system/tokens.css`: semantic colors, interface measurements, typography, focus and responsive control sizes.
- `src/ui/design-system/foundations.ts`: dimensions and breakpoints needed by JavaScript. `scripts/read-design-system.test.mjs` checks shared values against CSS.
- `src/theme.ts` and the early bootstrap in `index.html`: matching theme resolution before first paint.
- `scripts/read-design-system.mjs`: read-only JSON handoff for a deliberate Figma refresh. It resolves token aliases and touch overrides; it does not generate CSS or run in the app build.

Use the system UI font: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. Numerical values inherit the same family with tabular figures. SF Pro Regular, Medium and Semibold were verified in Figma before creating its text styles. Font specimens and document text keep their own fonts.

| Role | Desktop | Touch |
| --- | --- | --- |
| Body / label | 14 / 20 px, regular | Same |
| Secondary | 12 / 16 px | Same |
| Section heading | 14 / 20 px, semibold | Same |
| Panel padding / group gap | 12 px | Same |
| Control gap / label gap | 6 / 4 px | Same |
| Field / action | 30 / 32 px | 44 px minimum |
| Toolbar target | 36 px | 44 px |
| Slider hit region / track / thumb | 30 / 1 / 10 px | 44 / 1 / 10 px |
| Icon / stroke | 18 / 1.5 px | Same |
| Keyboard focus | 1 px contrasting outline, 2 px offset, translucent cyan halo | Same |

Touch control rules apply at widths up to 639 px or with a coarse pointer. The tablet sidebar boundary remains 950 px. Toolbar labels collapse separately at 740 px. These breakpoints describe different layout constraints.

## Themes and feedback

Everyday controls and primary actions are neutral. `--accent` is cyan **#00E5FF**, `--warning` orange **#FF9A00**, and `--error` pink **#FF3B8D**. Cyan fills are translucent or tinted for retained selection and active highlights. Fluorescent colors are paired with readable neutral text, an icon and a message for warnings/errors.

Light panels are #FAFAFA with white controls and #222222 text. Dark panels are #252525 with #2E2E2E controls and #EEEEEE text. The workspace uses light gray #F3F3F3 in light mode and charcoal #444444 in dark mode. Workspace status text uses its own `--workspace-ink` role so it remains readable against either background. Canvas keyboard focus uses a separate `--workspace-focus` role: #555555 in both modes (low-emphasis against the dark #444444 workspace), with a 1 px inset outline. Theme changes do not change document paper, artwork colors, font geometry or exports. The `--canvas-ui-*` roles are intentionally stable across themes. Dashed object-selection outlines use `--canvas-selection` (#2693FF), with a 1 px non-scaling stroke and at least 3:1 contrast against both white paper and the dark workspace. Mechanical plotter dimensions and document coordinates do not become UI tokens.

The decorative plotter has separate theme roles: `--plotter-backdrop-opacity` is 0.012 in light mode and 0.055 in dark mode. `--plotter-backdrop-filter` renders it as a faint dark silhouette on light gray and a soft light silhouette on charcoal. These effects apply only to `.plotter-rig`, outside the paper and exported geometry. The read-only token handoff exposes them under `effects`, separate from physical dimensions.

## Components

Existing native HTML helpers remain the component layer; there is no additional UI framework.

| Family | Source |
| --- | --- |
| Buttons, icon actions, fields, checkboxes, disclosure headings | `src/ui/design-system/components.ts` and adjacent CSS modules |
| Property numeric fields and units | `src/ui/design-system/property-field.ts` |
| Segmented controls | `src/ui/design-system/segmented.ts` |
| Slim slider with editable caption value | `src/ui/design-system/slider.ts` |
| Warning/error feedback | `src/ui/design-system/feedback.ts` |
| Dialog and menu surfaces | `src/ui/design-system/overlays.ts` |
| Floating toolbar and workspace | `src/ui/app/workspace.module.css` |
| Font picker | `src/ui/app/font-picker.ts` and `font-picker.module.css` |
| Text session, tabs and axis controls | `src/ui/app/canvas-text-editor.ts` |
| Persistent textarea markers | `src/ui/app/text-decorations.ts` |
| Resize affordances | `src/ui/app/resize-controls.ts` |

Slider rows keep the native range and numeric input, with the label/value caption beneath the thin track. Thumbs are hollow at rest and solid while focused or dragging. The caption value updates on each native slider input event; only geometry is debounced. Existing min/max, units, increments, Shift stepping, mixed values and data hooks pass through unchanged. Text previews retain the 150 ms debounce and flush before commit. The editor keeps its 180 px textarea and independently scrolling settings. Selection, IME handling, document formats and typography APIs are unchanged.

Feedback icons use local Lucide SVG masks, so a controller updating `textContent` cannot erase the icon. Keep simple settings as checkboxes; keep the established minus/check controls for font features. Nested disclosure headings remain regular-weight gray. Canvas resize/rotation controls suppress the native oversized focus halo and use a 1 px neutral stroke on the small visible knob; the larger pointer hit area stays unchanged.

## Motion and rendering feedback

Motion is interface-only. The paper, artwork paths and physical plotter coordinates are not tweened. Shared policy lives in `tokens.css`, `foundations.ts` and `motion.ts`; the read-only handoff includes motion values and CSS/JavaScript parity tests cover durations.

- Sidebar: 320 ms with a restrained elastic `cubic-bezier(0.22, 1.12, 0.36, 1)` surface transition. Canvas grid space settles monotonically to avoid overshooting available width. Direct divider resizing remains immediate.
- Dialogs: 180 ms entrance, 130 ms exit, 6 px offset and 0.99 scale, using `cubic-bezier(0.22, 1, 0.36, 1)`. Commit/cancel and drawer-to-editor focus handoff remain immediate. An inert outgoing editor can finish its exit after the app shell updates.
- Progress: 120 ms surface transition. Jobs shorter than 180 ms stay silent; visible feedback waits for 260 ms of quiet and remains visible for at least 320 ms. Related fill/estimate stages update one continuous indicator rather than flashing separate popups. Cancel is disabled during the quiet hold when no job is active. Computation itself is not delayed.
- Reduced-motion preferences disable surface transitions. Rapid reversal cancels obsolete animation callbacks so they cannot close a newly active surface or steal focus.

## Explicit Figma refresh

The companion contains **Overview**, **Foundations**, **Components** and **App Examples**. It has private primitive variables, semantic Color Light/Dark modes, Dimensions Desktop/Touch modes, semantic Motion variables, and verified SF Pro text styles. Native control variants cover default, hover, focus, disabled, selected, mixed and invalid states where applicable. App examples reuse components and the original `public/examples/alpha-starter.svg` vectors, with identical white paper in both modes.

`docs/design-system/figma-companion.json` stores file/page/collection/component IDs and source fingerprints. It contains no second set of token values. This is a navigation and refresh ledger, not a runtime dependency.

1. Implement and review the change in project files. Run token parity tests and relevant component tests.
2. Run `node scripts/read-design-system.mjs > /tmp/plot-it-design-tokens.json`. This is the explicit handoff. Do not redirect the Node-LTS wrapper's runtime banner into JSON.
3. Open the companion in the confirmed team/account. Resolve existing collections and nodes using the ledger. Verify the exact available SF Pro family/styles before writing text.
4. Update primitive aliases and semantic values from the handoff. Keep Color Light/Dark and Dimensions Desktop/Touch modes. Preserve CSS mappings such as `var(--slider-thumb-size)` in variable code syntax. Bind fills, strokes, sizes, gaps, padding and typography to the corresponding variables.
5. Update native main components from their referenced source files, then refresh instances and examples. Preserve component property bindings and mixed/invalid demonstrations. Never replace the editable UI with a screenshot.
6. Resolve every semantic color in Light/Dark and every metric in Desktop/Touch and compare with the handoff. Verify fonts, native instances, bindings and screenshots. Update the ledger's refresh date/fingerprints only after checks pass.

Figma does not automatically overwrite code, publish a library or synchronize tokens. No such automation is installed.
