import React, { useEffect } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { AppProviders } from './providers/AppProviders';
import { RootNavigator } from './navigation/RootNavigator';
import { useTransactionsStore } from '../features/transactions/state/transactionsStore';
import { colors } from '../theme';
import { DialogHost, SnackbarHost } from '../shared/ui';

export function App() {
  const isHydrated = useTransactionsStore(state => state.isHydrated);
  const hasOnboarded = useTransactionsStore(state => state.hasOnboarded);
  const hydrate = useTransactionsStore(state => state.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <AppProviders>
      <StatusBar barStyle="dark-content" />
      {isHydrated ? (
        <RootNavigator initialRouteName={hasOnboarded ? 'Tabs' : 'Onboarding'} />
      ) : (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}
      <SnackbarHost />
      <DialogHost />
    </AppProviders>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
});
