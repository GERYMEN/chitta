import React, { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Icon } from '../../../shared/icons';
import { colors, radii, spacing, typography } from '../../../theme';
import { useBudgetsStore } from '../state/budgetsStore';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { useNow } from '../../../shared/hooks/useNow';
import {
  budgetSummary,
  currentMonthRange,
  hasAnyBudget,
} from '../../../domain/budgets/budget.rules';
import { BudgetBar } from './BudgetBar';
import {
  BUDGET_STATE_COLORS,
  BUDGET_STATE_LABEL,
  leftOrOverLabel,
  spentOfLabel,
} from '../budgetLabels';

/**
 * R5c (D-e): Home budget card. Hidden until at least one budget is set. Shows
 * the overall month progress (bar + state colour) and, when any category is
 * over or near its cap, a one-line "N over budget" / "N near limit". Tapping
 * opens the Budgets screen. Every amount goes through the redaction-aware
 * formatter (spentOfLabel / leftOrOverLabel), so the feedback-screenshot flag
 * masks them.
 */
export function BudgetCard({ onPress }: { onPress: () => void }) {
  const budgets = useBudgetsStore(state => state.budgets);
  const refresh = useBudgetsStore(state => state.refresh);
  const transactions = useTransactionsStore(state => state.transactions);
  const categories = useTransactionsStore(state => state.categories);
  const now = useNow(budgets.length);

  useFocusEffect(
    useCallback(() => {
      refresh().catch(() => undefined);
    }, [refresh]),
  );

  const range = useMemo(() => currentMonthRange(now), [now]);
  const summary = useMemo(
    () => budgetSummary(budgets, categories, transactions, range),
    [budgets, categories, transactions, range],
  );

  if (!hasAnyBudget(budgets)) return null;

  const overall = summary.overall;
  const warning =
    summary.overCount > 0
      ? `${summary.overCount} over budget`
      : summary.nearCount > 0
      ? `${summary.nearCount} near limit`
      : null;
  const warningTone = summary.overCount > 0 ? 'over' : 'near';
  const warningColor = BUDGET_STATE_COLORS[warningTone].fg;

  const a11y = overall
    ? `Budget: ${spentOfLabel(overall.actualMinor, overall.budgetMinor)}, ${leftOrOverLabel(
        overall.remainingMinor,
        overall.overMinor,
      )}${warning ? `, ${warning}` : ''}`
    : `Budgets${warning ? `: ${warning}` : ''}`;

  return (
    <Pressable
      onPress={onPress}
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      testID="home-budget-card">
      <View style={styles.headerRow}>
        <Icon name="gauge" size={20} color={colors.primary} />
        <Text style={styles.title}>Budget</Text>
        {overall ? (
          <Text style={[styles.stateLabel, { color: BUDGET_STATE_COLORS[overall.state].fg }]}>
            {BUDGET_STATE_LABEL[overall.state]}
          </Text>
        ) : null}
        <Icon name="chevron-right" size={22} color={colors.outline} />
      </View>

      {overall ? (
        <>
          <View style={styles.amountRow}>
            <Text style={styles.amount}>{spentOfLabel(overall.actualMinor, overall.budgetMinor)}</Text>
            <Text style={[styles.leftOver, { color: BUDGET_STATE_COLORS[overall.state].fg }]}>
              {leftOrOverLabel(overall.remainingMinor, overall.overMinor)}
            </Text>
          </View>
          <BudgetBar progress={overall} />
        </>
      ) : (
        <Text style={styles.noOverall}>Tracking your category budgets this month.</Text>
      )}

      {warning ? (
        <Text style={[styles.warning, { color: warningColor }]}>{warning}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
    minHeight: 48,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.labelLg, color: colors.onSurface, flex: 1 },
  stateLabel: { ...typography.labelMd },
  amountRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  amount: { ...typography.bodyLg, color: colors.onSurface },
  leftOver: { ...typography.labelMd },
  noOverall: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  warning: { ...typography.labelMd },
});
