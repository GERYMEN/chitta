import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Icon } from '../../../shared/icons';
import { colors, spacing, typography } from '../../../theme';
import { ReviewSections } from '../components/ReviewSections';

/**
 * R3b: opened from the Home "N to review" card — possible transfers and
 * possible duplicates in one list (the same sections Pending shows on top).
 */
export function ReviewScreen() {
  const navigation = useNavigation();
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        {/* 48dp touch target (B2 lesson). */}
        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Back">
          <Icon name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>To review</Text>
        <View style={styles.back} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <ReviewSections emptyText="Nothing to review — all caught up." />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  back: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    ...typography.headlineSm,
    fontSize: 16,
    color: colors.onSurface,
  },
  content: {
    padding: spacing.screen,
    paddingTop: 0,
    paddingBottom: spacing.xl * 2,
  },
});
