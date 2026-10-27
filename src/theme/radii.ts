/**
 * Corner radius tokens, px — derived from docs/DESIGN.md `rounded` scale (rem * 16).
 */
export const radii = {
  sm: 8,
  default: 16,
  md: 24,
  lg: 32,
  xl: 48,
  full: 9999,
} as const;

export type RadiusToken = keyof typeof radii;
