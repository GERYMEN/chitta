import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AmountText, Chip } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, radii, spacing, typography } from '../../../theme';
import { Transaction } from '../../../domain/transactions/transaction.types';
import { Account } from '../../../domain/accounts/account.types';
import { accountDisplayLabel } from '../../../domain/accounts/account.rules';
import { formatTransactionTimestamp } from '../../../shared/utils/date';
import { parseSmsReference } from '../../sms-sync/smsReference';
import { OriginalSmsView } from '../../transactions/components/OriginalSmsView';

/**
 * R3b.1 F2 — one Uncategorised quick-assign row. Users cannot tell an item
 * from its merchant name alone, so the row shows merchant, amount, date and
 * account, and for SMS rows the stored sanitizedPreview as the "SMS
 * description" (2 lines, tap to expand) plus "View original SMS" — a live,
 * on-demand read held only in OriginalSmsView's state (never stored/logged).
 * Manual rows have no SMS section. Tapping the row body opens the detail; the
 * category chip keeps the R2 picker + "Always use…?" flow.
 */
export function UncategorisedRow({
  transaction,
  account,
  onOpen,
  onChooseCategory,
}: {
  transaction: Transaction;
  account: Pick<Account, 'name' | 'lastFour' | 'deletedAt'> | null;
  onOpen: (transaction: Transaction) => void;
  onChooseCategory: (transaction: Transaction) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isSms = transaction.sourceType === 'sms';
  const preview = isSms ? transaction.sanitizedPreview : null;
  const reference = isSms ? parseSmsReference(transaction.sourceReferenceHash) : null;

  return (
    <View style={styles.card} testID="quick-assign-row">
      <View style={styles.topRow}>
        <Pressable
          onPress={() => onOpen(transaction)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${transaction.merchantName}`}
          testID="quick-assign-open"
          style={({ pressed }) => [styles.body, pressed && styles.pressed]}>
          <View style={styles.titleRow}>
            <Text style={styles.merchant} numberOfLines={1}>
              {transaction.merchantName}
            </Text>
            <AmountText
              amountMinor={transaction.amountMinor}
              type={transaction.type}
              showPaise
              variant="labelLg"
            />
          </View>
          <Text style={styles.meta} numberOfLines={1}>
            {formatTransactionTimestamp(transaction.occurredAt)} · {accountDisplayLabel(account)}
            {transaction.status === 'pending' ? ' · Pending' : ''}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => onChooseCategory(transaction)}
          hitSlop={{ top: 6, bottom: 6 }}
          accessibilityRole="button"
          accessibilityLabel={`Choose category for ${transaction.merchantName}`}
          testID="quick-assign-category">
          <Chip
            label="Uncategorised"
            tone="pending"
            icon={<Icon name="chevron-down" size={14} color={colors.onSurfaceVariant} />}
          />
        </Pressable>
      </View>

      {isSms && (preview || reference) ? (
        <View style={styles.smsSection} testID="quick-assign-sms">
          {preview ? (
            <Pressable
              onPress={() => setExpanded(value => !value)}
              accessibilityRole="button"
              accessibilityLabel={expanded ? 'Collapse SMS description' : 'Expand SMS description'}
              accessibilityState={{ expanded }}
              testID="quick-assign-preview">
              <Text style={styles.smsLabel}>SMS description</Text>
              <Text style={styles.smsText} numberOfLines={expanded ? undefined : 2}>
                {preview}
              </Text>
            </Pressable>
          ) : null}
          {reference ? <OriginalSmsView reference={reference} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outlineVariant,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  pressed: {
    opacity: 0.6,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  merchant: {
    ...typography.bodyLg,
    color: colors.onSurface,
    flexShrink: 1,
  },
  meta: {
    ...typography.labelMd,
    color: colors.outline,
  },
  smsSection: {
    gap: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.outlineVariant,
  },
  smsLabel: {
    ...typography.labelSm,
    color: colors.outline,
    letterSpacing: 0.5,
  },
  smsText: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
});
