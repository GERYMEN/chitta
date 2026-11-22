import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, showDialog, showSnackbar } from '../../../shared/ui';
import { HeaderBackButton, HeaderSpacer } from '../../../shared/ui/HeaderBackButton';
import { spacing, typography, useColors, ColorTokens } from '../../../theme';
import { RootStackParamList } from '../../../app/navigation/routes';
import { redactText, useRedacted } from '../../../shared/privacy/redaction';
import { useNow } from '../../../shared/hooks/useNow';
import { formatRupeesFromMinor } from '../../../shared/utils/currency';
import { activeShares, directionLabel, isSettled, personNet } from '../../../domain/iou/iou.rules';
import { IouShare } from '../../../domain/iou/iou.types';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { SettleError, useIouStore } from '../state/iouStore';
import { netLabel } from '../iouLabels';
import { RepaymentSheet } from '../components/RepaymentSheet';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const SETTLE_ERROR_TEXT: Record<SettleError, string> = {
  missing: 'That transaction is no longer there.',
  'not-linkable': 'That transaction cannot be linked (it is already linked or not approved).',
};

/**
 * R10 (D-f): one person's shares. Settled shares older than 30 days are hidden
 * behind "Show settled". "Record repayment" / "Mark paid" settles in full
 * (optionally linking a transaction) with a 5 s Undo.
 */
export function PersonIousScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, 'PersonIous'>>();
  useRedacted();
  const personId = route.params.personId;
  const person = useIouStore(state => state.people.find(p => p.id === personId));
  const allShares = useIouStore(state => state.shares);
  const refresh = useIouStore(state => state.refresh);
  const settle = useIouStore(state => state.settle);
  const undoSettle = useIouStore(state => state.undoSettle);
  const remove = useIouStore(state => state.remove);
  const restore = useIouStore(state => state.restore);
  const transactions = useTransactionsStore(state => state.transactions);
  const now = useNow(allShares.length);
  const [showSettled, setShowSettled] = useState(false);
  const [repaying, setRepaying] = useState<IouShare | null>(null);

  useFocusEffect(
    useCallback(() => {
      refresh().catch(() => undefined);
    }, [refresh]),
  );

  const mine = useMemo(() => allShares.filter(s => s.personId === personId), [allShares, personId]);
  const visible = useMemo(() => (showSettled ? mine : activeShares(mine, now)), [mine, showSettled, now]);
  const hiddenCount = mine.length - activeShares(mine, now).length;
  const net = personNet(mine);

  async function onSettle(share: IouShare, transactionId: string | null) {
    const result = await settle(share, transactionId);
    if (typeof result === 'string') {
      showSnackbar({ message: SETTLE_ERROR_TEXT[result] });
      return;
    }
    setRepaying(null);
    showSnackbar({
      message: share.direction === 'lent' ? 'Repayment recorded' : 'Marked paid',
      actionLabel: 'Undo',
      onAction: () => {
        undoSettle(result).catch(() => undefined);
      },
    });
  }

  function confirmDelete(share: IouShare) {
    showDialog({
      title: 'Delete this IOU?',
      message: 'It is removed from your ledger. Your transactions are not changed. You can undo this.',
      icon: 'account-remove-outline',
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        {
          label: 'Delete',
          variant: 'primary',
          onPress: async () => {
            await remove(share);
            showSnackbar({
              message: 'IOU deleted',
              actionLabel: 'Undo',
              onAction: () => {
                restore(share).catch(() => undefined);
              },
            });
          },
        },
      ],
    });
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <HeaderBackButton onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle} numberOfLines={1}>
          {person ? redactText(person.name) : 'Person'}
        </Text>
        <HeaderSpacer />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.net} testID="person-net">
          {netLabel(net)}
        </Text>
        {visible.length === 0 ? <Text style={styles.empty}>Nothing here.</Text> : null}
        {visible.map(share => {
          const source = share.sourceTransactionId
            ? transactions.find(t => t.id === share.sourceTransactionId)
            : undefined;
          const settled = isSettled(share);
          return (
            <Card key={share.id} testID="person-share">
              <Text style={styles.line}>
                {directionLabel(share.direction)} {formatRupeesFromMinor(share.amountMinor)}
              </Text>
              {source ? <Text style={styles.meta}>For {redactText(source.merchantName)}</Text> : null}
              {share.note ? <Text style={styles.meta}>{redactText(share.note)}</Text> : null}
              <Text style={styles.meta}>
                {settled ? `Settled ${share.settledAt?.slice(0, 10)}` : 'Not settled'}
              </Text>
              <View style={styles.actions}>
                {!settled ? (
                  <Button
                    label={share.direction === 'lent' ? 'Record repayment' : 'Mark paid'}
                    variant="brand"
                    onPress={() => setRepaying(share)}
                    testID="person-settle"
                  />
                ) : null}
                <Button label="Delete" variant="ghost" onPress={() => confirmDelete(share)} testID="person-delete" />
              </View>
            </Card>
          );
        })}
        {hiddenCount > 0 || showSettled ? (
          <Button
            label={showSettled ? 'Hide old settled' : `Show settled (${hiddenCount})`}
            variant="ghost"
            onPress={() => setShowSettled(v => !v)}
            testID="person-show-settled"
          />
        ) : null}
      </ScrollView>
      <RepaymentSheet visible={repaying != null} onClose={() => setRepaying(null)} share={repaying} onSettle={onSettle} />
    </SafeAreaView>
  );
}

const makeStyles = (c: ColorTokens) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  headerTitle: { ...typography.headlineSm, color: c.onSurface, flex: 1, textAlign: 'center' },
  content: { padding: spacing.screen, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  net: { ...typography.headlineMd, color: c.onSurface },
  empty: { ...typography.bodyMd, color: c.onSurfaceVariant },
  line: { ...typography.bodyLg, color: c.onSurface },
  meta: { ...typography.bodyMd, color: c.outline },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' },
});
