import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, spacing, typography } from '../../../theme';
import { shadows } from '../../../theme/shadows';
import { navigationRef } from '../../../app/navigation/navigationRef';
import { useTourStore } from '../tourStore';
import {
  isLastStep,
  nextAfter,
  stepCounter,
  stepOutcome,
  TOUR_STEPS,
  TourTab,
} from '../tourModel';
import {
  holeFrame,
  placeTooltip,
  Rect,
  scrollDeltaToReveal,
  spotlightRect,
  SPOTLIGHT_PAD,
  SPOTLIGHT_RADIUS,
  toLocal,
} from '../tourLayout';
import { getTourScroller, measureTourTarget, measureViewInWindow } from '../tourTargets';

const MAIN_TABS: ReadonlySet<string> = new Set(['Home', 'Pending', 'Transactions', 'Accounts']);
/** Bottom tab bar height above the bottom inset (approx., dp). */
const TAB_BAR = 64;
const ESTIMATED_TOOLTIP_HEIGHT = 200;

function wait(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

function currentRouteName(): string | null {
  return navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name ?? null : null;
}

function showTab(tab: TourTab) {
  if (!navigationRef.isReady()) return;
  if (currentRouteName() === tab) return;
  navigationRef.navigate('Tabs', { screen: tab } as never);
}

/**
 * R4c first-run coach marks, mounted once above the navigator (App.tsx).
 * Dims everything except the target's rounded rectangle, blocks every touch
 * outside the tooltip (the highlighted control is never activated), switches
 * tabs and scrolls Home as steps need, and skips a step whose target is
 * missing.
 */
export function TourOverlay() {
  const active = useTourStore(s => s.active);
  const index = useTourStore(s => s.index);
  const requested = useTourStore(s => s.requested);
  const insets = useSafeAreaInsets();
  const rootRef = useRef<React.ComponentRef<typeof View>>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const [spot, setSpot] = useState<Rect | null>(null);
  const [tooltipHeight, setTooltipHeight] = useState(ESTIMATED_TOOLTIP_HEIGHT);
  const [routeName, setRouteName] = useState<string | null>(null);

  useEffect(() => {
    const update = () => setRouteName(currentRouteName());
    update();
    const unsubscribe = navigationRef.addListener('state', update);
    return unsubscribe;
  }, []);

  // Start once requested and the main tabs are on screen (after setup, an
  // owed launch, or Replay tour from Settings).
  useEffect(() => {
    if (!requested || active || !routeName || !MAIN_TABS.has(routeName)) return;
    const timer = setTimeout(() => useTourStore.getState().start(), 700);
    return () => clearTimeout(timer);
  }, [requested, active, routeName]);

  // Resolve the current step: switch tab, measure, scroll into view, place.
  useEffect(() => {
    if (!active) {
      setSpot(null);
      return;
    }
    let cancelled = false;
    const step = TOUR_STEPS[index];
    setSpot(null);
    (async () => {
      if (!step) return;
      if (step.tab) showTab(step.tab);
      await wait(step.tab ? 450 : 300);
      if (cancelled) return;
      const origin = (await measureViewInWindow(rootRef.current)) ?? { x: 0, y: 0 };
      let rect = await measureTourTarget(step.targetKey);
      const height = sizeRef.current?.height ?? 0;
      if (rect && step.tab && height > 0) {
        const band = {
          top: insets.top + spacing.sm,
          bottom: height - insets.bottom - TAB_BAR - spacing.sm,
        };
        const dy = scrollDeltaToReveal(toLocal(rect, origin), band);
        const scroller = getTourScroller(step.tab);
        if (dy !== 0 && scroller) {
          scroller.scrollBy(dy);
          await wait(400);
          if (cancelled) return;
          rect = await measureTourTarget(step.targetKey);
        }
      }
      if (cancelled) return;
      const outcome = stepOutcome(index, TOUR_STEPS.length, rect !== null);
      if (outcome.kind === 'goto') {
        useTourStore.getState().goTo(outcome.index);
        return;
      }
      if (outcome.kind === 'finish') {
        useTourStore.getState().finish();
        return;
      }
      setSpot(toLocal(rect as Rect, origin));
      AccessibilityInfo.announceForAccessibility(
        `${step.title}. ${step.body} Step ${index + 1} of ${TOUR_STEPS.length}.`,
      );
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, index]);

  if (!active) return null;

  const step = TOUR_STEPS[index];
  const screen = size ?? { width: 0, height: 0 };
  const spotlight = spot && size ? spotlightRect(spot, screen, step?.pad ?? SPOTLIGHT_PAD) : null;
  const frame = spotlight ? holeFrame(spotlight, screen, SPOTLIGHT_RADIUS) : null;
  const tooltip = spotlight
    ? placeTooltip({
        spot: spotlight,
        tooltipHeight,
        screen,
        insets: { top: insets.top, bottom: insets.bottom },
      })
    : null;
  const last = isLastStep(index, TOUR_STEPS.length);

  function handleNext() {
    const outcome = nextAfter(index, TOUR_STEPS.length);
    if (outcome.kind === 'goto') useTourStore.getState().goTo(outcome.index);
    else useTourStore.getState().finish();
  }

  return (
    <View
      ref={rootRef}
      collapsable={false}
      style={StyleSheet.absoluteFill}
      // Swallow every touch outside the tooltip: taps outside do nothing and
      // the highlighted control is not activated by the tour.
      onStartShouldSetResponder={() => true}
      onLayout={event => {
        const { width, height } = event.nativeEvent.layout;
        setSize({ width, height });
      }}
      testID="tour-overlay">
      {frame && spotlight ? (
        <>
          <View
            pointerEvents="none"
            style={[
              styles.hole,
              {
                left: frame.left,
                top: frame.top,
                width: frame.width,
                height: frame.height,
                borderWidth: frame.borderWidth,
                borderRadius: frame.borderRadius,
              },
            ]}
          />
          <View
            pointerEvents="none"
            style={[
              styles.ring,
              {
                left: spotlight.x,
                top: spotlight.y,
                width: spotlight.width,
                height: spotlight.height,
                borderRadius: Math.min(SPOTLIGHT_RADIUS, spotlight.width / 2, spotlight.height / 2),
              },
            ]}
          />
        </>
      ) : (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dim]} />
      )}

      {tooltip && step ? (
        <View
          style={[
            styles.tooltip,
            shadows.level2,
            { top: tooltip.top, left: tooltip.left, width: tooltip.width },
          ]}
          onLayout={event => {
            const h = Math.ceil(event.nativeEvent.layout.height);
            if (h > 0 && h !== tooltipHeight) setTooltipHeight(h);
          }}
          accessibilityLiveRegion="polite"
          testID="tour-tooltip">
          <View style={styles.tooltipHeader}>
            <Text style={styles.title} accessibilityRole="header">
              {step.title}
            </Text>
            <Text style={styles.counter} testID="tour-counter">
              {stepCounter(index, TOUR_STEPS.length)}
            </Text>
          </View>
          <Text style={styles.body}>{step.body}</Text>
          <View style={styles.actions}>
            <Pressable
              onPress={() => useTourStore.getState().finish()}
              accessibilityRole="button"
              accessibilityLabel="Skip tour"
              testID="tour-skip"
              style={({ pressed }) => [styles.skip, pressed && styles.pressed]}>
              <Text style={styles.skipText}>Skip</Text>
            </Pressable>
            <Pressable
              onPress={handleNext}
              accessibilityRole="button"
              accessibilityLabel={last ? 'Done' : 'Next'}
              testID="tour-next"
              style={({ pressed }) => [styles.next, pressed && styles.pressed]}>
              <Text style={styles.nextText}>{last ? 'Done' : 'Next'}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dim: {
    backgroundColor: colors.scrim,
  },
  hole: {
    position: 'absolute',
    borderColor: colors.scrim,
  },
  ring: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: colors.primaryContainer,
  },
  tooltip: {
    position: 'absolute',
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  tooltipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {
    ...typography.headlineSm,
    color: colors.onSurface,
    flex: 1,
  },
  counter: {
    ...typography.labelMd,
    color: colors.outline,
  },
  body: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  skip: {
    minHeight: 48,
    minWidth: 72,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipText: {
    ...typography.labelLg,
    color: colors.onSurfaceVariant,
  },
  next: {
    minHeight: 48,
    minWidth: 96,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.full,
    backgroundColor: colors.obsidian,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextText: {
    ...typography.labelLg,
    color: colors.onObsidian,
  },
  pressed: {
    opacity: 0.8,
  },
});
