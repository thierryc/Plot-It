export type ThemePreference = "system" | "light" | "dark";
export type InterfaceTheme = "light" | "dark";
export const THEME_KEY = "plot-it-theme";

export function themePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): InterfaceTheme {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference;
}

// Interface preferences live outside document state and never enter its undo history.
export function initializeTheme(host: Window, page: Document) {
  const media = host.matchMedia("(prefers-color-scheme: dark)");
  let preference: ThemePreference = "system";
  try { preference = themePreference(host.localStorage.getItem(THEME_KEY)); } catch { /* Storage may be disabled. */ }
  const apply = () => {
    const theme = resolveTheme(preference, media.matches);
    page.documentElement.dataset.theme = theme;
    page.documentElement.dataset.themePreference = preference;
    page.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#232329" : "#ffffff");
  };
  apply();
  media.addEventListener("change", () => { if (preference === "system") apply(); });
  return {
    get preference() { return preference; },
    setPreference(value: unknown) {
      preference = themePreference(value);
      try { host.localStorage.setItem(THEME_KEY, preference); } catch { /* Keep the theme usable without storage. */ }
      apply();
    }
  };
}
