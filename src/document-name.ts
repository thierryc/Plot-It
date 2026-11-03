export const DEFAULT_DOCUMENT_NAME = 'Untitled plot';
export function documentName(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_DOCUMENT_NAME;
}
export function documentFilename(name: string): string {
  return documentName(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '') || DEFAULT_DOCUMENT_NAME;
}
