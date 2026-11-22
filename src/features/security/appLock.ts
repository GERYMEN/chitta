import { AppLockTimeout } from './securitySettings';

const MINUTE_MS = 60_000;

/**
 * R9b: the pure lock decision.
 * - disabled: never locked.
 * - cold launch: locked.
 * - never backgrounded (no timestamp): not locked.
 * - 'immediate': locked after any background.
 * - '1' / '5': locked once the time away is >= that many minutes. A clock that
 *   went backwards (now < backgroundedAt) fails safe and locks.
 */
export function shouldLock(
  enabled: boolean,
  timeout: AppLockTimeout,
  backgroundedAtMs: number | null,
  nowMs: number,
  coldLaunch: boolean,
): boolean {
  if (!enabled) return false;
  if (coldLaunch) return true;
  if (backgroundedAtMs === null) return false;
  if (timeout === 'immediate') return true;
  const elapsed = nowMs - backgroundedAtMs;
  if (elapsed < 0) return true;
  const minutes = timeout === '1' ? 1 : timeout === '5' ? 5 : 0;
  return elapsed >= minutes * MINUTE_MS;
}
