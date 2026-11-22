import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../../shared/icons';
import { radii, spacing, typography, useColors, ColorTokens } from '../../../theme';
import { showDialog } from '../../../shared/ui';
import { formatRupeesFromMinor } from '../../../shared/utils/currency';
import { Account } from '../../../domain/accounts/account.types';
import {
  differenceDirection,
  formatAsOf,
  isDifferenceDismissed,
  prefillForDifference,
  reconcileBalance,
} from '../../../domain/accounts/accountReconcile';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { ReconcilePrefill } from '../../../app/navigation/routes';

/**
 * R6: the bank-SMS balance of an account, how far Tracker is from it, and the
 * three explicit ways to act. Nothing here changes a balance on its own — only
 * the "Use bank balance" confirm writes the (existing) user anchor; "Add
 * missing transaction" opens a PRE-FILLED Add Record that saves as PENDING;
 * "Dismiss" hides the difference for this snapshot only. Every amount goes
 * through formatRupeesFromMinor, so redaction masks it.
 */
export function BalanceReconcile({
  account,
  transactions,
  now,
  onAddMissing,
}: {
  account: Account;
  transactions: Parameters<typeof reconcileBalance>[1];
  now: Date;
  onAddMissing: (prefill: ReconcilePrefill) => void;
}) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const result = reconcileBalance(account, transactions, account.id);
  if (!result) return null;

  const { bankMinor, diffMinor, asOf } = result;
  const direction = differenceDirection(diffMinor);
  const showDifference = direction !== 'none' && !isDifferenceDismissed(account);
  const id = account.id;

  function confirmUseBankBalance() {
    showDialog({
      title: 'Use bank balance?',
      message: `${account.name} will show ${formatRupeesFromMinor(bankMinor, {
        showPaise: true,
      })} as of ${formatAsOf(asOf, now)}, and later transactions keep adding to it. Earlier ones stay in history but stop counting toward the balance. You can set it again any time.`,
      icon: 'bank-check',
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        {
          label: 'Use bank balance',
          variant: 'primary',
          onPress: async () => {
            await useTransactionsStore.getState().applyBankBalance(id);
          },
        },
      ],
    });
  }

  function addMissing() {
    const prefill = prefillForDifference(diffMinor);
    if (prefill) onAddMissing({ accountId: id, ...prefill });
  }

  return (
    <View style={styles.wrap} testID={`bank-sms-${id}`}>
      <View style={styles.row}>
        <Icon name="message-text-outline" size={16} color={c.outline} />
        <Text style={styles.line}>
          {`Bank SMS: ${formatRupeesFromMinor(bankMinor, { showPaise: true })} as of ${formatAsOf(
            asOf,
            now,
          )}`}
        </Text>
      </View>

      {showDifference ? (
        <View testID={`balance-difference-${id}`}>
          <Text style={styles.difference}>
            {`Difference ${formatRupeesFromMinor(Math.abs(diffMinor), { showPaise: true })} · Tracker shows ${
              direction === 'higher' ? 'more' : 'less'
            } than the bank`}
          </Text>
          <View style={styles.actions}>
            <ActionButton
              label="Use bank balance"
              onPress={confirmUseBankBalance}
              testID={`use-bank-balance-${id}`}
            />
            <ActionButton
              label="Add missing transaction"
              onPress={addMissing}
              testID={`add-missing-${id}`}
            />
            <ActionButton
              label="Dismiss"
              onPress={() => {
                useTransactionsStore.getState().dismissBalanceDifference(id).catch(() => undefined);
              }}
              testID={`dismiss-difference-${id}`}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <Pressable
      onPress={onPress}
      style={styles.action}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (c: ColorTokens) => StyleSheet.create({
  wrap: { gap: spacing.xs, marginTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  line: { ...typography.bodyMd, color: c.outline, flexShrink: 1 },
  difference: { ...typography.labelMd, color: c.error },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  action: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderRadius: radii.full,
    backgroundColor: c.surfaceContainer,
  },
  actionLabel: { ...typography.labelMd, color: c.onSurface },
});
