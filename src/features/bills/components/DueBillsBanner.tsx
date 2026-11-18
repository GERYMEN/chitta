import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Icon } from '../../../shared/icons';
import { colors, radii, spacing, typography } from '../../../theme';
import { useBillsStore } from '../state/billsStore';
import { dueBannerModel } from '../../../domain/bills/bill.rules';
import { formatRupeesFromMinor } from '../../../shared/utils/currency';
import { useNow } from '../../../shared/hooks/useNow';
import { useRedacted } from '../../../shared/privacy/redaction';

const MASKED = '₹ ••••';

/**
 * R5b (D-g): in-app Home banner (NO notification permission). Shows when any
 * bill is overdue or due soon: "N bills due — ₹X, next <date>". Overdue tints
 * it red. Hidden when nothing qualifies. The amount follows the Home privacy
 * (feedback-screenshot) redaction.
 */
export function DueBillsBanner({ onPress }: { onPress: () => void }) {
  const bills = useBillsStore(state => state.bills);
  const refresh = useBillsStore(state => state.refresh);
  const redacted = useRedacted();
  const now = useNow(bills.length);

  useFocusEffect(
    useCallback(() => {
      refresh().catch(() => undefined);
    }, [refresh]),
  );

  const model = dueBannerModel(bills, now);
  if (!model) return null;

  const amount = redacted ? MASKED : formatRupeesFromMinor(model.totalMinor);
  const next = model.nextDueDate
    ? new Date(model.nextDueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : null;

  return (
    <Pressable
      onPress={onPress}
      style={[styles.banner, model.hasOverdue ? styles.overdue : styles.dueSoon]}
      accessibilityRole="button"
      accessibilityLabel={`${model.count} bills due, ${amount}${next ? `, next ${next}` : ''}`}
      testID="home-bills-banner">
      <Icon
        name="file-document-alert-outline"
        size={20}
        color={model.hasOverdue ? '#B91C1C' : colors.primary}
      />
      <View style={styles.textWrap}>
        <Text style={[styles.title, model.hasOverdue && styles.overdueText]}>
          {`${model.count} bill${model.count === 1 ? '' : 's'} due — ${amount}`}
        </Text>
        {next ? <Text style={styles.subtitle}>{`Next ${next}`}</Text> : null}
      </View>
      <Icon name="chevron-right" size={22} color={colors.outline} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radii.md,
    padding: spacing.md,
    minHeight: 48,
  },
  dueSoon: { backgroundColor: colors.surfaceContainerLow },
  overdue: { backgroundColor: '#FEE2E2' },
  textWrap: { flex: 1 },
  title: { ...typography.labelLg, color: colors.onSurface },
  overdueText: { color: '#B91C1C' },
  subtitle: { ...typography.bodyMd, color: colors.outline },
});
