import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  AccessibilityActionEvent,
  AccessibilityInfo,
  Animated,
  Keyboard,
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../../shared/icons';
import { colors } from '../../../theme';
import { showSnackbar } from '../../../shared/ui';
import { navigationRef } from '../../../app/navigation/navigationRef';
import { settingsRepository } from '../../../data/repositories/settings.repository';
import {
  deleteFeedbackScreenshot,
  FeedbackScreenshot,
  getFeedbackDeviceInfo,
} from '../../../native/android/feedback/feedbackNative';
import { registerTourTarget } from '../../tour/tourTargets';
import { selectTourTargetKey, useTourStore } from '../../tour/tourStore';
import { FEEDBACK_POSITION_KEY } from '../feedback.constants';
import {
  buildFeedbackMessage,
  DEFAULT_FEEDBACK_CATEGORY,
  FEEDBACK_THANKS,
  FeedbackCategory,
  versionBadge,
} from '../feedbackMessage';
import { captureRedactedScreenshot, shareFeedback, waitForReturnToApp } from '../feedbackFlow';
import {
  BUTTON_RADIUS,
  BUTTON_SIZE,
  clampCenterY,
  DOCKED_OPACITY,
  dockedX,
  DRAG_SCALE,
  expandedX,
  IDLE_COLLAPSE_MS,
  initialWidgetState,
  isDragGesture,
  isExpandedVisual,
  isWidgetVisible,
  parsePosition,
  serializePosition,
  WidgetLayout,
  widgetReducer,
} from '../widgetMachine';
import { FeedbackSheet } from './FeedbackSheet';

const FALLBACK_LAYOUT = { width: 360, height: 760 };
/** BottomSheet slide-out time before a Retake / Add capture. */
const SHEET_CLOSE_MS = 280;

/**
 * R4c floating feedback button, mounted ONCE above the navigator (App.tsx).
 * State lives in the pure widgetReducer; motion is RN Animated (native driver
 * for transform/opacity) + PanResponder — no gesture/animation dependency.
 */
export function FeedbackWidget() {
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState(FALLBACK_LAYOUT);
  const layout: WidgetLayout = {
    width: size.width,
    height: size.height,
    insetTop: insets.top,
    insetBottom: insets.bottom,
  };
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const [state, dispatch] = useReducer(widgetReducer, layout, initialWidgetState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const [routeName, setRouteName] = useState<string | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const screenReaderRef = useRef(false);
  const tourActive = useTourStore(s => s.active);
  const tourTarget = useTourStore(selectTourTargetKey);
  const tourPointsAtWidget = tourTarget === 'feedback.button';

  // Sheet form state.
  const [category, setCategory] = useState<FeedbackCategory | null>(DEFAULT_FEEDBACK_CATEGORY);
  const [note, setNote] = useState('');
  const [screenshot, setScreenshot] = useState<FeedbackScreenshot | null>(null);
  const [sending, setSending] = useState(false);
  const recaptureDelayRef = useRef(0);

  const translateX = useRef(new Animated.Value(dockedX('right', layout))).current;
  const translateY = useRef(new Animated.Value(state.centerY - BUTTON_RADIUS)).current;
  const opacity = useRef(new Animated.Value(DOCKED_OPACITY)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const position = useRef({ x: dockedX('right', layout), y: state.centerY - BUTTON_RADIUS });
  const dragStart = useRef({ x: 0, y: 0 });
  const dragging = useRef(false);
  const containerRef = useRef<React.ComponentRef<typeof View>>(null);

  const visible = isWidgetVisible({
    routeName,
    keyboardOpen,
    mode: state.mode,
    tourActive,
    tourPointsAtWidget,
  });
  // The tour's step 6 can only point at the button while it is allowed on screen.
  const tourVisibleRef = useRef(false);
  tourVisibleRef.current = isWidgetVisible({
    routeName,
    keyboardOpen,
    mode: state.mode,
    tourActive: true,
    tourPointsAtWidget: true,
  });

  // ---- environment: route, keyboard, screen reader, saved position ----------
  useEffect(() => {
    const update = () =>
      setRouteName(navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name ?? null : null);
    update();
    const unsubscribe = navigationRef.addListener('state', update);
    const readyTimer = setTimeout(update, 300);
    return () => {
      unsubscribe();
      clearTimeout(readyTimer);
    };
  }, []);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    AccessibilityInfo.isScreenReaderEnabled()
      .then(enabled => {
        screenReaderRef.current = enabled;
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', enabled => {
      screenReaderRef.current = enabled;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let cancelled = false;
    settingsRepository
      .getValue(FEEDBACK_POSITION_KEY)
      .then(value => {
        const saved = parsePosition(value);
        if (!cancelled && saved) {
          dispatch({
            type: 'RESTORE',
            side: saved.side,
            centerY: clampCenterY(saved.centerY, layoutRef.current),
          });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep Y inside the band when the screen size / insets change.
  useEffect(() => {
    const clamped = clampCenterY(state.centerY, layout);
    if (clamped !== state.centerY && state.mode === 'DOCKED') {
      dispatch({ type: 'RESTORE', side: state.side, centerY: clamped });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height, insets.top, insets.bottom]);

  // ---- tour target: where the button is when the tour points at it --------
  const measureForTour = useCallback(
    () =>
      new Promise<{ x: number; y: number; width: number; height: number } | null>(resolve => {
        const view = containerRef.current;
        if (!view || !tourVisibleRef.current) {
          resolve(null);
          return;
        }
        view.measureInWindow((originX, originY) => {
          const current = stateRef.current;
          resolve({
            x: originX + expandedX(current.side, layoutRef.current),
            y: originY + current.centerY - BUTTON_RADIUS,
            width: BUTTON_SIZE,
            height: BUTTON_SIZE,
          });
        });
      }),
    [],
  );
  useEffect(() => registerTourTarget('feedback.button', measureForTour), [measureForTour]);

  // ---- motion ---------------------------------------------------------------
  const animateTo = useCallback(
    (x: number, y: number, toOpacity: number, toScale: number, onDone?: () => void) => {
      position.current = { x, y };
      Animated.parallel([
        Animated.spring(translateX, { toValue: x, useNativeDriver: true, friction: 7, tension: 70 }),
        Animated.spring(translateY, { toValue: y, useNativeDriver: true, friction: 7, tension: 70 }),
        Animated.timing(opacity, { toValue: toOpacity, duration: 180, useNativeDriver: true }),
        Animated.spring(scale, { toValue: toScale, useNativeDriver: true, friction: 6 }),
      ]).start(({ finished }) => {
        if (finished && onDone) onDone();
      });
    },
    [opacity, scale, translateX, translateY],
  );

  useEffect(() => {
    const top = state.centerY - BUTTON_RADIUS;
    if (tourPointsAtWidget) {
      animateTo(expandedX(state.side, layout), top, 1, 1);
      return;
    }
    switch (state.mode) {
      case 'DOCKED':
        animateTo(dockedX(state.side, layout), top, DOCKED_OPACITY, 1);
        return;
      case 'EXPANDED': {
        animateTo(expandedX(state.side, layout), top, 1, 1);
        const timer = setTimeout(() => dispatch({ type: 'IDLE_TIMEOUT' }), IDLE_COLLAPSE_MS);
        return () => clearTimeout(timer);
      }
      case 'DRAGGING':
        Animated.spring(scale, { toValue: DRAG_SCALE, useNativeDriver: true, friction: 6 }).start();
        opacity.setValue(1);
        return;
      case 'SNAPPING':
        animateTo(dockedX(state.side, layout), top, DOCKED_OPACITY, 1, () => {
          dispatch({ type: 'SNAP_DONE' });
          settingsRepository
            .setValue(
              FEEDBACK_POSITION_KEY,
              serializePosition({ side: state.side, centerY: state.centerY }),
            )
            .catch(() => undefined);
        });
        return;
      default:
        return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.mode, state.side, state.centerY, size.width, size.height, tourPointsAtWidget]);

  // ---- capture: button hidden + app redacted, then the sheet opens ---------
  useEffect(() => {
    if (state.mode !== 'CAPTURING_SCREENSHOT') return;
    let cancelled = false;
    const delayMs = recaptureDelayRef.current;
    recaptureDelayRef.current = 0;
    (async () => {
      if (delayMs > 0) await new Promise<void>(resolve => setTimeout(resolve, delayMs));
      const shot = await captureRedactedScreenshot();
      if (cancelled) return;
      setScreenshot(shot);
      dispatch({ type: 'CAPTURE_DONE' });
    })();
    return () => {
      cancelled = true;
    };
  }, [state.mode]);

  // ---- gestures -------------------------------------------------------------
  const handleTap = useCallback(() => {
    dispatch({ type: 'TAP', screenReader: screenReaderRef.current });
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => isDragGesture(g.dx, g.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        dragging.current = false;
        dragStart.current = { ...position.current };
      },
      onPanResponderMove: (_e, g) => {
        if (!dragging.current && isDragGesture(g.dx, g.dy)) {
          const mode = stateRef.current.mode;
          if (mode !== 'DOCKED' && mode !== 'EXPANDED' && mode !== 'SNAPPING') return;
          dragging.current = true;
          // Start from the fully visible spot so the button is under the finger.
          dragStart.current = {
            x: expandedX(stateRef.current.side, layoutRef.current),
            y: dragStart.current.y,
          };
          dispatch({ type: 'DRAG_START' });
        }
        if (dragging.current) {
          const x = dragStart.current.x + g.dx;
          const y = dragStart.current.y + g.dy;
          position.current = { x, y };
          translateX.setValue(x);
          translateY.setValue(y);
        }
      },
      onPanResponderRelease: (_e, g) => {
        if (dragging.current) {
          dragging.current = false;
          dispatch({
            type: 'RELEASE',
            centerX: dragStart.current.x + g.dx + BUTTON_RADIUS,
            centerY: dragStart.current.y + g.dy + BUTTON_RADIUS,
            layout: layoutRef.current,
          });
        } else {
          handleTap();
        }
      },
      onPanResponderTerminate: (_e, g) => {
        if (!dragging.current) return;
        dragging.current = false;
        dispatch({
          type: 'RELEASE',
          centerX: dragStart.current.x + g.dx + BUTTON_RADIUS,
          centerY: dragStart.current.y + g.dy + BUTTON_RADIUS,
          layout: layoutRef.current,
        });
      },
    }),
  ).current;

  const onAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === 'activate') {
        // TalkBack double-tap: always open the sheet in one step.
        dispatch({ type: 'TAP', screenReader: true });
      }
    },
    [],
  );

  // ---- sheet actions ---------------------------------------------------------
  const resetSheet = useCallback(() => {
    setCategory(DEFAULT_FEEDBACK_CATEGORY);
    setNote('');
    setScreenshot(null);
  }, []);

  const closeSheet = useCallback(() => dispatch({ type: 'SHEET_CLOSED' }), []);

  const recapture = useCallback(() => {
    recaptureDelayRef.current = SHEET_CLOSE_MS;
    if (screenshot) deleteFeedbackScreenshot(screenshot.path).catch(() => undefined);
    setScreenshot(null);
    dispatch({ type: 'RECAPTURE' });
  }, [screenshot]);

  const removeScreenshot = useCallback(() => {
    if (screenshot) deleteFeedbackScreenshot(screenshot.path).catch(() => undefined);
    setScreenshot(null);
  }, [screenshot]);

  const send = useCallback(async () => {
    const info = getFeedbackDeviceInfo();
    const text = buildFeedbackMessage({
      category: category ?? DEFAULT_FEEDBACK_CATEGORY,
      note,
      versionName: info.versionName,
      versionCode: info.versionCode,
      androidRelease: info.androidRelease,
      brand: info.brand,
      model: info.model,
      routeName,
      now: new Date(),
    });
    setSending(true);
    try {
      await shareFeedback(text, screenshot ? screenshot.path : null);
      dispatch({ type: 'SHEET_CLOSED' });
      await waitForReturnToApp();
      // The PNG stays in cache/feedback/ until the next capture or app start,
      // so WhatsApp can still read it while the chat is open.
      resetSheet();
      showSnackbar({ message: FEEDBACK_THANKS });
    } catch {
      showSnackbar({ message: 'Could not open WhatsApp — please try again.' });
    } finally {
      setSending(false);
    }
  }, [category, note, routeName, screenshot, resetSheet]);

  const info = getFeedbackDeviceInfo();
  const expandedLook = tourPointsAtWidget || isExpandedVisual(state.mode) || state.mode === 'DRAGGING';

  return (
    <View
      ref={containerRef}
      collapsable={false}
      pointerEvents="box-none"
      style={StyleSheet.absoluteFill}
      onLayout={(event: LayoutChangeEvent) => {
        const { width, height } = event.nativeEvent.layout;
        if (width > 0 && height > 0 && (width !== size.width || height !== size.height)) {
          setSize({ width, height });
        }
      }}>
      {visible ? (
        <Animated.View
          {...panResponder.panHandlers}
          accessible
          accessibilityRole="button"
          accessibilityLabel="Send feedback"
          accessibilityActions={[{ name: 'activate' }]}
          onAccessibilityAction={onAccessibilityAction}
          testID="feedback-button"
          style={[
            styles.button,
            expandedLook ? styles.buttonRaised : styles.buttonDocked,
            state.mode === 'DRAGGING' && styles.buttonDragging,
            {
              opacity,
              transform: [{ translateX }, { translateY }, { scale }],
            },
          ]}>
          <Icon name="message-alert-outline" size={24} color={colors.onObsidian} />
        </Animated.View>
      ) : null}

      <FeedbackSheet
        visible={state.mode === 'FEEDBACK_MODAL_OPEN'}
        onClose={closeSheet}
        versionLabel={versionBadge(info.versionName, info.versionCode)}
        category={category}
        onCategoryChange={setCategory}
        note={note}
        onNoteChange={setNote}
        screenshotUri={screenshot ? screenshot.uri : null}
        onRetake={recapture}
        onRemove={removeScreenshot}
        onAdd={recapture}
        onSend={send}
        sending={sending}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_RADIUS,
    backgroundColor: colors.obsidian,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    shadowColor: colors.obsidian,
  },
  buttonDocked: {
    elevation: 3,
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  buttonRaised: {
    elevation: 6,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  buttonDragging: {
    elevation: 12,
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
});
