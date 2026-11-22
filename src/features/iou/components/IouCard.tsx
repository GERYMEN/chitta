import React, { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Icon } from '../../../shared/icons';
import { colors, radii, spacing, typography } from '../../../theme';
import { useRedacted } from '../../../shared/privacy/redaction';
import { hasUnsettled, totals } from '../../../domain/iou/iou.rules';
import { useIouStore } from '../state/iouStore';
import { youGetLabel, youOweLabel } from '../iouLabels';

/**
 * R10 (D-g): Home IOU tile — "You get ₹X / You owe ₹Y" (unsettled lent /
 * borrowed). Hidden until there is at least one unsettled share. Amounts use
 * the redaction-aware formatter (Private mode masks them). Tap -> People.
 */
export function IouCard({ onPress }: { onPress: () => void }) {
  useRedacted();
  const shares = useIouStore(state => state.shares);
  const refresh = useIouStore(state => state.refresh);

  useFocusEffect(
    useCallback(() => {
      refresh().catch(() => undefined);
    }, [refresh]),
  );

  const sums = useMemo(() => totals(shares), [shares]);
  if (!hasUnsettled(shares)) return null;

  const get = youGetLabel(sums.youGetMinor);
  const owe = youOweLabel(sums.youOweMinor);
  return (
    <Pressable
      onPress={onPress}
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={`IOUs: ${get}, ${owe}`}
      testID="home-iou-card">
      <View style={styles.headerRow}>
        <Icon name="account-cash-outline" size={20} color={colors.primary} />
        <Text style={styles.title}>IOUs</Text>
        <Icon name="chevron-right" size={22} color={colors.outline} />
      </View>
      <View style={styles.amountRow}>
        <Text style={styles.get} testID="home-iou-get">
          {get}
        </Text>
        <Text style={styles.owe} testID="home-iou-owe">
          {owe}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
    minHeight: 48,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.labelLg, color: colors.onSurface, flex: 1 },
  amountRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  get: { ...typography.bodyLg, color: colors.primary },
  owe: { ...typography.bodyLg, color: colors.onSurface },
});
