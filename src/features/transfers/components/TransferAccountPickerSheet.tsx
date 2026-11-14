import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { BottomSheet } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, spacing, typography } from '../../../theme';
import { accountDisplayLabel } from '../../../domain/accounts/account.rules';
import type { AccountType } from '../../../domain/accounts/account.types';
import {
  selectActiveAccounts,
  useTransactionsStore,
} from '../../transactions/state/transactionsStore';

/**
 * R3a "Mark as transfer": pick the OTHER account (active, never the row's own
 * account). For an expense it is where the money went ("to"); for an income
 * where it came from ("from").
 */
export function TransferAccountPickerSheet({
  visible,
  onClose,
  excludeAccountId,
  direction,
  onSelect,
  allowedTypes,
  body,
}: {
  visible: boolean;
  onClose: () => void;
  excludeAccountId: string;
  direction: 'to' | 'from';
  onSelect: (accountId: string) => void;
  /** R5e "Choose account": only the account types the meaning allows. */
  allowedTypes?: ReadonlyArray<AccountType>;
  /** R5e: replaces the default explainer line. */
  body?: string;
}) {
  const active = useTransactionsStore(useShallow(selectActiveAccounts));
  const options = useMemo(
    () =>
      active.filter(
        account => account.id !== excludeAccountId && (!allowedTypes || allowedTypes.includes(account.type)),
      ),
    [active, excludeAccountId, allowedTypes],
  );

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>
        {direction === 'to' ? 'Moved to which account?' : 'Moved from which account?'}
      </Text>
      <Text style={styles.body}>
        {body ?? `It stops counting as ${direction === 'to' ? 'an expense' : 'income'} and moves both balances.`}
      </Text>
      {options.length === 0 ? (
        <Text style={styles.body}>Add another account first.</Text>
      ) : (
        options.map(account => (
          <Pressable
            key={account.id}
            onPress={() => onSelect(account.id)}
            accessibilityRole="button"
            accessibilityLabel={`${direction === 'to' ? 'To' : 'From'} ${accountDisplayLabel(account)}`}
            style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
            <Icon name="swap-horizontal" size={20} color={colors.secondary} />
            <Text style={styles.optionLabel} numberOfLines={1}>
              {accountDisplayLabel(account)}
            </Text>
          </Pressable>
        ))
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.headlineSm,
    fontSize: 18,
    color: colors.onSurface,
  },
  body: {
    ...typography.bodyMd,
    color: colors.outline,
    marginBottom: spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
  },
  pressed: {
    opacity: 0.6,
  },
  optionLabel: {
    ...typography.bodyLg,
    color: colors.onSurface,
    flex: 1,
  },
});
