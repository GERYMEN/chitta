import React, { useMemo } from 'react';
import { ChartBars, ChartBarsDatum } from '../../../components/charts/ChartBars';
import { colors } from '../../../theme';
import { Category } from '../../../domain/categories/category.types';
import { categoryLabel } from '../../../domain/categories/category.rules';
import { CategoryBreakdownRow } from '../../../domain/insights/insights.types';
import { getCategoryVisual } from '../../../shared/constants/categoryVisuals';
import { formatRupeesFromMinor } from '../../../shared/utils/currency';
import {
  categoryBarA11yLabel,
  categoryBarDetail,
  OTHER_LABEL,
  otherCategoriesA11yName,
} from '../insightLabels';

interface CategoryBarItem {
  datum: ChartBarsDatum;
  row: CategoryBreakdownRow;
  a11yName: string;
}

/**
 * Breakdown rows → ChartBars data: category name (archived marked), the R2
 * category colour (getCategoryVisual fg; unknown → its neutral fallback
 * token) and the folded "Other" row in the outline token.
 */
export function categoryBarItems(
  rows: ReadonlyArray<CategoryBreakdownRow>,
  categories: ReadonlyArray<Category>,
): CategoryBarItem[] {
  const byId = new Map(categories.map(category => [category.id, category]));
  return rows.map(row => {
    if (row.categoryId === null) {
      return {
        row,
        a11yName: otherCategoriesA11yName(row.categoryCount),
        datum: { key: row.key, label: OTHER_LABEL, value: row.spendMinor, color: colors.outline },
      };
    }
    const category = byId.get(row.categoryId);
    const name = categoryLabel(category);
    return {
      row,
      a11yName: name,
      datum: {
        key: row.key,
        label: name,
        value: row.spendMinor,
        color: getCategoryVisual(row.categoryId, category).iconColor,
      },
    };
  });
}

export interface CategoryBarsProps {
  rows: ReadonlyArray<CategoryBreakdownRow>;
  categories: ReadonlyArray<Category>;
  /** A category bar (categoryId) or the "Other" row (null). */
  onPressRow: (row: CategoryBreakdownRow) => void;
  testID?: string;
}

/** R4: horizontal category bars — ₹ amount, item count and % of spend. */
export function CategoryBars({ rows, categories, onPressRow, testID }: CategoryBarsProps) {
  const items = useMemo(() => categoryBarItems(rows, categories), [rows, categories]);
  const byKey = useMemo(() => new Map(items.map(item => [item.datum.key, item])), [items]);
  const data = useMemo(() => items.map(item => item.datum), [items]);

  return (
    <ChartBars
      data={data}
      orientation="horizontal"
      formatValue={value => formatRupeesFromMinor(value)}
      formatDetail={datum => {
        const item = byKey.get(datum.key);
        return item ? categoryBarDetail(item.row) : null;
      }}
      accessibilityLabelFor={datum => {
        const item = byKey.get(datum.key);
        return item ? categoryBarA11yLabel(item.a11yName, item.row) : datum.label;
      }}
      onPressBar={datum => {
        const item = byKey.get(datum.key);
        if (item) onPressRow(item.row);
      }}
      testID={testID}
    />
  );
}
