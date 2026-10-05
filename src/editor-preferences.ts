export interface EditorPreferences { nudgeMm: number; shiftNudgeMm: number }
export const EDITOR_PREFERENCES_KEY = 'plot-it-editor-preferences';
export const DEFAULT_EDITOR_PREFERENCES: Readonly<EditorPreferences> = { nudgeMm: .1, shiftNudgeMm: 1 };
export function nudgeValue(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) throw new Error('Enter a positive finite distance.');
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error('Enter a positive finite distance.');
  return number;
}
export function restoreEditorPreferences(value: unknown): EditorPreferences {
  const result = { ...DEFAULT_EDITOR_PREFERENCES };
  for (const key of ['nudgeMm', 'shiftNudgeMm'] as const) {
    try { result[key] = nudgeValue((value as Partial<EditorPreferences> | null)?.[key]); } catch { /* Invalid fields use their default. */ }
  }
  return result;
}
export function editorPreferences(storage: Pick<Storage, 'getItem' | 'setItem'>) {
  let current = { ...DEFAULT_EDITOR_PREFERENCES };
  try { current = restoreEditorPreferences(JSON.parse(storage.getItem(EDITOR_PREFERENCES_KEY) ?? 'null')); } catch { /* Storage may be unavailable. */ }
  const save = () => { try { storage.setItem(EDITOR_PREFERENCES_KEY, JSON.stringify(current)); } catch { /* Keep session preferences usable. */ } };
  return {
    get value(): Readonly<EditorPreferences> { return current; },
    set(key: keyof EditorPreferences, value: unknown) { current = { ...current, [key]: nudgeValue(value) }; save(); },
    reset() { current = { ...DEFAULT_EDITOR_PREFERENCES }; save(); }
  };
}
