import { useEffect, useRef } from 'react';
import { useIsFocused } from '@react-navigation/native';

/** B3: true only for an unfocused → focused transition. */
export function regainedFocus(wasFocused: boolean, isFocused: boolean): boolean {
  return !wasFocused && isFocused;
}

/**
 * Fixes B3: runs `onRegain` only when the screen gains focus after having
 * been unfocused (e.g. back from Transaction detail) — never on mount, a
 * re-render, a store refresh, a data reload or a repeated focus event while
 * the screen is already focused.
 */
export function useOnFocusRegained(onRegain: () => void): void {
  const isFocused = useIsFocused();
  const wasFocused = useRef(isFocused);
  const callback = useRef(onRegain);
  useEffect(() => {
    callback.current = onRegain;
  }, [onRegain]);
  useEffect(() => {
    if (regainedFocus(wasFocused.current, isFocused)) callback.current();
    wasFocused.current = isFocused;
  }, [isFocused]);
}
