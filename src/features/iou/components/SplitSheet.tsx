import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet, Button, Chip, showSnackbar } from '../../../shared/ui';
import { radii, spacing, typography, useColors, ColorTokens } from '../../../theme';
import { Transaction } from '../../../domain/transactions/transaction.types';
import { splitTotalForExpense } from '../../../domain/iou/iou.rules';
import { SplitShareInput } from '../../../domain/iou/iou.types';
import { formatRupeesFromMinor } from '../../../shared/utils/currency';
import { useRedacted } from '../../../shared/privacy/redaction';
import { useIouStore } from '../state/iouStore';
import { parseRupeesToMinor, SPLIT_ERROR_TEXT } from '../iouLabels';

interface Row {
  name: string;
  amount: string;
}

const EMPTY_ROW: Row = { name: '', amount: '' };

/**
 * R10 (D-c) "Split" sheet for an APPROVED expense: one or more shares, each a
 * free-text person (an existing person is reused by name; tap a chip to pick
 * one) and an amount. Validation: every amount > 0 and the shares add up to at
 * most the expense. Your spend is not changed — this only notes who owes you.
 */
export function SplitSheet({
  visible,
  onClose,
  expense,
}: {
  visible: boolean;
  onClose: () => void;
  expense: Transaction;
}) {
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  useRedacted();
  const people = useIouStore(state => state.people);
  const shares = useIouStore(state => state.shares);
  const splitExpense = useIouStore(state => state.splitExpense);
  const [rows, setRows] = useState<Row[]>([{ ...EMPTY_ROW }]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setRows([{ ...EMPTY_ROW }]);
      setError(null);
    }
  }, [visible]);

  const alreadyMinor = useMemo(() => splitTotalForExpense(shares, expense.id).minor, [shares, expense.id]);
  const leftMinor = Math.max(0, expense.amountMinor - alreadyMinor);

  function patchRow(index: number, patch: Partial<Row>) {
    setRows(current => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setError(null);
  }

  async function onSave() {
    const inputs: SplitShareInput[] = [];
    for (const row of rows) {
      const amountMinor = parseRupeesToMinor(row.amount);
      inputs.push({ personId: null, newName: row.name, amountMinor: amountMinor ?? Number.NaN });
    }
    if (inputs.some(i => Number.isNaN(i.amountMinor))) {
      setError(SPLIT_ERROR_TEXT['amount-not-whole']);
      return;
    }
    const failure = await splitExpense(expense, inputs);
    if (failure) {
      setError(SPLIT_ERROR_TEXT[failure]);
      return;
    }
    onClose();
    showSnackbar({ message: `Split saved · ${inputs.length} ${inputs.length === 1 ? 'person' : 'people'}` });
  }

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>Split this expense</Text>
      <Text style={styles.body}>
        Note who owes you. Your spend stays {formatRupeesFromMinor(expense.amountMinor)}; up to{' '}
        {formatRupeesFromMinor(leftMinor)} can be split.
      </Text>
      <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
        {rows.map((row, index) => (
          <View key={index} style={styles.row}>
            <TextInput
              style={[styles.input, styles.nameInput]}
              value={row.name}
              onChangeText={name => patchRow(index, { name })}
              placeholder="Person's name"
              placeholderTextColor={c.outline}
              accessibilityLabel={`Person ${index + 1} name`}
              testID={`split-name-${index}`}
            />
            <TextInput
              style={[styles.input, styles.amountInput]}
              value={row.amount}
              onChangeText={amount => patchRow(index, { amount })}
              placeholder="₹ amount"
              placeholderTextColor={c.outline}
              keyboardType="decimal-pad"
              accessibilityLabel={`Person ${index + 1} amount in rupees`}
              testID={`split-amount-${index}`}
            />
          </View>
        ))}
        {people.length > 0 ? (
          <View style={styles.chips} accessibilityRole="radiogroup">
            {people.slice(0, 12).map(person => (
              <Pressable
                key={person.id}
                onPress={() => {
                  const target = rows.findIndex(r => r.name.trim() === '');
                  patchRow(target === -1 ? rows.length - 1 : target, { name: person.name });
                }}
                accessibilityRole="button"
                accessibilityLabel={`Use ${person.name}`}
                style={styles.chipTouch}>
                <Chip label={person.name} />
              </Pressable>
            ))}
          </View>
        ) : null}
        <Button
          label="Add another person"
          variant="ghost"
          onPress={() => setRows(current => [...current, { ...EMPTY_ROW }])}
          testID="split-add-person"
        />
        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite" testID="split-error">
            {error}
          </Text>
        ) : null}
        <Button label="Save split" variant="brand" onPress={onSave} testID="split-save" style={styles.save} />
      </ScrollView>
    </BottomSheet>
  );
}

const makeStyles = (c: ColorTokens) => StyleSheet.create({
  title: { ...typography.headlineSm, fontSize: 18, color: c.onSurface },
  body: { ...typography.bodyMd, color: c.outline, marginBottom: spacing.sm },
  scroll: { maxHeight: 420 },
  row: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  input: {
    backgroundColor: c.surfaceContainerLowest,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.outlineVariant,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    ...typography.bodyLg,
    color: c.onSurface,
  },
  nameInput: { flex: 2 },
  amountInput: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  chipTouch: { minHeight: 48, justifyContent: 'center' },
  error: { ...typography.bodyMd, color: c.error, marginTop: spacing.sm },
  save: { marginTop: spacing.sm },
});
