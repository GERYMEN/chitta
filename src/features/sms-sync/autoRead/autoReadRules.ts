/**
 * R5 auto-read (RECEIVE_SMS) — pure rules, unit-tested without timers or
 * native code.
 *
 * Setting `sms_auto_read`: 'on' | 'off' | missing. Missing = "default ON once
 * granted": new installs grant RECEIVE_SMS at the permissions step and read
 * automatically; existing installs (the owner's phone) have no grant after
 * the update, so the toggle shows OFF with "Turn on" until they grant it.
 */
export type AutoReadSetting = 'on' | 'off' | null;

export const AUTO_READ_SETTING_KEY = 'sms_auto_read';

export function parseAutoReadSetting(raw: string | null | undefined): AutoReadSetting {
  return raw === 'on' || raw === 'off' ? raw : null;
}

/** Whether new SMS are read automatically right now. */
export function effectiveAutoRead(setting: AutoReadSetting, receiveGranted: boolean): boolean {
  return receiveGranted && setting !== 'off';
}

export type AutoReadSkipReason =
  | 'not_onboarded'
  | 'no_permission'
  | 'turned_off'
  | 'no_accounts'
  | 'large_window';

export interface AutoReadConditions {
  hasOnboarded: boolean;
  readGranted: boolean;
  receiveGranted: boolean;
  setting: AutoReadSetting;
  hasActiveAccounts: boolean;
  /** SMS in the normal sync window (COUNT only); null = not known yet. */
  windowEstimate: number | null;
  /** Above this a run needs the user (manual Sync asks first). */
  largeThreshold: number;
}

/**
 * Why an auto-read run must NOT happen (null = go). A run never shows a
 * dialog or a permission prompt, so anything that would need the user is a
 * skip: a big window (first sync of a whole inbox) is left to manual Sync.
 */
export function autoReadSkipReason(c: AutoReadConditions): AutoReadSkipReason | null {
  if (!c.hasOnboarded) return 'not_onboarded';
  if (!c.readGranted || !c.receiveGranted) return 'no_permission';
  if (!effectiveAutoRead(c.setting, c.receiveGranted)) return 'turned_off';
  if (!c.hasActiveAccounts) return 'no_accounts';
  if (c.windowEstimate != null && c.windowEstimate > c.largeThreshold) return 'large_window';
  return null;
}

/** Inbox write lands after the SMS_RECEIVED broadcast: wait a moment. */
export const AUTO_READ_DELAY_MS = 4000;
/** A burst never postpones the run by more than this. */
export const AUTO_READ_MAX_WAIT_MS = 15000;
/** When the single-flight guard says "busy", try once more after this. */
export const AUTO_READ_RETRY_MS = 5000;

export interface TimerApi {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

/**
 * Debounce SMS arrivals into one run: each arrival restarts the delay, but
 * the first arrival of a burst guarantees a run within AUTO_READ_MAX_WAIT_MS.
 * `run` resolves false when another scan held the single-flight guard; the
 * coalescer then retries once (the running scan may have started before the
 * newest SMS landed).
 */
export function createAutoReadCoalescer(
  run: () => Promise<boolean>,
  timers: TimerApi,
  options: { delayMs?: number; maxWaitMs?: number; retryMs?: number } = {},
) {
  const delayMs = options.delayMs ?? AUTO_READ_DELAY_MS;
  const maxWaitMs = options.maxWaitMs ?? AUTO_READ_MAX_WAIT_MS;
  const retryMs = options.retryMs ?? AUTO_READ_RETRY_MS;
  let handle: unknown = null;
  let burstStartedAt: number | null = null;
  let retried = false;

  const fire = async () => {
    handle = null;
    burstStartedAt = null;
    const ran = await run().catch(() => true);
    if (!ran && !retried) {
      retried = true;
      handle = timers.setTimeout(() => {
        fire();
      }, retryMs);
      return;
    }
    retried = false;
  };

  return {
    /** An SMS arrived. */
    notify(): void {
      const now = timers.now();
      if (burstStartedAt == null) burstStartedAt = now;
      if (handle != null) timers.clearTimeout(handle);
      const waited = now - burstStartedAt;
      const wait = Math.max(0, Math.min(delayMs, maxWaitMs - waited));
      retried = false;
      handle = timers.setTimeout(() => {
        fire();
      }, wait);
    },
    /** True while a run is scheduled (tests). */
    pending(): boolean {
      return handle != null;
    },
    cancel(): void {
      if (handle != null) timers.clearTimeout(handle);
      handle = null;
      burstStartedAt = null;
    },
  };
}
