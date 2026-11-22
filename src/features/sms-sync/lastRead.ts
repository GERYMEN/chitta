/**
 * R5j (G9) — "Last read N days ago" Home banner rules (pure).
 *
 * `sms_last_synced_at` is the NEWEST SMS date seen (the sync cursor), not the
 * time a read ran, so a quiet inbox would look stale. A read stamps its own
 * time under `sms_last_read_at` (any completed run: Sync SMS, auto-read, gap or
 * re-scan). Installs from before this phase have no stamp yet; they fall back
 * to the cursor until the first completed read after the update.
 */
export const LAST_READ_KEY = 'sms_last_read_at';

/** Banner shows when the last successful read is more than this many days old. */
export const LAST_READ_STALE_DAYS = 3;

const DAY_MS = 86_400_000;

function parseMs(iso: string | null): number | null {
  if (iso == null) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Whole days since the last read when it is stale (> N days), else null. */
export function staleReadDays(input: {
  lastReadAt: string | null;
  lastSyncedAt: string | null;
  nowMs: number;
  thresholdDays?: number;
}): number | null {
  const threshold = input.thresholdDays ?? LAST_READ_STALE_DAYS;
  const at = parseMs(input.lastReadAt) ?? parseMs(input.lastSyncedAt);
  if (at == null) return null;
  const age = input.nowMs - at;
  if (age <= threshold * DAY_MS) return null;
  return Math.floor(age / DAY_MS);
}

export function lastReadLabel(days: number): string {
  return `Last read ${days} day${days === 1 ? '' : 's'} ago`;
}

export function lastReadBannerVisible(input: {
  loaded: boolean;
  hasOnboarded: boolean;
  hasActiveAccounts: boolean;
  syncing: boolean;
  staleDays: number | null;
}): boolean {
  return (
    input.loaded &&
    input.hasOnboarded &&
    input.hasActiveAccounts &&
    !input.syncing &&
    input.staleDays !== null
  );
}
