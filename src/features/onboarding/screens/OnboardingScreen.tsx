import React, { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { OnboardingShell } from '../components/OnboardingShell';
import { TourIllustration } from '../components/TourIllustration';
import { TOUR_STEPS } from '../models/tourSteps';
import { RootStackParamList } from '../../../app/navigation/routes';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function OnboardingScreen() {
  const navigation = useNavigation<Nav>();
  const [index, setIndex] = useState(0);
  const step = TOUR_STEPS[index];
  const isLast = index === TOUR_STEPS.length - 1;

  // Tour (finished or skipped) -> ProfileSetup -> Permissions -> Tabs.
  function goToProfileSetup() {
    navigation.replace('ProfileSetup');
  }

  return (
    <OnboardingShell
      stepIndex={index}
      stepCount={TOUR_STEPS.length}
      headline={step.headline}
      subtext={step.subtext}
      ctaLabel={step.ctaLabel}
      onNext={() => (isLast ? goToProfileSetup() : setIndex(i => i + 1))}
      onBack={index > 0 ? () => setIndex(i => i - 1) : undefined}
      onSkip={goToProfileSetup}>
      <TourIllustration stepId={step.id} />
    </OnboardingShell>
  );
}
