import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, spacing, typography } from '../../../theme';
import { Transaction } from '../../../domain/transactions/transaction.types';
import { rankRefundCandidates, REFUND_LOOKBACK_DAYS } from '../../../domain/refunds/refund.rules';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { leftToRefundLabel, refundCandidateMeta } from '../refundLabels';

/**
 * R3b "Link to original expense": ranked candidates (same merchant, then
 * same account, then closest date) with what is still refundable on each.
 */
export function RefundCandidateSheet({
  visible,
  onClose,
  refund,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  refund: Transaction;
  onSelect: (expenseId: string) => void;
}) {
  const transactions = useTransactionsStore(state => state.transactions);
  const candidates = useMemo(
    () => (visible ? rankRefundCandidates(refund, transactions) : []),
    [visible, refund, transactions],
  );

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>Link to original expense</Text>
      <Text style={styles.body}>
        A linked refund is not income — it reduces what you spent. Your balance does not change.
      </Text>
      {candidates.length === 0 ? (
        <Text style={styles.body} testID="refund-candidates-empty">
          No expense from the last {REFUND_LOOKBACK_DAYS} days can take this refund.
        </Text>
      ) : (
        <View>
          {candidates.map(({ expense, leftMinor }) => (
            <Pressable
              key={expense.id}
              onPress={() => onSelect(expense.id)}
              accessibilityRole="button"
              accessibilityLabel={`Link to ${expense.merchantName}`}
              testID="refund-candidate"
              style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
              <Icon name="cash-refund" size={20} color={colors.primary} />
              <View style={styles.optionText}>
                <Text style={styles.optionTitle} numberOfLines={1}>
                  {expense.merchantName}
                </Text>
                <Text style={styles.optionMeta}>{refundCandidateMeta(expense)}</Text>
                <Text style={styles.optionLeft}>{leftToRefundLabel(leftMinor)}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.headlineSm,
    fontSize: 18,
    color: colors.onSurface,
  },
  body: {
    ...typography.bodyMd,
    color: colors.outline,
    marginBottom: spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 56,
    paddingVertical: spacing.xs,
  },
  pressed: {
    opacity: 0.6,
  },
  optionText: {
    flex: 1,
  },
  optionTitle: {
    ...typography.bodyLg,
    color: colors.onSurface,
  },
  optionMeta: {
    ...typography.bodyMd,
    color: colors.outline,
  },
  optionLeft: {
    ...typography.labelMd,
    color: colors.primary,
  },
});
