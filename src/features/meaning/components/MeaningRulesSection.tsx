import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { confirmDialog, showSnackbar } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { spacing, typography, useColors, ColorTokens } from '../../../theme';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { useRedacted } from '../../../shared/privacy/redaction';
import { meaningRuleLabel } from '../meaningLabels';

/**
 * R5e T3 — Settings → "Automatic money rules": one line per stored meaning
 * rule (bank · kind · ••last4 → account) with Remove (confirm → audited
 * 'meaning_rule_removed'). Rows already recorded keep what they are.
 */
export function MeaningRulesSection() {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const rules = useTransactionsStore(state => state.meaningRules);
  const accounts = useTransactionsStore(state => state.accounts);
  useRedacted(); // R4c: last-4 masked in the feedback screenshot
  const [busy, setBusy] = useState(false);

  async function remove(ruleId: string, label: string) {
    const ok = await confirmDialog({
      title: 'Remove this automatic rule?',
      message: `${label}\n\nItems already recorded stay as they are. Next time Tracker asks again.`,
      confirmLabel: 'Remove',
      destructive: true,
      icon: 'playlist-remove',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await useTransactionsStore.getState().removeMeaningRule(ruleId);
      showSnackbar({ message: 'Automatic rule removed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.section} testID="settings-meaning-rules">
      <View style={styles.headerRow}>
        <View style={styles.icon}>
          <Icon name="swap-horizontal" size={20} color={c.onSurfaceVariant} />
        </View>
        <View style={styles.text}>
          <Text style={styles.title}>Automatic money rules</Text>
          <Text style={styles.caption}>
            {rules.length === 0
              ? 'None yet — confirm a card bill, cash withdrawal or wallet top-up with "Do this automatically next time"'
              : `${rules.length} rule${rules.length === 1 ? '' : 's'} · matching SMS become transfers`}
          </Text>
        </View>
      </View>
      {rules.map(rule => {
        const label = meaningRuleLabel(rule, accounts);
        return (
          <View key={rule.id} style={styles.ruleRow} testID="settings-meaning-rule">
            <Text style={styles.ruleLabel}>{label}</Text>
            <Pressable
              onPress={() => remove(rule.id, label)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Remove automatic rule: ${label}`}
              testID="settings-meaning-rule-remove"
              style={({ pressed }) => [styles.remove, pressed && styles.pressed]}>
              <Text style={styles.removeText}>Remove</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = (c: ColorTokens) => StyleSheet.create({
  section: {
    gap: spacing.xs,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: c.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
  },
  title: {
    ...typography.bodyLg,
    color: c.onSurface,
  },
  caption: {
    ...typography.bodyMd,
    color: c.outline,
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: 36 + spacing.md,
  },
  ruleLabel: {
    ...typography.bodyMd,
    color: c.onSurface,
    flex: 1,
  },
  remove: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: {
    ...typography.labelLg,
    color: c.error,
  },
  pressed: {
    opacity: 0.6,
  },
});
