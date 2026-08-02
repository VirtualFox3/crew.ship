/**
 * Howl.Host panel themes.
 *
 * Ported verbatim from the design's THEMES table. The panel is themeable
 * because a Minecraft control panel is something people leave open for hours —
 * the design treats that as a first-class choice rather than a settings-page
 * afterthought.
 *
 * `hero` is the raised surface behind status widgets, `panel` is a card, `bg`
 * is the page. `soft` and `line` are pre-mixed alphas of `ink` so contrast
 * holds on both the light and dark themes without per-theme tuning.
 */

export interface Theme {
  bg: string;
  panel: string;
  hero: string;
  ink: string;
  soft: string;
  line: string;
}

export const THEMES: Record<string, Theme> = {
  Teal: {
    bg: "#4fd1c0",
    panel: "#6bdccd",
    hero: "#89e6da",
    ink: "#031412",
    soft: "rgba(3,20,18,.6)",
    line: "rgba(3,20,18,.18)",
  },
  "Warm dark": {
    bg: "#17110c",
    panel: "#1d160f",
    hero: "#241b12",
    ink: "#f6eee1",
    soft: "rgba(246,238,225,.5)",
    line: "rgba(246,238,225,.12)",
  },
  Midnight: {
    bg: "#191d24",
    panel: "#20252e",
    hero: "#252b35",
    ink: "#e2e6ec",
    soft: "rgba(226,230,236,.55)",
    line: "rgba(226,230,236,.10)",
  },
  "Deep forest": {
    bg: "#1a201c",
    panel: "#212823",
    hero: "#262e28",
    ink: "#e2e8e3",
    soft: "rgba(226,232,227,.55)",
    line: "rgba(226,232,227,.10)",
  },
  Charcoal: {
    bg: "#1c1d1f",
    panel: "#232427",
    hero: "#2a2b2e",
    ink: "#e5e5e7",
    soft: "rgba(229,229,231,.55)",
    line: "rgba(229,229,231,.10)",
  },
  Slate: {
    bg: "#16181d",
    panel: "#1c1f26",
    hero: "#22262e",
    ink: "#e6e9ef",
    soft: "rgba(230,233,239,.52)",
    line: "rgba(230,233,239,.11)",
  },
  Paper: {
    bg: "#f4f1ea",
    panel: "#ffffff",
    hero: "#faf8f3",
    ink: "#23262a",
    soft: "rgba(35,38,42,.55)",
    line: "rgba(35,38,42,.10)",
  },
  Red: {
    bg: "#e8564a",
    panel: "#f0736a",
    hero: "#f58e86",
    ink: "#150806",
    soft: "rgba(21,8,6,.6)",
    line: "rgba(21,8,6,.18)",
  },
  Yellow: {
    bg: "#f2cb3c",
    panel: "#f7d962",
    hero: "#fae388",
    ink: "#171204",
    soft: "rgba(23,18,4,.6)",
    line: "rgba(23,18,4,.18)",
  },
  Purple: {
    bg: "#a98bf0",
    panel: "#bba3f5",
    hero: "#cdbaf8",
    ink: "#0f0722",
    soft: "rgba(15,7,34,.6)",
    line: "rgba(15,7,34,.18)",
  },
};

export const DEFAULT_THEME = "Teal";

/** Status accents, offered in the design's own order. */
export const ACCENTS = ["#1b1409", "#f2b13c", "#7fd96a", "#5ad1e0", "#e07ac8"] as const;
export const DEFAULT_ACCENT = "#1b1409";

export function themeVars(name: string, accent: string): React.CSSProperties {
  const t = THEMES[name] ?? THEMES[DEFAULT_THEME];
  return {
    "--th-bg": t.bg,
    "--th-panel": t.panel,
    "--th-hero": t.hero,
    "--th-ink": t.ink,
    "--th-soft": t.soft,
    "--th-line": t.line,
    "--th-accent": accent,
  } as React.CSSProperties;
}
