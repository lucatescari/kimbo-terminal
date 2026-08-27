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
    /** ANSI green, yellow and bright-black, used by the card's mini-window
     *  preview. Present for Builtin/Installed themes, which are full themes
     *  on disk. Absent for Available ones: the community index.json carries
     *  only the four colors above, so the preview folds these segments back
     *  onto accent/foreground rather than inventing values. */
    green?: string;
    yellow?: string;
    dim?: string;
  };
  source: ThemeSource;
  active: boolean;
}
