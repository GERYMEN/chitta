import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, radii, spacing, typography } from '../../../theme';
import { Account } from '../../../domain/accounts/account.types';
import { Transaction } from '../../../domain/transactions/transaction.types';
import { defaultKeepId, DuplicatePair } from '../../../domain/duplicates/duplicate.rules';
import { duplicatePairTitle, duplicateRowLine, duplicateRowStatus } from '../duplicateLabels';

/**
 * R3b Pending / Review "Possible duplicates" card: both rows with their date
 * and time, which one will be KEPT (default: the approved one, else the
 * earlier — tap a row to keep that one instead), then [Mark duplicate] hides
 * the other, [Not duplicates] dismisses the suggestion.
 */
export function DuplicatePairCard({
  pair,
  accounts,
  busy = false,
  onMark,
  onDismiss,
}: {
  pair: DuplicatePair;
  accounts: ReadonlyArray<Account>;
  busy?: boolean;
  onMark: (keptId: string, duplicateId: string) => void;
  onDismiss: (pair: DuplicatePair) => void;
}) {
  const [keepId, setKeepId] = useState(() => defaultKeepId(pair));
  const hideId = keepId === pair.first.id ? pair.second.id : pair.first.id;

  return (
    <Card style={styles.card} testID="duplicate-pair-card">
      <View style={styles.topRow}>
        <View style={styles.icon}>
          <Icon name="content-duplicate" size={20} color={colors.secondary} />
        </View>
        <Text style={styles.title}>{duplicatePairTitle(pair.first, accounts)}</Text>
      </View>
      {[pair.first, pair.second].map(row => (
        <SideRow
          key={row.id}
          row={row}
          kept={row.id === keepId}
          disabled={busy}
          onPress={() => setKeepId(row.id)}
        />
      ))}
      <Text style={styles.hint}>
        The other one is hidden — not in lists, totals or balances. You can undo it from Activity.
      </Text>
      <View style={styles.actions}>
        <Button
          label="Mark duplicate"
          variant="brand"
          disabled={busy}
          onPress={() => onMark(keepId, hideId)}
          style={styles.action}
          testID="duplicate-pair-mark"
        />
        <Button
          label="Not duplicates"
          variant="ghost"
          disabled={busy}
          onPress={() => onDismiss(pair)}
          style={styles.action}
          testID="duplicate-pair-dismiss"
        />
      </View>
    </Card>
  );
}

function SideRow({
  row,
  kept,
  disabled,
  onPress,
}: {
  row: Transaction;
  kept: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected: kept, disabled }}
      accessibilityLabel={`Keep this one: ${duplicateRowLine(row)}`}
      style={({ pressed }) => [styles.side, kept && styles.sideKept, pressed && styles.pressed]}>
      <Icon
        name={kept ? 'radiobox-marked' : 'radiobox-blank'}
        size={20}
        color={kept ? colors.primary : colors.outline}
      />
      <View style={styles.sideText}>
        <Text style={styles.sideLine} numberOfLines={1}>
          {duplicateRowLine(row)}
        </Text>
        <Text style={styles.sideMeta}>
          {duplicateRowStatus(row)} · {kept ? 'Will be kept' : 'Will be hidden'}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: colors.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.headlineSm,
    fontSize: 15,
    color: colors.onSurface,
    flex: 1,
  },
  side: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outlineVariant,
  },
  sideKept: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceContainerLow,
  },
  pressed: {
    opacity: 0.7,
  },
  sideText: {
    flex: 1,
    paddingVertical: spacing.xs,
  },
  sideLine: {
    ...typography.bodyLg,
    color: colors.onSurface,
  },
  sideMeta: {
    ...typography.labelMd,
    color: colors.outline,
  },
  hint: {
    ...typography.bodyMd,
    color: colors.outline,
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
