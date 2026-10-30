import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, ToastAndroid, View } from 'react-native';
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
import { colors, radii, spacing, typography } from '../../../theme';
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
  RootStackParamList,
} from '../../../app/navigation/routes';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Accounts'>,
  NativeStackNavigationProp<RootStackParamList>
>;

const ACCOUNT_ICON: Record<AccountType, string> = {
  bank: 'bank-outline',
  cash: 'cash',
  credit_card: 'credit-card-outline',
  upi: 'qrcode',
  other: 'wallet-outline',
};

const GROUP_LABEL: Record<AccountType, string> = {
  bank: 'BANK ACCOUNTS',
  cash: 'CASH',
  credit_card: 'CREDIT CARDS & PAY LATER',
  upi: 'UPI SOURCES',
  other: 'OTHER',
};

export function AccountsScreen() {
  const navigation = useNavigation<Nav>();
  const transactions = useTransactionsStore(state => state.transactions);
  // D10: totals and main groups use ACTIVE accounts only; soft-deleted ones
  // are listed separately with Restore. Their transactions are untouched.
  const accounts = useTransactionsStore(useShallow(selectActiveAccounts));
  const removed = useTransactionsStore(useShallow(selectDeletedAccounts));
  const removeAccount = useTransactionsStore(state => state.removeAccount);
  const restoreAccount = useTransactionsStore(state => state.restoreAccount);
  const [deletedOpen, setDeletedOpen] = useState(false);

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

  const groups = Array.from(new Set(accounts.map(a => a.type))).map(type => ({
    type,
    accounts: accounts.filter(a => a.type === type),
  }));

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Accounts</Text>
        <Text style={styles.subtitle}>Your money sources</Text>

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
                  color={colors.primaryContainer}
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

        <View style={styles.flowBanner}>
          <Text style={styles.flowText}>
            Source → Approved Entry → Calculated Balance
          </Text>
        </View>

        <View style={styles.privacyBanner}>
          <Icon name="shield-lock-outline" size={20} color={colors.primary} />
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
                  onRemove={() => confirmRemove(account)}
                />
              ))}
            </View>
          ))
        )}

        <Button
          label="Add New Money Source"
          variant="primary"
          onPress={() => navigation.navigate('AddAccount')}
          icon={<Icon name="plus" size={18} color={colors.onObsidian} />}
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
                color={colors.outline}
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
  onRemove,
}: {
  account: Account;
  transactions: Parameters<typeof calculateBalance>[1];
  onRemove: () => void;
}) {
  const balanceMinor = calculateBalance(account, transactions, account.id);
  const liability = isLiabilityAccount(account.type);

  return (
    <Card style={styles.accountCard}>
      <View style={styles.accountTopRow}>
        <View style={styles.accountIcon}>
          <Icon
            name={ACCOUNT_ICON[account.type]}
            size={22}
            color={colors.primary}
          />
        </View>
        <View style={styles.accountMeta}>
          <Text style={styles.accountName}>{account.name}</Text>
          <Text style={styles.accountSubtitle}>
            {account.lastFour ? `•••• ${account.lastFour}` : 'Physical wallet'}
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

      <Pressable
        onPress={onRemove}
        style={styles.removeAction}
        accessibilityRole="button"
        accessibilityLabel={`Remove account ${account.name}`}>
        <Icon name="trash-can-outline" size={18} color={colors.error} />
        <Text style={styles.removeLabel}>Remove account</Text>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface,
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
    color: colors.onSurface,
  },
  subtitle: {
    ...typography.bodyMd,
    color: colors.outline,
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
    color: colors.inverseOnSurface,
    letterSpacing: 0.5,
  },
  balanceAmount: {
    ...typography.displayHeroMobile,
    color: colors.onObsidian,
  },
  balanceCaption: {
    ...typography.bodyMd,
    color: colors.inverseOnSurface,
    marginBottom: spacing.sm,
  },
  flowBanner: {
    alignItems: 'center',
  },
  flowText: {
    ...typography.labelMd,
    color: colors.outline,
  },
  privacyBanner: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.surfaceContainerLow,
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
    color: colors.onSurface,
  },
  privacyBody: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
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
    color: colors.outline,
    textAlign: 'center',
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  groupTitle: {
    ...typography.labelLg,
    color: colors.outline,
    letterSpacing: 0.5,
  },
  groupCount: {
    ...typography.bodyMd,
    color: colors.outline,
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
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountMeta: {
    flex: 1,
  },
  accountName: {
    ...typography.headlineSm,
    fontSize: 16,
    color: colors.onSurface,
  },
  accountSubtitle: {
    ...typography.bodyMd,
    color: colors.outline,
  },
  balanceRowLabel: {
    ...typography.labelMd,
    color: colors.outline,
  },
  balanceRowValue: {
    ...typography.headlineMd,
    color: colors.onSurface,
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
    color: colors.error,
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
    color: '#DC2626',
  },
});
