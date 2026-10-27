import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../../shared/ui';
import { colors, spacing, typography } from '../../../theme';

export interface OnboardingShellProps {
  stepIndex: number;
  stepCount: number;
  headline: string;
  subtext: string;
  ctaLabel: string;
  onNext: () => void;
  onBack?: () => void;
  onSkip: () => void;
  children: React.ReactNode;
}

/**
 * Shared shell for every tour slide (docs/reference/welcome_to_tracker,
 * dashboard_tour, ... screen.png): progress dots, skip, an illustration
 * slot, headline/subtext, and primary + back navigation.
 */
export function OnboardingShell({
  stepIndex,
  stepCount,
  headline,
  subtext,
  ctaLabel,
  onNext,
  onBack,
  onSkip,
  children,
}: OnboardingShellProps) {
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.brand}>Tracker</Text>
        <Text style={styles.skip} onPress={onSkip}>
          Skip Tour
        </Text>
      </View>

      <View style={styles.dots}>
        {Array.from({ length: stepCount }).map((_, index) => (
          <View
            key={index}
            style={[styles.dot, index === stepIndex ? styles.dotActive : styles.dotInactive]}
          />
        ))}
      </View>

      <View style={styles.illustration}>{children}</View>

      <View style={styles.copy}>
        <Text style={styles.headline}>{headline}</Text>
        <Text style={styles.subtext}>{subtext}</Text>
      </View>

      <View style={styles.footer}>
        <Button label={ctaLabel} variant="brand" onPress={onNext} />
        {onBack ? (
          <Text style={styles.back} onPress={onBack}>
            Back
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.screen,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  brand: {
    ...typography.headlineSm,
    color: colors.onSurface,
  },
  skip: {
    ...typography.labelLg,
    color: colors.outline,
  },
  dots: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginVertical: spacing.md,
  },
  dot: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  dotActive: {
    backgroundColor: colors.primaryContainer,
  },
  dotInactive: {
    backgroundColor: colors.surfaceContainerHigh,
  },
  illustration: {
    flex: 1,
    justifyContent: 'center',
  },
  copy: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  headline: {
    ...typography.headlineLgMobile,
    color: colors.onSurface,
  },
  subtext: {
    ...typography.bodyLg,
    color: colors.onSurfaceVariant,
  },
  footer: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  back: {
    ...typography.labelLg,
    color: colors.outline,
    textAlign: 'center',
  },
});
