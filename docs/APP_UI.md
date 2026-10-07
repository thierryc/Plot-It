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

`PlotCanvasStatus` owns the canvas-side process summary while PlotWorkspace supplies
formatted state and metrics. Numeric updates are silent and unchanged text is preserved;
process and supply-state changes use polite live regions. Destroy it on leaving Plot.
Connection selection is independent of simulation playback. Shared Plot views supply
the same connection area and footer action layout to local and hosted builds.

Plot's top-level Destination, Plot settings, Pens & passes, Motors, Pen and Diagnostics use
the shared native disclosure primitive, composed by `plotSection` in the app view.
Main sections start expanded; Diagnostics and nested advanced options start collapsed. Both states and
summary focus survive preparation and settings refreshes. Native summary activation
supports Enter/Space and Tab skips collapsed content. Playback opens the pen/pass
section to expose progress; Edit/Plot is identified by the workspace mode control.

Pens & passes has one disclosure level. Its count and pass order are direct contents;
a single pass is shown during playback, without repeating the idle pen assignment.
Motors and Pen have separate sections. Up/Down actions share a row, with the two
height fields directly below. Short visual labels retain explicit accessible names.
Diagnostics contains the app version, firmware, device/paper details and log download.
All actions use existing controller adapters and connection/ownership/busy guards.

The decorative plotter rig uses a retracted rest position with the main rail above
or to the left of the paper, and the existing extended position on the right/below.
The arm and chassis anchor share the rest offset, keeping the pen at the paper origin
and preserving live pen tracking. This affects the diagram only, never motion plans.

## Machine profile fields

`src/machine-profiles.ts` owns profile labels, NextDraw model choices and hardware
capability flags. `src/ui/app/machine-profile.ts` composes native fields/selects once
for Edit and Plot, with typed event hooks supplied by their adapters. NextDraw's
8511/A4, 1117/A3 and 2234/A1 models follow the
[manufacturer's model listing](https://support.bantamtools.com/hc/en-us/articles/28809219814547-Bantam-Tools-NextDraw-Documentation-Resources).

NextDraw is currently a setup/simulation profile. Its model is saved and survives
reload and document import/export. Preview uses the shared CoreXY XY calibration
and existing generic pen timing, not a hardware-verified NextDraw time estimate.
The AxiDraw decorative illustration is hidden for NextDraw; its physical envelope
and automatic homing are not represented. Model selection does not resize paper
or enforce hardware travel bounds.

Hardware capabilities control destination/connection, motor/pen actions and Start.
The adapter also rejects NextDraw physical configurations and plans; network job
validation continues to accept only supported hardware profiles. The NextDraw
brushless pen lift needs a separate adapter configuration (pin 2, narrow-band PWM,
channel count and rate/timing model), rather than the current legacy servo setup.
The inspected official source is recorded in the NextDraw API research notes.

`fieldWithAction(label, control, action)` composes a native field and a separately
labelled trailing icon button. Its CSS Module aligns the action with the control
at 30px on desktop and 44px on touch layouts. The action stays outside the field
label, so selecting a preset and opening advanced options remain distinct actions.
Paper Size uses it for Canvas dimensions; the ellipsis opens the existing modal
directly with dialog popup semantics and native focus restoration.

## Contextual section help and floating modes

`contextualHelp(id, label, content)` renders a named native info button and an auto
popover. `mountContextualHelp(root)` owns positioning, expanded state and focus
cleanup through delegated events, so help added by later inspector refreshes works
without per-view listener setup. `WorkspaceOverlays` mounts it once and releases it
on teardown. Help opens with Enter/Space, closes with Escape or its close button,
and returns focus to its invoker (or the summary if the section closes).

Expanded section headings expose separate help controls; buttons are outside the
summary, so reading help does not toggle a disclosure. Paper/setup, objects, selection,
SVG elements, fill, font details and Plot sections keep instructional text in these
popovers. Loading/errors, unavailable controls and live state stay inline. Help uses
24px desktop buttons, 44px touch buttons, 14px text and viewport-clamped positioning.

Edit and Plot reserve 72px inside their scrolling surface for the floating workspace
modes. That space scrolls away while the mode control remains over the inspector.
On phones, the same segmented group moves into the modal drawer below its close
header, then returns to the app header on dismissal. There is one live group and
one inspector instance. The Plot player remains independently pinned.

For left-side placement, the stationary base/rail assembly is reflected around the
pen's resting axis. This places the base above the origin and the rail along the
paper while keeping the secondary arm retracted and pen tracking unchanged.

### Compact property rows

`propertyField` is the inspector primitive for numeric properties and short native selects. Use a quiet prefix (`X`, `Y`, `W`, `H`, `Cap`, `Track`, `Deg`) and a full `label` for its accessible name. Units have a fixed trailing slot; values use right alignment and tabular figures. Prefixes and units are not separately announced. Controls retain native validation, disabled states, and typed, escaped event attributes. The entire field gets the existing focus outline. Do not add internal prefix dividers or apply generic input height rules to checkboxes.

Pair rows with the app's shared `two-col` composition so geometry, typography, fill and speeds have matching edges. Keep names and multiline content left aligned. Desktop fields are 30px, text is 14px, panel padding is 12px and row gaps are 6px; touch controls retain 44px targets. The workspace mode switch and 288px desktop sidebar width are unchanged.

The text alignment composition uses the design system's icon-only radio options and a native text-options adapter. It supplies full accessible names, one Tab stop, arrow/Home/End selection and focus restoration when the editor rerenders. `mountSegmentedControls` mounts newly inserted groups and releases removed groups automatically. Font upload is a native file control beside the picker, with its own accessible name and focus outline. App controllers continue owning typography, undo and persistence.

The development showcase includes property rows, icon groups, disabled fields and invalid fields. Extend these shared components rather than adding panel-specific numeric control CSS. Do not apply these tokens or compositions to the website.

Use `align:'left'` for the Profile, Model and Rail property selects. This gives their quiet labels a shared 42px slot and their values a common left edge. Native select padding centers the text in the field; numeric property values retain right alignment.
