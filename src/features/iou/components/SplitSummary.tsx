import React, { useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Card } from '../../../shared/ui';
import { colors, typography } from '../../../theme';
import { splitTotalForExpense } from '../../../domain/iou/iou.rules';
import { useRedacted } from '../../../shared/privacy/redaction';
import { useIouStore } from '../state/iouStore';
import { splitSummaryLabel } from '../iouLabels';

/** R10 (D-c): the expense detail's "Split: N people owe you ₹X" line. Null when none. */
export function SplitSummary({ expenseId }: { expenseId: string }) {
  useRedacted();
  const shares = useIouStore(state => state.shares);
  const summary = useMemo(() => splitTotalForExpense(shares, expenseId), [shares, expenseId]);
  if (summary.count === 0) return null;
  return (
    <Card testID="iou-split-summary">
      <Text style={styles.text}>{splitSummaryLabel(summary.owedCount, summary.owedMinor, summary.count)}</Text>
      <Text style={styles.meta}>Your spend is unchanged. Open People to record repayments.</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  text: { ...typography.bodyLg, color: colors.onSurface },
  meta: { ...typography.bodyMd, color: colors.outline },
});
