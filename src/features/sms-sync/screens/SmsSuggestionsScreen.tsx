import React from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Icon } from '../../../shared/icons';
import { Button, Card } from '../../../shared/ui';
import { colors, spacing, typography } from '../../../theme';
import { AccountType } from '../../../domain/accounts/account.types';
import { RootStackParamList } from '../../../app/navigation/routes';
import { SmsAccountSuggestion } from '../smsSyncLogic';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'SmsSuggestions'>;

const TYPE_LABEL: Record<AccountType, string> = {
  bank: 'Bank Account',
  cash: 'Cash',
  credit_card: 'Credit Card',
  upi: 'UPI',
  other: 'Other',
};

function suggestionKey(suggestion: SmsAccountSuggestion): string {
  return `${suggestion.accountKind}:${suggestion.bankName}:${suggestion.lastFour ?? 'unknown'}`;
}

/**
 * Review surface for SMS-derived accounts that didn't match any existing
 * account. Each row deep-links into a pre-filled Add Account form. v1 has no
 * "dismiss forever" action — declined suggestions reappear on the next sync
 * (recomputed fresh, never persisted).
 */
export function SmsSuggestionsScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { suggestions } = route.params;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Icon
          name="arrow-left"
          size={22}
          color={colors.onSurface}
          onPress={() => navigation.goBack()}
        />
        <Text style={styles.headerTitle}>New Accounts Found</Text>
        <View style={styles.headerSpacer} />
      </View>

      <FlatList
        data={suggestions}
        keyExtractor={suggestionKey}
        contentContainerStyle={styles.content}
        renderItem={({ item }) => (
          <Card style={styles.card}>
            <Text style={styles.title}>{item.bankName}</Text>
            <Text style={styles.subtitle}>
              {TYPE_LABEL[item.accountKind]} · {item.lastFour ? `•••• ${item.lastFour}` : 'Unknown'}
            </Text>
            <Text style={styles.count}>
              {item.messageCount} transaction{item.messageCount === 1 ? '' : 's'} waiting
            </Text>
            <Button
              label="Add Account"
              variant="brand"
              fullWidth
              testID={`add-account-${suggestionKey(item)}`}
              onPress={() =>
                navigation.navigate('AddAccount', {
                  prefill: {
                    name: item.bankName,
                    type: item.accountKind,
                    lastFour: item.lastFour ?? '',
                  },
                })
              }
            />
          </Card>
        )}
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
  content: {
    padding: spacing.screen,
    gap: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  card: {
    gap: spacing.xs,
  },
  title: {
    ...typography.headlineSm,
    fontSize: 18,
    color: colors.onSurface,
  },
  subtitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  count: {
    ...typography.labelMd,
    color: colors.primary,
    marginBottom: spacing.sm,
  },
});
