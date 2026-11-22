import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { HeaderBackButton, HeaderSpacer } from '../../../shared/ui/HeaderBackButton';
import { radii, spacing, typography, useColors, ColorTokens } from '../../../theme';
import { RootStackParamList } from '../../../app/navigation/routes';
import { redactText, useRedacted } from '../../../shared/privacy/redaction';
import { useNow } from '../../../shared/hooks/useNow';
import { activeShares, personNet, totals } from '../../../domain/iou/iou.rules';
import { useIouStore } from '../state/iouStore';
import { netLabel, youGetLabel, youOweLabel } from '../iouLabels';
import { ManualIouSheet } from '../components/ManualIouSheet';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * R10 (D-f): People & IOUs. One row per person who has an active share
 * (unsettled, or settled within 30 days), with their NET (unsettled lent minus
 * unsettled borrowed). Tap -> that person's shares. Names are the user's own
 * free text and are masked in Private mode.
 */
export function PeopleScreen() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const navigation = useNavigation<Nav>();
  useRedacted();
  const people = useIouStore(state => state.people);
  const shares = useIouStore(state => state.shares);
  const refresh = useIouStore(state => state.refresh);
  const now = useNow(shares.length);
  const [adding, setAdding] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refresh().catch(() => undefined);
    }, [refresh]),
  );

  const rows = useMemo(() => {
    const active = activeShares(shares, now);
    return people
      .map(person => {
        const mine = shares.filter(s => s.personId === person.id);
        return {
          person,
          visible: active.some(s => s.personId === person.id),
          net: personNet(mine),
        };
      })
      .filter(r => r.visible);
  }, [people, shares, now]);
  const sums = useMemo(() => totals(shares), [shares]);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <HeaderBackButton onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle}>People & IOUs</Text>
        <HeaderSpacer />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.summary} testID="people-summary">
          <Text style={styles.get}>{youGetLabel(sums.youGetMinor)}</Text>
          <Text style={styles.owe}>{youOweLabel(sums.youOweMinor)}</Text>
        </View>
        <Button
          label="Add an IOU"
          variant="brand"
          onPress={() => setAdding(true)}
          icon={<Icon name="plus" size={18} color={c.onObsidian} />}
          testID="people-add"
        />
        {rows.length === 0 ? (
          <Text style={styles.empty} testID="people-empty">
            No IOUs yet. Split an expense from its detail, or add one here.
          </Text>
        ) : null}
        {rows.map(({ person, net }) => (
          <Pressable
            key={person.id}
            onPress={() => navigation.navigate('PersonIous', { personId: person.id })}
            accessibilityRole="button"
            accessibilityLabel={`${redactText(person.name)}, ${netLabel(net)}`}
            testID="people-row"
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <View style={styles.rowText}>
              <Text style={styles.name} numberOfLines={1}>
                {redactText(person.name)}
              </Text>
              <Text style={[styles.net, net > 0 && styles.netGet]}>{netLabel(net)}</Text>
            </View>
            <Icon name="chevron-right" size={22} color={c.outline} />
          </Pressable>
        ))}
      </ScrollView>
      <ManualIouSheet visible={adding} onClose={() => setAdding(false)} />
    </SafeAreaView>
  );
}

const makeStyles = (c: ColorTokens) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  headerTitle: { ...typography.headlineSm, color: c.onSurface, flex: 1, textAlign: 'center' },
  content: { padding: spacing.screen, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  summary: { flexDirection: 'row', justifyContent: 'space-between' },
  get: { ...typography.bodyLg, color: c.primary },
  owe: { ...typography.bodyLg, color: c.onSurface },
  empty: { ...typography.bodyMd, color: c.onSurfaceVariant },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.surfaceContainerLow,
    borderRadius: radii.md,
    padding: spacing.md,
    minHeight: 56,
  },
  pressed: { opacity: 0.6 },
  rowText: { flex: 1 },
  name: { ...typography.bodyLg, color: c.onSurface },
  net: { ...typography.bodyMd, color: c.outline },
  netGet: { color: c.primary },
});
