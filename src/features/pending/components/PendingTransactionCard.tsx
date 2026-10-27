import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Chip } from '../../../shared/ui';
import { AmountText } from '../../../shared/ui/AmountText';
import { Icon } from '../../../shared/icons';
import { colors, spacing, typography } from '../../../theme';
import { Transaction } from '../../../domain/transactions/transaction.types';
import { confidenceTier } from '../../../domain/transactions/transaction.rules';
import { getCategoryVisual } from '../../../shared/constants/categoryVisuals';
import { formatTransactionTimestamp } from '../../../shared/utils/date';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';

export interface PendingTransactionCardProps {
  transaction: Transaction;
  onApprove: (transaction: Transaction) => void;
  onReview: (transaction: Transaction) => void;
}

const CHANNEL_LABEL: Record<Transaction['paymentMethod'], string> = {
  bank: 'Bank',
  upi: 'UPI',
  cash: 'Cash',
  card: 'Card',
  other: 'Other',
};

/**
 * Default Pending card (docs/PROJECT.md §5.2): merchant, amount, time ·
 * channel, category, confidence, with only Approve + Review surfaced —
 * Edit/Reject live inside the Review sheet, not on every card.
 */
export function PendingTransactionCard({
  transaction,
  onApprove,
  onReview,
}: PendingTransactionCardProps) {
  const categories = useTransactionsStore(state => state.categories);

  const visual = getCategoryVisual(transaction.categoryId);
  const category = categories.find(c => c.id === transaction.categoryId);
  const tier = confidenceTier(transaction.confidenceScore);

  return (
    <Card style={styles.card}>
      <View style={styles.topRow}>
        <View style={[styles.avatar, { backgroundColor: visual.backgroundColor }]}>
          <Icon name={visual.icon} size={22} color={visual.iconColor} />
        </View>
        <View style={styles.middle}>
          <Text style={styles.merchant}>{transaction.merchantName}</Text>
          <Text style={styles.subtitle}>
            {formatTransactionTimestamp(transaction.occurredAt)} · {CHANNEL_LABEL[transaction.paymentMethod]}
          </Text>
        </View>
        <AmountText amountMinor={transaction.amountMinor} type={transaction.type} variant="headlineSm" />
      </View>

      <View style={styles.chipRow}>
        {category ? <Chip label={category.name} tone="neutral" /> : null}
        <Chip
          label={tier === 'high' ? 'High confidence' : tier === 'needsReview' ? 'Needs review' : 'Uncertain'}
          tone={tier === 'high' ? 'approved' : 'pending'}
        />
      </View>

      <View style={styles.actions}>
        <Button
          label="Approve"
          variant="brand"
          onPress={() => onApprove(transaction)}
          fullWidth={false}
          style={styles.approveButton}
          icon={<Icon name="check" size={16} color={colors.obsidian} />}
        />
        <Button
          label="Review"
          variant="ghost"
          onPress={() => onReview(transaction)}
          fullWidth={false}
          style={styles.reviewButton}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middle: {
    flex: 1,
    marginLeft: spacing.md,
    marginRight: spacing.sm,
  },
  merchant: {
    ...typography.headlineSm,
    fontSize: 16,
    color: colors.onSurface,
  },
  subtitle: {
    ...typography.bodyMd,
    color: colors.outline,
    marginTop: 2,
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  approveButton: {
    flex: 1,
    height: 48,
  },
  reviewButton: {
    flex: 1,
    height: 48,
  },
});
