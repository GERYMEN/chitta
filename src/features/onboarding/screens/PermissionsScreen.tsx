import React, { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, Chip } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, radii, spacing, typography } from '../../../theme';
import { requestSmsPermission } from '../../../native/android/permissions/smsPermission';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';

interface PermissionRow {
  icon: string;
  title: string;
  badge: string;
  badgeTone: 'required' | 'recommended';
  description: string;
  locked?: boolean;
}

const PERMISSION_ROWS: PermissionRow[] = [
  {
    icon: 'message-text-outline',
    title: 'Read Transaction SMS',
    badge: 'Required',
    badgeTone: 'required',
    description:
      'Detects debits, credits, and UPI transfers in real-time from verified financial institution sender IDs. Personal messages are strictly excluded.',
    locked: true,
  },
  {
    icon: 'bell-ring-outline',
    title: 'Instant Approval Alerts',
    badge: 'Recommended',
    badgeTone: 'recommended',
    description:
      'Promptly notifies you when a new transaction is detected so you can approve, edit, or reject it with a single tap.',
  },
];

const PRIVACY_POINTS = [
  {
    title: 'Zero OTP or Personal Text Access',
    body: 'Tracker strictly filters for registered bank headers; personal contacts and 2FA OTP codes are discarded instantly.',
  },
  {
    title: 'Local Phone Memory Execution',
    body: 'Data parsers run strictly in memory on your hardware. Your raw SMS bodies are never uploaded to remote servers.',
  },
  {
    title: 'You Always Have The Final Say',
    body: 'Detected expenses stay in review queues and never enter your permanent ledger without your clear verification — unless you opt in to auto-approve.',
  },
  {
    title: 'Revoke Permissions Anytime',
    body: 'Toggle detection on or off inside Settings at any time, or purge tracked records with zero residual sync.',
  },
];

export function PermissionsScreen() {
  const navigation = useNavigation();
  const [instantAlerts, setInstantAlerts] = useState(true);

  function enterAppManual() {
    useTransactionsStore.getState().completeOnboarding();
    navigation.reset({ index: 0, routes: [{ name: 'Tabs' as never }] });
  }

  async function enterApp() {
    // Request the real READ_SMS permission, but navigate regardless of the
    // result so a denial never blocks onboarding (user can grant it later via
    // the Sync SMS button's request-on-demand flow).
    try {
      await requestSmsPermission();
    } catch {
      // Ignore request failures — onboarding still proceeds.
    }
    await useTransactionsStore.getState().completeOnboarding();
    navigation.reset({ index: 0, routes: [{ name: 'Tabs' as never }] });
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.stepRow}>
          <Text style={styles.stepLabel}>STEP 8 OF 8 · PERMISSIONS</Text>
          <Text style={styles.stepPercent}>100% Completed</Text>
        </View>

        <Text style={styles.headline}>Enable transaction detection.</Text>
        <Text style={styles.subtext}>
          Tracker automatically detects income and expenses from bank and UPI notifications so
          you never have to enter transactions manually.
        </Text>

        {PERMISSION_ROWS.map(row => (
          <Card key={row.title} style={styles.permissionCard}>
            <View style={styles.permissionTopRow}>
              <View style={styles.permissionIcon}>
                <Icon name={row.icon} size={20} color={colors.primary} />
              </View>
              <View style={styles.permissionText}>
                <Text style={styles.permissionTitle}>{row.title}</Text>
              </View>
              <Chip
                label={row.badge}
                tone={row.badgeTone === 'required' ? 'active' : 'neutral'}
              />
              <Switch
                value={row.locked ? true : instantAlerts}
                onValueChange={row.locked ? undefined : setInstantAlerts}
                disabled={row.locked}
                trackColor={{ true: colors.primary, false: colors.surfaceContainerHigh }}
                thumbColor={colors.surfaceContainerLowest}
              />
            </View>
            <Text style={styles.permissionBody}>{row.description}</Text>
          </Card>
        ))}

        <View style={styles.privacyBlock}>
          <View style={styles.privacyHeaderRow}>
            <Icon name="shield-check-outline" size={22} color={colors.primary} />
            <Text style={styles.privacyHeading}>100% On-Device Privacy</Text>
          </View>

          {PRIVACY_POINTS.map(point => (
            <View key={point.title} style={styles.privacyRow}>
              <Icon name="check-circle-outline" size={18} color={colors.primary} />
              <View style={styles.privacyTextWrap}>
                <Text style={styles.privacyTitle}>{point.title}</Text>
                <Text style={styles.privacyBody}>{point.body}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button label="Enable &amp; Continue to Home" variant="primary" onPress={enterApp} />
        <Text style={styles.manualLink} onPress={enterAppManual}>
          Enter transactions manually instead
        </Text>
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
  stepPercent: {
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
  permissionCard: {
    gap: spacing.sm,
  },
  permissionTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  permissionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionText: {
    flex: 1,
  },
  permissionTitle: {
    ...typography.headlineSm,
    fontSize: 15,
    color: colors.onSurface,
  },
  permissionBody: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  privacyBlock: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.md,
  },
  privacyHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  privacyHeading: {
    ...typography.headlineSm,
    fontSize: 16,
    color: colors.onSurface,
  },
  privacyRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  privacyTextWrap: {
    flex: 1,
  },
  privacyTitle: {
    ...typography.labelLg,
    color: colors.onSurface,
  },
  privacyBody: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  footer: {
    padding: spacing.screen,
    gap: spacing.sm,
  },
  manualLink: {
    ...typography.labelLg,
    color: colors.outline,
    textAlign: 'center',
  },
});
