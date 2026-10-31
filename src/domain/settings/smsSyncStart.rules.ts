import { periodRange } from '../periods/period.rules';

/**
 * R4b: where SMS sync starts.
 *
 * - 'install' = the moment setup completes (the first sync finds nothing).
 * - 'month'   = local midnight on the 1st of the current month.
 * - '3m'      = local midnight on the 1st of the month 2 months back
 *               (same calendar semantics as the '3M' period chip).
 * - 'all'     = whole inbox (start = null).
 * - 'custom'  = a date set by the upgrade path or picked in Settings.
 *
 * Only dates and mode names are ever stored or audited — never SMS content.
 */
export type SmsSyncStartMode = 'install' | 'month' | '3m' | 'all' | 'custom';

/** The 4 choices offered in onboarding and Settings ('custom' is Settings-only). */
export type SmsSyncStartChoice = Exclude<SmsSyncStartMode, 'custom'>;

export const SMS_SYNC_KEYS = {
  startMode: 'sms_sync_start_mode',
  /** ISO timestamp; stored as '' when the mode is 'all' (whole inbox). */
  startAt: 'sms_sync_start_at',
  /** ISO timestamp of the newest SMS date fully processed by a normal sync. */
  lastSyncedAt: 'sms_last_synced_at',
} as const;

export const DEFAULT_SMS_SYNC_START_CHOICE: SmsSyncStartChoice = 'install';

/** One day of overlap on incremental syncs (dedup by hash prevents doubles). */
export const INCREMENTAL_OVERLAP_MS = 24 * 60 * 60 * 1000;

/** Above this estimate a normal Sync asks before scanning. */
export const LARGE_SCAN_THRESHOLD = 500;

/** Rows per native page. */
export const SMS_PAGE_SIZE = 300;

const MODES: ReadonlySet<string> = new Set(['install', 'month', '3m', 'all', 'custom']);

export interface SmsSyncStartOption {
  mode: SmsSyncStartChoice;
  label: string;
  helper: string;
  recommended: boolean;
}

export const SMS_SYNC_START_OPTIONS: ReadonlyArray<SmsSyncStartOption> = [
  {
    mode: 'install',
    label: 'From install date',
    helper: 'Start empty — only SMS that arrive after setup are synced.',
    recommended: true,
  },
  {
    mode: 'month',
    label: 'Start of this month',
    helper: 'Bring in this month’s transactions from your SMS.',
    recommended: false,
  },
  {
    mode: '3m',
    label: 'Last 3 months',
    helper: 'This month plus the 2 months before it.',
    recommended: false,
  },
  {
    mode: 'all',
    label: 'Whole inbox',
    helper: 'Every SMS on the phone — may add many items to Pending.',
    recommended: false,
  },
];

export function parseStartMode(raw: string | null | undefined): SmsSyncStartMode | null {
  return raw != null && MODES.has(raw) ? (raw as SmsSyncStartMode) : null;
}

/** '' / missing / unparseable → null (whole inbox or not set). */
export function parseIsoOrNull(raw: string | null | undefined): string | null {
  if (raw == null || raw.trim() === '') return null;
  return Number.isFinite(Date.parse(raw)) ? raw : null;
}

/** The start timestamp a choice means at `now` (null = whole inbox). */
export function startForChoice(mode: SmsSyncStartChoice, now: Date): string | null {
  switch (mode) {
    case 'install':
      return now.toISOString();
    case 'month':
      return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).toISOString();
    case '3m':
      return periodRange('3M', now).from.toISOString();
    case 'all':
      return null;
  }
}

/** A picked calendar day → local midnight of that day. */
export function startForCustomDate(date: Date): string {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0).toISOString();
}

export interface UpgradeStartInput {
  /** MIN(sms_sync_runs.started_at) in ms, if any run was ever recorded. */
  firstRunStartedAtMs: number | null;
  /** Earliest occurredAt among SMS-sourced transactions (any status). */
  earliestSmsTransactionAt: string | null;
  now: Date;
}

/**
 * Existing install (onboarding done, keys missing): the earliest of the first
 * recorded sync run and the earliest SMS-sourced transaction; if neither
 * exists, the time of the upgrade.
 */
export function upgradeDefaultStart(input: UpgradeStartInput): string {
  const candidates: number[] = [];
  if (input.firstRunStartedAtMs != null && Number.isFinite(input.firstRunStartedAtMs)) {
    candidates.push(input.firstRunStartedAtMs);
  }
  const earliest = input.earliestSmsTransactionAt
    ? Date.parse(input.earliestSmsTransactionAt)
    : NaN;
  if (Number.isFinite(earliest)) candidates.push(earliest);
  if (candidates.length === 0) return input.now.toISOString();
  return new Date(Math.min(...candidates)).toISOString();
}

/** Earliest / newest occurredAt among SMS-sourced rows (any status). */
export function smsTransactionBounds(
  transactions: ReadonlyArray<{ sourceType: string; occurredAt: string }>,
): { earliest: string | null; newest: string | null } {
  let min = Infinity;
  let max = -Infinity;
  for (const t of transactions) {
    if (t.sourceType !== 'sms') continue;
    const at = Date.parse(t.occurredAt);
    if (!Number.isFinite(at)) continue;
    if (at < min) min = at;
    if (at > max) max = at;
  }
  return {
    earliest: Number.isFinite(min) ? new Date(min).toISOString() : null,
    newest: Number.isFinite(max) ? new Date(max).toISOString() : null,
  };
}

/** Half-open SMS date window: sinceMs <= date < beforeMs. */
export interface SyncWindow {
  sinceMs: number;
  beforeMs: number;
}

/**
 * Normal Sync window. First sync: [start, now]. Later syncs: from
 * max(start, lastSynced − 1 day) to now. Start null = whole inbox (0).
 */
export function computeSyncWindow(input: {
  startAt: string | null;
  lastSyncedAt: string | null;
  nowMs: number;
}): SyncWindow {
  const start = input.startAt ? Date.parse(input.startAt) : NaN;
  let sinceMs = Number.isFinite(start) ? start : 0;
  const last = input.lastSyncedAt ? Date.parse(input.lastSyncedAt) : NaN;
  if (Number.isFinite(last)) sinceMs = Math.max(sinceMs, last - INCREMENTAL_OVERLAP_MS);
  sinceMs = Math.max(0, sinceMs);
  // +1 so an SMS stamped exactly `now` is inside the half-open window.
  return { sinceMs, beforeMs: input.nowMs + 1 };
}

export type StartChange =
  | { kind: 'same' }
  /** Scan only [newStart, oldStart) — nothing else is re-read. */
  | { kind: 'earlier'; gap: SyncWindow }
  /** Nothing is deleted; future syncs start from the new date. */
  | { kind: 'later' };

/** null = whole inbox = the earliest possible start. */
export function classifyStartChange(oldStartAt: string | null, newStartAt: string | null): StartChange {
  const oldMs = oldStartAt ? Date.parse(oldStartAt) : 0;
  const newMs = newStartAt ? Date.parse(newStartAt) : 0;
  if (newMs === oldMs) return { kind: 'same' };
  if (newMs < oldMs) return { kind: 'earlier', gap: { sinceMs: newMs, beforeMs: oldMs } };
  return { kind: 'later' };
}

export function needsLargeScanConfirm(estimate: number): boolean {
  return estimate > LARGE_SCAN_THRESHOLD;
}

/** Normal sync advances the cursor only after the whole window was processed. */
export function nextLastSyncedAt(
  previous: string | null,
  newestSeenMs: number | null,
): string | null {
  const prev = previous ? Date.parse(previous) : NaN;
  if (newestSeenMs == null || !Number.isFinite(newestSeenMs)) return previous;
  if (Number.isFinite(prev) && prev >= newestSeenMs) return previous;
  return new Date(newestSeenMs).toISOString();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "d MMM yyyy" in local time. */
export function formatStartDate(iso: string): string {
  const date = new Date(iso);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** Settings row value: "<d MMM yyyy>" or "Whole inbox". */
export function syncStartLabel(startAt: string | null): string {
  return startAt ? formatStartDate(startAt) : 'Whole inbox';
}

export const START_MODE_LABEL: Record<SmsSyncStartMode, string> = {
  install: 'From install date',
  month: 'Start of this month',
  '3m': 'Last 3 months',
  all: 'Whole inbox',
  custom: 'Custom date',
};

/** "1,200" — plain thousands grouping for scan counts. */
export function formatCount(n: number): string {
  return String(Math.max(0, Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function largeScanMessage(estimate: number): string {
  return `About ${formatCount(estimate)} SMS to scan — this may add many items to Pending.`;
}

/** Home progress line: "Scanning 1,200 / 4,800" (counts only). */
export function scanProgressLabel(scanned: number, total: number, cancelling = false): string {
  if (cancelling) return 'Stopping…';
  if (total <= 0 && scanned <= 0) return 'Preparing scan…';
  const shownTotal = Math.max(total, scanned);
  return `Scanning ${formatCount(scanned)} / ${formatCount(shownTotal)}`;
}

/** Settings: start moved earlier → confirm the gap scan. */
export function gapConfirmTitle(newStartAt: string | null, oldStartAt: string | null): string {
  const from = newStartAt ? formatStartDate(newStartAt) : 'the beginning';
  const to = oldStartAt ? formatStartDate(oldStartAt) : 'now';
  return `Scan SMS from ${from} to ${to}?`;
}

export function gapConfirmMessage(estimate: number | null): string | undefined {
  return estimate == null ? undefined : `About ${formatCount(estimate)} SMS.`;
}

/** Settings: start moved later → nothing is deleted. */
export function laterStartMessage(newStartAt: string | null): string {
  return `Items already recorded stay; future syncs start from ${syncStartLabel(newStartAt)}.`;
}
