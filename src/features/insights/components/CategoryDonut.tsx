import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChartDonut } from '../../../components/charts/ChartDonut';
import { AmountText } from '../../../shared/ui';
import { useRedacted } from '../../../shared/privacy/redaction';
import { chartOtherColor, chartSeriesColors, colors, spacing, typography } from '../../../theme';
import { Category } from '../../../domain/categories/category.types';
import { categoryLabel } from '../../../domain/categories/category.rules';
import { CategorySpend } from '../../../domain/insights/insights.types';
import { buildPieModel, PieSlice } from '../../../domain/insights/pie.rules';
import {
  OTHER_LABEL,
  otherCategoriesA11yName,
  pieLegendA11yLabel,
  piePercentLabel,
  pieSummaryA11yLabel,
} from '../insightLabels';

export interface DonutItem {
  slice: PieSlice;
  name: string;
  a11yName: string;
  color: string;
  percentLabel: string;
}

/** Pie model → named, coloured legend items (colour by rank; "Other" muted). */
export function donutItems(
  rows: ReadonlyArray<CategorySpend>,
  categories: ReadonlyArray<Category>,
): { totalMinor: number; items: DonutItem[] } {
  const model = buildPieModel(rows);
  const byId = new Map(categories.map(category => [category.id, category]));
  let rank = 0;
  const items = model.slices.map(slice => {
    const percentLabel = piePercentLabel(slice.percent, slice.share);
    if (slice.categoryId === null) {
      return {
        slice,
        name: OTHER_LABEL,
        a11yName: otherCategoriesA11yName(slice.categoryCount),
        color: chartOtherColor,
        percentLabel,
      };
    }
    const name = categoryLabel(byId.get(slice.categoryId));
    const color = chartSeriesColors[rank % chartSeriesColors.length];
    rank += 1;
    return { slice, name, a11yName: name, color, percentLabel };
  });
  return { totalMinor: model.totalMinor, items };
}

export interface CategoryDonutProps {
  /** spendByCategory(...) for the selected period (all categories). */
  rows: ReadonlyArray<CategorySpend>;
  categories: ReadonlyArray<Category>;
  /** A category slice / legend row (categoryId) or "Other" (null). */
  onPressSlice: (categoryId: string | null) => void;
  testID?: string;
}

/**
 * R4e "Where it went" donut + legend. The centre shows the total spent
 * (AmountText → masked while the feedback screenshot is REDACTED); each
 * legend row shows a colour dot, the category, its % and amount. A slice
 * and its legend row do the same thing.
 */
export function CategoryDonut({ rows, categories, onPressSlice, testID }: CategoryDonutProps) {
  // R4c: labels below are built with formatRupeesFromMinor → re-render on the flag.
  const redacted = useRedacted();
  const { totalMinor, items } = useMemo(() => donutItems(rows, categories), [rows, categories]);
  const byKey = useMemo(() => new Map(items.map(item => [item.slice.key, item])), [items]);
  const summary = useMemo(
    () =>
      pieSummaryA11yLabel(
        totalMinor,
        items.map(item => ({ name: item.a11yName, percentLabel: item.percentLabel })),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [totalMinor, items, redacted],
  );

  return (
    <View style={styles.wrap} testID={testID}>
      <ChartDonut
        slices={items.map(item => ({
          key: item.slice.key,
          startAngle: item.slice.startAngle,
          endAngle: item.slice.endAngle,
          color: item.color,
        }))}
        accessibilityLabel={summary}
        onPressSlice={key => {
          const item = byKey.get(key);
          if (item) onPressSlice(item.slice.categoryId);
        }}
        center={
          <>
            <AmountText
              amountMinor={totalMinor}
              type="expense"
              signed={false}
              variant="headlineSm"
              style={styles.total}
            />
            <Text style={styles.totalCaption}>spent</Text>
          </>
        }
        testID="where-it-went-donut"
      />
      <View style={styles.legend}>
        {items.map(item => (
          <Pressable
            key={item.slice.key}
            onPress={() => onPressSlice(item.slice.categoryId)}
            accessibilityRole="button"
            accessibilityLabel={pieLegendA11yLabel(
              item.a11yName,
              item.percentLabel,
              item.slice.spendMinor,
            )}
            testID={`where-it-went-legend-${item.slice.key}`}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <View style={[styles.dot, { backgroundColor: item.color }]} />
            <Text style={styles.name} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.percent}>{item.percentLabel}</Text>
            <AmountText
              amountMinor={item.slice.spendMinor}
              type="expense"
              signed={false}
              variant="labelLg"
              style={styles.amount}
            />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  total: {
    textAlign: 'center',
  },
  totalCaption: {
    ...typography.labelMd,
    color: colors.outline,
  },
  legend: {
    gap: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
  },
  pressed: {
    opacity: 0.6,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  name: {
    flex: 1,
    ...typography.bodyLg,
    color: colors.onSurface,
  },
  percent: {
    ...typography.labelLg,
    color: colors.onSurfaceVariant,
    minWidth: 40,
    textAlign: 'right',
  },
  amount: {
    minWidth: 72,
    textAlign: 'right',
  },
});
