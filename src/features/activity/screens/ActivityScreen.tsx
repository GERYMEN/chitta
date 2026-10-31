import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Icon } from '../../../shared/icons';
import { colors, radii, spacing, typography } from '../../../theme';
import { transactionStateColors } from '../../../theme/colors';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { RootStackParamList } from '../../../app/navigation/routes';
import { useActivityFeed } from '../hooks/useActivityFeed';
import {
  ActivityItem,
  describeActivity,
  formatRelativeTime,
  groupActivityByDay,
  ImpactTone,
} from '../activityFeed';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const TONE_COLOR: Record<ImpactTone, string> = {
  income: transactionStateColors.approved.fg,
  expense: colors.onSurface,
  pending: transactionStateColors.pending.fg,
  negative: transactionStateColors.failed.fg,
  neutral: colors.outline,
};

/**
 * Activity (R1): every money-changing action from `audit_events`, newest
 * first, grouped by day, paginated by cursor. Reached from the Home settings
 * sheet — not a tab (PROJECT.md four-tab rule).
 */
export function ActivityScreen() {
  const navigation = useNavigation<Nav>();
  const transactions = useTransactionsStore(state => state.transactions);
  const accounts = useTransactionsStore(state => state.accounts);
  const categories = useTransactionsStore(state => state.categories);
  const { events, loading, loadingMore, failed, reload, loadMore } = useActivityFeed();
  // R2 T0: amounts are private. Hidden by default every time the screen is
  // opened or comes back into focus; never persisted.
  const [showAmounts, setShowAmounts] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setShowAmounts(false);
      reload();
    }, [reload]),
  );

  const sections = useMemo(() => {
    const transactionById = new Map(transactions.map(t => [t.id, t]));
    const accountById = new Map(accounts.map(a => [a.id, a]));
    const categoryById = new Map(categories.map(c => [c.id, c]));
    const items = events.map(event => {
      const categoryId =
        event.metadata && 'categoryId' in event.metadata ? event.metadata.categoryId : null;
      const transaction = event.transactionId
        ? transactionById.get(event.transactionId) ?? null
        : null;
      // R3a: a transfer names both sides — "from" is the row's account (live
      // row first, else the event's), "to" its transfer account.
      const snapshot =
        event.metadata?.kind === 'deleted' ? event.metadata : event.deletedSnapshot;
      const fromId = transaction?.type === 'transfer' ? transaction.accountId : event.accountId;
      const toId =
        transaction?.type === 'transfer'
          ? transaction.transferAccountId ?? null
          : snapshot?.transferAccountId ?? null;
      // R3b: the other row of a refund / duplicate event (the original
      // expense, or the kept row), looked up by the id in the metadata.
      const metadata = event.metadata;
      const linkedId =
        metadata?.kind === 'refund_linked' || metadata?.kind === 'refund_unlinked'
          ? metadata.expense_id
          : metadata?.kind === 'duplicate_marked' || metadata?.kind === 'duplicate_restored'
          ? metadata.kept_id
          : null;
      return describeActivity(
        event,
        {
          transaction,
          linkedTransaction: linkedId ? transactionById.get(linkedId) ?? null : null,
          account: fromId ? accountById.get(fromId) ?? null : null,
          transferAccount: toId ? accountById.get(toId) ?? null : null,
          category: categoryId ? categoryById.get(categoryId) ?? null : null,
        },
        { showAmounts },
      );
    });
    return groupActivityByDay(items, new Date());
  }, [events, transactions, accounts, categories, showAmounts]);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back">
          <Icon name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Activity</Text>
        <Pressable
          onPress={() => setShowAmounts(value => !value)}
          style={styles.eyeButton}
          accessibilityRole="button"
          accessibilityLabel={showAmounts ? 'Hide amounts' : 'Show amounts'}
          testID="activity-toggle-amounts">
          <Icon
            name={showAmounts ? 'eye-off-outline' : 'eye-outline'}
            size={22}
            color={colors.onSurface}
          />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.content}
          stickySectionHeadersEnabled={false}
          onEndReached={() => loadMore()}
          onEndReachedThreshold={0.4}
          renderSectionHeader={({ section }) => (
            <Text style={styles.dayTitle}>{section.title.toUpperCase()}</Text>
          )}
          renderItem={({ item }) => (
            <ActivityRow
              item={item}
              onPress={
                item.transactionId
                  ? () =>
                      navigation.navigate('TransactionDetail', {
                        transactionId: item.transactionId as string,
                      })
                  : undefined
              }
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Icon name="history" size={28} color={colors.outline} />
              </View>
              <Text style={styles.emptyTitle}>
                {failed ? 'Could not load activity' : 'No activity yet'}
              </Text>
              <Text style={styles.emptyBody}>
                {failed
                  ? 'Go back and open Activity again.'
                  : 'Approvals, edits, deletions and account changes will appear here as they happen.'}
              </Text>
            </View>
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator style={styles.footer} color={colors.primary} /> : undefined
          }
        />
      )}
    </SafeAreaView>
  );
}

function ActivityRow({ item, onPress }: { item: ActivityItem; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [styles.row, pressed && onPress ? styles.pressed : null]}>
      <View style={styles.rowIcon}>
        <Icon name={item.icon} size={20} color={colors.onSurfaceVariant} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.sentence}>{item.sentence}</Text>
        {item.impact ? (
          <Text style={[styles.impact, { color: TONE_COLOR[item.impact.tone] }]}>
            {item.impact.text}
          </Text>
        ) : null}
        <Text style={styles.time}>{formatRelativeTime(item.eventAt)}</Text>
      </View>
      {onPress ? <Icon name="chevron-right" size={20} color={colors.outline} /> : null}
    </Pressable>
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
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.sm,
    minHeight: 48,
  },
  headerTitle: {
    ...typography.headlineSm,
    fontSize: 16,
    color: colors.onSurface,
  },
  eyeButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -spacing.sm,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.xl * 2,
    flexGrow: 1,
  },
  dayTitle: {
    ...typography.labelLg,
    color: colors.outline,
    letterSpacing: 0.5,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 64,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.default,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outlineVariant,
  },
  pressed: {
    opacity: 0.7,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  sentence: {
    ...typography.bodyMd,
    color: colors.onSurface,
  },
  impact: {
    ...typography.labelMd,
  },
  time: {
    ...typography.labelSm,
    color: colors.outline,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    ...typography.headlineSm,
    fontSize: 16,
    color: colors.onSurface,
  },
  emptyBody: {
    ...typography.bodyMd,
    color: colors.outline,
    textAlign: 'center',
  },
  footer: {
    marginVertical: spacing.md,
  },
});
