export function restorePaperColor(value: unknown): string {
  return typeof value === "string" && /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : "#ffffff";
}

/** Manual color fields accept six-digit RGB and the familiar short hex form. */
export function parseHexColor(value: string): string {
  const match = value.trim().match(/^#?([\da-f]{3}|[\da-f]{6})$/i);
  if (!match) throw new Error('Enter a hex color such as #C43A32.');
  const hex = match[1]!;
  return `#${(hex.length === 3 ? [...hex].map(character => character + character).join('') : hex).toUpperCase()}`;
}
