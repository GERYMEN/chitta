import React, { useMemo, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CompositeNavigationProp,
  useNavigation,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Button, Card, Chip, showDialog } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { radii, spacing, typography, useColors, ColorTokens } from '../../../theme';
import {
  selectActiveAccounts,
  selectDeletedAccounts,
  useTransactionsStore,
} from '../../transactions/state/transactionsStore';
import {
  accountDisplayLabel,
  calculateBalance,
  isLiabilityAccount,
} from '../../../domain/accounts/account.rules';
import { formatRupeesFromMinor } from '../../../shared/utils/currency';
import { touchesAccount } from '../../../domain/transfers/transfer.rules';
import { removeAccountMessage } from '../components/removeAccountMessage';
import { Account, AccountType } from '../../../domain/accounts/account.types';
import {
  MainTabParamList,
  ReconcilePrefill,
  RootStackParamList,
} from '../../../app/navigation/routes';
import { redactLast4, useRedacted } from '../../../shared/privacy/redaction';
import { TourTarget } from '../../tour/components/TourTarget';
import { useLinkedNumbersStore } from '../state/linkedNumbersStore';
import { LinkedNumber, linkedNumbersFor } from '../../sms-sync/suggestionGroups';
import { checkBalanceContacts } from '../../sms-sync/rules/checkBalance';
import { useBillsStore } from '../../bills/state/billsStore';
import { Bill } from '../../../domain/bills/bill.types';
import { creditUsage, remainingMinor, billUrgency } from '../../../domain/bills/bill.rules';
import { useNow } from '../../../shared/hooks/useNow';
import { BalanceReconcile } from '../components/BalanceReconcile';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Accounts'>,
  NativeStackNavigationProp<RootStackParamList>
>;

const ACCOUNT_ICON: Record<AccountType, string> = {
  bank: 'bank-outline',
  cash: 'cash',
  credit_card: 'credit-card-outline',
  pay_later: 'credit-card-clock-outline',
  upi: 'qrcode',
  other: 'wallet-outline',
};

const GROUP_LABEL: Record<AccountType, string> = {
  bank: 'BANK ACCOUNTS',
  cash: 'CASH',
  credit_card: 'CREDIT CARDS & PAY LATER',
  pay_later: 'CREDIT CARDS & PAY LATER',
  upi: 'UPI SOURCES',
  other: 'OTHER',
};

// R5b D-a: credit cards and pay-later lines share one group.
function groupKeyOf(type: AccountType): AccountType {
  return type === 'pay_later' ? 'credit_card' : type;
}

export function AccountsScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<Nav>();
  useRedacted(); // R4c: balances + last-4 masked in the feedback screenshot
  const transactions = useTransactionsStore(state => state.transactions);
  // D10: totals and main groups use ACTIVE accounts only; soft-deleted ones
  // are listed separately with Restore. Their transactions are untouched.
  const accounts = useTransactionsStore(useShallow(selectActiveAccounts));
  const removed = useTransactionsStore(useShallow(selectDeletedAccounts));
  const removeAccount = useTransactionsStore(state => state.removeAccount);
  const restoreAccount = useTransactionsStore(state => state.restoreAccount);
  const [deletedOpen, setDeletedOpen] = useState(false);
  // R5d T3c: 'linked' decisions (card / account numbers routed to an account).
  // Re-read whenever accounts or transactions change (a link / undo / import).
  const linkedRows = useLinkedNumbersStore(state => state.rows);
  const refreshLinked = useLinkedNumbersStore(state => state.refresh);
  // R5b: open bills per account (card / pay-later detail) + Bills entry count.
  const bills = useBillsStore(state => state.bills);
  const refreshBills = useBillsStore(state => state.refresh);
  const now = useNow(transactions.length);
  useEffect(() => {
    refreshLinked().catch(() => undefined);
    refreshBills().catch(() => undefined);
  }, [refreshLinked, refreshBills, accounts.length, transactions.length]);

  function confirmUnlink(account: Account, number: LinkedNumber) {
    showDialog({
      title: `Unlink ${number.label}?`,
      message: `Items already added stay on ${account.name}. New SMS for this number will show in "New accounts found" again.`,
      icon: 'link-variant-off',
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        {
          label: 'Unlink',
          variant: 'destructive',
          onPress: async () => {
            await useLinkedNumbersStore.getState().unlink(account.id, number);
          },
        },
      ],
    });
  }

  function transactionCountFor(accountId: string): number {
    // R3a: a transfer belongs to both of its accounts.
    return transactions.filter(t => touchesAccount(t, accountId)).length;
  }

  function confirmRemove(account: Account) {
    const count = transactionCountFor(account.id);
    const name = `${account.name}${account.lastFour ? ` ••${account.lastFour}` : ''}`;
    showDialog({
      title: 'Remove account?',
      message: removeAccountMessage(name, count),
      icon: 'bank-remove',
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        {
          label: 'Remove',
          variant: 'destructive',
          onPress: async () => {
            await removeAccount(account.id);
          },
        },
      ],
    });
  }

  async function handleRestore(account: Account) {
    await restoreAccount(account.id);
    ToastAndroid.show(
      `${account.name} restored. Tap Sync SMS to import messages from while it was removed.`,
      ToastAndroid.LONG,
    );
  }

  const totalTracked = accounts
    .filter(a => !isLiabilityAccount(a.type))
    .reduce((sum, a) => sum + calculateBalance(a, transactions, a.id), 0);

  const groups = Array.from(new Set(accounts.map(a => groupKeyOf(a.type)))).map(type => ({
    type,
    accounts: accounts.filter(a => groupKeyOf(a.type) === type),
  }));

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Accounts</Text>
        <Text style={styles.subtitle}>Your money sources</Text>

        {/* R4c: tour step 5 spotlights the balance card. */}
        <TourTarget targetKey="accounts.balance">
        <Card tone="obsidian" style={styles.balanceCard}>
          <View style={styles.balanceTopRow}>
            <Text style={styles.balanceLabel}>TOTAL BALANCE</Text>
            <Chip
              label="Tracked & Reconciled"
              tone="active"
              icon={
                <Icon
                  name="shield-check-outline"
                  size={14}
                  color={c.primaryContainer}
                />
              }
            />
          </View>
          <Text style={styles.balanceAmount}>
            {formatRupeesFromMinor(totalTracked, { showPaise: true })}
          </Text>
          <Text style={styles.balanceCaption}>
            Across {accounts.length} tracked money sources
          </Text>
          <Button
            label="Add Account"
            variant="brand"
            onPress={() => navigation.navigate('AddAccount')}
          />
        </Card>
        </TourTarget>

        <View style={styles.flowBanner}>
          <Text style={styles.flowText}>
            Source → Approved Entry → Calculated Balance
          </Text>
        </View>

        <Pressable
          onPress={() => navigation.navigate('Bills')}
          style={styles.billsEntry}
          accessibilityRole="button"
          accessibilityLabel="Bills and dues"
          testID="accounts-bills-entry">
          <Icon name="file-document-outline" size={20} color={c.primary} />
          <Text style={styles.billsEntryLabel}>Bills & dues</Text>
          <Text style={styles.billsEntryCount}>
            {bills.filter(b => b.status === 'open').length} open
          </Text>
          <Icon name="chevron-right" size={22} color={c.outline} />
        </Pressable>

        <View style={styles.privacyBanner}>
          <Icon name="shield-lock-outline" size={20} color={c.primary} />
          <View style={styles.privacyTextWrap}>
            <View style={styles.privacyHeaderRow}>
              <Text style={styles.privacyTitle}>Zero Bank Login Required</Text>
              <Chip label="100% On-Device" tone="neutral" />
            </View>
            <Text style={styles.privacyBody}>
              Balances adjust strictly through transactions you review and
              approve. We never ask for bank credentials, MPINs, or account
              control.
            </Text>
          </View>
        </View>

        {groups.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>
              No accounts yet — add one to start tracking
            </Text>
          </View>
        ) : (
          groups.map(group => (
            <View key={group.type} style={styles.group}>
              <View style={styles.groupHeader}>
                <Text style={styles.groupTitle}>{GROUP_LABEL[group.type]}</Text>
                <Text style={styles.groupCount}>
                  {group.accounts.length} source
                  {group.accounts.length > 1 ? 's' : ''}
                </Text>
              </View>

              {group.accounts.map(account => (
                <AccountCard
                  key={account.id}
                  account={account}
                  transactions={transactions}
                  linked={linkedNumbersFor(linkedRows, account.id)}
                  openBill={bills.find(b => b.accountId === account.id && b.status === 'open') ?? null}
                  now={now}
                  onOpenBills={() => navigation.navigate('Bills')}
                  onUnlink={number => confirmUnlink(account, number)}
                  onRemove={() => confirmRemove(account)}
                  onAddMissing={reconcile => navigation.navigate('AddRecord', { reconcile })}
                />
              ))}
            </View>
          ))
        )}

        <Button
          label="Add New Money Source"
          variant="primary"
          onPress={() => navigation.navigate('AddAccount')}
          icon={<Icon name="plus" size={18} color={c.onObsidian} />}
        />

        {removed.length > 0 ? (
          <View style={styles.group}>
            <Pressable
              onPress={() => setDeletedOpen(open => !open)}
              style={styles.deletedHeader}
              accessibilityRole="button"
              accessibilityState={{ expanded: deletedOpen }}>
              <Text style={styles.groupTitle}>Deleted accounts ({removed.length})</Text>
              <Icon
                name={deletedOpen ? 'chevron-up' : 'chevron-down'}
                size={22}
                color={c.outline}
              />
            </Pressable>
            {deletedOpen
              ? removed.map(account => (
                  <Card key={account.id} style={styles.deletedCard}>
                    <View style={styles.deletedMeta}>
                      <Text style={styles.accountName}>{accountDisplayLabel(account)}</Text>
                      <Text style={styles.accountSubtitle}>
                        {transactionCountFor(account.id)} transactions kept · not in balance
                      </Text>
                    </View>
                    <Button
                      label="Restore"
                      variant="ghost"
                      onPress={() => handleRestore(account)}
                    />
                  </Card>
                ))
              : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function AccountCard({
  account,
  transactions,
  linked,
  openBill,
  now,
  onOpenBills,
  onUnlink,
  onRemove,
  onAddMissing,
}: {
  account: Account;
  transactions: Parameters<typeof calculateBalance>[1];
  /** R5d T3c: numbers linked to this account (bank · kind · ••last4). */
  linked: LinkedNumber[];
  /** R5b D-h: this account's open bill (card / pay-later detail). */
  openBill: Bill | null;
  now: Date;
  onOpenBills: () => void;
  onUnlink: (number: LinkedNumber) => void;
  onRemove: () => void;
  onAddMissing: (prefill: ReconcilePrefill) => void;
}) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const balanceMinor = calculateBalance(account, transactions, account.id);
  const liability = isLiabilityAccount(account.type);
  // R5b D-b: used / available credit for credit_card / pay_later accounts.
  const usage = liability ? creditUsage(account.creditLimitMinor, balanceMinor) : null;

  return (
    <Card style={styles.accountCard}>
      <View style={styles.accountTopRow}>
        <View style={styles.accountIcon}>
          <Icon
            name={ACCOUNT_ICON[account.type]}
            size={22}
            color={c.primary}
          />
        </View>
        <View style={styles.accountMeta}>
          <Text style={styles.accountName}>{account.name}</Text>
          <Text style={styles.accountSubtitle}>
            {account.lastFour ? `•••• ${redactLast4(account.lastFour)}` : 'Physical wallet'}
          </Text>
        </View>
      </View>

      <Text style={styles.balanceRowLabel}>
        {liability
          ? 'Current Outstanding Liability'
          : 'Approved Ledger Balance'}
      </Text>
      <Text
        style={[styles.balanceRowValue, liability && styles.liabilityValue]}
      >
        {formatRupeesFromMinor(Math.abs(balanceMinor), { showPaise: true })}
      </Text>

      {/* R6: the bank-SMS balance, the difference and how to act on it. */}
      <BalanceReconcile
        account={account}
        transactions={transactions}
        now={now}
        onAddMissing={onAddMissing}
      />

      {usage ? (
        <View style={styles.creditRow} testID={`credit-usage-${account.id}`}>
          <Text style={styles.balanceRowLabel}>
            {`Used ${formatRupeesFromMinor(usage.usedMinor)} · Available ${formatRupeesFromMinor(
              usage.availableMinor,
            )} of ${formatRupeesFromMinor(usage.limitMinor)}`}
          </Text>
        </View>
      ) : null}

      {liability && openBill ? (
        <Pressable
          onPress={onOpenBills}
          style={styles.openBillRow}
          accessibilityRole="button"
          accessibilityLabel="View bill"
          testID={`account-bill-${account.id}`}>
          <Icon
            name="file-document-outline"
            size={16}
            color={billUrgency(openBill, now) === 'overdue' ? c.error : c.outline}
          />
          <Text
            style={[
              styles.openBillLabel,
              billUrgency(openBill, now) === 'overdue' && styles.liabilityValue,
            ]}>
            {`Bill due ${formatRupeesFromMinor(remainingMinor(openBill))}`}
            {openBill.dueDate ? ` · ${new Date(openBill.dueDate).toLocaleDateString('en-IN')}` : ''}
          </Text>
        </Pressable>
      ) : null}

      {linked.length > 0 ? (
        <View style={styles.linkedSection} testID={`linked-numbers-${account.id}`}>
          <Text style={styles.balanceRowLabel}>Linked card / account numbers</Text>
          {linked.map(number => (
            <View key={number.key} style={styles.linkedRow}>
              <Icon name="link-variant" size={16} color={c.outline} />
              <Text style={styles.linkedLabel}>{number.label}</Text>
              <Pressable
                onPress={() => onUnlink(number)}
                style={styles.unlinkAction}
                accessibilityRole="button"
                accessibilityLabel={`Unlink ${number.label}`}>
                <Text style={styles.unlinkLabel}>Unlink</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {/* R5g item 22: verified balance-enquiry numbers only (tel: link, no SMS). */}
      {checkBalanceContacts(account).slice(0, 1).map(contact => (
        <Pressable
          key={contact.telUrl}
          onPress={() => Linking.openURL(contact.telUrl).catch(() => undefined)}
          style={styles.unlinkAction}
          accessibilityRole="button"
          accessibilityLabel={`Check balance for ${account.name}`}
          testID={`check-balance-${account.id}`}>
          <Text style={styles.unlinkLabel}>
            {contact.type === 'missed_call' ? 'Check balance (missed call)' : 'Check balance'}
          </Text>
        </Pressable>
      ))}

      <Pressable
        onPress={onRemove}
        style={styles.removeAction}
        accessibilityRole="button"
        accessibilityLabel={`Remove account ${account.name}`}>
        <Icon name="trash-can-outline" size={18} color={c.error} />
        <Text style={styles.removeLabel}>Remove account</Text>
      </Pressable>
    </Card>
  );
}

const makeStyles = (c: ColorTokens) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: c.surface,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: spacing.screen,
    gap: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  title: {
    ...typography.headlineLgMobile,
    color: c.onSurface,
  },
  subtitle: {
    ...typography.bodyMd,
    color: c.outline,
  },
  balanceCard: {
    gap: spacing.sm,
  },
  balanceTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  balanceLabel: {
    ...typography.labelMd,
    color: c.inverseOnSurface,
    letterSpacing: 0.5,
  },
  balanceAmount: {
    ...typography.displayHeroMobile,
    color: c.onObsidian,
  },
  balanceCaption: {
    ...typography.bodyMd,
    color: c.inverseOnSurface,
    marginBottom: spacing.sm,
  },
  flowBanner: {
    alignItems: 'center',
  },
  flowText: {
    ...typography.labelMd,
    color: c.outline,
  },
  privacyBanner: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: c.surfaceContainerLow,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  privacyTextWrap: {
    flex: 1,
    gap: spacing.xs,
  },
  privacyHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  privacyTitle: {
    ...typography.headlineSm,
    fontSize: 15,
    color: c.onSurface,
  },
  privacyBody: {
    ...typography.bodyMd,
    color: c.onSurfaceVariant,
  },
  group: {
    gap: spacing.sm,
  },
  emptyState: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    ...typography.bodyMd,
    color: c.outline,
    textAlign: 'center',
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  groupTitle: {
    ...typography.labelLg,
    color: c.outline,
    letterSpacing: 0.5,
  },
  groupCount: {
    ...typography.bodyMd,
    color: c.outline,
  },
  accountCard: {
    gap: spacing.xs,
  },
  accountTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  accountIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountMeta: {
    flex: 1,
  },
  accountName: {
    ...typography.headlineSm,
    fontSize: 16,
    color: c.onSurface,
  },
  accountSubtitle: {
    ...typography.bodyMd,
    color: c.outline,
  },
  balanceRowLabel: {
    ...typography.labelMd,
    color: c.outline,
  },
  balanceRowValue: {
    ...typography.headlineMd,
    color: c.onSurface,
  },
  removeAction: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    minHeight: 48,
    paddingRight: spacing.sm,
  },
  removeLabel: {
    ...typography.labelLg,
    color: c.error,
  },
  linkedSection: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  linkedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  linkedLabel: {
    ...typography.bodyMd,
    color: c.onSurface,
    flex: 1,
  },
  unlinkAction: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  unlinkLabel: {
    ...typography.labelLg,
    color: c.primary,
  },
  deletedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 48,
  },
  deletedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  deletedMeta: {
    flex: 1,
  },
  liabilityValue: {
    color: c.failedFg,
  },
  billsEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: c.surfaceContainerLow,
    borderRadius: radii.md,
    padding: spacing.md,
    minHeight: 48,
  },
  billsEntryLabel: {
    ...typography.labelLg,
    color: c.onSurface,
    flex: 1,
  },
  billsEntryCount: {
    ...typography.bodyMd,
    color: c.outline,
  },
  creditRow: {
    marginTop: spacing.xs,
  },
  openBillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 48,
  },
  openBillLabel: {
    ...typography.bodyMd,
    color: c.onSurface,
  },
});
