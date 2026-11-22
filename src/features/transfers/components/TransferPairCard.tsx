import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { radii, spacing, typography, useColors, ColorTokens } from '../../../theme';
import { Account } from '../../../domain/accounts/account.types';
import { TransferPair } from '../../../domain/transfers/transfer.rules';
import { transferPairDates, transferPairTitle } from '../transferLabels';

/** R3a Pending "Looks like a transfer" card: one suggested pair. */
export function TransferPairCard({
  pair,
  accounts,
  busy = false,
  onConfirm,
  onDismiss,
}: {
  pair: TransferPair;
  accounts: ReadonlyArray<Account>;
  busy?: boolean;
  onConfirm: (pair: TransferPair) => void;
  onDismiss: (pair: TransferPair) => void;
}) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <Card style={styles.card} testID="transfer-pair-card">
      <View style={styles.topRow}>
        <View style={styles.icon}>
          <Icon name="swap-horizontal" size={20} color={c.secondary} />
        </View>
        <View style={styles.meta}>
          <Text style={styles.title}>{transferPairTitle(pair, accounts)}</Text>
          <Text style={styles.dates}>{transferPairDates(pair)}</Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Button
          label="It's a transfer"
          variant="brand"
          disabled={busy}
          onPress={() => onConfirm(pair)}
          style={styles.action}
          testID="transfer-pair-confirm"
        />
        <Button
          label="Not a transfer"
          variant="ghost"
          disabled={busy}
          onPress={() => onDismiss(pair)}
          style={styles.action}
          testID="transfer-pair-dismiss"
        />
      </View>
    </Card>
  );
}

const makeStyles = (c: ColorTokens) => StyleSheet.create({
  card: {
    gap: spacing.sm,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    backgroundColor: c.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: {
    flex: 1,
  },
  title: {
    ...typography.headlineSm,
    fontSize: 15,
    color: c.onSurface,
  },
  dates: {
    ...typography.bodyMd,
    color: c.outline,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  action: {
    flex: 1,
    minHeight: 48,
  },
});
