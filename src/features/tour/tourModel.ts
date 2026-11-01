/**
 * R4c pure first-run tour model: coach marks on the real screens after setup.
 * The overlay switches tabs as a step requires and skips a step whose target
 * is not on screen (missing target).
 */
export type TourTab = 'Home' | 'Pending' | 'Transactions' | 'Accounts';

export type TourTargetKey =
  | 'home.sync'
  | 'tab.Pending'
  | 'home.periods'
  | 'transactions.search'
  | 'accounts.balance'
  | 'feedback.button';

export interface TourStep {
  id: string;
  /** Tab to show before measuring the target; null = stay where we are. */
  tab: TourTab | null;
  targetKey: TourTargetKey;
  title: string;
  body: string;
  /** Extra spotlight padding around the target, dp. */
  pad?: number;
}

export const TOUR_STEPS: ReadonlyArray<TourStep> = [
  {
    id: 'sync',
    tab: 'Home',
    targetKey: 'home.sync',
    title: 'Sync SMS',
    body: 'Reads your bank SMS on this phone and puts each payment it finds into Pending. Nothing is saved until you approve it.',
  },
  {
    id: 'pending',
    tab: 'Pending',
    targetKey: 'tab.Pending',
    title: 'Pending',
    body: 'Detected items wait here. Approve, edit or reject each one before it counts.',
    pad: 14,
  },
  {
    id: 'periods',
    tab: 'Home',
    targetKey: 'home.periods',
    title: 'Pick a period',
    body: 'Choose a period to see your income, spending and "Where it went" for that time.',
  },
  {
    id: 'transactions',
    tab: 'Transactions',
    targetKey: 'transactions.search',
    title: 'Transactions',
    body: 'Search by merchant or note, and filter by type, account or category.',
  },
  {
    id: 'accounts',
    tab: 'Accounts',
    targetKey: 'accounts.balance',
    title: 'Accounts',
    body: 'Balances per account, worked out from the items you approved.',
  },
  {
    id: 'feedback',
    tab: null,
    targetKey: 'feedback.button',
    title: 'Send feedback',
    body: 'Found a bug or have an idea? Tap here twice.',
    pad: 10,
  },
];

export type StepOutcome = { kind: 'show' } | { kind: 'goto'; index: number } | { kind: 'finish' };

/**
 * After trying to measure step `index`: show it, or — when its target is
 * missing — skip to the next step (whose tab may mount its target), or end
 * the tour when no step is left.
 */
export function stepOutcome(index: number, total: number, targetFound: boolean): StepOutcome {
  if (targetFound) return { kind: 'show' };
  return index + 1 < total ? { kind: 'goto', index: index + 1 } : { kind: 'finish' };
}

/** Next / Done button. */
export function nextAfter(
  index: number,
  total: number,
): { kind: 'goto'; index: number } | { kind: 'finish' } {
  return index + 1 < total ? { kind: 'goto', index: index + 1 } : { kind: 'finish' };
}

export function stepCounter(index: number, total: number): string {
  return `${index + 1} / ${total}`;
}

export function isLastStep(index: number, total: number): boolean {
  return index >= total - 1;
}

// ---- trigger rules ----------------------------------------------------------

/** app_settings key, not audited. ISO = done; '' = owed (new install, not yet shown). */
export const TOUR_COMPLETED_KEY = 'tour_completed_at';
export const TOUR_OWED_VALUE = '';

export type TourKeyState = 'unset' | 'owed' | 'done';

export function tourKeyState(value: string | null): TourKeyState {
  if (value === null) return 'unset';
  return value === TOUR_OWED_VALUE ? 'owed' : 'done';
}

export type TourLaunchDecision = 'show' | 'mark_done_silently' | 'none';

/**
 * At app start:
 * - not onboarded yet (new install still in setup) → nothing; the tour is
 *   requested when setup completes.
 * - onboarded, key missing → an install from before R4c (owner's phone):
 *   set the key to now silently, never auto-show.
 * - onboarded, key owed → setup finished but the tour never ran (app closed)
 *   → show it now.
 * - done → nothing (Settings → Replay tour still works).
 */
export function decideTourOnLaunch(input: {
  hasOnboarded: boolean;
  value: string | null;
}): TourLaunchDecision {
  if (!input.hasOnboarded) return 'none';
  const state = tourKeyState(input.value);
  if (state === 'unset') return 'mark_done_silently';
  if (state === 'owed') return 'show';
  return 'none';
}

/** Setup just completed: mark owed only when the key is missing (a replay never re-owes). */
export function shouldMarkOwedAfterSetup(value: string | null): boolean {
  return tourKeyState(value) === 'unset';
}
