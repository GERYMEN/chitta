import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from '../../../shared/ui';
import { colors, spacing, typography } from '../../../theme';
import { Category } from '../../../domain/categories/category.types';
import { Period } from '../../../domain/periods/period.types';
import { CategoryBreakdownRow } from '../../../domain/insights/insights.types';
import { CategoryBars } from './CategoryBars';
import { noSpendingLabel, PERIOD_CAPTION } from '../insightLabels';

export interface WhereItWentCardProps {
  /** topCategories(spendByCategory(...)) for the selected period. */
  rows: ReadonlyArray<CategoryBreakdownRow>;
  categories: ReadonlyArray<Category>;
  period: Period;
  onPressCategory: (categoryId: string) => void;
  /** "See all ›" — and the folded "Other" row — open the Insights screen. */
  onSeeAll: () => void;
}

/**
 * R4 Home card: top 5 categories + "Other" as horizontal bars (₹ amount,
 * item count, % of spend) for the selected period; an empty state when
 * nothing was spent. A category bar opens Transactions filtered to it.
 */
export function WhereItWentCard({
  rows,
  categories,
  period,
  onPressCategory,
  onSeeAll,
}: WhereItWentCardProps) {
  return (
    <Card style={styles.card} testID="where-it-went-card">
      <View style={styles.header}>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>Where it went</Text>
          <Text style={styles.caption}>{PERIOD_CAPTION[period]}</Text>
        </View>
        <Pressable
          onPress={onSeeAll}
          accessibilityRole="button"
          accessibilityLabel="See all insights"
          testID="where-it-went-see-all"
          style={({ pressed }) => [styles.seeAll, pressed && styles.pressed]}>
          <Text style={styles.seeAllText}>See all ›</Text>
        </Pressable>
      </View>
      {rows.length === 0 ? (
        <Text style={styles.empty} testID="where-it-went-empty">
          {noSpendingLabel(period)}
        </Text>
      ) : (
        <CategoryBars
          rows={rows}
          categories={categories}
          onPressRow={row => (row.categoryId === null ? onSeeAll() : onPressCategory(row.categoryId))}
          testID="where-it-went-bars"
        />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  titleWrap: {
    flex: 1,
  },
  title: {
    ...typography.headlineSm,
    fontSize: 18,
    color: colors.onSurface,
  },
  caption: {
    ...typography.labelMd,
    color: colors.outline,
  },
  seeAll: {
    minHeight: 48,
    minWidth: 48,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  seeAllText: {
    ...typography.labelLg,
    color: colors.primary,
  },
  pressed: {
    opacity: 0.6,
  },
  empty: {
    ...typography.bodyMd,
    color: colors.outline,
    paddingVertical: spacing.sm,
  },
});
