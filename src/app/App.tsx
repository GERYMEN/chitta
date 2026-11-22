import React, { useMemo, useEffect, useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { AppProviders } from './providers/AppProviders';
import { RootNavigator } from './navigation/RootNavigator';
import { useTransactionsStore } from '../features/transactions/state/transactionsStore';
import { useColors, useTheme, ThemeProvider, ColorTokens } from '../theme';
import { initThemeOnLaunch } from '../theme/themeMode';
import { DialogHost, SnackbarHost } from '../shared/ui';
import { FeedbackWidget } from '../features/feedback/components/FeedbackWidget';
import { TourOverlay } from '../features/tour/components/TourOverlay';
import { initTourOnLaunch } from '../features/tour/tourStore';
import { clearFeedbackScreenshots } from '../native/android/feedback/feedbackNative';
import { useSmsReaderStore } from '../features/sms-sync/smsReaderStore';
import { startForegroundAutoRead } from '../features/sms-sync/autoRead/autoReadRunner';
import { initSecurityOnLaunch } from '../features/security/securitySettings';
import { AppLockGate } from '../features/security/components/AppLockGate';
import { startNotificationReconciler } from '../features/notifications/reconcile';
import { useChainSuggestions } from '../features/sms-sync/rules/chaining';

/** R12: the theme provider sits above everything that reads colours (incl. the nav container). */
export function App() {
  return (
    <ThemeProvider>
      <AppRoot />
    </ThemeProvider>
  );
}

function AppRoot() {
  const c = useColors();
  const { mode } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const isHydrated = useTransactionsStore(state => state.isHydrated);
  const hasOnboarded = useTransactionsStore(state => state.hasOnboarded);
  const hydrate = useTransactionsStore(state => state.hydrate);
  // R9a: no screen is drawn until Hide amounts / secure screen are applied.
  const [securityReady, setSecurityReady] = useState(false);

  useEffect(() => {
    // R4c: delete any feedback screenshot left from a previous run.
    clearFeedbackScreenshots();
    // R5-fix C10: a headless auto-read may already have hydrated (or be
    // hydrating — hydrate is single-flight); never reload under a running sync.
    const ready = useTransactionsStore.getState().isHydrated ? Promise.resolve() : hydrate();
    // R9a: apply saved Hide amounts + secure screen as soon as the DB is open.
    ready
      // R12: the saved theme is applied before the first screen is drawn (no light flash).
      .then(() => Promise.all([initSecurityOnLaunch(), initThemeOnLaunch()]))
      .catch(() => undefined)
      .then(() => setSecurityReady(true));
    ready.then(() => {
      // R5: auto-read setting + grant (mirrored to the native receiver flag),
      // reader version, "not understood" rows. Never blocks the app.
      useSmsReaderStore.getState().load().catch(() => undefined);
      // R5i (G3): bring persisted chain suggestions back into memory on launch.
      useChainSuggestions.getState().refresh().catch(() => undefined);
      // R4c: upgrade installs are marked toured silently; an owed tour is requested.
      return initTourOnLaunch(useTransactionsStore.getState().hasOnboarded).catch(() => undefined);
    });
  }, [hydrate]);

  // R5: a new SMS arrived while the app is in front → coalesced incremental sync.
  useEffect(() => startForegroundAutoRead(), []);

  // R8b: keep the scheduled notifications in step with bills / transactions / settings
  // (launch, foreground, after a sync, Private mode flip). Opt-in; a no-op while all are off.
  useEffect(() => startNotificationReconciler(), []);

  return (
    <AppProviders>
      {/* R9b: opaque lock overlay above everything while the app lock is engaged. */}
      <AppLockGate ready={isHydrated && securityReady}>
        <StatusBar barStyle={mode === 'dark' ? 'light-content' : 'dark-content'} />
        {isHydrated && securityReady ? (
          <>
            <RootNavigator initialRouteName={hasOnboarded ? 'Tabs' : 'Onboarding'} />
            {/* R4c: one floating feedback button + the first-run tour, above every screen. */}
            <FeedbackWidget />
            <TourOverlay />
          </>
        ) : (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={c.primary} />
          </View>
        )}
        <SnackbarHost />
        <DialogHost />
      </AppLockGate>
    </AppProviders>
  );
}

const makeStyles = (c: ColorTokens) => StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.surface,
  },
});
