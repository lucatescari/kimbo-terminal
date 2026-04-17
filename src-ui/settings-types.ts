// Types shared between settings.ts and theme-card.ts. Mirrors the Rust
// UnifiedTheme struct in crates/kimbo-config/src/theme.rs.

export type ThemeSource = "Builtin" | "Installed" | "Available";

export interface UnifiedTheme {
  slug: string;
  name: string;
  theme_type: string;
  author: string;
  version: string;
  swatches: {
    background: string;
    foreground: string;
    accent: string;
    cursor: string;
  };
  source: ThemeSource;
  active: boolean;
}
