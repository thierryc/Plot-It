/** Optional companion information for private, browser-imported fonts. */
export interface FontImportMetadata {
  displayName?: string;
  attribution?: string;
  license?: { name: string; text: string };
}

export function fontImportMetadata(value: unknown): FontImportMetadata | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid font metadata.');
  const source = value as Record<string, unknown>, result: FontImportMetadata = {};
  const text = (value: unknown, limit: number): string => {
    if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error('Invalid font metadata.');
    return value;
  };
  if (source.displayName !== undefined) result.displayName = text(source.displayName, 200);
  if (source.attribution !== undefined) result.attribution = text(source.attribution, 2000);
  if (source.license !== undefined) {
    if (!source.license || typeof source.license !== 'object' || Array.isArray(source.license)) throw new Error('Invalid font licence.');
    const license = source.license as Record<string, unknown>;
    result.license = { name: text(license.name, 255), text: text(license.text, 1024 * 1024) };
  }
  return result;
}
