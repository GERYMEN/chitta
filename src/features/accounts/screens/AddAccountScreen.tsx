import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../../../shared/icons';
import { showDialog } from '../../../shared/ui';
import { colors, spacing, typography } from '../../../theme';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { activeAccounts } from '../../../domain/accounts/account.rules';
import { CreateAccountInput } from '../../../data/repositories/account.repository';
import { RootStackParamList } from '../../../app/navigation/routes';
import { AccountForm } from '../components/AccountForm';
import { AccountFormValues, findDuplicateAccount, openingBalanceInputToMinor } from '../components/accountForm.schema';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'AddAccount'>;

/**
 * Adds a new money source ("account"). On submit it persists through the
 * store's `addAccount` (SQLite insert + state refresh) and navigates back to
 * the Accounts tab, where the new account and updated balance render live.
 * Supports an optional `prefill` route param (from the SMS suggestions screen)
 * so a discovered account/card arrives pre-filled instead of blank.
 */
export function AddAccountScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const [submitting, setSubmitting] = useState(false);

  const prefill = route.params?.prefill;

  async function handleSubmit(values: AccountFormValues) {
    const lastFour =
      values.lastFour && values.lastFour.trim() !== '' ? values.lastFour.trim() : null;

    const duplicate = findDuplicateAccount(activeAccounts(useTransactionsStore.getState().accounts), {
      name: values.name,
      type: values.type,
      lastFour,
    });
    if (duplicate) {
      showDialog({
        title: 'Account already exists',
        message: `An account named '${values.name.trim()}' already exists.`,
        icon: 'alert-circle-outline',
        actions: [{ label: 'OK', variant: 'primary' }],
      });
      return;
    }

    const input: CreateAccountInput = {
      name: values.name,
      type: values.type,
      lastFour,
      openingBalanceMinor: openingBalanceInputToMinor(values.openingBalance),
      currency: 'INR',
      isActive: true,
    };

    setSubmitting(true);
    try {
      await useTransactionsStore.getState().addAccount(input);
      navigation.goBack();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Icon name="arrow-left" size={22} color={colors.onSurface} onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle}>Add Account</Text>
        <View style={styles.headerSpacer} />
      </View>

      <AccountForm
        onSubmit={handleSubmit}
        submitting={submitting}
        initialValues={
          prefill
            ? {
                name: prefill.name,
                type: prefill.type,
                lastFour: prefill.lastFour ?? '',
              }
            : undefined
        }
      />
    </SafeAreaView>
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
  },
  headerTitle: {
    ...typography.headlineSm,
    fontSize: 16,
    color: colors.onSurface,
  },
  headerSpacer: {
    width: 22,
  },
});
