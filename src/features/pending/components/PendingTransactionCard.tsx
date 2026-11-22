import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Chip } from '../../../shared/ui';
import { AmountText } from '../../../shared/ui/AmountText';
import { Icon } from '../../../shared/icons';
import { spacing, typography, useColors, ColorTokens } from '../../../theme';
import { Transaction } from '../../../domain/transactions/transaction.types';
import { confidenceTier } from '../../../domain/transactions/transaction.rules';
import { getCategoryVisual } from '../../../shared/constants/categoryVisuals';
import { formatTransactionTimestamp } from '../../../shared/utils/date';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { categoryLabel, UNCATEGORISED_ID } from '../../../domain/categories/category.rules';
import { redactText, useRedacted } from '../../../shared/privacy/redaction';
import { isRuleDisagreementRow } from '../../sms-sync/smsSyncLogic';
import { isWaitingForMatchingAlert, useChainSuggestions } from '../../sms-sync/rules/chaining';
import { MeaningCard } from '../../meaning/components/MeaningCard';

/** R5g N1: the template and the reader read this SMS differently. */
export const RULE_DISAGREEMENT_NOTE = 'Check this one: two readers disagree';
/** R5g item 21: an incomplete chained alert (held up to 24 h). */
export const WAITING_FOR_ALERT_NOTE = 'Waiting for the matching alert';

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
  const pal = useColors();
  const styles = useMemo(() => makeStyles(pal), [pal]);
  const categories = useTransactionsStore(state => state.categories);
  const chainSuggestions = useChainSuggestions(state => state.suggestions);
  // R5e T3: an open money meaning (card bill / ATM / wallet / own transfer).
  const meaning = useTransactionsStore(state =>
    state.meaningSuggestions.find(s => s.transactionId === transaction.id && s.resolvedAt == null),
  );
  useRedacted(); // R4c

  const category = categories.find(c => c.id === transaction.categoryId);
  const visual = getCategoryVisual(transaction.categoryId, category, pal);
  const tier = confidenceTier(transaction.confidenceScore);

  return (
    <Card style={styles.card}>
      <View style={styles.topRow}>
        <View style={[styles.avatar, { backgroundColor: visual.backgroundColor }]}>
          <Icon name={visual.icon} size={22} color={visual.iconColor} />
        </View>
        <View style={styles.middle}>
          <Text style={styles.merchant}>{redactText(transaction.merchantName)}</Text>
          <Text style={styles.subtitle}>
            {formatTransactionTimestamp(transaction.occurredAt)} · {CHANNEL_LABEL[transaction.paymentMethod]}
          </Text>
        </View>
        <AmountText amountMinor={transaction.amountMinor} type={transaction.type} variant="headlineSm" />
      </View>

      {isRuleDisagreementRow(transaction) ? (
        <Text style={styles.disagreeNote} testID="pending-rule-disagreement">
          {RULE_DISAGREEMENT_NOTE}
        </Text>
      ) : null}
      {isWaitingForMatchingAlert(chainSuggestions, transaction.id, Date.now()) ? (
        <Text style={styles.disagreeNote} testID="pending-waiting-alert">
          {WAITING_FOR_ALERT_NOTE}
        </Text>
      ) : null}

      <View style={styles.chipRow}>
        {category ? (
          <Chip
            label={categoryLabel(category)}
            tone={category.id === UNCATEGORISED_ID ? 'pending' : 'neutral'}
          />
        ) : null}
        <Chip
          label={tier === 'high' ? 'High confidence' : tier === 'needsReview' ? 'Needs review' : 'Uncertain'}
          tone={tier === 'high' ? 'approved' : 'pending'}
        />
      </View>

      {meaning ? <MeaningCard suggestion={meaning} transaction={transaction} /> : null}

      <View style={styles.actions}>
        <Button
          label="Approve"
          variant="brand"
          onPress={() => onApprove(transaction)}
          fullWidth={false}
          style={styles.approveButton}
          icon={<Icon name="check" size={16} color={pal.obsidian} />}
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

const makeStyles = (pal: ColorTokens) => StyleSheet.create({
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
    color: pal.onSurface,
  },
  subtitle: {
    ...typography.bodyMd,
    color: pal.outline,
    marginTop: 2,
  },
  disagreeNote: {
    ...typography.bodyMd,
    color: pal.outline,
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
