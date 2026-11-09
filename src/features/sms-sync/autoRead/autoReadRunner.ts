import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { activeAccounts } from '../../../domain/accounts/account.rules';
import { checkSmsPermission, checkReceiveSmsPermission } from '../../../native/android/permissions/smsPermission';
import { subscribeSmsReceived } from '../../../native/android/sms/smsAutoRead';
import { LARGE_SCAN_THRESHOLD } from '../../../domain/settings/smsSyncStart.rules';
import { currentSyncWindow, estimateWindowCount, SmsSyncResult } from '../syncSms';
import { runSmsSync, useSyncRunStore } from '../syncRunner';
import { useSmsReaderStore } from '../smsReaderStore';
import {
  autoReadSkipReason,
  AutoReadSkipReason,
  createAutoReadCoalescer,
} from './autoReadRules';

/**
 * R5 auto-read: one run of the EXISTING incremental sync (R4b window +
 * cursor + 1-day overlap, dedup by hash, R3a/R3b pair holds, the opt-in
 * auto-approve rule), started because a new SMS arrived. No UI, no dialog,
 * no permission prompt; counts-only audit ('auto_read') when it added
 * anything. Nothing here sees an SMS body — syncSms reads the inbox itself.
 */
export type AutoReadOutcome =
  | { kind: 'skipped'; reason: AutoReadSkipReason }
  | { kind: 'busy' }
  | { kind: 'done'; created: number; notUnderstood: number }
  | { kind: 'failed' };

export async function runAutoRead(): Promise<AutoReadOutcome> {
  // R5-fix C10: never during a backup restore (the coalescer retries once);
  // wait for the (single-flight) launch hydrate before reading the store.
  if (useSyncRunStore.getState().restoring) return { kind: 'busy' };
  const tx = useTransactionsStore.getState();
  if (!tx.isHydrated) await tx.hydrate();
  if (useSyncRunStore.getState().restoring) return { kind: 'busy' };
  const reader = useSmsReaderStore.getState();
  if (!reader.loaded) await reader.load();

  const state = useTransactionsStore.getState();
  const [readGranted, receiveGranted] = await Promise.all([
    checkSmsPermission().catch(() => false),
    checkReceiveSmsPermission().catch(() => false),
  ]);
  const base = {
    hasOnboarded: state.hasOnboarded,
    readGranted,
    receiveGranted,
    setting: useSmsReaderStore.getState().autoReadSetting,
    hasActiveAccounts: activeAccounts(state.accounts).length > 0,
    largeThreshold: LARGE_SCAN_THRESHOLD,
  };
  const early = autoReadSkipReason({ ...base, windowEstimate: null });
  if (early) return { kind: 'skipped', reason: early };

  const estimate = await estimateWindowCount(currentSyncWindow()).catch(() => null);
  const late = autoReadSkipReason({ ...base, windowEstimate: estimate });
  if (late) return { kind: 'skipped', reason: late };

  let result: SmsSyncResult | null;
  try {
    result = await runSmsSync({ kind: 'auto' });
  } catch {
    return { kind: 'failed' };
  }
  if (!result) return { kind: 'busy' };
  await useSmsReaderStore.getState().refreshUnparsed().catch(() => undefined);
  return { kind: 'done', created: result.created, notUnderstood: result.notUnderstood };
}

/**
 * Headless JS task (RN core HeadlessJsTaskConfig, started by the native
 * SmsAutoReadService when the app is in the background or killed). The
 * native side already waited a few seconds for the inbox write; the task
 * has a 30 s timeout there.
 */
export async function autoReadHeadlessTask(): Promise<void> {
  await runAutoRead().catch(() => undefined);
}

/**
 * Foreground: native event → coalesced run (bursts merge; a run that finds
 * Sync already running retries once).
 */
export function startForegroundAutoRead(): () => void {
  const coalescer = createAutoReadCoalescer(
    async () => (await runAutoRead()).kind !== 'busy',
    { now: Date.now, setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>) },
    // The native service already waited for the inbox write.
    { delayMs: 1500 },
  );
  const subscription = subscribeSmsReceived(() => coalescer.notify());
  return () => {
    subscription.remove();
    coalescer.cancel();
  };
}
