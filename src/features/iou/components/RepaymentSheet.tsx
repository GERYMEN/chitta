import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BottomSheet, Button } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, spacing, typography } from '../../../theme';
import { canLinkAsRepayment } from '../../../domain/iou/iou.rules';
import { IouShare } from '../../../domain/iou/iou.types';
import { Transaction } from '../../../domain/transactions/transaction.types';
import { formatRupeesFromMinor } from '../../../shared/utils/currency';
import { redactText, useRedacted } from '../../../shared/privacy/redaction';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { useIouStore } from '../state/iouStore';

const MAX_CANDIDATES = 20;

/**
 * Candidates for an IOU repayment link: for LENT, approved unlinked credits
 * (exact amount first, then newest); for BORROWED, approved expenses that are
 * not hidden/linked (newest first). Pure + exported for tests.
 */
export function repaymentCandidates(
  share: IouShare,
  transactions: ReadonlyArray<Transaction>,
  shares: ReadonlyArray<IouShare>,
): Transaction[] {
  const pool =
    share.direction === 'lent'
      ? transactions.filter(t => canLinkAsRepayment(t, shares))
      : transactions.filter(
          t =>
            t.type === 'expense' &&
            t.status === 'approved' &&
            t.linkKind == null &&
            !shares.some(s => s.repaymentTransactionId === t.id),
        );
  return [...pool]
    .sort((a, b) => {
      const exactA = a.amountMinor === share.amountMinor ? 0 : 1;
      const exactB = b.amountMinor === share.amountMinor ? 0 : 1;
      return exactA - exactB || b.occurredAt.localeCompare(a.occurredAt);
    })
    .slice(0, MAX_CANDIDATES);
}

/**
 * R10 (D-d / D-e) "Record repayment" / "Mark paid": settle in full with no
 * transaction, or link one. (Partial repayment is not offered — see the R10
 * report: settle in full only.) A credit linked to a lent share stops counting
 * as income; an expense linked to a borrowed share stays normal spend.
 */
export function RepaymentSheet({
  visible,
  onClose,
  share,
  onSettle,
}: {
  visible: boolean;
  onClose: () => void;
  share: IouShare | null;
  onSettle: (share: IouShare, transactionId: string | null) => void;
}) {
  useRedacted();
  const transactions = useTransactionsStore(state => state.transactions);
  const shares = useIouStore(state => state.shares);
  const candidates = useMemo(
    () => (visible && share ? repaymentCandidates(share, transactions, shares) : []),
    [visible, share, transactions, shares],
  );
  if (!share) return null;
  const lent = share.direction === 'lent';

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>{lent ? 'Record repayment' : 'Mark paid'}</Text>
      <Text style={styles.body}>
        Settles the full {formatRupeesFromMinor(share.amountMinor)}.{' '}
        {lent
          ? 'A credit you link here is not counted as income.'
          : 'An expense you link here is still your spend.'}
      </Text>
      <Button
        label={lent ? 'Settle without a transaction' : 'Mark paid without a transaction'}
        variant="brand"
        onPress={() => onSettle(share, null)}
        testID="iou-settle-plain"
      />
      <Text style={styles.sub}>{lent ? 'Or link the credit that paid you back' : 'Or link the expense that paid it'}</Text>
      {candidates.length === 0 ? (
        <Text style={styles.body} testID="iou-candidates-empty">
          {lent ? 'No unlinked credit to link.' : 'No expense to link.'}
        </Text>
      ) : (
        <ScrollView style={styles.scroll}>
          {candidates.map(t => (
            <Pressable
              key={t.id}
              onPress={() => onSettle(share, t.id)}
              accessibilityRole="button"
              accessibilityLabel={`Link ${redactText(t.merchantName)} ${formatRupeesFromMinor(t.amountMinor)}`}
              testID="iou-candidate"
              style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
              <Icon name={lent ? 'cash-plus' : 'cash-minus'} size={20} color={colors.primary} />
              <View style={styles.optionText}>
                <Text style={styles.optionTitle} numberOfLines={1}>
                  {redactText(t.merchantName)}
                </Text>
                <Text style={styles.optionMeta}>
                  {formatRupeesFromMinor(t.amountMinor)} · {t.occurredAt.slice(0, 10)}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.headlineSm, fontSize: 18, color: colors.onSurface },
  body: { ...typography.bodyMd, color: colors.outline, marginBottom: spacing.sm },
  sub: { ...typography.labelLg, color: colors.outline, marginTop: spacing.md, marginBottom: spacing.xs },
  scroll: { maxHeight: 300 },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 56, paddingVertical: spacing.xs },
  pressed: { opacity: 0.6 },
  optionText: { flex: 1 },
  optionTitle: { ...typography.bodyLg, color: colors.onSurface },
  optionMeta: { ...typography.bodyMd, color: colors.outline },
});
