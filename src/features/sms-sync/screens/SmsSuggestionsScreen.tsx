import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useShallow } from 'zustand/react/shallow';
import { Icon } from '../../../shared/icons';
import { AmountText, BottomSheet, Button, Card, Chip, showDialog } from '../../../shared/ui';
import { colors, radii, spacing, typography } from '../../../theme';
import { Account, AccountType } from '../../../domain/accounts/account.types';
import { accountDisplayLabel } from '../../../domain/accounts/account.rules';
import { RootStackParamList } from '../../../app/navigation/routes';
import { formatRupeesFromMinor } from '../../../shared/utils/currency';
import { formatTransactionTimestamp } from '../../../shared/utils/date';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { OriginalSmsView } from '../../transactions/components/OriginalSmsView';
import { parseSmsReference } from '../smsReference';
import { ParsedSmsTransaction } from '../smsParser';
import {
  formatShortDateRange,
  linkableAccounts,
  proposedAccountBaseName,
  proposedAccountTitle,
  suggestionsSummaryLine,
  summarizeGroup,
  SuggestionGroup,
  waitingLabel,
} from '../suggestionGroups';
import { useSuggestionSession } from '../suggestionSession';
import {
  ignoreSuggestionGroup,
  linkSuggestion,
  showImportSnackbar,
} from '../importSuggestion';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'SmsSuggestions'>;

const TYPE_LABEL: Record<AccountType, string> = {
  bank: 'Bank Account',
  cash: 'Cash',
  credit_card: 'Credit Card',
  upi: 'UPI',
  other: 'Other',
};

/**
 * R2b "New Accounts Found": one card per suggested account with the SMS
 * transactions waiting for it (from the in-memory suggestion session — nav
 * params carry only the run id). Add account opens the prefilled Add Account
 * form; Add / Link insert the card's items as pending in one transaction;
 * Ignore records an 'ignored' decision. Back / leaving writes nothing.
 */
export function SmsSuggestionsScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { runId } = route.params;
  const session = useSuggestionSession(
    useShallow(state => ({ runId: state.runId, groups: state.groups })),
  );
  const accounts = useTransactionsStore(state => state.accounts);
  const [linking, setLinking] = useState<SuggestionGroup | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const stale = session.runId !== runId;
  const groups = stale ? [] : session.groups;

  function confirmIgnore(group: SuggestionGroup) {
    const count = group.items.length;
    showDialog({
      title: `Ignore ${proposedAccountTitle(group.suggestion)}?`,
      message: `Its ${count} waiting transaction${count === 1 ? '' : 's'} won't be added, and future SMS for this account will be skipped. There is no way to undo this in the app yet.`,
      icon: 'eye-off-outline',
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        {
          label: 'Ignore',
          variant: 'destructive',
          onPress: async () => {
            setBusyKey(group.key);
            try {
              await ignoreSuggestionGroup(runId, group.key);
            } finally {
              setBusyKey(null);
            }
          },
        },
      ],
    });
  }

  function confirmLink(group: SuggestionGroup, account: Account) {
    setLinking(null);
    const count = group.items.length;
    showDialog({
      title: `Link to ${accountDisplayLabel(account)}?`,
      message: `${count} waiting transaction${count === 1 ? '' : 's'} will be added to Pending on this account, and future SMS for ${proposedAccountTitle(group.suggestion)} will go there too.`,
      icon: 'link-variant',
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        {
          label: 'Link',
          variant: 'primary',
          onPress: async () => {
            setBusyKey(group.key);
            try {
              const outcome = await linkSuggestion(runId, group.key, account.id);
              if (outcome) showImportSnackbar(outcome, true);
            } finally {
              setBusyKey(null);
            }
          },
        },
      ],
    });
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.headerButton}
          accessibilityRole="button"
          accessibilityLabel="Back">
          <Icon name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>New Accounts Found</Text>
        <View style={styles.headerButton} />
      </View>

      <FlatList
        data={groups}
        keyExtractor={group => group.key}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          groups.length > 0 ? (
            <Text style={styles.summary} testID="suggestions-summary">
              {suggestionsSummaryLine(groups)}
            </Text>
          ) : undefined
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {stale
                ? 'These results are from an earlier sync. Tap Sync SMS on Home to see them again.'
                : 'All new accounts are sorted.'}
            </Text>
            <Button label="Done" variant="ghost" onPress={() => navigation.goBack()} />
          </View>
        }
        renderItem={({ item }) => (
          <SuggestionCard
            group={item}
            busy={busyKey === item.key}
            canLink={linkableAccounts(accounts, item.suggestion).length > 0}
            onAdd={() =>
              navigation.navigate('AddAccount', {
                prefill: {
                  name: proposedAccountBaseName(item.suggestion),
                  type: item.suggestion.accountKind,
                  lastFour: item.suggestion.lastFour ?? '',
                },
                suggestion: { runId, key: item.key },
              })
            }
            onLink={() => setLinking(item)}
            onIgnore={() => confirmIgnore(item)}
          />
        )}
      />

      <BottomSheet visible={linking !== null} onClose={() => setLinking(null)}>
        {linking ? (
          <LinkPicker
            accounts={linkableAccounts(accounts, linking.suggestion)}
            onPick={account => confirmLink(linking, account)}
          />
        ) : null}
      </BottomSheet>
    </SafeAreaView>
  );
}

interface SuggestionCardProps {
  group: SuggestionGroup;
  busy: boolean;
  canLink: boolean;
  onAdd: () => void;
  onLink: () => void;
  onIgnore: () => void;
}

function SuggestionCard({ group, busy, canLink, onAdd, onLink, onIgnore }: SuggestionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const summary = useMemo(() => summarizeGroup(group.items), [group.items]);
  const title = proposedAccountTitle(group.suggestion);

  return (
    <Card style={styles.card}>
      <View style={styles.titleRow}>
        <Text style={styles.title} testID="suggestion-title">
          {title}
        </Text>
        <Chip label={TYPE_LABEL[group.suggestion.accountKind]} />
      </View>
      <Text style={styles.count} testID="suggestion-waiting">
        {waitingLabel(summary.count)}
      </Text>
      {summary.firstAt && summary.lastAt ? (
        <Text style={styles.meta}>{formatShortDateRange(summary.firstAt, summary.lastAt)}</Text>
      ) : null}
      <Text style={styles.meta}>
        {`In ${formatRupeesFromMinor(summary.inMinor, { showPaise: true })} · Out ${formatRupeesFromMinor(summary.outMinor, { showPaise: true })}`}
      </Text>

      <Pressable
        onPress={() => setExpanded(value => !value)}
        style={styles.toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={expanded ? 'Hide transactions' : 'Show transactions'}>
        <Text style={styles.toggleText}>
          {expanded ? 'Hide transactions' : 'Show transactions'}
        </Text>
        <Icon
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={colors.primary}
        />
      </Pressable>

      {expanded ? (
        <View style={styles.items} testID="suggestion-items">
          {group.items.map(item => (
            <WaitingItemRow key={item.sourceReferenceHash} item={item} />
          ))}
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button
          label="Add account"
          variant="brand"
          disabled={busy}
          onPress={onAdd}
          testID={`add-account-${group.key}`}
        />
        {canLink ? (
          <Button label="Link to existing" variant="ghost" disabled={busy} onPress={onLink} />
        ) : null}
        <Button label="Ignore" variant="ghost" disabled={busy} onPress={onIgnore} />
      </View>
    </Card>
  );
}

function WaitingItemRow({ item }: { item: ParsedSmsTransaction }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const reference = parseSmsReference(item.sourceReferenceHash);
  const income = item.type === 'income';

  return (
    <View style={styles.itemRow} testID="suggestion-item">
      <View style={styles.itemTop}>
        <View style={[styles.arrow, income ? styles.arrowIn : styles.arrowOut]}>
          <Icon
            name={income ? 'arrow-bottom-left' : 'arrow-top-right'}
            size={16}
            color={income ? colors.primary : colors.onSurface}
          />
        </View>
        <View style={styles.itemMiddle}>
          <Text style={styles.itemMerchant} numberOfLines={1}>
            {item.merchantName}
          </Text>
          <Text style={styles.itemDate}>{formatTransactionTimestamp(item.occurredAt)}</Text>
        </View>
        <AmountText amountMinor={item.amountMinor} type={item.type} variant="labelLg" />
      </View>
      <Text
        style={styles.preview}
        numberOfLines={previewOpen ? undefined : 2}
        onPress={() => setPreviewOpen(value => !value)}
        accessibilityRole="button"
        accessibilityHint={previewOpen ? 'Collapse SMS description' : 'Expand SMS description'}>
        {item.sanitizedPreview}
      </Text>
      {reference ? <OriginalSmsView reference={reference} /> : null}
    </View>
  );
}

function LinkPicker({
  accounts,
  onPick,
}: {
  accounts: Account[];
  onPick: (account: Account) => void;
}) {
  return (
    <View style={styles.picker}>
      <Text style={styles.pickerTitle}>Link to an existing account</Text>
      <Text style={styles.meta}>Same type, no last 4 set.</Text>
      {accounts.map(account => (
        <Pressable
          key={account.id}
          onPress={() => onPick(account)}
          style={styles.pickerRow}
          accessibilityRole="button">
          <Icon name="wallet-outline" size={20} color={colors.onSurfaceVariant} />
          <Text style={styles.pickerLabel}>{accountDisplayLabel(account)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
  },
  headerButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    ...typography.headlineSm,
    fontSize: 16,
    color: colors.onSurface,
  },
  content: {
    padding: spacing.screen,
    gap: spacing.md,
    paddingBottom: spacing.xl * 3,
  },
  summary: {
    ...typography.labelLg,
    color: colors.onSurfaceVariant,
  },
  empty: {
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
  },
  emptyText: {
    ...typography.bodyMd,
    color: colors.outline,
    textAlign: 'center',
  },
  card: {
    gap: spacing.xs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {
    ...typography.headlineSm,
    fontSize: 18,
    color: colors.onSurface,
    flex: 1,
  },
  count: {
    ...typography.labelLg,
    color: colors.primary,
    marginTop: spacing.xs,
  },
  meta: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  toggle: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  toggleText: {
    ...typography.labelLg,
    color: colors.primary,
  },
  items: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  itemRow: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.sm,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  itemTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  arrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowIn: {
    backgroundColor: colors.surfaceContainerLowest,
  },
  arrowOut: {
    backgroundColor: colors.surfaceContainer,
  },
  itemMiddle: {
    flex: 1,
  },
  itemMerchant: {
    ...typography.labelLg,
    color: colors.onSurface,
  },
  itemDate: {
    ...typography.labelSm,
    color: colors.outline,
  },
  preview: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  picker: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  pickerTitle: {
    ...typography.headlineSm,
    fontSize: 16,
    color: colors.onSurface,
  },
  pickerRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pickerLabel: {
    ...typography.bodyLg,
    color: colors.onSurface,
  },
});
