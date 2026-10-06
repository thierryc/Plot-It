# App UI size comparison — 6 October 2026

A modest compact desktop pass brings Plot-It closer to a property editor while using 14px main text and retaining
readable hierarchy and separation between groups. All sizes below are logical CSS pixels,
not physical Retina screenshot pixels. Website styling is outside this change.

## Evidence and limits

Plot-It values come from component CSS and browser geometry. ChatGPT values were measured
from the live desktop web app at https://chatgpt.com/ (1280px viewport), using navigation,
sidebar and home controls. Figma values marked ≈ are visual estimates from the open native
Figma editor, whose 2× screenshot shows a 241px sidebar, approximately 24px property fields
and 32px primary/toolbar buttons. They are not exported Figma tokens or exact DOM measurements.
The page color field was visible; checkbox and label-gap measurements were unavailable.
Neither product has one universal size across all surfaces, releases and devices.

Figma's [UI3 design rationale](https://www.figma.com/blog/our-approach-to-designing-ui3/)
explains its property-panel hierarchy. It does not publish the numerical values in this table.
ChatGPT's navigation is useful for button sizing; its conversational composer is not an
appropriate property-field reference. A dash means the corresponding control was not measured.

## Desktop comparison

| Element / spacing | Figma observed, estimated | ChatGPT web measured | Plot-It before | Plot-It applied |
| --- | --- | --- | --- | --- |
| Text / number / select height | ≈24 (page property field) | — | 34 | **30** |
| Standard text button height | ≈32 (Share) | 35–36 (New chat / Show more) | 36 | **32** |
| Toolbar / main icon target | ≈32 | 36 (Search / nav rail) | 40 | **36** |
| Secondary icon target | — | 20–24 (sidebar actions) | varies | unchanged; keep toolbar 36 |
| Layer / object row height | ≈32 (layer rows) | — | 34 | **30** |
| Small UI text | ≈11–12 | 14 (navigation), 12 (small actions) | 11 labels / 12 values | **14 main / 12 secondary** |
| Checkbox square | — | — | 16 × 16 | **16 × 16 unchanged** |
| Checkbox clickable row, minimum | — | — | 28 | **28 unchanged** |
| Label-to-field gap | — | — | 6 | **4** |
| Panel content gap | — | — | 12 | **8** |
| Inspector section padding | ≈16 | — | 20 vertical / 18 horizontal | **14** |
| Text button padding, vertical / horizontal | — | 6 / 10 (New chat) | 8 / 12 | **4 / 8** |
| Primary button horizontal padding | — | — | 19 | **12** |
| Text field padding, vertical / horizontal | — | — | 7 / 9 | **4 / 8** |
| Button icon / label gap | — | 6–8 | 7 | **6** |
| Field corner radius | ≈4–6 | — | 7 | **6** |
| Standard button corner radius | ≈6 (Share) | 8–10 (nav buttons); pill composer controls | 8 | **9999 (pill)** |
| Desktop inspector width | 241 (AX resize value, current window) | 288 (home sidebar; different purpose) | 288, 260 on tablet | **unchanged** |
| Font picker trigger / search height | — | — | 38 | **30** |
| Segmented button height | — | — | 36 | **32** |

Fields shrink by 12%, text buttons by 11%, toolbar targets by 10%. The current main UI
font is 14px. A labeled field with a 20px label line is 54px before inter-field spacing.
Panel padding is 14px and content gaps are 8px, balancing the larger, more readable type. Property fields remain
6px taller than the estimated Figma reference, leaving a little more room for interaction.

## Touch layouts

Keep fields, buttons, toolbar controls, checkbox rows and disclosure targets at least
44px on widths ≤639px or coarse pointers. Keep checkbox squares at 16px. Restore label
gap to 6px and panel gap to 12px. Native textareas remain multiline and are not forced
into the single-line control height. Font specimens and previews are not scaled down.

## Ownership and verification

Control dimensions and semantic spacing live in app-scoped design-system tokens. App
views consume them for inspector, Plot, font picker and canvas controls. The spacing scale
stays 4/8/12/16/20px. The development showcase displays the active token summary.

Verification passed: TypeScript check; 47 affected UI/theme/font-picker/Plot tests; hosted
site build; showcase geometry at 1440, 768, 640, 390 and 320px in both themes; checkbox
keyboard activation; dialog and phone drawer focus return; local editor/Plot and rebuilt
hosted artifact geometry. Desktop fields measured 30px, text buttons 32px and toolbars
36px; phone fields/buttons measured 44px. Checkbox squares remain 16px with no page overflow. This work
is local; deployment is a separate action. The hosted `/app/` artifact is rebuilt locally with the compact CSS.
