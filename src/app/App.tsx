import React, { useEffect } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { AppProviders } from './providers/AppProviders';
import { RootNavigator } from './navigation/RootNavigator';
import { useTransactionsStore } from '../features/transactions/state/transactionsStore';
import { colors } from '../theme';
import { DialogHost, SnackbarHost } from '../shared/ui';
import { FeedbackWidget } from '../features/feedback/components/FeedbackWidget';
import { TourOverlay } from '../features/tour/components/TourOverlay';
import { initTourOnLaunch } from '../features/tour/tourStore';
import { clearFeedbackScreenshots } from '../native/android/feedback/feedbackNative';

export function App() {
  const isHydrated = useTransactionsStore(state => state.isHydrated);
  const hasOnboarded = useTransactionsStore(state => state.hasOnboarded);
  const hydrate = useTransactionsStore(state => state.hydrate);

  useEffect(() => {
    // R4c: delete any feedback screenshot left from a previous run.
    clearFeedbackScreenshots();
    hydrate().then(() =>
      // R4c: upgrade installs are marked toured silently; an owed tour is requested.
      initTourOnLaunch(useTransactionsStore.getState().hasOnboarded).catch(() => undefined),
    );
  }, [hydrate]);

  return (
    <AppProviders>
      <StatusBar barStyle="dark-content" />
      {isHydrated ? (
        <>
          <RootNavigator initialRouteName={hasOnboarded ? 'Tabs' : 'Onboarding'} />
          {/* R4c: one floating feedback button + the first-run tour, above every screen. */}
          <FeedbackWidget />
          <TourOverlay />
        </>
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
