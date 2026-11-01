import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../../shared/ui';
import { colors, spacing, typography } from '../../../theme';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { SyncStartOptions } from '../../sms-sync/components/SyncStartOptions';
import {
  DEFAULT_SMS_SYNC_START_CHOICE,
  SmsSyncStartChoice,
  startForChoice,
} from '../../../domain/settings/smsSyncStart.rules';
import { requestTourAfterSetup } from '../../tour/tourStore';

/**
 * R4b: save the onboarding choice (audited 'settings_changed', dates/mode
 * only), then finish onboarding. 'install' = the moment setup completes.
 */
export async function saveOnboardingSyncStart(
  choice: SmsSyncStartChoice,
  now: Date = new Date(),
): Promise<void> {
  const store = useTransactionsStore.getState();
  await store.setSmsSyncStart(choice, startForChoice(choice, now));
  await store.completeOnboarding();
  // R4c: a new install owes the first-run tour; it starts on the main tabs.
  await requestTourAfterSetup().catch(() => undefined);
}

/** R4b onboarding step after Permissions: "Where should SMS sync start?" */
export function SyncStartScreen() {
  const navigation = useNavigation();
  const [choice, setChoice] = useState<SmsSyncStartChoice>(DEFAULT_SMS_SYNC_START_CHOICE);
  const [saving, setSaving] = useState(false);

  async function handleContinue() {
    setSaving(true);
    try {
      await saveOnboardingSyncStart(choice);
      navigation.reset({ index: 0, routes: [{ name: 'Tabs' as never }] });
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.stepRow}>
          <Text style={styles.stepLabel}>STEP 9 OF 9 · SMS SYNC</Text>
        </View>
        <Text style={styles.headline} accessibilityRole="header">
          Where should SMS sync start?
        </Text>
        <Text style={styles.subtext}>
          Tracker only reads SMS from this point on. You can change it later in Settings.
        </Text>
        <SyncStartOptions
          value={choice}
          onChange={mode => {
            if (mode !== 'custom') setChoice(mode);
          }}
        />
      </ScrollView>
      <View style={styles.footer}>
        <Button
          label="Continue"
          variant="primary"
          onPress={handleContinue}
          loading={saving}
          disabled={saving}
          testID="sync-start-continue"
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
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  stepRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stepLabel: {
    ...typography.labelMd,
    color: colors.primary,
  },
  headline: {
    ...typography.headlineLgMobile,
    color: colors.onSurface,
  },
  subtext: {
    ...typography.bodyLg,
    color: colors.onSurfaceVariant,
  },
  footer: {
    padding: spacing.screen,
  },
});
