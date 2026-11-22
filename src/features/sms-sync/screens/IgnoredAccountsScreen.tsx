import React, { useMemo, useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Button, HeaderBackButton, HeaderSpacer } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { radii, spacing, typography, useColors, ColorTokens } from '../../../theme';
import { accountRepository } from '../../../data/repositories/account.repository';
import { useRedacted } from '../../../shared/privacy/redaction';
import { ACCOUNT_KEY_NORMALIZER_VERSION } from '../normalizeAccountKey';
import { IgnoredAccount, ignoredAccountsFrom } from '../suggestionGroups';
import { unignoreAccount } from '../importSuggestion';

/**
 * R5j (G7) "Hidden accounts": the account numbers the user chose to Ignore
 * (public bank id, kind, last-4 — no SMS text). "Un-ignore" drops the decision
 * so matching SMS are handled again from the next sync.
 */
export function IgnoredAccountsScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation();
  useRedacted(); // R4c: last-4 masked in the feedback screenshot
  const [rows, setRows] = useState<IgnoredAccount[] | null>(null);

  const load = useCallback(async () => {
    const decisions = await accountRepository.listSuggestionDecisions().catch(() => []);
    setRows(ignoredAccountsFrom(decisions));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function unignore(row: IgnoredAccount) {
    try {
      await unignoreAccount({
        bankCanonical: row.bankCanonical,
        accountKind: row.accountKind,
        lastFour: row.lastFour,
        normalizerVersion: ACCOUNT_KEY_NORMALIZER_VERSION,
      });
      ToastAndroid.show('Un-ignored — run Sync SMS to see its messages', ToastAndroid.SHORT);
    } catch {
      ToastAndroid.show('Could not un-ignore — please try again.', ToastAndroid.LONG);
    }
    await load();
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <HeaderBackButton onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle}>Hidden accounts</Text>
        <HeaderSpacer />
      </View>
      <FlatList
        data={rows ?? []}
        keyExtractor={row => row.key}
        contentContainerStyle={styles.content}
        testID="ignored-accounts-list"
        ListHeaderComponent={
          rows && rows.length > 0 ? (
            <Text style={styles.intro}>
              You chose to ignore these accounts, so their messages are skipped. Un-ignore one to
              handle its messages again.
            </Text>
          ) : undefined
        }
        ListEmptyComponent={
          rows ? (
            <View style={styles.empty} testID="ignored-accounts-empty">
              <Icon name="eye-outline" size={32} color={c.primary} />
              <Text style={styles.emptyTitle}>Nothing hidden</Text>
              <Text style={styles.emptyBody}>Accounts you ignore will be listed here.</Text>
            </View>
          ) : undefined
        }
        renderItem={({ item }) => (
          <View style={styles.row} testID="ignored-account-row">
            <View style={styles.rowIcon}>
              <Icon name="eye-off-outline" size={20} color={c.onSurfaceVariant} />
            </View>
            <Text style={styles.rowTitle} numberOfLines={2}>
              {item.label}
            </Text>
            <Button
              label="Un-ignore"
              variant="ghost"
              onPress={() => unignore(item)}
              accessibilityLabel={`Un-ignore ${item.label}`}
              testID="ignored-account-unignore"
            />
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const makeStyles = (c: ColorTokens) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
    minHeight: 48,
  },
  headerTitle: { ...typography.headlineSm, fontSize: 16, color: c.onSurface },
  content: { paddingHorizontal: spacing.screen, paddingBottom: spacing.xl * 2, flexGrow: 1, gap: spacing.sm },
  intro: { ...typography.bodyMd, color: c.onSurfaceVariant, marginBottom: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.default,
    backgroundColor: c.surfaceContainerLow,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: c.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { ...typography.labelLg, color: c.onSurface, flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyTitle: { ...typography.headlineSm, fontSize: 16, color: c.onSurface },
  emptyBody: { ...typography.bodyMd, color: c.outline, textAlign: 'center' },
});
