import { ColorTokens } from '../../theme';
import type { Category } from '../../domain/categories/category.types';
import type { CategoryColorKey } from '../../domain/categories/category.rules';

export interface CategoryVisual {
  icon: string;
  iconColor: string;
  backgroundColor: string;
}

const defaultVisual = (colors: ColorTokens): CategoryVisual => ({
  icon: 'file-document-outline',
  iconColor: colors.onSurfaceVariant,
  backgroundColor: colors.surfaceContainerHigh,
});

const categoryVisuals = (colors: ColorTokens): Record<string, CategoryVisual> => ({
  'cat-food': {
    icon: 'silverware-fork-knife',
    iconColor: colors.categoryAmberFg,
    backgroundColor: colors.categoryAmberBg,
  },
  'cat-shopping': {
    icon: 'shopping-outline',
    iconColor: colors.onSurfaceVariant,
    backgroundColor: colors.surfaceContainerHigh,
  },
  'cat-transport': {
    icon: 'car-outline',
    iconColor: colors.onSurfaceVariant,
    backgroundColor: colors.surfaceContainerHigh,
  },
  'cat-coffee': {
    icon: 'coffee-outline',
    iconColor: colors.categoryAmberFg,
    backgroundColor: colors.categoryAmberBg,
  },
  'cat-salary': {
    icon: 'bank-outline',
    iconColor: colors.primary,
    backgroundColor: colors.primaryContainer + '33',
  },
  'cat-freelance': {
    icon: 'laptop',
    iconColor: colors.primary,
    backgroundColor: colors.primaryContainer + '33',
  },
  // R3a: transfers — swap arrows on the neutral secondary tokens.
  'cat-transfer': {
    icon: 'swap-horizontal',
    iconColor: colors.secondary,
    backgroundColor: colors.secondaryContainer,
  },
  // R5e: EMI & Loans (expense) / Interest (income) system categories.
  'cat-emi': {
    icon: 'calendar-sync-outline',
    iconColor: colors.onSurfaceVariant,
    backgroundColor: colors.surfaceContainerHigh,
  },
  'cat-interest': {
    icon: 'percent-outline',
    iconColor: colors.primary,
    backgroundColor: colors.primaryContainer + '33',
  },
  'cat-uncategorised': {
    icon: 'help-circle-outline',
    iconColor: colors.pendingFg,
    backgroundColor: colors.pendingBg,
  },
});

/** R2 custom-category colours — every pair is an existing theme token. */
export const categoryColorSwatches = (
  colors: ColorTokens,
): Record<CategoryColorKey, { fg: string; bg: string }> => ({
  green: { fg: colors.primary, bg: colors.approvedBg },
  lime: { fg: colors.onPrimaryFixedVariant, bg: colors.primaryFixed },
  amber: { fg: colors.onTertiaryContainer, bg: colors.tertiaryFixed },
  slate: { fg: colors.onSurfaceVariant, bg: colors.surfaceContainerHigh },
  grey: { fg: colors.onSecondaryFixedVariant, bg: colors.secondaryFixed },
  red: { fg: colors.onErrorContainer, bg: colors.errorContainer },
});

/**
 * Built-in categories use the fixed visuals above; a custom category uses its
 * own icon + colour key. Unknown ids fall back to a neutral document icon.
 */
export function getCategoryVisual(
  categoryId: string,
  category: Pick<Category, 'icon' | 'color'> | null | undefined,
  colors: ColorTokens,
): CategoryVisual {
  const builtIn = categoryVisuals(colors)[categoryId];
  if (builtIn) return builtIn;
  const fallback = defaultVisual(colors);
  if (category) {
    const swatches = categoryColorSwatches(colors);
    const swatch =
      category.color && category.color in swatches
        ? swatches[category.color as CategoryColorKey]
        : { fg: fallback.iconColor, bg: fallback.backgroundColor };
    return { icon: category.icon, iconColor: swatch.fg, backgroundColor: swatch.bg };
  }
  return fallback;
}
