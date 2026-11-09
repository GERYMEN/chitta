import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, HeaderBackButton, HeaderSpacer } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, radii, spacing, typography } from '../../../theme';
import { RootStackParamList } from '../../../app/navigation/routes';
import { formatTransactionTimestamp } from '../../../shared/utils/date';
import { readSmsById } from '../../../native/android/sms/smsReader';
import { checkSmsPermission, requestSmsPermission } from '../../../native/android/permissions/smsPermission';
import { getFeedbackDeviceInfo } from '../../../native/android/feedback/feedbackNative';
import { redactText, useRedacted } from '../../../shared/privacy/redaction';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { SmsUnparsedRow } from '../../../data/repositories/smsUnparsed.repository';
import { institutionDisplayName } from '../parser/institutions';
import { bestGuessForSms, PARSER_VERSION } from '../parser/readSms';
import { maskSmsPattern, MaskedPattern, sharePatternMessage } from '../parser/maskSmsPattern';
import { shareFeedback } from '../../feedback/feedbackFlow';
import { unparsedReasonLabel, useSmsReaderStore, visibleUnparsed } from '../smsReaderStore';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** R5-fix U10: TalkBack label — bank, date and reason (rows are told apart by date). */
export function notUnderstoodRowLabel(row: Pick<SmsUnparsedRow, 'institution' | 'smsDate' | 'reasonCode'>): string {
  return `${institutionDisplayName(row.institution)}, ${formatTransactionTimestamp(
    new Date(row.smsDate).toISOString(),
  )}, ${unparsedReasonLabel(row.reasonCode)}`;
}

/**
 * R5 "Messages not understood". Rows come from sms_unparsed (date, bank,
 * reason — no text). Tapping a row reads that SMS LIVE by id into this
 * component's state only (like "View original SMS"); it is never stored,
 * logged or put in nav params. "Share pattern" shows an allowlist-masked
 * version first and sends it only when the user taps "Send on WhatsApp".
 */
type Open =
  | { kind: 'loading' }
  | { kind: 'shown'; address: string; body: string }
  | { kind: 'gone' }
  | { kind: 'denied'; blocked: boolean }
  | { kind: 'error' };

export function NotUnderstoodScreen() {
  const navigation = useNavigation<Nav>();
  useRedacted(); // R4c: SMS text masked in feedback screenshots
  const rows = useSmsReaderStore(state => state.unparsed);
  const transactions = useTransactionsStore(state => state.transactions);
  const visible = useMemo(() => visibleUnparsed(rows, transactions), [rows, transactions]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [pattern, setPattern] = useState<MaskedPattern | null>(null);
  const token = useRef(0);

  useEffect(() => {
    useSmsReaderStore.getState().refreshUnparsed();
    return () => {
      token.current += 1;
    };
  }, []);

  const close = useCallback(() => {
    token.current += 1;
    setOpenKey(null);
    setOpen(null);
    setPattern(null);
  }, []);

  /** Read the row's SMS live (by id, exact date only) into component state. */
  const openRow = useCallback(async (row: SmsUnparsedRow) => {
    const key = `${row.smsId}:${row.smsDate}`;
    const mine = ++token.current;
    setOpenKey(key);
    setPattern(null);
    setOpen({ kind: 'loading' });
    try {
      if (!(await checkSmsPermission())) {
        if (mine === token.current) setOpen({ kind: 'denied', blocked: false });
        return;
      }
      const message = await readSmsById(row.smsId);
      if (mine !== token.current) return;
      // ids can be reused after deletion: only the exact message (same date).
      if (!message || message.date !== row.smsDate) {
        setOpen({ kind: 'gone' });
        return;
      }
      setOpen({ kind: 'shown', address: message.address, body: message.body });
    } catch {
      if (mine === token.current) setOpen({ kind: 'error' });
    }
  }, []);

  const toggle = useCallback(
    async (row: SmsUnparsedRow) => {
      if (openKey === `${row.smsId}:${row.smsDate}`) {
        close();
        return;
      }
      await openRow(row);
    },
    [openKey, close, openRow],
  );

  /** R5-fix U10: the denied state offers the grant (or Settings when blocked). */
  async function grantAndRetry(row: SmsUnparsedRow) {
    const result = await requestSmsPermission().catch(() => 'denied' as const);
    if (result === 'granted') {
      await openRow(row);
      return;
    }
    if (result === 'never_ask_again') {
      setOpen({ kind: 'denied', blocked: true });
      Linking.openSettings().catch(() => undefined);
      return;
    }
    setOpen({ kind: 'denied', blocked: false });
  }

  async function addAsTransaction(row: SmsUnparsedRow, body: string, address: string) {
    const guess = bestGuessForSms({ id: row.smsId, address, body, date: row.smsDate });
    close();
    navigation.navigate('AddRecord', {
      fromSms: {
        smsId: row.smsId,
        smsDate: row.smsDate,
        type: guess.type,
        amountMinor: guess.amountMinor,
        lastFour: guess.lastFour,
      },
    });
  }

  async function notATransaction(row: SmsUnparsedRow) {
    close();
    await useSmsReaderStore.getState().dismissUnparsed(row);
    ToastAndroid.show('Marked as not a transaction', ToastAndroid.SHORT);
  }

  async function sendPattern(row: SmsUnparsedRow, masked: MaskedPattern) {
    const info = getFeedbackDeviceInfo();
    const text = sharePatternMessage({
      pattern: masked,
      reasonLabel: unparsedReasonLabel(row.reasonCode),
      appVersion: info.versionName || '?',
      parserVersion: PARSER_VERSION,
    });
    try {
      await shareFeedback(text, null);
    } catch {
      ToastAndroid.show('Could not open WhatsApp', ToastAndroid.SHORT);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <HeaderBackButton onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle}>Messages not understood</Text>
        <HeaderSpacer />
      </View>
      <FlatList
        data={visible}
        keyExtractor={row => `${row.smsId}:${row.smsDate}`}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          visible.length > 0 ? (
            <Text style={styles.intro}>
              These look like bank messages, but Tracker could not read a transaction from them.
              Tap one to see it (read live from your inbox, not stored).
            </Text>
          ) : undefined
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="check-circle-outline" size={32} color={colors.primary} />
            <Text style={styles.emptyTitle}>Nothing here</Text>
            <Text style={styles.emptyBody}>Every bank message so far was understood.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const key = `${item.smsId}:${item.smsDate}`;
          const isOpen = key === openKey;
          return (
            <View style={styles.card}>
              <Pressable
                onPress={() => toggle(item)}
                accessibilityRole="button"
                accessibilityState={{ expanded: isOpen }}
                accessibilityLabel={notUnderstoodRowLabel(item)}
                testID="not-understood-row"
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                <View style={styles.rowIcon}>
                  <Icon name="message-question-outline" size={20} color={colors.onSurfaceVariant} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{institutionDisplayName(item.institution)}</Text>
                  <Text style={styles.rowCaption}>
                    {formatTransactionTimestamp(new Date(item.smsDate).toISOString())} ·{' '}
                    {unparsedReasonLabel(item.reasonCode)}
                  </Text>
                </View>
                <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={22} color={colors.outline} />
              </Pressable>
              {isOpen && open ? (
                <View style={styles.detail}>
                  {open.kind === 'loading' ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : null}
                  {open.kind === 'denied' ? (
                    <>
                      <Text style={styles.status} testID="not-understood-denied">
                        {open.blocked
                          ? 'SMS access is blocked. Allow SMS for Tracker in Settings to view this message.'
                          : 'Tracker needs SMS access to read this message live from your inbox. Nothing is stored.'}
                      </Text>
                      <Button
                        label={open.blocked ? 'Open Settings' : 'Allow SMS access'}
                        variant="primary"
                        onPress={() =>
                          open.blocked ? Linking.openSettings().catch(() => undefined) : grantAndRetry(item)
                        }
                      />
                      <Button label="Not a transaction" variant="ghost" onPress={() => notATransaction(item)} />
                    </>
                  ) : null}
                  {open.kind === 'gone' ? (
                    <Text style={styles.status}>This message is no longer in your inbox.</Text>
                  ) : null}
                  {open.kind === 'error' ? (
                    <Text style={styles.status}>Couldn&apos;t read the message.</Text>
                  ) : null}
                  {open.kind === 'gone' || open.kind === 'error' ? (
                    <Button label="Not a transaction" variant="ghost" onPress={() => notATransaction(item)} />
                  ) : null}
                  {open.kind === 'shown' ? (
                    <>
                      <View style={styles.sourceBox}>
                        <Text style={styles.sourceLabel}>READ LIVE FROM YOUR INBOX · NOT STORED</Text>
                        <Text style={styles.body} selectable>
                          {redactText(open.body)}
                        </Text>
                      </View>
                      <Button
                        label="Add as transaction"
                        variant="primary"
                        onPress={() => addAsTransaction(item, open.body, open.address)}
                        testID="not-understood-add"
                      />
                      <Button
                        label="Not a transaction"
                        variant="ghost"
                        onPress={() => notATransaction(item)}
                        testID="not-understood-dismiss"
                      />
                      {pattern ? (
                        <View style={styles.sourceBox} testID="not-understood-pattern">
                          <Text style={styles.sourceLabel}>
                            WHAT WILL BE SENT · names, numbers and amounts removed
                          </Text>
                          <Text style={styles.body}>Sender: {pattern.sender}</Text>
                          <Text style={styles.body}>{pattern.text}</Text>
                          <Button
                            label="Send on WhatsApp"
                            variant="brand"
                            onPress={() => sendPattern(item, pattern)}
                            testID="not-understood-send"
                          />
                        </View>
                      ) : (
                        <Button
                          label="Share pattern"
                          variant="ghost"
                          onPress={() => setPattern(maskSmsPattern(open.body, open.address))}
                          testID="not-understood-share"
                        />
                      )}
                    </>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
    minHeight: 48,
  },
  headerTitle: { ...typography.headlineSm, fontSize: 16, color: colors.onSurface },
  content: { paddingHorizontal: spacing.screen, paddingBottom: spacing.xl * 2, flexGrow: 1, gap: spacing.sm },
  intro: { ...typography.bodyMd, color: colors.onSurfaceVariant, marginBottom: spacing.md },
  card: { borderRadius: radii.default, backgroundColor: colors.surfaceContainerLow, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pressed: { opacity: 0.7 },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowTitle: { ...typography.labelLg, color: colors.onSurface },
  rowCaption: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  detail: { padding: spacing.md, paddingTop: 0, gap: spacing.sm },
  status: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  sourceBox: { backgroundColor: colors.surfaceContainer, borderRadius: 12, padding: spacing.md, gap: spacing.xs },
  sourceLabel: { ...typography.labelSm, color: colors.outline, letterSpacing: 0.5 },
  body: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyTitle: { ...typography.headlineSm, fontSize: 16, color: colors.onSurface },
  emptyBody: { ...typography.bodyMd, color: colors.outline, textAlign: 'center' },
});
