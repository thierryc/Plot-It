import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { initializeTheme, resolveTheme, themePreference, THEME_KEY } from "./theme";

function environment(saved: unknown = null, dark = false, blocked = false) {
  let listener = () => {};
  const media = { matches: dark, addEventListener: vi.fn((_type, callback) => { listener = callback; }) };
  const storage = {
    getItem: vi.fn(() => { if (blocked) throw new Error("blocked"); return saved; }),
    setItem: vi.fn(() => { if (blocked) throw new Error("blocked"); })
  };
  const root = { dataset: {} as Record<string, string> };
  const meta = { setAttribute: vi.fn() };
  const page = { documentElement: root, querySelector: vi.fn((_selector: string) => meta) };
  const host = { matchMedia: vi.fn(() => media), localStorage: storage };
  return {
    host, page, root, meta, storage,
    systemChange(value: boolean) { media.matches = value; listener(); },
    initialize() { return initializeTheme(host as unknown as Window, page as unknown as Document); }
  };
}

describe("interface themes", () => {
  it("validates preferences and defaults to System", () => {
    for (const invalid of [null, undefined, "sepia", "DARK", {}, 42]) expect(themePreference(invalid)).toBe("system");
    expect(themePreference("light")).toBe("light");
    expect(themePreference("dark")).toBe("dark");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("follows system changes only while System is selected", () => {
    const env = environment(); const theme = env.initialize();
    expect(env.root.dataset.theme).toBe("light");
    env.systemChange(true); expect(env.root.dataset.theme).toBe("dark");
    theme.setPreference("light"); env.systemChange(true);
    expect(env.root.dataset.theme).toBe("light");
    theme.setPreference("dark"); env.systemChange(false);
    expect(env.root.dataset.theme).toBe("dark");
    theme.setPreference("system"); expect(env.root.dataset.theme).toBe("light");
    expect(env.meta.setAttribute).toHaveBeenLastCalledWith("content", "#ffffff");
  });

  it("persists separately and restores an explicit preference", () => {
    const env = environment("dark"); const theme = env.initialize();
    expect(theme.preference).toBe("dark");
    expect(env.root.dataset.theme).toBe("dark");
    expect(env.meta.setAttribute).toHaveBeenLastCalledWith("content", "#232329");
    theme.setPreference("light");
    expect(env.storage.setItem).toHaveBeenCalledExactlyOnceWith(THEME_KEY, "light");
    // Only root attributes and browser chrome are touched; no editor rendering occurs.
    expect(env.page.querySelector.mock.calls.every(([selector]) => selector === 'meta[name="theme-color"]')).toBe(true);
  });

  it("handles invalid preferences and disabled storage", () => {
    const invalid = environment("wrong", true); expect(invalid.initialize().preference).toBe("system");
    expect(invalid.root.dataset.theme).toBe("dark");
    const blocked = environment(null, false, true); const theme = blocked.initialize();
    expect(() => theme.setPreference("dark")).not.toThrow();
    expect(blocked.root.dataset.theme).toBe("dark");
  });

  it("bootstraps before the editor and matches runtime theme resolution", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]!;
    expect(html.indexOf(script)).toBeLessThan(html.indexOf('/src/main.ts'));
    for (const saved of [null, "system", "light", "dark", "invalid"]) {
      for (const dark of [true, false]) {
        const env = environment(saved, dark);
        runInNewContext(script, { localStorage: env.storage, matchMedia: env.host.matchMedia, document: env.page });
        const firstPaint = { ...env.root.dataset };
        env.initialize(); expect(env.root.dataset).toEqual(firstPaint);
        expect(firstPaint.theme).toBe(resolveTheme(themePreference(saved), dark));
      }
    }
  });

  it("uses the exact accent and readable interface colors without recoloring artwork", () => {
    const css = readFileSync(new URL("./ui/design-system/tokens.css", import.meta.url), "utf8");
    const canvas = readFileSync(new URL("./ui/app/canvas.module.css", import.meta.url), "utf8");
    expect(canvas).toContain('background:var(--paper-color, #ffffff)');
    expect(canvas).toContain('stroke:#0B99FF');
    const luminance = (hex: string) => {
      const rgb = [1, 3, 5].map(offset => {
        const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
      });
      return rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722;
    };
    for (const palette of css.match(/:root[^{}]*\{[^}]*\}/g)!.filter(block => block.includes("--accent:"))) {
      const tokens = Object.fromEntries([...palette.matchAll(/(--[\w-]+):\s*(#[\da-fA-F]{6})\b/g)].map(([, name, value]) => [name!, value!]));
      expect(tokens['--accent']).toBe('#0B99FF');
      for (const [foreground, background] of [["--ink", "--control"], ["--muted", "--surface"], ["--text-quiet", "--surface-subtle"], ["--on-primary", "--primary"], ["--accent-text", "--surface"]]) {
        const a = luminance(tokens[foreground!]!), b = luminance(tokens[background!]!);
        expect((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toBeGreaterThanOrEqual(4.5);
      }
      for (const background of ["--surface", "--surface-subtle", "--control"]) {
        const a = luminance(tokens["--focus"]!), b = luminance(tokens[background]!);
        expect((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
