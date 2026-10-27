import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TransactionDetailActions, TransactionDetailContent } from '../components/TransactionDetailContent';
import { Icon } from '../../../shared/icons';
import { showDialog } from '../../../shared/ui';
import { colors, spacing, typography } from '../../../theme';
import { useTransactionsStore } from '../state/transactionsStore';
import { RootStackParamList } from '../../../app/navigation/routes';

type DetailRoute = RouteProp<RootStackParamList, 'TransactionDetail'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

export function TransactionDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<DetailRoute>();
  const transaction = useTransactionsStore(state =>
    state.transactions.find(t => t.id === route.params.transactionId),
  );
  const approve = useTransactionsStore(state => state.approve);
  const reject = useTransactionsStore(state => state.reject);
  const deleteTransaction = useTransactionsStore(state => state.deleteTransaction);

  function handleDelete(transactionId: string) {
    showDialog({
      title: 'Delete transaction?',
      message: 'This will permanently remove the record.',
      icon: 'trash-can-outline',
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        {
          label: 'Delete',
          variant: 'destructive',
          onPress: async () => {
            await deleteTransaction(transactionId);
            navigation.goBack();
          },
        },
      ],
    });
  }

  if (!transaction) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingText}>Transaction not found.</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Icon name="arrow-left" size={22} color={colors.onSurface} onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle}>Transaction</Text>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <TransactionDetailContent
          transaction={transaction}
          variant="screen"
          hideActions
          onApprove={t => {
            approve(t.id);
            navigation.goBack();
          }}
          onReject={t => {
            reject(t.id);
            navigation.goBack();
          }}
          onEdit={t => navigation.navigate('EditTransaction', { transactionId: t.id })}
          onDelete={t => handleDelete(t.id)}
        />
      </ScrollView>
      <View style={styles.footer}>
        <TransactionDetailActions
          transaction={transaction}
          onApprove={t => {
            approve(t.id);
            navigation.goBack();
          }}
          onReject={t => {
            reject(t.id);
            navigation.goBack();
          }}
          onEdit={t => navigation.navigate('EditTransaction', { transactionId: t.id })}
          onDelete={t => handleDelete(t.id)}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  content: {
    padding: spacing.screen,
    paddingBottom: spacing.xl * 2,
  },
  footer: {
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.xl,
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
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  missingText: {
    ...typography.bodyLg,
    color: colors.outline,
  },
});
