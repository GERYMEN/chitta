import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityActionEvent,
  Animated,
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  View,
} from 'react-native';
import { colors } from '../../../theme';
import { clamp, nudge, positionToValue, valueToFraction } from './sliderMath';

/** Thumb touch target (≥48dp) — also the horizontal inset of the track. */
const THUMB_TOUCH = 48;
const THUMB_SIZE = 26;
const TRACK_HEIGHT = 6;
const INSET = THUMB_TOUCH / 2;

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  accessibilityLabel: string;
  /** Spoken value text (e.g. "95 percent"). Defaults to the number. */
  formatValue?: (value: number) => string;
  disabled?: boolean;
  testID?: string;
}

/**
 * Hand-rolled slider (core PanResponder + Animated only — the project
 * deliberately has no gesture-handler/reanimated). Tap anywhere on the track
 * to jump, or drag; the value is stepped + clamped on every move and the
 * thumb snaps to the stepped position on release.
 */
export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  accessibilityLabel,
  formatValue,
  disabled = false,
  testID,
}: SliderProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const position = useRef(new Animated.Value(0)).current;
  const dragging = useRef(false);
  const grantPosition = useRef(0);
  const lastEmitted = useRef(value);

  // PanResponder is created once; read the latest props through a ref.
  const latest = useRef({ min, max, step, onChange, trackWidth, disabled });
  latest.current = { min, max, step, onChange, trackWidth, disabled };

  useEffect(() => {
    lastEmitted.current = value;
    if (!dragging.current) {
      position.setValue(valueToFraction(value, min, max) * trackWidth);
    }
  }, [value, min, max, trackWidth, position]);

  const panResponder = useMemo(() => {
    function moveTo(pixels: number) {
      const {
        min: lo,
        max: hi,
        step: st,
        trackWidth: width,
        onChange: emit,
      } = latest.current;
      const clamped = clamp(pixels, 0, width);
      position.setValue(clamped);
      const next = positionToValue(clamped, width, lo, hi, st);
      if (next !== lastEmitted.current) {
        lastEmitted.current = next;
        emit(next);
      }
    }

    function settle() {
      dragging.current = false;
      const { min: lo, max: hi, trackWidth: width } = latest.current;
      Animated.timing(position, {
        toValue: valueToFraction(lastEmitted.current, lo, hi) * width,
        duration: 120,
        useNativeDriver: false,
      }).start();
    }

    return PanResponder.create({
      onStartShouldSetPanResponder: () => !latest.current.disabled,
      onMoveShouldSetPanResponder: () => !latest.current.disabled,
      // Keep the gesture even inside a vertical ScrollView / bottom sheet.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: event => {
        dragging.current = true;
        position.stopAnimation();
        // Children have pointerEvents="none", so locationX is relative to
        // the responder container itself.
        grantPosition.current = event.nativeEvent.locationX - INSET;
        moveTo(grantPosition.current);
      },
      onPanResponderMove: (_event, gesture) => {
        moveTo(grantPosition.current + gesture.dx);
      },
      onPanResponderRelease: settle,
      onPanResponderTerminate: settle,
    });
  }, [position]);

  function handleLayout(event: LayoutChangeEvent) {
    setTrackWidth(Math.max(0, event.nativeEvent.layout.width - INSET * 2));
  }

  function handleAccessibilityAction(event: AccessibilityActionEvent) {
    if (disabled) return;
    const direction = event.nativeEvent.actionName === 'increment' ? 1 : -1;
    const next = nudge(value, direction, min, max, step);
    if (next !== value) onChange(next);
  }

  return (
    <View
      testID={testID}
      style={[styles.container, disabled && styles.disabled]}
      onLayout={handleLayout}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      accessibilityValue={{
        min,
        max,
        now: value,
        text: formatValue ? formatValue(value) : String(value),
      }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={handleAccessibilityAction}
      {...panResponder.panHandlers}
    >
      <View style={styles.track} pointerEvents="none">
        <Animated.View style={[styles.fill, { width: position }]} />
      </View>
      <Animated.View
        pointerEvents="none"
        style={[styles.thumbTouch, { transform: [{ translateX: position }] }]}
      >
        <View style={styles.thumb} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: THUMB_TOUCH,
    paddingHorizontal: INSET,
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: colors.surfaceContainerHigh,
    overflow: 'hidden',
  },
  fill: {
    height: TRACK_HEIGHT,
    backgroundColor: colors.primary,
  },
  thumbTouch: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: THUMB_TOUCH,
    height: THUMB_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 3,
    borderColor: colors.primary,
    elevation: 2,
  },
});
