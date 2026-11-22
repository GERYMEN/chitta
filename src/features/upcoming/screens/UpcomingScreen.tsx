import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card } from '../../../shared/ui';
import { HeaderBackButton, HeaderSpacer } from '../../../shared/ui/HeaderBackButton';
import { spacing, typography, useColors, ColorTokens } from '../../../theme';
import { useRedacted } from '../../../shared/privacy/redaction';
import { RootStackParamList } from '../../../app/navigation/routes';
import { RecurringSeries } from '../../../domain/recurring/recurring.types';
import { relativeDueLabel } from '../../../domain/recurring/recurring.rules';
import { useUpcoming } from '../useUpcoming';
import { RemindMeButton } from '../../notifications/components/RemindMeButton';
import { useRemindersStore } from '../../notifications/state/remindersStore';
import { useDismissedRecurringStore } from '../state/dismissedRecurringStore';
import { approxAmountLabel, CADENCE_LABEL, shortDateLabel } from '../upcomingLabels';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * R8a (D-f): all detected recurring payments (estimates), next due first.
 * "Not recurring" hides a false positive for this app run only.
 */
export function UpcomingScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  useRedacted();
  const navigation = useNavigation<Nav>();
  const { now, all } = useUpcoming();
  const dismiss = useDismissedRecurringStore(state => state.dismiss);
  const loadReminders = useRemindersStore(state => state.load);
  React.useEffect(() => {
    loadReminders().catch(() => undefined);
  }, [loadReminders]);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <HeaderBackButton onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle}>Upcoming</Text>
        <HeaderSpacer />
      </View>
      <ScrollView contentContainerStyle={styles.content} testID="upcoming-screen">
        <Text style={styles.note}>
          Estimated from your past payments. Amounts are approximate, not confirmed charges.
        </Text>
        {all.length === 0 ? (
          <Text style={styles.empty}>
            No repeating payments found yet. A payment shows up here after it has been paid at
            least 3 times on a regular schedule.
          </Text>
        ) : null}
        {all.map(s => (
          <SeriesRow key={s.merchantKey} series={s} now={now} onNotRecurring={() => dismiss(s.merchantKey)} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function SeriesRow({
  series,
  now,
  onNotRecurring,
}: {
  series: RecurringSeries;
  now: Date;
  onNotRecurring: () => void;
}) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const due = relativeDueLabel(series.nextDueAt, now);
  return (
    <Card style={styles.row}>
      <View style={styles.rowTop}>
        <Text style={styles.name} numberOfLines={1}>
          {series.displayName}
        </Text>
        <Text style={styles.amount}>{approxAmountLabel(series.typicalAmountMinor)}</Text>
      </View>
      <Text style={styles.meta}>
        {CADENCE_LABEL[series.cadence]} · last paid {shortDateLabel(series.lastAt)}
      </Text>
      <Text style={styles.due}>Next due {due}</Text>
      <View style={styles.actions}>
        <RemindMeButton merchantKey={series.merchantKey} displayName={series.displayName} />
        <Pressable
          onPress={onNotRecurring}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel={`Not recurring: ${series.displayName}`}>
          <Text style={styles.actionLabel}>Not recurring</Text>
        </Pressable>
      </View>
    </Card>
  );
}

const makeStyles = (c: ColorTokens) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  headerTitle: { ...typography.headlineSm, color: c.onSurface, flex: 1, textAlign: 'center' },
  content: { padding: spacing.screen, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  note: { ...typography.bodyMd, color: c.onSurfaceVariant },
  empty: { ...typography.bodyMd, color: c.outline },
  row: { gap: spacing.xs },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { ...typography.labelLg, color: c.onSurface, flex: 1 },
  amount: { ...typography.labelLg, color: c.onSurface },
  meta: { ...typography.bodyMd, color: c.onSurfaceVariant },
  due: { ...typography.labelMd, color: c.primary },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  action: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start', paddingRight: spacing.sm },
  actionLabel: { ...typography.labelLg, color: c.primary },
});
