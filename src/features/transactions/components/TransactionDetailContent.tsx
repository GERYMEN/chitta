import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AmountText, Button, Card, Chip } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, spacing, typography } from '../../../theme';
import { Transaction } from '../../../domain/transactions/transaction.types';
import { confidenceTier } from '../../../domain/transactions/transaction.rules';
import { accountDisplayLabel } from '../../../domain/accounts/account.rules';
import { getCategoryVisual } from '../../../shared/constants/categoryVisuals';
import { formatTransactionTimestamp } from '../../../shared/utils/date';
import { formatRupeesFromMinor } from '../../../shared/utils/currency';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { parseSmsReference } from '../../sms-sync/smsReference';
import { OriginalSmsView } from './OriginalSmsView';
import { categoryLabel } from '../../../domain/categories/category.rules';

export interface TransactionDetailContentProps {
  transaction: Transaction;
  onApprove: (transaction: Transaction) => void;
  onEdit: (transaction: Transaction) => void;
  onReject: (transaction: Transaction) => void;
  /**
   * Delete is only offered for non-pending transactions, and only when the
   * caller passes this (Pending's review sheet does not — user decision B).
   */
  onDelete?: (transaction: Transaction) => void;
  /** 'sheet': compact Pending → Review surface. 'screen': full Transaction Detail. */
  variant?: 'sheet' | 'screen';
  /** When true, the action row is omitted so the parent can render it in a fixed footer. */
  hideActions?: boolean;
  /** R2: when passed, the Category row is tappable (opens a picker). */
  onChangeCategory?: (transaction: Transaction) => void;
}

const TIER_LABEL: Record<ReturnType<typeof confidenceTier>, string> = {
  high: 'High Match',
  needsReview: 'Needs Review',
  uncertain: 'Uncertain',
};

const CHANNEL_LABEL: Record<Transaction['paymentMethod'], string> = {
  bank: 'Bank Transfer',
  upi: 'UPI',
  cash: 'Cash',
  card: 'Card',
  other: 'Other',
};

export interface TransactionDetailActionsProps {
  transaction: Transaction;
  onApprove: (transaction: Transaction) => void;
  onEdit: (transaction: Transaction) => void;
  onReject: (transaction: Transaction) => void;
  onDelete?: (transaction: Transaction) => void;
}

/**
 * Action row (approve/edit/reject/delete) shown for a transaction, split out
 * so the full-screen detail can pin it in a fixed footer above the gesture
 * navigation zone instead of burying it at the bottom of the scroll content.
 */
export function TransactionDetailActions({
  transaction,
  onApprove,
  onEdit,
  onReject,
  onDelete,
}: TransactionDetailActionsProps) {
  const isPending = transaction.status === 'pending';

  return (
    <View style={styles.actions}>
      {isPending ? (
        <>
          <Button
            label={`Approve Transaction (${formatRupeesFromMinor(transaction.amountMinor)})`}
            variant="brand"
            onPress={() => onApprove(transaction)}
          />
          <View style={styles.secondaryActions}>
            <Button label="Edit" variant="ghost" onPress={() => onEdit(transaction)} style={styles.secondaryButton} />
            <Button label="Reject" variant="destructive" onPress={() => onReject(transaction)} style={styles.secondaryButton} />
          </View>
        </>
      ) : (
        <View style={styles.secondaryActions}>
          <Button label="Edit" variant="ghost" onPress={() => onEdit(transaction)} style={styles.secondaryButton} />
          {onDelete ? (
            <Button label="Delete" variant="destructive" onPress={() => onDelete(transaction)} style={styles.secondaryButton} />
          ) : null}
        </View>
      )}
    </View>
  );
}

/**
 * One reusable architecture for both pending review and approved detail
 * (docs/PROJECT.md §5.3). Progressive disclosure: list level never shown
 * here, review level always visible, advanced/audit level stays collapsed
 * behind "Detection Transparency" until requested.
 */
export function TransactionDetailContent({
  transaction,
  onApprove,
  onEdit,
  onReject,
  onDelete,
  variant = 'screen',
  hideActions = false,
  onChangeCategory,
}: TransactionDetailContentProps) {
  const [transparencyOpen, setTransparencyOpen] = useState(variant === 'screen');
  const [auditOpen, setAuditOpen] = useState(false);
  const categories = useTransactionsStore(state => state.categories);
  const accounts = useTransactionsStore(state => state.accounts);

  const category = categories.find(c => c.id === transaction.categoryId);
  const visual = getCategoryVisual(transaction.categoryId, category);
  const account = accounts.find(a => a.id === transaction.accountId);
  const tier = confidenceTier(transaction.confidenceScore);
  const isPending = transaction.status === 'pending';
  const confidencePercent =
    transaction.confidenceScore !== null ? Math.round(transaction.confidenceScore) : null;
  const smsReference =
    transaction.sourceType === 'sms' ? parseSmsReference(transaction.sourceReferenceHash) : null;

  return (
    <View style={styles.container}>
      {isPending ? (
        <Chip label="Pending Approval" tone="pending" icon={<Icon name="clock-outline" size={14} color="#B7791F" />} />
      ) : (
        <Chip label="Approved" tone="approved" icon={<Icon name="check-circle-outline" size={14} color="#00A827" />} />
      )}

      <View style={styles.summary}>
        <View style={[styles.avatar, { backgroundColor: visual.backgroundColor }]}>
          <Icon name={visual.icon} size={28} color={visual.iconColor} />
        </View>
        <View style={styles.merchantRow}>
          <Text style={styles.merchant}>{transaction.merchantName}</Text>
          {confidencePercent !== null ? (
            <Chip label={`${confidencePercent}% match`} tone="approved" />
          ) : null}
        </View>
        <AmountText
          amountMinor={transaction.amountMinor}
          type={transaction.type}
          showPaise
          variant="displayHeroMobile"
          style={styles.amount}
        />
        <View style={styles.chipRow}>
          <Chip
            label={transaction.type === 'income' ? 'Income Inflow' : 'Expense Outflow'}
            tone={transaction.type === 'income' ? 'approved' : 'neutral'}
          />
          {isPending ? <Chip label="Not counted in balance" tone="pending" /> : null}
        </View>
        <Text style={styles.metaLine}>
          {formatTransactionTimestamp(transaction.occurredAt)} · {CHANNEL_LABEL[transaction.paymentMethod]}
          {account ? ` · ${accountDisplayLabel(account)}` : ''}
        </Text>
      </View>

      <Card style={styles.fieldsCard}>
        <Text style={styles.cardTitle}>Transaction Details</Text>
        <DetailRow
          label="Type"
          value={transaction.type === 'income' ? 'Credit Income' : 'Debit Expense'}
        />
        {onChangeCategory ? (
          <Pressable
            onPress={() => onChangeCategory(transaction)}
            accessibilityRole="button"
            accessibilityLabel={`Category ${categoryLabel(category)}. Change category`}
            testID="detail-category-row"
            style={({ pressed }) => [styles.detailRow, styles.tappableRow, pressed && styles.pressed]}>
            <Text style={styles.detailLabel}>Category</Text>
            <View style={styles.tappableValue}>
              <Text style={styles.detailValue} numberOfLines={2}>
                {categoryLabel(category)}
              </Text>
              <Icon name="pencil-outline" size={16} color={colors.primary} />
            </View>
          </Pressable>
        ) : (
          <DetailRow label="Category" value={categoryLabel(category)} />
        )}
        <DetailRow
          label="Account"
          value={accountDisplayLabel(account)}
        />
        <DetailRow label="Date & Time" value={formatTransactionTimestamp(transaction.occurredAt)} />
        {transaction.note ? <DetailRow label="Personal Note" value={transaction.note} /> : null}
      </Card>

      <Card style={styles.fieldsCard}>
        <View style={styles.transparencyHeader}>
          <Text style={styles.cardTitle}>Detection Transparency</Text>
          <Text style={styles.linkText} onPress={() => setTransparencyOpen(!transparencyOpen)}>
            {transparencyOpen ? 'Hide' : 'Show'}
          </Text>
        </View>

        {transparencyOpen ? (
          <>
            <View style={styles.transparencyGrid}>
              <View style={styles.transparencyCell}>
                <Text style={styles.transparencyLabel}>Detected From</Text>
                <Text style={styles.transparencyValue}>
                  {transaction.sourceType === 'sms' ? 'SMS' : transaction.sourceType === 'notification' ? 'Notification' : 'Manual Entry'}
                </Text>
              </View>
              <View style={styles.transparencyCell}>
                <Text style={styles.transparencyLabel}>Confidence</Text>
                <Text style={styles.transparencyValue}>
                  {confidencePercent !== null ? `${confidencePercent}% ${TIER_LABEL[tier]}` : 'N/A'}
                </Text>
              </View>
            </View>
            <Text style={styles.transparencyMeta}>
              Parser: {transaction.parserVersion ?? 'unknown'} · Ref ID: {transaction.sourceReferenceHash ?? '—'}
            </Text>

            {transaction.sanitizedPreview ? (
              <View style={styles.sourceBox}>
                <Text style={styles.sourceLabel}>SANITIZED SOURCE MESSAGE</Text>
                <Text style={styles.sourceText}>&ldquo;{transaction.sanitizedPreview}&rdquo;</Text>
                <Text style={styles.sourceFootnote}>Zero credentials stored · Sanitized entirely on-device</Text>
              </View>
            ) : null}

            {smsReference ? <OriginalSmsView reference={smsReference} /> : null}

            <Text style={styles.linkText} onPress={() => setAuditOpen(!auditOpen)}>
              {auditOpen ? 'Hide' : 'Show'} Advanced Cryptographic &amp; Audit Logs
            </Text>
            {auditOpen ? (
              <Text style={styles.transparencyMeta}>
                No audit events recorded yet for this transaction.
              </Text>
            ) : null}
          </>
        ) : null}
      </Card>

      {!hideActions ? (
        <TransactionDetailActions
          transaction={transaction}
          onApprove={onApprove}
          onEdit={onEdit}
          onReject={onReject}
          onDelete={onDelete}
        />
      ) : null}
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  summary: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  merchantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  merchant: {
    ...typography.headlineMd,
    color: colors.onSurface,
  },
  amount: {
    marginTop: spacing.xs,
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  metaLine: {
    ...typography.bodyMd,
    color: colors.outline,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  fieldsCard: {
    gap: spacing.sm,
  },
  cardTitle: {
    ...typography.headlineSm,
    fontSize: 16,
    color: colors.onSurface,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  detailLabel: {
    ...typography.bodyMd,
    color: colors.outline,
  },
  tappableRow: {
    minHeight: 48,
    alignItems: 'center',
  },
  tappableValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 1,
  },
  pressed: {
    opacity: 0.6,
  },
  detailValue: {
    ...typography.bodyLg,
    color: colors.onSurface,
    flexShrink: 1,
    textAlign: 'right',
    marginLeft: spacing.md,
  },
  transparencyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  transparencyGrid: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  transparencyCell: {
    gap: 2,
  },
  transparencyLabel: {
    ...typography.labelMd,
    color: colors.outline,
  },
  transparencyValue: {
    ...typography.bodyLg,
    color: colors.onSurface,
  },
  transparencyMeta: {
    ...typography.bodyMd,
    color: colors.outline,
  },
  sourceBox: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.xs,
  },
  sourceLabel: {
    ...typography.labelSm,
    color: colors.outline,
    letterSpacing: 0.5,
  },
  sourceText: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    fontStyle: 'italic',
  },
  sourceFootnote: {
    ...typography.labelSm,
    color: colors.primary,
  },
  linkText: {
    ...typography.labelLg,
    color: colors.primary,
  },
  actions: {
    gap: spacing.sm,
  },
  secondaryActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 48,
  },
});
