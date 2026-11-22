import React from 'react';
import { StyleSheet, View } from 'react-native';
import { radii, useColors } from '../../../theme';
import { BudgetProgress } from '../../../domain/budgets/budget.rules';
import { budgetStateColors } from '../budgetLabels';

/**
 * R5c (D-d): a horizontal progress bar for one budget. The fill width is the
 * ratio clamped to [0, 1] (an over-budget bar is full and red); the colour is
 * the state colour (green / amber / red) from the theme. Decorative only — the
 * numbers beside it carry the meaning, so it is hidden from the a11y tree.
 */
export function BudgetBar({ progress, height = 8 }: { progress: BudgetProgress; height?: number }) {
  const c = useColors();
  const palette = budgetStateColors(c)[progress.state];
  const fillPct = Math.max(0, Math.min(1, progress.ratio)) * 100;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.track, { height, backgroundColor: palette.track, borderRadius: height }]}>
      <View
        style={[
          styles.fill,
          { width: `${fillPct}%`, backgroundColor: palette.fill, borderRadius: height },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    overflow: 'hidden',
    borderRadius: radii.sm,
  },
  fill: {
    height: '100%',
  },
});
