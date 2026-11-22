import React, { useEffect, useMemo, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet, Button, Card, Chip, showSnackbar } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, radii, spacing, typography } from '../../../theme';
import { Transaction } from '../../../domain/transactions/transaction.types';
import { autoTagsFor, normalizeTagName, validateTagName } from '../../../domain/tags/tag.rules';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { receiptUri } from '../../../native/android/receipts/receiptNative';
import { attachReceipt, removeReceiptWithUndo } from '../receiptActions';
import { redactText, useRedacted } from '../../../shared/privacy/redaction';
import { Tag } from '../../../domain/tags/tag.types';

const EMPTY_IDS: string[] = [];

/**
 * R11 (D-c): Tags + Receipt on the transaction detail screen.
 * Tags: derived auto chips (muted, not removable) + the user's custom chips
 * (tap x to remove, 5 s Undo) + "Add tag" (pick one or type a new name).
 * Receipt: thumbnail (tap = full view) or "Attach receipt" (system photo
 * picker). A receipt whose file is missing (restore on a new phone) shows a
 * plain note and the attach button.
 */
export function TagsReceiptCard({ transaction }: { transaction: Transaction }) {
  useRedacted();
  const allTags = useTransactionsStore(state => state.tags);
  const linkIds = useTransactionsStore(state => state.tagLinks[transaction.id]) ?? EMPTY_IDS;
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [uri, setUri] = useState<string | null | undefined>(undefined);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const autoTags = autoTagsFor(transaction);
  const attached = useMemo(
    () => linkIds.flatMap(id => allTags.filter(t => t.id === id)),
    [linkIds, allTags],
  );
  const suggestions = useMemo(
    () => allTags.filter(t => !linkIds.includes(t.id)),
    [allTags, linkIds],
  );

  const receiptPath = transaction.receiptPath ?? null;
  useEffect(() => {
    let cancelled = false;
    if (receiptPath === null) {
      setUri(null);
      return;
    }
    setUri(undefined);
    receiptUri(receiptPath).then(value => {
      if (!cancelled) setUri(value);
    });
    return () => {
      cancelled = true;
    };
  }, [receiptPath]);

  async function addTag(name: string) {
    const valid = validateTagName(name);
    if (valid === null) {
      showSnackbar({ message: 'Enter a tag name (up to 30 characters)' });
      return;
    }
    await useTransactionsStore.getState().addTagToTransaction(transaction.id, valid);
    setDraft('');
    setAddOpen(false);
  }

  async function removeTag(tag: Tag) {
    await useTransactionsStore.getState().removeTagFromTransaction(transaction.id, tag.id);
    showSnackbar({
      message: 'Tag removed',
      actionLabel: 'Undo',
      onAction: async () => {
        await useTransactionsStore.getState().addTagToTransaction(transaction.id, tag.name);
      },
    });
  }

  async function onAttach() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await attachReceipt(transaction.id);
      if (result === 'unavailable') showSnackbar({ message: 'Receipts are not available here' });
      else if (result === 'failed') showSnackbar({ message: 'Could not save that image' });
    } finally {
      setBusy(false);
    }
  }

  const draftName = normalizeTagName(draft);

  return (
    <>
      <Card style={styles.card} testID="detail-tags-card">
        <Text style={styles.title}>Tags</Text>
        <View style={styles.chipRow}>
          {autoTags.map(tag => (
            <View key={tag} testID={`auto-tag-${tag}`}>
              <Chip label={tag} tone="neutral" />
            </View>
          ))}
          {attached.map(tag => (
            <Pressable
              key={tag.id}
              onPress={() => removeTag(tag)}
              accessibilityRole="button"
              accessibilityLabel={`Tag ${tag.name}. Remove`}
              testID={`custom-tag-${tag.nameKey}`}>
              <Chip
                label={`#${redactText(tag.name)}  ✕`}
                tone="active"
              />
            </Pressable>
          ))}
          <Pressable
            onPress={() => setAddOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Add tag"
            testID="detail-add-tag">
            <Chip
              label="Add tag"
              tone="neutral"
              icon={<Icon name="plus" size={14} color={colors.onSurfaceVariant} />}
            />
          </Pressable>
        </View>

        <Text style={[styles.title, styles.receiptTitle]}>Receipt</Text>
        {receiptPath === null ? (
          <Button
            label="Attach receipt"
            variant="ghost"
            onPress={onAttach}
            loading={busy}
            testID="detail-attach-receipt"
          />
        ) : uri === undefined ? null : uri === null ? (
          <View testID="receipt-missing">
            <Text style={styles.note}>
              The receipt file is not on this phone (receipt images are not part of backups).
            </Text>
            <View style={styles.actions}>
              <Button label="Attach again" variant="ghost" onPress={onAttach} loading={busy} />
              <Button
                label="Clear"
                variant="ghost"
                onPress={() => removeReceiptWithUndo(transaction.id, receiptPath)}
              />
            </View>
          </View>
        ) : (
          <View>
            <Pressable
              onPress={() => setViewerOpen(true)}
              accessibilityRole="imagebutton"
              accessibilityLabel="Receipt. Tap to view full size"
              testID="receipt-thumbnail">
              <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
            </Pressable>
            <View style={styles.actions}>
              <Button label="Replace" variant="ghost" onPress={onAttach} loading={busy} />
              <Button
                label="Remove receipt"
                variant="destructive"
                onPress={() => removeReceiptWithUndo(transaction.id, receiptPath)}
                testID="detail-remove-receipt"
              />
            </View>
          </View>
        )}
      </Card>

      <BottomSheet visible={addOpen} onClose={() => setAddOpen(false)}>
        <Text style={styles.sheetTitle}>Add tag</Text>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="New tag name"
          placeholderTextColor={colors.outline}
          maxLength={32}
          autoCapitalize="none"
          style={styles.input}
          testID="add-tag-input"
        />
        <Button
          label={draftName ? `Add #${draftName}` : 'Add'}
          onPress={() => addTag(draft)}
          disabled={draftName === ''}
          testID="add-tag-confirm"
        />
        {suggestions.length > 0 ? <Text style={styles.sheetHeading}>Your tags</Text> : null}
        <View style={styles.chipRow}>
          {suggestions.map(tag => (
            <Pressable key={tag.id} onPress={() => addTag(tag.name)} accessibilityRole="button">
              <Chip label={`#${redactText(tag.name)}`} tone="neutral" />
            </Pressable>
          ))}
        </View>
      </BottomSheet>

      <Modal visible={viewerOpen} transparent animationType="fade" onRequestClose={() => setViewerOpen(false)}>
        <Pressable style={styles.viewer} onPress={() => setViewerOpen(false)} testID="receipt-viewer">
          {uri ? <Image source={{ uri }} style={styles.full} resizeMode="contain" /> : null}
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  title: { ...typography.labelMd, color: colors.onSurfaceVariant },
  receiptTitle: { marginTop: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center' },
  note: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  thumb: { width: 120, height: 120, borderRadius: radii.md, backgroundColor: colors.surfaceContainerLowest },
  sheetTitle: { ...typography.headlineSm, color: colors.onSurface, marginBottom: spacing.sm },
  sheetHeading: { ...typography.labelMd, color: colors.onSurfaceVariant, marginVertical: spacing.sm },
  input: {
    ...typography.bodyMd,
    color: colors.onSurface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outlineVariant,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  full: { width: '100%', height: '100%' },
});
