import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { HeaderBackButton, HeaderSpacer } from '../../../shared/ui';
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
        <HeaderBackButton onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle}>To review</Text>
        <HeaderSpacer />
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
