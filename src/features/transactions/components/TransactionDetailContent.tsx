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
import { findTransferTwin, isPairCandidate } from '../../../domain/transfers/transfer.rules';
import { transferRouteLabel } from '../../transfers/transferLabels';
import { isLinkedRefund } from '../../../domain/transactions/transaction.rules';
import { canLinkAsRefund, refundsFor } from '../../../domain/refunds/refund.rules';
import {
  duplicatePickerOptions,
  hiddenDuplicatesOf,
} from '../../../domain/duplicates/duplicate.rules';
import { refundedLabel, refundForLabel, refundRowLine } from '../../refunds/refundLabels';
import { hiddenDuplicatesLabel } from '../../duplicates/duplicateLabels';

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
  /** R3a: a transfer twin's "View transfer" link. */
  onOpenTransfer?: (transferId: string) => void;
  /** R3b: refund ↔ expense and duplicate ↔ kept-row links. */
  onOpenTransaction?: (transactionId: string) => void;
}

/** R3a: the kept SMS credit half of a confirmed transfer pair. */
export function isTransferTwin(transaction: Pick<Transaction, 'linkKind'>): boolean {
  return transaction.linkKind === 'transfer_twin';
}

/** R3b: a row hidden as a duplicate of another (rejected, link_kind 'duplicate'). */
export function isHiddenDuplicate(transaction: Pick<Transaction, 'linkKind'>): boolean {
  return transaction.linkKind === 'duplicate';
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
  /** R3a: approved income/expense → "Mark as transfer". */
  onMarkAsTransfer?: (transaction: Transaction) => void;
  /** R3a: a transfer confirmed from an SMS pair → "Undo transfer". */
  onUndoTransfer?: (transaction: Transaction) => void;
  /** R3b: pending/approved unlinked income → "Link to original expense". */
  onLinkRefund?: (transaction: Transaction) => void;
  /** R3b: linked refund → "Unlink refund". */
  onUnlinkRefund?: (transaction: Transaction) => void;
  /** R3b: pending/approved income/expense with a same-amount twin → "Mark as duplicate of…". */
  onMarkDuplicate?: (transaction: Transaction) => void;
  /** R3b: hidden duplicate → "Not a duplicate". */
  onRestoreDuplicate?: (transaction: Transaction) => void;
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
  onMarkAsTransfer,
  onUndoTransfer,
  onLinkRefund,
  onUnlinkRefund,
  onMarkDuplicate,
  onRestoreDuplicate,
}: TransactionDetailActionsProps) {
  const isPending = transaction.status === 'pending';
  const transactions = useTransactionsStore(state => state.transactions);
  // The twin is reached only from Activity; it has no actions of its own.
  if (isTransferTwin(transaction)) return null;
  // R3b: a hidden duplicate (reached from Activity / the kept row) can only be restored.
  if (isHiddenDuplicate(transaction)) {
    return onRestoreDuplicate ? (
      <View style={styles.actions}>
        <Button
          label="Not a duplicate"
          variant="ghost"
          onPress={() => onRestoreDuplicate(transaction)}
          icon={<Icon name="backup-restore" size={18} color={colors.onSurface} />}
          testID="detail-restore-duplicate"
        />
      </View>
    ) : null;
  }
  const isPaired =
    transaction.type === 'transfer' && findTransferTwin(transactions, transaction.id) !== null;
  // R3b.1: an expense with linked refunds is not offered "Mark as transfer".
  const canMark =
    transaction.status === 'approved' &&
    isPairCandidate(transaction) &&
    refundsFor(transactions, transaction.id).length === 0 &&
    onMarkAsTransfer;
  const canLinkRefund = canLinkAsRefund(transaction) && onLinkRefund;
  const canUnlinkRefund = isLinkedRefund(transaction) && onUnlinkRefund;
  // Offered only when there is something it could be a duplicate of.
  const canMarkDuplicate =
    onMarkDuplicate && duplicatePickerOptions(transaction, transactions).length > 0;

  return (
    <View style={styles.actions}>
      {canLinkRefund ? (
        <Button
          label="Link to original expense"
          variant="ghost"
          onPress={() => onLinkRefund(transaction)}
          icon={<Icon name="cash-refund" size={18} color={colors.onSurface} />}
          testID="detail-link-refund"
        />
      ) : null}
      {canUnlinkRefund ? (
        <Button
          label="Unlink refund"
          variant="ghost"
          onPress={() => onUnlinkRefund(transaction)}
          icon={<Icon name="link-variant-off" size={18} color={colors.onSurface} />}
          testID="detail-unlink-refund"
        />
      ) : null}
      {canMarkDuplicate ? (
        <Button
          label="Mark as duplicate of…"
          variant="ghost"
          onPress={() => onMarkDuplicate(transaction)}
          icon={<Icon name="content-duplicate" size={18} color={colors.onSurface} />}
          testID="detail-mark-duplicate"
        />
      ) : null}
      {canMark ? (
        <Button
          label="Mark as transfer"
          variant="ghost"
          onPress={() => onMarkAsTransfer(transaction)}
          icon={<Icon name="swap-horizontal" size={18} color={colors.onSurface} />}
          testID="detail-mark-transfer"
        />
      ) : null}
      {isPaired && onUndoTransfer ? (
        <Button
          label="Undo transfer"
          variant="ghost"
          onPress={() => onUndoTransfer(transaction)}
          icon={<Icon name="undo-variant" size={18} color={colors.onSurface} />}
          testID="detail-undo-transfer"
        />
      ) : null}
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
  onOpenTransfer,
  onOpenTransaction,
}: TransactionDetailContentProps) {
  const [transparencyOpen, setTransparencyOpen] = useState(variant === 'screen');
  const [auditOpen, setAuditOpen] = useState(false);
  const categories = useTransactionsStore(state => state.categories);
  const accounts = useTransactionsStore(state => state.accounts);
  const transactions = useTransactionsStore(state => state.transactions);

  const category = categories.find(c => c.id === transaction.categoryId);
  const visual = getCategoryVisual(transaction.categoryId, category);
  const account = accounts.find(a => a.id === transaction.accountId);
  const tier = confidenceTier(transaction.confidenceScore);
  const isPending = transaction.status === 'pending';
  const confidencePercent =
    transaction.confidenceScore !== null ? Math.round(transaction.confidenceScore) : null;
  const smsReference =
    transaction.sourceType === 'sms' ? parseSmsReference(transaction.sourceReferenceHash) : null;
  const isTransfer = transaction.type === 'transfer';
  const twin = isTransferTwin(transaction);
  const toAccount = isTransfer
    ? accounts.find(a => a.id === transaction.transferAccountId)
    : undefined;
  // R3b links (looked up live; ids only are stored on the rows).
  const hiddenDuplicate = isHiddenDuplicate(transaction);
  const isRefund = isLinkedRefund(transaction);
  const linkedRow =
    (hiddenDuplicate || isRefund) && transaction.linkedTransactionId
      ? transactions.find(t => t.id === transaction.linkedTransactionId) ?? null
      : null;
  const refunds = transaction.type === 'expense' ? refundsFor(transactions, transaction.id) : [];
  const refundedTotal = refunds.reduce((sum, r) => sum + r.amountMinor, 0);
  const hiddenDuplicates =
    hiddenDuplicate || twin ? [] : hiddenDuplicatesOf(transactions, transaction.id);

  return (
    <View style={styles.container}>
      {twin ? (
        <Chip label="Part of a transfer" tone="neutral" icon={<Icon name="swap-horizontal" size={14} color={colors.secondary} />} />
      ) : hiddenDuplicate ? (
        <Chip label="Duplicate · hidden" tone="neutral" icon={<Icon name="content-duplicate" size={14} color={colors.secondary} />} />
      ) : isPending ? (
        <Chip label="Pending Approval" tone="pending" icon={<Icon name="clock-outline" size={14} color="#B7791F" />} />
      ) : transaction.status === 'rejected' ? (
        <Chip label="Rejected" tone="rejected" icon={<Icon name="close-circle-outline" size={14} color="#6C757D" />} />
      ) : (
        <Chip label="Approved" tone="approved" icon={<Icon name="check-circle-outline" size={14} color="#00A827" />} />
      )}

      {twin ? (
        <Card style={styles.fieldsCard} testID="transfer-twin-notice">
          <Text style={styles.cardTitle}>Part of a transfer</Text>
          <Text style={styles.transparencyMeta}>
            This credit was confirmed as the receiving side of a transfer between your
            accounts. It is kept only so SMS sync never adds it again — it is not in any list,
            total or balance.
          </Text>
          {transaction.linkedTransactionId && onOpenTransfer ? (
            <Text
              style={styles.linkText}
              onPress={() => onOpenTransfer(transaction.linkedTransactionId as string)}
              accessibilityRole="link"
              testID="transfer-twin-open">
              View transfer ›
            </Text>
          ) : null}
        </Card>
      ) : null}

      {hiddenDuplicate ? (
        <Card style={styles.fieldsCard} testID="duplicate-notice">
          <Text style={styles.cardTitle}>
            {linkedRow ? `Duplicate of ${linkedRow.merchantName}` : 'Duplicate'}
          </Text>
          <Text style={styles.transparencyMeta}>
            You marked this as the same money recorded twice. It is kept only so SMS sync never
            adds it again — it is not in any list, total or balance.
          </Text>
          {linkedRow && onOpenTransaction ? (
            <Text
              style={styles.linkText}
              onPress={() => onOpenTransaction(linkedRow.id)}
              accessibilityRole="link"
              testID="duplicate-open-kept">
              View the kept item ›
            </Text>
          ) : null}
        </Card>
      ) : null}

      {isRefund ? (
        <Card style={styles.fieldsCard} testID="refund-notice">
          <Text style={styles.cardTitle}>Refund</Text>
          <Text style={styles.transparencyMeta}>
            Not counted as income — it reduces what you spent. Your balance still includes it.
          </Text>
          {linkedRow ? (
            <Text
              style={styles.linkText}
              onPress={onOpenTransaction ? () => onOpenTransaction(linkedRow.id) : undefined}
              accessibilityRole="link"
              testID="refund-open-expense">
              {refundForLabel(linkedRow)} ›
            </Text>
          ) : (
            <Text style={styles.transparencyMeta}>The original expense was deleted.</Text>
          )}
        </Card>
      ) : null}

      {refunds.length > 0 ? (
        <Card style={styles.fieldsCard} testID="refunded-notice">
          <Text style={styles.cardTitle}>{refundedLabel(refundedTotal)}</Text>
          {refunds.map(refund => (
            <Pressable
              key={refund.id}
              onPress={onOpenTransaction ? () => onOpenTransaction(refund.id) : undefined}
              accessibilityRole="link"
              accessibilityLabel={`Refund ${refundRowLine(refund)}`}
              style={({ pressed }) => [styles.detailRow, styles.tappableRow, pressed && styles.pressed]}>
              <Text style={styles.detailLabel}>{refund.merchantName}</Text>
              <Text style={styles.linkText}>{refundRowLine(refund)} ›</Text>
            </Pressable>
          ))}
        </Card>
      ) : null}

      {hiddenDuplicates.length > 0 ? (
        <Pressable
          onPress={onOpenTransaction ? () => onOpenTransaction(hiddenDuplicates[0].id) : undefined}
          accessibilityRole="link"
          testID="hidden-duplicates-link"
          style={({ pressed }) => [styles.hiddenLink, pressed && styles.pressed]}>
          <Icon name="content-duplicate" size={18} color={colors.secondary} />
          <Text style={styles.hiddenLinkText}>{hiddenDuplicatesLabel(hiddenDuplicates.length)}</Text>
          <Text style={styles.linkText}>View ›</Text>
        </Pressable>
      ) : null}

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
            label={
              isTransfer
                ? 'Transfer · not income or expense'
                : isRefund
                ? 'Refund · reduces spending'
                : transaction.type === 'income'
                ? 'Income Inflow'
                : 'Expense Outflow'
            }
            tone={transaction.type === 'income' ? 'approved' : 'neutral'}
          />
          {isPending ? <Chip label="Not counted in balance" tone="pending" /> : null}
        </View>
        {isTransfer ? (
          <Text style={styles.metaLine} testID="transfer-route">
            {transferRouteLabel(transaction, accounts)}
          </Text>
        ) : null}
        <Text style={styles.metaLine}>
          {formatTransactionTimestamp(transaction.occurredAt)} · {CHANNEL_LABEL[transaction.paymentMethod]}
          {account && !isTransfer ? ` · ${accountDisplayLabel(account)}` : ''}
        </Text>
      </View>

      <Card style={styles.fieldsCard}>
        <Text style={styles.cardTitle}>Transaction Details</Text>
        <DetailRow
          label="Type"
          value={
            isTransfer
              ? 'Transfer'
              : isRefund
              ? 'Refund'
              : transaction.type === 'income'
              ? 'Credit Income'
              : 'Debit Expense'
          }
        />
        {isTransfer ? null : onChangeCategory && !twin && !hiddenDuplicate ? (
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
        {isTransfer ? (
          <>
            <DetailRow label="From" value={accountDisplayLabel(account)} />
            <DetailRow label="To" value={accountDisplayLabel(toAccount)} />
          </>
        ) : (
          <DetailRow label="Account" value={accountDisplayLabel(account)} />
        )}
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
  hiddenLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: 16,
    backgroundColor: colors.secondaryContainer,
  },
  hiddenLinkText: {
    ...typography.labelLg,
    color: colors.onSurface,
    flex: 1,
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
