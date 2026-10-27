import { TextStyle } from 'react-native';

/**
 * Typography tokens — Plus Jakarta Sans across every role (docs/DESIGN.md).
 * Font weights are selected via family name, since RN on Android ignores
 * numeric fontWeight for custom fonts that aren't variable fonts.
 */
const family = {
  extrabold: 'PlusJakartaSans-ExtraBold',
  bold: 'PlusJakartaSans-Bold',
  semibold: 'PlusJakartaSans-SemiBold',
  medium: 'PlusJakartaSans-Medium',
  regular: 'PlusJakartaSans-Regular',
};

export type TypographyToken = TextStyle & { fontFamily: string };

export const typography: Record<string, TypographyToken> = {
  displayHero: {
    fontFamily: family.extrabold,
    fontSize: 56,
    fontWeight: '800',
    lineHeight: 64,
  },
  displayHeroMobile: {
    fontFamily: family.extrabold,
    fontSize: 44,
    fontWeight: '800',
    lineHeight: 52,
  },
  headlineLg: {
    fontFamily: family.bold,
    fontSize: 32,
    fontWeight: '700',
    lineHeight: 40,
  },
  headlineLgMobile: {
    fontFamily: family.bold,
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 34,
  },
  headlineMd: {
    fontFamily: family.bold,
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
  },
  headlineSm: {
    fontFamily: family.semibold,
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
  },
  bodyLg: {
    fontFamily: family.medium,
    fontSize: 16,
    fontWeight: '500',
    lineHeight: 24,
  },
  bodyMd: {
    fontFamily: family.regular,
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
  },
  labelLg: {
    fontFamily: family.bold,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  labelMd: {
    fontFamily: family.semibold,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  labelSm: {
    fontFamily: family.bold,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 14,
  },
};
