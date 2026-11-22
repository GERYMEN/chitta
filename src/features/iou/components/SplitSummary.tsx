import React, { useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Card } from '../../../shared/ui';
import { typography, useColors, ColorTokens } from '../../../theme';
import { splitTotalForExpense } from '../../../domain/iou/iou.rules';
import { useRedacted } from '../../../shared/privacy/redaction';
import { useIouStore } from '../state/iouStore';
import { splitSummaryLabel } from '../iouLabels';

/** R10 (D-c): the expense detail's "Split: N people owe you ₹X" line. Null when none. */
export function SplitSummary({ expenseId }: { expenseId: string }) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
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

const makeStyles = (c: ColorTokens) => StyleSheet.create({
  text: { ...typography.bodyLg, color: c.onSurface },
  meta: { ...typography.bodyMd, color: c.outline },
});
