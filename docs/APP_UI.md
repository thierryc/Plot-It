# App UI ownership

The design system is private to the editor, including the local, browser-only,
and hosted `/app/` builds. The public website has its own CSS and design.

## Layers

- `src/ui/design-system/`: app-scoped tokens, framework-free native HTML primitives,
  one CSS Module per component, escaped typed attributes, and generic overlay lifecycle.
  Import the public `index.ts` entry. This layer must not import editor models,
  persistence, hardware services, or app selectors.
- `src/ui/app/`: editor shell, inspector/typography/fill views, menus/toolbars,
  font picker, Plot settings/pen/player views, app CSS, DOM event adapters, and
  responsive inspector docking. App views consume primitives and explicit model snapshots.
- `main.ts` and `plot-workspace.ts`: state transitions, undo, persistence,
  geometry queries, planning, connections, and execution. Views do not initiate hardware work.

Each CSS class has one owner. Templates emit that owner's CSS Module class directly.
Semantic classes and `data-*` attributes remain stable behavior hooks; they are not
resolved through a class registry or a post-render DOM scan. SVG artwork and selection
geometry stay outside the HTML component renderer.

## Controls

Use `checkbox(label, checked, attributes)` for labeled checkbox rows and
`checkboxInput` inside a separately associated pen label. All checkbox squares are
16 × 16px; the row, not the square, grows to 44px on phone/coarse-pointer layouts.
Text/number/select controls are 30px on desktop, buttons at least 32px, and touch
controls at least 44px. Textareas, colors, files, ranges, and hidden inputs have
separate sizing contracts. Never add generic `.panel input` or `dialog input` rules.

Use typed `Attributes` for data and accessibility hooks. Values, labels, and attributes
are escaped; component content/icon slots accept trusted renderer markup only.
Preserve input/change timing when migrating controls because editing, undo grouping,
and the pen command queue rely on those distinctions.

```ts
import { checkbox, numberField } from './ui/design-system';
checkbox('Draw boundary', settings.outline, { 'data-fill-setting': 'outline' });
numberField('Drawing speed', 35, 'mm/s', {
  min: 1, max: 100, step: 1, 'data-plot-setting': 'speed'
});
```

## Surfaces and lifecycle

Use native popover/dialog top-layer behavior. `NativeOverlays` accepts element/trigger
bindings and owns positioning, dismissal, keyboard navigation, and focus restoration.
Destroy it when a view is replaced. `WorkspaceOverlays` additionally owns the one
inspector panel's dock/drawer transitions and available canvas height. The font picker
owns its abortable events and lazy preview observer independently. Plot event adapters
release listeners on exit; retained controller behavior stays in PlotWorkspace.

Paper, status, floating controls, progress, and toast levels use named layer tokens.
Native dialogs/popovers sit in the browser top layer. Theme tokens keep the existing
palette and storage preference; artwork and paper colors are independent.

## Development and verification

Start Vite with the pinned Node runtime. Visit
`/scripts/fixtures/ui-components.html` for a development-only showcase of native
controls, wrapping labels, disabled/error states, themes, and overlays. It is outside
production entrypoints and stores no editor document. Its live geometry status checks
all visible checkboxes on resize.

Run `npm test` and the normal/browser/site builds with `scripts/node-lts.sh --npm`.
`verify-native-controls.mjs` adds browser checks for typography and fill controls,
checkbox Space/label activation, desktop/mobile themes, drawer focus, and Plot controls.
Run on an isolated origin with disposable state using the project's existing
Playwright verification convention. `verify-workspace-layout.mjs` covers the broader
editing/import/export/layout workflow. Never connect physical hardware during UI checks.
Hosted artifact tests use `PLOT_SITE_BUILD_DIR=dist-site`; live deployment verification
must record the deployed release independently of the locally rebuilt artifact.

Add primitives only when multiple app compositions need the behavior. Put domain
choices and labels in app views, retain CSS ownership, add a showcase state, and verify
the affected state in a browser. Do not add a framework, a package release, or website
imports for this internal library.

## Desktop density

Use 14px for main labels, control values and button text, with 12px secondary help. Use the semantic `--field-gap` (4px),
`--panel-gap` (8px), `--panel-padding` (14px), and `--toolbar-size` (36px) tokens
in app compositions. The 4/8/12/16/20px spacing scale remains available; avoid shrinking
all spacing globally. Phone/coarse-pointer layouts restore 6px label gaps, 12px panel
gaps and 44px control targets. See [UI size comparison](UI_DENSITY.md) for the benchmark
and before/after decisions.

Text action buttons and segmented workspace modes use `--radius-button` (9999px) for
pill-shaped ends. Icon controls and shape tiles retain `--radius-control`; text fields
and surface radii are independent. Button heights, padding and touch targets are unchanged.

## Segmented controls and keyboard access

`segmentedControl(label, options)` is a reusable single-choice component in
`src/ui/design-system/segmented.ts`. It owns its CSS, uses a named `radiogroup`, and
renders native buttons with `role="radio"`, `aria-checked` and one roving Tab stop.
It does not inherit ordinary action-button styles. Equal-width segments sit in a
content-sized pill track with a consistent 3px inset, including touch layouts.

Mount `mountSegmentedControls(root)` once after inserting markup, and call its returned
cleanup function before replacing the view. `WorkspaceOverlays` already does this for
local and hosted app shells. The development showcase uses the same mounting function.

- Tab/Shift+Tab enter at the selected enabled segment and leave the group.
- Arrow keys select and focus an enabled segment, wrapping at either end. Left/right
  direction follows RTL layout; up/down work too. Home/End select the first/last enabled option.
- Space, Enter and pointer clicks use native button activation. Existing click adapters
  remain responsible for application actions. Selecting Plot opens its panel; it does
  not start simulation or hardware execution.
- Exactly one option is exposed as checked; native disabled options are skipped.
  A mutation observer maintains the Tab stop after disabled/selection changes.
- The focus ring is independent of the selected background. Forced-color styles keep
  both states visible. The control does not trap Tab or take over unrelated shortcuts.

The app controller updates `aria-checked` when application state changes independently
of a click. A standalone component needs no per-option state listeners. Keep domain
operations in event adapters/controllers and destroy the mounted behavior on teardown.
The editor ignores keyboard shortcuts while buttons and other form controls are focused.

Action buttons and segmented labels use regular weight (400). Selection is conveyed
by the checked state, background and outline, rather than bold text.
