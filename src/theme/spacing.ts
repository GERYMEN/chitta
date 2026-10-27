/**
 * Spacing tokens, px — derived from docs/DESIGN.md spacing scale (rem * 16).
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  /** Screen edge margin — "Mobile Edge Margins" rule in DESIGN.md. */
  screen: 16,
} as const;

export type SpacingToken = keyof typeof spacing;
