import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Chip, showSnackbar } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, spacing, typography } from '../../../theme';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import type { Transaction } from '../../../domain/transactions/transaction.types';
import type { MeaningSuggestion } from '../../../domain/meaning/meaning.types';
import { useRedacted } from '../../../shared/privacy/redaction';
import type { RootStackParamList } from '../../../app/navigation/routes';
import { TransferAccountPickerSheet } from '../../transfers/components/TransferAccountPickerSheet';
import {
  AUTOMATIC_NEXT_TIME,
  confirmedSnackbarText,
  meaningCardModel,
  REFUND_LINKED_NOTE,
} from '../meaningLabels';
import { refundsFor } from '../../../domain/refunds/refund.rules';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * R5e T3 — the money-meaning card on a Pending item (and in Review's "Money
 * meaning" section): a chip ("Card bill payment" …), ONE primary action —
 * "Confirm transfer to <account>" (unique target), "Choose account" (the
 * account picker filtered to the right types) or "Add <…> account" (Add
 * Account prefilled; the target re-resolves live on return) — the secondary
 * "It's an expense", and "Do this automatically next time" (default ON).
 * Every target is ≥ 48 dp; account labels mask their last-4 when redacted.
 */
export function MeaningCard({
  suggestion,
  transaction,
}: {
  suggestion: MeaningSuggestion;
  transaction: Transaction;
}) {
  const navigation = useNavigation<Nav>();
  const accounts = useTransactionsStore(state => state.accounts);
  const rules = useTransactionsStore(state => state.meaningRules);
  // R5e-FIX M5 (R3b.1): an expense with linked refunds can only stay an expense.
  const refundLinked = useTransactionsStore(
    state => refundsFor(state.transactions, transaction.id).length > 0,
  );
  const redacted = useRedacted();
  const [remember, setRemember] = useState(true);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const model = useMemo(
    () => meaningCardModel(suggestion, transaction, accounts, rules),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [suggestion, transaction, accounts, rules, redacted],
  );

  async function confirm(targetAccountId: string) {
    setBusy(true);
    try {
      const store = useTransactionsStore.getState();
      const ok = await store.confirmMeaning(transaction.id, targetAccountId, {
        remember,
      });
      if (!ok) {
        showSnackbar({ message: 'This item changed — not recorded' });
        return;
      }
      const after = useTransactionsStore
        .getState()
        .transactions.find(t => t.id === transaction.id);
      // With the counterpart SMS the expense is the transfer and this row its twin.
      const transferId =
        after?.type === 'transfer'
          ? after.id
          : after?.linkedTransactionId ?? transaction.id;
      const target = useTransactionsStore
        .getState()
        .accounts.find(a => a.id === targetAccountId);
      showSnackbar({
        message: confirmedSnackbarText(target, remember, model.side),
        actionLabel: 'Undo',
        onAction: async () => {
          await useTransactionsStore.getState().undoMeaning(transferId);
        },
      });
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    setBusy(true);
    try {
      const ok = await useTransactionsStore
        .getState()
        .dismissMeaning(transaction.id);
      if (ok)
        showSnackbar({
          message:
            model.side === 'out' ? 'Kept as an expense' : 'Kept as income',
        });
    } finally {
      setBusy(false);
    }
  }

  function onPrimary() {
    const action = model.action;
    if (action.kind === 'confirm') confirm(action.target.id);
    else if (action.kind === 'choose') setPicking(true);
    else navigation.navigate('AddAccount', { prefill: action.prefill });
  }

  return (
    <View style={styles.card} testID="meaning-card">
      <View style={styles.chipRow}>
        <Chip
          label={model.chip}
          tone="active"
          icon={
            <Icon name="swap-horizontal" size={14} color={colors.secondary} />
          }
        />
      </View>
      <Text style={styles.explainer}>{model.explainer}</Text>
      {refundLinked ? (
        <Text style={styles.explainer} testID="meaning-refund-note">
          {REFUND_LINKED_NOTE}
        </Text>
      ) : (
        <Button
          label={model.primaryLabel}
          accessibilityLabel={model.primaryA11y}
          variant="brand"
          onPress={onPrimary}
          disabled={busy}
          testID="meaning-primary"
          style={styles.button}
        />
      )}
      <Button
        label={model.secondaryLabel}
        variant="ghost"
        onPress={dismiss}
        disabled={busy}
        testID="meaning-dismiss"
        style={styles.button}
      />
      {refundLinked ? null : (
        <Pressable
          onPress={() => setRemember(on => !on)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: remember }}
          accessibilityLabel={AUTOMATIC_NEXT_TIME}
          testID="meaning-remember"
          style={styles.checkRow}
        >
          <Icon
            name={remember ? 'checkbox-marked' : 'checkbox-blank-outline'}
            size={22}
            color={colors.primary}
          />
          <Text style={styles.checkLabel}>{AUTOMATIC_NEXT_TIME}</Text>
        </Pressable>
      )}
      {/* Mounted only while choosing: many Pending cards never pay for a sheet. */}
      {picking ? (
        <TransferAccountPickerSheet
          visible={picking}
          onClose={() => setPicking(false)}
          excludeAccountId={transaction.accountId}
          direction={model.side === 'out' ? 'to' : 'from'}
          allowedTypes={model.pickerTypes}
          body="It becomes a transfer: both balances move, never income or expense."
          onSelect={accountId => {
            setPicking(false);
            confirm(accountId);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.secondaryContainer,
  },
  chipRow: {
    flexDirection: 'row',
  },
  explainer: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  button: {
    minHeight: 48,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
  },
  checkLabel: {
    ...typography.bodyMd,
    color: colors.onSurface,
    flex: 1,
  },
});
