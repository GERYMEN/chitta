/**
 * Color tokens — sourced from docs/DESIGN.md ("Vibrant Pulse Fintech").
 * Do not hard-code hex values inside feature components; read tokens via useColors().
 * R12: light + dark palettes share one key set (ColorTokens). Dark values are
 * derived Material-style counterparts (docs/DESIGN.md defines the light palette only).
 */
export const lightColors = {
  surface: '#f6faff',
  surfaceDim: '#d2dbe4',
  surfaceBright: '#f6faff',
  surfaceContainerLowest: '#ffffff',
  surfaceContainerLow: '#ecf5fe',
  surfaceContainer: '#e6eff8',
  surfaceContainerHigh: '#e0e9f2',
  surfaceContainerHighest: '#dbe4ed',
  surfaceVariant: '#dbe4ed',

  onSurface: '#141d23',
  onSurfaceVariant: '#3c4b38',

  inverseSurface: '#293138',
  inverseOnSurface: '#e9f2fb',

  outline: '#6c7b67',
  outlineVariant: '#bbcbb3',

  surfaceTint: '#006e14',
  primary: '#006e14',
  onPrimary: '#ffffff',
  primaryContainer: '#00d632',
  onPrimaryContainer: '#00560e',
  inversePrimary: '#2ae540',

  secondary: '#5c5f62',
  onSecondary: '#ffffff',
  secondaryContainer: '#e1e2e7',
  onSecondaryContainer: '#626468',

  tertiary: '#865300',
  onTertiary: '#ffffff',
  tertiaryContainer: '#fea51f',
  onTertiaryContainer: '#694000',

  error: '#ba1a1a',
  onError: '#ffffff',
  errorContainer: '#ffdad6',
  onErrorContainer: '#93000a',

  primaryFixed: '#73ff6f',
  primaryFixedDim: '#2ae540',
  onPrimaryFixed: '#002202',
  onPrimaryFixedVariant: '#00530d',

  secondaryFixed: '#e1e2e7',
  secondaryFixedDim: '#c5c6cb',
  onSecondaryFixed: '#191c1f',
  onSecondaryFixedVariant: '#44474b',

  tertiaryFixed: '#ffddb9',
  tertiaryFixedDim: '#ffb961',
  onTertiaryFixed: '#2b1700',
  onTertiaryFixedVariant: '#663e00',

  background: '#f6faff',
  onBackground: '#141d23',

  // Obsidian anchor — dark balance card / primary pill on dark surfaces.
  obsidian: '#0B0E11',
  onObsidian: '#ffffff',

  // R4c: WhatsApp brand green for the "Send on WhatsApp" button only
  // (obsidian label: white on this green fails contrast).
  whatsapp: '#25D366',
  onWhatsapp: '#0B0E11',

  // R4c: tour dim layer.
  scrim: 'rgba(11, 14, 17, 0.72)',

  // Transaction state matrix (docs/DESIGN.md) — flat so it flips with the theme.
  approvedFg: '#00A827',
  approvedBg: '#E6F9EC',
  pendingFg: '#B7791F',
  pendingBg: '#FEF3C7',
  rejectedFg: '#6C757D',
  rejectedBg: '#E9ECEF',
  failedFg: '#DC2626',
  failedBg: '#FEE2E2',

  // Amber category badge (Food / Coffee).
  categoryAmberFg: '#694000',
  categoryAmberBg: '#FBE3C2',

  // Dim layers: bottom-sheet backdrop and the full-screen receipt viewer.
  backdrop: 'rgba(11, 14, 17, 0.4)',
  viewerScrim: 'rgba(0, 0, 0, 0.92)',
};

export type ColorTokens = typeof lightColors;

export const darkColors: ColorTokens = {
  surface: '#0e1417',
  surfaceDim: '#0e1417',
  surfaceBright: '#343a3e',
  surfaceContainerLowest: '#090f12',
  surfaceContainerLow: '#161c1f',
  surfaceContainer: '#1a2023',
  surfaceContainerHigh: '#252b2e',
  surfaceContainerHighest: '#303639',
  surfaceVariant: '#3c4b38',

  onSurface: '#dde3e9',
  onSurfaceVariant: '#bbcbb3',

  inverseSurface: '#dde3e9',
  inverseOnSurface: '#293138',

  outline: '#8a9a83',
  outlineVariant: '#3c4b38',

  surfaceTint: '#2ae540',
  primary: '#2ae540',
  onPrimary: '#003907',
  primaryContainer: '#00d632',
  onPrimaryContainer: '#00560e',
  inversePrimary: '#006e14',

  secondary: '#c5c6cb',
  onSecondary: '#2e3134',
  secondaryContainer: '#44474b',
  onSecondaryContainer: '#e1e2e7',

  tertiary: '#ffb961',
  onTertiary: '#472a00',
  tertiaryContainer: '#fea51f',
  onTertiaryContainer: '#694000',

  error: '#ffb4ab',
  onError: '#690005',
  errorContainer: '#93000a',
  onErrorContainer: '#ffdad6',

  primaryFixed: '#73ff6f',
  primaryFixedDim: '#2ae540',
  onPrimaryFixed: '#002202',
  onPrimaryFixedVariant: '#00530d',

  secondaryFixed: '#e1e2e7',
  secondaryFixedDim: '#c5c6cb',
  onSecondaryFixed: '#191c1f',
  onSecondaryFixedVariant: '#44474b',

  tertiaryFixed: '#ffddb9',
  tertiaryFixedDim: '#ffb961',
  onTertiaryFixed: '#2b1700',
  onTertiaryFixedVariant: '#663e00',

  background: '#0e1417',
  onBackground: '#dde3e9',

  // Obsidian anchor — on dark surfaces the "obsidian" cards stay dark but lift off the canvas.
  obsidian: '#1f272b',
  onObsidian: '#ffffff',

  whatsapp: '#25D366',
  onWhatsapp: '#0B0E11',

  scrim: 'rgba(0, 0, 0, 0.72)',

  approvedFg: '#4ade80',
  approvedBg: '#10301c',
  pendingFg: '#f5c76b',
  pendingBg: '#3a2c0c',
  rejectedFg: '#aab2ba',
  rejectedBg: '#2a3136',
  failedFg: '#ff8a80',
  failedBg: '#3d1a1a',

  categoryAmberFg: '#ffb961',
  categoryAmberBg: '#3a2c0c',

  backdrop: 'rgba(0, 0, 0, 0.6)',
  viewerScrim: 'rgba(0, 0, 0, 0.92)',
};

export type ColorToken = keyof ColorTokens;

/** Transaction state matrix — maps domain status to visual tokens for the active palette. */
export function stateColorsFor(c: ColorTokens) {
  return {
    approved: { fg: c.approvedFg, bg: c.approvedBg },
    pending: { fg: c.pendingFg, bg: c.pendingBg },
    rejected: { fg: c.rejectedFg, bg: c.rejectedBg },
    failed: { fg: c.failedFg, bg: c.failedBg },
  };
}

export type StateColors = ReturnType<typeof stateColorsFor>;

/**
 * R4e: "Where it went" donut slice colours, by rank (largest first). Every
 * value is an existing token; neighbours around the ring differ in hue or
 * lightness. Contrast on dark cards is device-verified (R12).
 */
export function chartSeriesColorsFor(c: ColorTokens): ReadonlyArray<string> {
  return [
    c.primary,
    c.tertiaryContainer,
    c.primaryContainer,
    c.error,
    c.onTertiaryContainer,
    c.secondary,
    c.tertiaryFixedDim,
  ];
}

export function chartOtherColorFor(c: ColorTokens): string {
  return c.outlineVariant;
}
