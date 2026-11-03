# SVG copy and paste

Select artwork on the canvas, then use **Command/Ctrl+C** and **Command/Ctrl+V**. The main menu also provides Copy, Paste and Duplicate; the selection inspector provides Copy and Duplicate. Duplicate remains the immediate **Command/Ctrl+D** action.

- Copy includes the selected object, or the selected SVG element, with inherited transforms, definitions and generated fill. It does not include the paper, selection handles or other artwork.
- Standard `image/svg+xml` is written when the browser supports it, alongside SVG source in `text/plain`. If vector clipboard writing fails, copying falls back to SVG source.
- SVG metadata carries a versioned, validated Plot-It representation of the selected artwork and its referenced custom fonts. Plot-It uses it to preserve editable text, frames, OpenType ranges, variable axes, fill settings and transforms. External apps can use the portable vectors; text produced by Plot-It is already outlined.
- Pasting recognizes SVG clipboard data, SVG source, SVG inside HTML and available SVG file contents. File references alone, such as those sometimes copied from Finder, may require the Import SVG button instead.
- Imported SVG passes through the existing SVG sanitization. Invalid editable metadata falls back to portable SVG. If the original font cannot be restored, portable vectors preserve the appearance instead of creating text with the wrong font.
- Pasted objects receive fresh IDs, including internal SVG references. Internal pastes offset the source by 5 mm; repeated pastes advance by 5 mm. External SVG starts at the viewport center. Each paste creates one undo entry; copying creates none.
- Native text fields, selected interface text and the floating text editor retain normal browser copy/paste and IME behavior. Clipboard commands do not interrupt an active canvas text session or plotting session.

The clipboard artwork limit is 32 MB. Larger artwork can use SVG or Plot-It files. Async clipboard access requires a secure context (HTTPS or localhost), a user action and any permissions required by the browser. No clipboard is read in the background. Compatibility with a receiving application depends on that application accepting the browser's SVG clipboard representation; SVG source remains a fallback, not a promise of vector paste in every application.

Implementation: `src/artwork-clipboard.ts` owns SVG extraction, editable metadata, validation and clipboard representations. `src/main.ts` owns selection, queued paste transactions, font loading, placement and undo integration. Document file formats and typography APIs are unchanged.
