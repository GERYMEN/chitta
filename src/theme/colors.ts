/**
 * Color tokens — sourced from docs/DESIGN.md ("Vibrant Pulse Fintech").
 * Do not hard-code hex values inside feature components; import tokens from here.
 */
export const colors = {
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
} as const;

/**
 * Transaction state matrix — maps domain status to visual tokens.
 * Approved/pending/failed colors come from the design system's
 * "Transaction State Matrix", independent from the generic M3 scale above.
 */
export const transactionStateColors = {
  approved: {
    fg: '#00A827',
    bg: '#E6F9EC',
  },
  pending: {
    fg: '#B7791F',
    bg: '#FEF3C7',
  },
  rejected: {
    fg: '#6C757D',
    bg: '#E9ECEF',
  },
  failed: {
    fg: '#DC2626',
    bg: '#FEE2E2',
  },
} as const;

export type ColorToken = keyof typeof colors;
