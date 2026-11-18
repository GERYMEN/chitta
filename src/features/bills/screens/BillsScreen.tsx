import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, BottomSheet, showDialog, showSnackbar } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { HeaderBackButton, HeaderSpacer } from '../../../shared/ui/HeaderBackButton';
import { colors, radii, spacing, typography } from '../../../theme';
import { RootStackParamList } from '../../../app/navigation/routes';
import { useBillsStore, BillPaidPrior } from '../state/billsStore';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { Bill } from '../../../domain/bills/bill.types';
import { billSections, remainingMinor } from '../../../domain/bills/bill.rules';
import { accountDisplayLabel } from '../../../domain/accounts/account.rules';
import { formatRupeesFromMinor } from '../../../shared/utils/currency';
import { BILL_KIND_LABEL, dueLabel } from '../billLabels';
import { useNow } from '../../../shared/hooks/useNow';
import { Transaction } from '../../../domain/transactions/transaction.types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function BillsScreen() {
  const navigation = useNavigation<Nav>();
  const bills = useBillsStore(state => state.bills);
  const refresh = useBillsStore(state => state.refresh);
  const markPaid = useBillsStore(state => state.markPaid);
  const undoMarkPaid = useBillsStore(state => state.undoMarkPaid);
  const dismiss = useBillsStore(state => state.dismiss);
  const undoDismiss = useBillsStore(state => state.undoDismiss);
  const accounts = useTransactionsStore(state => state.accounts);
  const transactions = useTransactionsStore(state => state.transactions);
  const now = useNow(bills.length);
  const [linkFor, setLinkFor] = useState<Bill | null>(null);

  useFocusEffect(
    useCallback(() => {
      refresh().catch(() => undefined);
    }, [refresh]),
  );
  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const sections = useMemo(() => billSections(bills, now), [bills, now]);

  const accountLabel = (accountId: string | null): string | null =>
    accountId ? accountDisplayLabel(accounts.find(a => a.id === accountId)) : null;

  async function onMarkPaid(bill: Bill) {
    const prior: BillPaidPrior = await markPaid(bill, {
      addMinor: remainingMinor(bill),
      transactionId: null,
      force: true,
    });
    showSnackbar({
      message: 'Marked as paid',
      actionLabel: 'Undo',
      onAction: () => undoMarkPaid(prior),
    });
  }

  async function onDismiss(bill: Bill) {
    await dismiss(bill);
    showSnackbar({
      message: 'Bill dismissed',
      actionLabel: 'Undo',
      onAction: () => undoDismiss(bill),
    });
  }

  function confirmMarkPaid(bill: Bill) {
    showDialog({
      title: 'Mark as paid?',
      message: `Mark "${bill.payee}" as paid. You can undo this.`,
      icon: 'file-document-check-outline',
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        { label: 'Mark paid', variant: 'primary', onPress: () => onMarkPaid(bill) },
      ],
    });
  }

  async function onLinkPayment(bill: Bill, txn: Transaction) {
    setLinkFor(null);
    const prior = await markPaid(bill, {
      addMinor: txn.amountMinor,
      transactionId: txn.id,
      force: false,
    });
    showSnackbar({
      message: 'Payment linked',
      actionLabel: 'Undo',
      onAction: () => undoMarkPaid(prior),
    });
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <HeaderBackButton onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle}>Bills & dues</Text>
        <HeaderSpacer />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Button
          label="Add bill"
          variant="brand"
          onPress={() => navigation.navigate('AddBill')}
          icon={<Icon name="plus" size={18} color={colors.onObsidian} />}
          style={styles.addButton}
        />

        {bills.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No bills yet. Card statements and biller SMS add bills automatically, or add one above.</Text>
          </View>
        ) : null}

        <Section title="Overdue" bills={sections.overdue} tone="overdue" {...{ accountLabel, navigation, onMarkPaid: confirmMarkPaid, onDismiss, onLink: setLinkFor }} />
        <Section title="Due soon" bills={sections.dueSoon} {...{ accountLabel, navigation, onMarkPaid: confirmMarkPaid, onDismiss, onLink: setLinkFor }} />
        <Section title="Later" bills={sections.later} {...{ accountLabel, navigation, onMarkPaid: confirmMarkPaid, onDismiss, onLink: setLinkFor }} />
        <Section title="Paid & dismissed" bills={sections.paidDismissed} muted {...{ accountLabel, navigation, onMarkPaid: confirmMarkPaid, onDismiss, onLink: setLinkFor }} />
      </ScrollView>

      <LinkPaymentSheet
        bill={linkFor}
        transactions={transactions}
        onClose={() => setLinkFor(null)}
        onPick={onLinkPayment}
      />
    </SafeAreaView>
  );
}

function Section({
  title,
  bills,
  tone,
  muted,
  accountLabel,
  navigation,
  onMarkPaid,
  onDismiss,
  onLink,
}: {
  title: string;
  bills: Bill[];
  tone?: 'overdue';
  muted?: boolean;
  accountLabel: (id: string | null) => string | null;
  navigation: Nav;
  onMarkPaid: (bill: Bill) => void;
  onDismiss: (bill: Bill) => void;
  onLink: (bill: Bill) => void;
}) {
  if (bills.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, tone === 'overdue' && styles.overdueText]}>
        {title} ({bills.length})
      </Text>
      {bills.map(bill => {
        const account = accountLabel(bill.accountId);
        const done = bill.status !== 'open';
        return (
          <Card key={bill.id} style={styles.billCard}>
            <View style={styles.billTopRow}>
              <Text style={[styles.payee, muted && styles.mutedText]} numberOfLines={1}>
                {bill.payee}
              </Text>
              <Text style={[styles.amount, tone === 'overdue' && styles.overdueText]}>
                {formatRupeesFromMinor(remainingMinor(bill))}
              </Text>
            </View>
            <Text style={styles.meta}>
              {BILL_KIND_LABEL[bill.kind]}
              {account ? ` · ${account}` : ''}
            </Text>
            <Text style={[styles.meta, tone === 'overdue' && styles.overdueText]}>
              {dueLabel(bill.dueDate)}
              {bill.minDueMinor != null ? ` · Min ${formatRupeesFromMinor(bill.minDueMinor)}` : ''}
              {bill.paidMinor > 0 ? ` · Paid ${formatRupeesFromMinor(bill.paidMinor)}` : ''}
              {bill.status === 'paid' ? ' · Paid' : bill.status === 'dismissed' ? ' · Dismissed' : ''}
            </Text>
            {!done ? (
              <View style={styles.actionsRow}>
                <BillAction label="Mark paid" icon="check" onPress={() => onMarkPaid(bill)} />
                <BillAction label="Link payment" icon="link-variant" onPress={() => onLink(bill)} />
                {bill.source === 'manual' ? (
                  <BillAction
                    label="Edit"
                    icon="pencil-outline"
                    onPress={() => navigation.navigate('EditBill', { billId: bill.id })}
                  />
                ) : null}
                <BillAction label="Dismiss" icon="close" onPress={() => onDismiss(bill)} />
              </View>
            ) : null}
          </Card>
        );
      })}
    </View>
  );
}

function BillAction({ label, icon, onPress }: { label: string; icon: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.action}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <Icon name={icon} size={16} color={colors.primary} />
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

function LinkPaymentSheet({
  bill,
  transactions,
  onClose,
  onPick,
}: {
  bill: Bill | null;
  transactions: Transaction[];
  onClose: () => void;
  onPick: (bill: Bill, txn: Transaction) => void;
}) {
  const candidates = useMemo(() => {
    if (!bill) return [];
    return transactions
      .filter(t => {
        if (t.status !== 'approved') return false;
        if (bill.kind === 'card_statement' || bill.kind === 'pay_later') {
          return t.type === 'transfer' && t.transferAccountId === bill.accountId;
        }
        return t.type === 'expense';
      })
      .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
      .slice(0, 30);
  }, [bill, transactions]);

  return (
    <BottomSheet visible={bill != null} onClose={onClose}>
      <Text style={styles.sheetTitle}>Link a payment</Text>
      {candidates.length === 0 ? (
        <Text style={styles.meta}>No matching approved transactions.</Text>
      ) : (
        <ScrollView style={styles.sheetList}>
          {candidates.map(t => (
            <Pressable
              key={t.id}
              onPress={() => bill && onPick(bill, t)}
              style={styles.sheetRow}
              accessibilityRole="button"
              accessibilityLabel={`Link ${t.merchantName}`}>
              <Text style={styles.sheetRowLabel} numberOfLines={1}>
                {t.merchantName}
              </Text>
              <Text style={styles.sheetRowAmount}>{formatRupeesFromMinor(t.amountMinor)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  headerTitle: { ...typography.headlineSm, color: colors.onSurface, flex: 1, textAlign: 'center' },
  content: { padding: spacing.screen, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  addButton: {},
  empty: { padding: spacing.xl, alignItems: 'center' },
  emptyText: { ...typography.bodyMd, color: colors.outline, textAlign: 'center' },
  section: { gap: spacing.sm },
  sectionTitle: { ...typography.labelLg, color: colors.outline, letterSpacing: 0.5 },
  overdueText: { color: '#DC2626' },
  billCard: { gap: spacing.xs },
  billTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  payee: { ...typography.headlineSm, fontSize: 16, color: colors.onSurface, flex: 1 },
  amount: { ...typography.headlineSm, fontSize: 16, color: colors.onSurface },
  meta: { ...typography.bodyMd, color: colors.outline },
  mutedText: { color: colors.outline },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 48,
    paddingRight: spacing.sm,
  },
  actionLabel: { ...typography.labelLg, color: colors.primary },
  sheetTitle: { ...typography.headlineSm, color: colors.onSurface, marginBottom: spacing.sm },
  sheetList: { maxHeight: 320 },
  sheetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 48,
    borderRadius: radii.sm,
  },
  sheetRowLabel: { ...typography.bodyLg, color: colors.onSurface, flex: 1 },
  sheetRowAmount: { ...typography.bodyLg, color: colors.onSurface },
});
