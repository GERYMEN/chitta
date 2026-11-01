import { AppState, AppStateStatus, Linking } from 'react-native';
import { setRedacted } from '../../shared/privacy/redaction';
import {
  captureScreen,
  FeedbackScreenshot,
  shareChooser,
  shareToPackage,
} from '../../native/android/feedback/feedbackNative';
import { FEEDBACK_WHATSAPP_JID } from './feedback.constants';
import { shareFallbackChain, waMeUrl } from './feedbackMessage';

/** Two animation frames + a short settle, so the redacted UI is on screen. */
export function waitForRedactedFrame(settleMs: number = 120): Promise<void> {
  return new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, settleMs)));
  });
}

export interface CaptureDeps {
  capture: () => Promise<FeedbackScreenshot>;
  waitForFrame: () => Promise<void>;
}

/**
 * R4c: switch the app into REDACTED mode, wait for that frame, capture the
 * window, then ALWAYS restore. The caller hides the button first (the widget
 * renders nothing while CAPTURING_SCREENSHOT). Resolves null on failure — the
 * sheet then opens without a screenshot. Never logs the image or its path.
 */
export async function captureRedactedScreenshot(
  deps: CaptureDeps = { capture: captureScreen, waitForFrame: () => waitForRedactedFrame() },
): Promise<FeedbackScreenshot | null> {
  setRedacted(true);
  try {
    await deps.waitForFrame();
    return await deps.capture();
  } catch {
    return null;
  } finally {
    setRedacted(false);
  }
}

export interface ShareDeps {
  shareToPackage: typeof shareToPackage;
  shareChooser: typeof shareChooser;
  openUrl: (url: string) => Promise<unknown>;
}

const defaultShareDeps: ShareDeps = {
  shareToPackage,
  shareChooser,
  openUrl: url => Linking.openURL(url),
};

export type ShareOutcome = 'com.whatsapp' | 'com.whatsapp.w4b' | 'chooser' | 'waMe';

/**
 * Walk the fallback chain: WhatsApp → WhatsApp Business → wa.me text link
 * (no screenshot) or the system chooser (with screenshot).
 */
export async function shareFeedback(
  text: string,
  screenshotPath: string | null,
  deps: ShareDeps = defaultShareDeps,
): Promise<ShareOutcome> {
  for (const step of shareFallbackChain(screenshotPath !== null)) {
    if (step.kind === 'package') {
      const result = await deps.shareToPackage(
        step.packageName,
        FEEDBACK_WHATSAPP_JID,
        text,
        screenshotPath,
      );
      if (result === 'sent') return step.packageName as ShareOutcome;
    } else if (step.kind === 'chooser') {
      await deps.shareChooser(text, screenshotPath);
      return 'chooser';
    } else {
      await deps.openUrl(waMeUrl(text));
      return 'waMe';
    }
  }
  /* istanbul ignore next — the chain always ends in chooser / wa.me */
  return 'waMe';
}

/**
 * Resolves when the app is back in front after the share (it went to the
 * background and became active again), or after `fallbackMs` if it never
 * left the foreground.
 */
export function waitForReturnToApp(fallbackMs: number = 1500): Promise<void> {
  return new Promise(resolve => {
    let left = AppState.currentState !== 'active';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      subscription.remove();
      resolve();
    };
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next !== 'active') {
        left = true;
        clearTimeout(timer);
      } else if (left) {
        finish();
      }
    });
    const timer = setTimeout(() => {
      if (!left) finish();
    }, fallbackMs);
  });
}
