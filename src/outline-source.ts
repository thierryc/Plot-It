/** Persisted on editable OpenType glyph paths; generated linework is never saved. */
export const OUTLINE_VERSION_ATTRIBUTE = 'data-opentype-outline';
export const OUTLINE_GLYPH_ATTRIBUTE = 'data-opentype-glyph';
export function isOutlineGlyph(element: Element): boolean {
  return element.localName === 'path' && element.getAttribute(OUTLINE_VERSION_ATTRIBUTE) === '1' && element.hasAttribute(OUTLINE_GLYPH_ATTRIBUTE);
}
