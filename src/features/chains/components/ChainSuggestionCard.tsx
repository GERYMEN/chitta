import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, radii, spacing, typography } from '../../../theme';
import { Account } from '../../../domain/accounts/account.types';
import { accountDisplayLabel } from '../../../domain/accounts/account.rules';
import { AmountText } from '../../../shared/ui/AmountText';
import { redactText } from '../../../shared/privacy/redaction';
import { formatTransactionTimestamp } from '../../../shared/utils/date';
import { ChainReviewItem, chainAcceptLabel, chainRelationLabel } from '../chainReview';

/**
 * R5i (G3) Review "Linked by rules" card. Shows the pending child (masked
 * merchant / account / date / amount) and the proposed relation. Accept
 * applies the link by reusing the existing store action (and re-checks at tap
 * time); Dismiss keeps the items apart (with a 5 s Undo). An 'incomplete'
 * suggestion has no Accept — it waits for the matching alert.
 */
export function ChainSuggestionCard({
  item,
  accounts,
  busy = false,
  onAccept,
  onDismiss,
}: {
  item: ChainReviewItem;
  accounts: ReadonlyArray<Account>;
  busy?: boolean;
  onAccept: (item: ChainReviewItem) => void;
  onDismiss: (item: ChainReviewItem) => void;
}) {
  const { child, suggestion } = item;
  const account = accounts.find(a => a.id === child.accountId) ?? null;
  const relation = chainRelationLabel(suggestion.kind);
  const acceptLabel = chainAcceptLabel(suggestion.kind);

  return (
    <Card style={styles.card} testID="chain-suggestion-card">
      <View style={styles.topRow}>
        <View style={styles.icon}>
          <Icon name="link-variant" size={20} color={colors.secondary} />
        </View>
        <Text style={styles.relation} testID="chain-relation">
          {relation}
        </Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.line} numberOfLines={1}>
          {redactText(child.merchantName)} · {accountDisplayLabel(account)} ·{' '}
          {formatTransactionTimestamp(child.occurredAt)}
        </Text>
        <AmountText amountMinor={child.amountMinor} type={child.type} variant="labelLg" />
      </View>
      <View style={styles.actions}>
        {acceptLabel ? (
          <Button
            label={acceptLabel}
            variant="brand"
            disabled={busy}
            onPress={() => onAccept(item)}
            style={styles.action}
            accessibilityLabel={`${acceptLabel} — ${relation}`}
            testID="chain-accept"
          />
        ) : null}
        <Button
          label="Dismiss"
          variant="ghost"
          disabled={busy}
          onPress={() => onDismiss(item)}
          style={styles.action}
          accessibilityLabel="Dismiss this suggestion"
          testID="chain-dismiss"
        />
      </View>
    </Card>
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
  relation: {
    ...typography.headlineSm,
    fontSize: 15,
    color: colors.onSurface,
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  line: {
    ...typography.bodyLg,
    color: colors.onSurface,
    flex: 1,
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
