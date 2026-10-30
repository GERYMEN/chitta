import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet, Button, Chip } from '../../../shared/ui';
import { Icon } from '../../../shared/icons';
import { colors, radii, spacing, typography } from '../../../theme';
import { Category, CategoryKind } from '../../../domain/categories/category.types';
import {
  CATEGORY_COLOR_KEYS,
  CATEGORY_ICON_CHOICES,
  CATEGORY_NAME_MAX,
  CategoryColorKey,
  validateCategoryName,
} from '../../../domain/categories/category.rules';
import { CATEGORY_COLOR_SWATCHES } from '../../../shared/constants/categoryVisuals';

export interface CategoryFormValues {
  name: string;
  type: CategoryKind;
  icon: string;
  color: CategoryColorKey;
}

export interface CategoryFormSheetProps {
  visible: boolean;
  onClose: () => void;
  /** null = create; otherwise edit (type is fixed once created). */
  editing: Category | null;
  categories: ReadonlyArray<Category>;
  onSave: (values: CategoryFormValues) => Promise<void>;
  onArchive?: (category: Category) => void;
}

const TYPE_OPTIONS: Array<{ value: CategoryKind; label: string }> = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'both', label: 'Both' },
];

const NAME_ERROR: Record<'empty' | 'too-long' | 'duplicate', string> = {
  empty: 'Enter a name',
  'too-long': `Use at most ${CATEGORY_NAME_MAX} characters`,
  duplicate: 'A category with this name already exists',
};

function initialValues(editing: Category | null): CategoryFormValues {
  return {
    name: editing?.name ?? '',
    type: editing?.type ?? 'expense',
    icon: editing?.icon ?? CATEGORY_ICON_CHOICES[0],
    color: (CATEGORY_COLOR_KEYS as ReadonlyArray<string>).includes(editing?.color ?? '')
      ? (editing?.color as CategoryColorKey)
      : 'green',
  };
}

export function CategoryFormSheet({
  visible,
  onClose,
  editing,
  categories,
  onSave,
  onArchive,
}: CategoryFormSheetProps) {
  const [values, setValues] = useState<CategoryFormValues>(() => initialValues(editing));
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setValues(initialValues(editing));
      setTouched(false);
    }
  }, [visible, editing]);

  const nameError = validateCategoryName(values.name, categories, editing?.id ?? null);

  async function handleSave() {
    setTouched(true);
    if (nameError) return;
    setSaving(true);
    try {
      await onSave({ ...values, name: values.name.trim() });
    } finally {
      setSaving(false);
    }
  }

  const swatch = CATEGORY_COLOR_SWATCHES[values.color];

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>{editing ? 'Edit category' : 'New category'}</Text>

      <Text style={styles.label}>Name</Text>
      <TextInput
        value={values.name}
        onChangeText={name => setValues(v => ({ ...v, name }))}
        onBlur={() => setTouched(true)}
        placeholder="e.g. Pets"
        placeholderTextColor={colors.outline}
        maxLength={CATEGORY_NAME_MAX + 5}
        style={styles.input}
        testID="category-name-input"
      />
      {touched && nameError ? <Text style={styles.error}>{NAME_ERROR[nameError]}</Text> : null}

      {editing ? null : (
        <>
          <Text style={styles.label}>Type</Text>
          <View style={styles.row}>
            {TYPE_OPTIONS.map(option => (
              <Pressable
                key={option.value}
                onPress={() => setValues(v => ({ ...v, type: option.value }))}
                accessibilityRole="radio"
                accessibilityState={{ checked: values.type === option.value }}>
                <Chip label={option.label} tone={values.type === option.value ? 'active' : 'neutral'} />
              </Pressable>
            ))}
          </View>
        </>
      )}

      <Text style={styles.label}>Icon</Text>
      <View style={styles.grid}>
        {CATEGORY_ICON_CHOICES.map(icon => {
          const selected = values.icon === icon;
          return (
            <Pressable
              key={icon}
              onPress={() => setValues(v => ({ ...v, icon }))}
              accessibilityRole="radio"
              accessibilityLabel={icon.replace(/-/g, ' ')}
              accessibilityState={{ checked: selected }}
              style={[
                styles.iconCell,
                { backgroundColor: selected ? swatch.bg : colors.surfaceContainerLow },
                selected && { borderColor: swatch.fg },
              ]}>
              <Icon name={icon} size={22} color={selected ? swatch.fg : colors.onSurfaceVariant} />
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.label}>Colour</Text>
      <View style={styles.row}>
        {CATEGORY_COLOR_KEYS.map(key => {
          const selected = values.color === key;
          return (
            <Pressable
              key={key}
              onPress={() => setValues(v => ({ ...v, color: key }))}
              accessibilityRole="radio"
              accessibilityLabel={key}
              accessibilityState={{ checked: selected }}
              style={[styles.swatchCell, selected && styles.swatchSelected]}>
              <View style={[styles.swatch, { backgroundColor: CATEGORY_COLOR_SWATCHES[key].bg }]}>
                <View style={[styles.swatchDot, { backgroundColor: CATEGORY_COLOR_SWATCHES[key].fg }]} />
              </View>
            </Pressable>
          );
        })}
      </View>

      <Button
        label={saving ? 'Saving…' : editing ? 'Save' : 'Create category'}
        variant="brand"
        loading={saving}
        onPress={handleSave}
        style={styles.save}
        testID="category-save"
      />
      {editing && onArchive ? (
        <Button
          label="Archive category"
          variant="ghost"
          onPress={() => onArchive(editing)}
          style={styles.archive}
          testID="category-archive"
        />
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.headlineSm,
    fontSize: 18,
    color: colors.onSurface,
  },
  label: {
    ...typography.labelLg,
    color: colors.outline,
    letterSpacing: 0.5,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outlineVariant,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 48,
    ...typography.bodyLg,
    color: colors.onSurface,
  },
  error: {
    ...typography.bodyMd,
    color: colors.error,
    marginTop: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  iconCell: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchCell: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchSelected: {
    borderColor: colors.obsidian,
  },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  save: {
    marginTop: spacing.lg,
  },
  archive: {
    marginTop: spacing.sm,
  },
});
