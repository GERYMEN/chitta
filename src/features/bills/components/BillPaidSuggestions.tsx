import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Button, Card, showSnackbar } from '../../../shared/ui';
import { spacing, typography, useColors, ColorTokens } from '../../../theme';
import { useBillsStore } from '../state/billsStore';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { matchBillSuggestions } from '../../../domain/bills/billMatch.rules';
import { formatRupeesFromMinor } from '../../../shared/utils/currency';
import { accountDisplayLabel } from '../../../domain/accounts/account.rules';

/**
 * R5b (D-e): "Bill paid?" suggestions — a payment transaction that matches an
 * open bill. The user taps Confirm (links it and marks the bill paid) or Not
 * this (dismissed for this session). Never auto-marked.
 */
export function BillPaidSuggestions() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const bills = useBillsStore(state => state.bills);
  const refresh = useBillsStore(state => state.refresh);
  const markPaid = useBillsStore(state => state.markPaid);
  const undoMarkPaid = useBillsStore(state => state.undoMarkPaid);
  const transactions = useTransactionsStore(state => state.transactions);
  const accounts = useTransactionsStore(state => state.accounts);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());

  useFocusEffect(
    useCallback(() => {
      refresh().catch(() => undefined);
    }, [refresh]),
  );

  const matches = useMemo(
    () =>
      matchBillSuggestions(bills, transactions).filter(
        m => !dismissed.has(`${m.billId}:${m.transactionId}`),
      ),
    [bills, transactions, dismissed],
  );

  if (matches.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Bill paid?</Text>
      {matches.map(match => {
        const bill = bills.find(b => b.id === match.billId);
        const txn = transactions.find(t => t.id === match.transactionId);
        if (!bill || !txn) return null;
        const account = bill.accountId ? accountDisplayLabel(accounts.find(a => a.id === bill.accountId)) : null;
        return (
          <Card key={`${match.billId}:${match.transactionId}`} style={styles.card}>
            <Text style={styles.title}>{`Did this pay "${bill.payee}"?`}</Text>
            <Text style={styles.meta}>
              {`${txn.merchantName} · ${formatRupeesFromMinor(txn.amountMinor)}`}
              {account ? ` → ${account}` : ''}
            </Text>
            <View style={styles.actions}>
              <Button
                label="Confirm"
                variant="brand"
                onPress={async () => {
                  const prior = await markPaid(bill, {
                    addMinor: txn.amountMinor,
                    transactionId: txn.id,
                    force: false,
                  });
                  showSnackbar({
                    message: 'Bill marked paid',
                    actionLabel: 'Undo',
                    onAction: () => undoMarkPaid(prior),
                  });
                }}
                style={styles.actionBtn}
              />
              <Button
                label="Not this"
                variant="ghost"
                onPress={() =>
                  setDismissed(prev => new Set(prev).add(`${match.billId}:${match.transactionId}`))
                }
                style={styles.actionBtn}
              />
            </View>
          </Card>
        );
      })}
    </View>
  );
}

const makeStyles = (c: ColorTokens) => StyleSheet.create({
  section: { gap: spacing.sm, marginBottom: spacing.md },
  sectionTitle: { ...typography.labelLg, color: c.outline, letterSpacing: 0.5 },
  card: { gap: spacing.xs },
  title: { ...typography.headlineSm, fontSize: 15, color: c.onSurface },
  meta: { ...typography.bodyMd, color: c.outline },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  actionBtn: { flex: 1 },
});
