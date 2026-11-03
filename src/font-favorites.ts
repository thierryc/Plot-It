const storageKey = 'plot-it-favorite-fonts';
export const fontFavoritesChanged = 'plot-it-font-favorites-changed';
let fallback = new Set<string>();
/** Favorites belong to this browser, independently of documents and font files. */
export function favoriteFontIds(): Set<string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    fallback = new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []);
  } catch { /* Keep session favorites when browser storage is unavailable. */ }
  return new Set(fallback);
}
export function toggleFavoriteFont(id: string): void {
  const ids = favoriteFontIds();
  if (ids.has(id)) ids.delete(id); else ids.add(id);
  fallback = ids;
  try { localStorage.setItem(storageKey, JSON.stringify([...ids])); } catch { /* Session fallback remains usable. */ }
  window.dispatchEvent(new Event(fontFavoritesChanged));
}
