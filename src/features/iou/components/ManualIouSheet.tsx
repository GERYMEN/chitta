import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet, Button, Chip, showSnackbar } from '../../../shared/ui';
import { colors, radii, spacing, typography } from '../../../theme';
import { IouDirection } from '../../../domain/iou/iou.types';
import { useIouStore } from '../state/iouStore';
import { parseRupeesToMinor, SPLIT_ERROR_TEXT } from '../iouLabels';

/**
 * R10 (D-e) manual entry: "You owe someone" (borrowed, the default) or "Someone
 * owes you" (lent without an expense). Person is free text; amount > 0.
 */
export function ManualIouSheet({
  visible,
  onClose,
  initialPersonName = '',
}: {
  visible: boolean;
  onClose: () => void;
  initialPersonName?: string;
}) {
  const people = useIouStore(state => state.people);
  const addManual = useIouStore(state => state.addManual);
  const [direction, setDirection] = useState<IouDirection>('borrowed');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setDirection('borrowed');
      setName(initialPersonName);
      setAmount('');
      setNote('');
      setError(null);
    }
  }, [visible, initialPersonName]);

  async function onSave() {
    const amountMinor = parseRupeesToMinor(amount);
    if (amountMinor == null) {
      setError(SPLIT_ERROR_TEXT['amount-not-whole']);
      return;
    }
    const failure = await addManual({ direction, personId: null, newName: name, amountMinor, note });
    if (failure) {
      setError(SPLIT_ERROR_TEXT[failure]);
      return;
    }
    onClose();
    showSnackbar({ message: direction === 'borrowed' ? 'Noted: you owe' : 'Noted: they owe you' });
  }

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>Add an IOU</Text>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {(['borrowed', 'lent'] as const).map(d => (
          <Pressable
            key={d}
            onPress={() => setDirection(d)}
            accessibilityRole="radio"
            accessibilityState={{ selected: direction === d }}
            accessibilityLabel={d === 'borrowed' ? 'You owe someone' : 'Someone owes you'}
            style={styles.chipTouch}
            testID={`iou-direction-${d}`}>
            <Chip label={d === 'borrowed' ? 'You owe someone' : 'Someone owes you'} tone={direction === d ? 'active' : 'neutral'} />
          </Pressable>
        ))}
      </View>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={v => {
          setName(v);
          setError(null);
        }}
        placeholder="Person's name"
        placeholderTextColor={colors.outline}
        accessibilityLabel="Person name"
        testID="iou-manual-name"
      />
      {people.length > 0 ? (
        <View style={styles.chips}>
          {people.slice(0, 12).map(p => (
            <Pressable
              key={p.id}
              onPress={() => setName(p.name)}
              accessibilityRole="button"
              accessibilityLabel={`Use ${p.name}`}
              style={styles.chipTouch}>
              <Chip label={p.name} />
            </Pressable>
          ))}
        </View>
      ) : null}
      <TextInput
        style={styles.input}
        value={amount}
        onChangeText={v => {
          setAmount(v);
          setError(null);
        }}
        placeholder="₹ amount"
        placeholderTextColor={colors.outline}
        keyboardType="decimal-pad"
        accessibilityLabel="Amount in rupees"
        testID="iou-manual-amount"
      />
      <TextInput
        style={styles.input}
        value={note}
        onChangeText={setNote}
        placeholder="Note (optional)"
        placeholderTextColor={colors.outline}
        accessibilityLabel="Note"
        testID="iou-manual-note"
      />
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite" testID="iou-manual-error">
          {error}
        </Text>
      ) : null}
      <Button label="Save" variant="brand" onPress={onSave} testID="iou-manual-save" style={styles.save} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.headlineSm, fontSize: 18, color: colors.onSurface, marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  chipTouch: { minHeight: 48, justifyContent: 'center' },
  input: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outlineVariant,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    marginBottom: spacing.sm,
    ...typography.bodyLg,
    color: colors.onSurface,
  },
  error: { ...typography.bodyMd, color: colors.error },
  save: { marginTop: spacing.sm },
});
