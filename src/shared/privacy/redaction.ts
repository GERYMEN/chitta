import { create } from 'zustand';

/**
 * R4c: one global "redacted" flag for the feedback screenshot. While it is on,
 * the shared display helpers mask private values:
 * - money: formatRupeesFromMinor / AmountText → REDACTED_AMOUNT
 * - merchant / payee names, notes, SMS descriptions, original SMS, the user's
 *   name → REDACTED_TEXT (via redactText)
 * - account last-4 → REDACTED_LAST4 (via redactLast4 / accountDisplayLabel)
 *
 * Components that render such values subscribe with useRedacted() so they
 * re-render the moment the flag flips (before the capture frame is drawn).
 * The flag is in memory only — never persisted.
 */
export const REDACTED_AMOUNT = '₹ ••••';
export const REDACTED_TEXT = '••••••';
export const REDACTED_LAST4 = '••••';

interface RedactionState {
  redacted: boolean;
}

export const useRedactionStore = create<RedactionState>(() => ({ redacted: false }));

export function setRedacted(redacted: boolean): void {
  if (useRedactionStore.getState().redacted !== redacted) {
    useRedactionStore.setState({ redacted });
  }
}

export function isRedacted(): boolean {
  return useRedactionStore.getState().redacted;
}

/** Subscribe a component to the flag (re-renders when it flips). */
export function useRedacted(): boolean {
  return useRedactionStore(state => state.redacted);
}

/** Private free text (merchant, payee, note, SMS text, user name). Empty stays empty. */
export function redactText<T extends string | null | undefined>(text: T): T {
  if (text && isRedacted()) return REDACTED_TEXT as T;
  return text;
}

/** Account last-4 digits. */
export function redactLast4(lastFour: string): string {
  return isRedacted() ? REDACTED_LAST4 : lastFour;
}
