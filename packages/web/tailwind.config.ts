import type { Config } from "tailwindcss";

/**
 * Atrium token bridge. Colors are defined ONCE as channel-triple RGB CSS vars in
 * index.css and consumed here via rgb(var(--x) / <alpha-value>), so opacity
 * utilities work and light/dark are a single source of truth. Brand is fixed:
 * navy #004B87, red #EF3340 (AMPAM standards). Elevation/motion read the same
 * CSS vars so dark mode and reduced-motion stay centralized. Documented in
 * docs/DESIGN-SYSTEM.md.
 */
const token = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: token("--bg"),
        surface: token("--surface"),
        elevated: token("--elevated"),
        ink: token("--ink"),
        muted: token("--muted"),
        line: token("--line"),
        brand: { navy: token("--brand-navy"), red: token("--brand-red") },
        accent: token("--accent"),
        good: token("--good"),
        warn: token("--warn"),
        bad: token("--bad"),
      },
      fontFamily: {
        sans: ["Arial", "Helvetica", "system-ui", "sans-serif"],
      },
      // Documented type ramp (size / line-height). Tight tracking on display sizes.
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],   // 11px — labels, kbd
        xs: ["0.75rem", { lineHeight: "1.1rem" }],       // 12px — captions, meta
        sm: ["0.875rem", { lineHeight: "1.35rem" }],     // 14px — body / UI default
        base: ["1rem", { lineHeight: "1.6rem" }],        // 16px — prose
        lg: ["1.125rem", { lineHeight: "1.6rem", letterSpacing: "-0.01em" }],   // 18px — section title
        xl: ["1.375rem", { lineHeight: "1.75rem", letterSpacing: "-0.015em" }], // 22px — page title
        "2xl": ["1.75rem", { lineHeight: "2.1rem", letterSpacing: "-0.02em" }], // 28px — stat value
        "3xl": ["2.25rem", { lineHeight: "2.5rem", letterSpacing: "-0.02em" }], // 36px — hero
      },
      letterSpacing: {
        tightish: "-0.01em",
      },
      borderRadius: {
        card: "12px",
        pill: "9999px",
      },
      boxShadow: {
        // Mapped to the elevation scale in index.css (theme-aware).
        card: "var(--shadow-1)",
        "card-hover": "var(--shadow-2)",
        overlay: "var(--shadow-3)",
      },
      transitionTimingFunction: {
        out: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      transitionDuration: {
        fast: "150ms",
        base: "200ms",
        slow: "250ms",
      },
    },
  },
  plugins: [],
} satisfies Config;
