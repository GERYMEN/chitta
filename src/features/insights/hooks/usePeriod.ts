import { useMemo } from 'react';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { useNow } from '../../../shared/hooks/useNow';
import { Period, PeriodRange } from '../../../domain/periods/period.types';
import { periodRange } from '../../../domain/periods/period.rules';
import {
  earliestApprovedAt,
  pendingInRangeCount,
} from '../../../domain/insights/insights.rules';

export interface SelectedPeriod {
  period: Period;
  setPeriod: (period: Period) => void;
  /** The screen's injected now (device clock; see useNow). */
  now: Date;
  range: PeriodRange;
}

/**
 * R4: the store's selected period + this screen's injected now → range.
 * The range is memoised on (period, now) so insights memoised on it only
 * recompute when one of those (or the rows) changes.
 */
export function useSelectedPeriod(): SelectedPeriod {
  const transactions = useTransactionsStore(state => state.transactions);
  const period = useTransactionsStore(state => state.selectedPeriod);
  const setPeriod = useTransactionsStore(state => state.setSelectedPeriod);
  const now = useNow(transactions);
  const range = useMemo(() => periodRange(period, now), [period, now]);
  return { period, setPeriod, now, range };
}

/** R4: inputs of PeriodNotices, memoised on the rows (and the range). */
export function usePeriodNotices(range: PeriodRange): {
  earliestApprovedAt: string | null;
  pendingCount: number;
} {
  const transactions = useTransactionsStore(state => state.transactions);
  const earliest = useMemo(() => earliestApprovedAt(transactions), [transactions]);
  const pendingCount = useMemo(
    () => pendingInRangeCount(transactions, range),
    [transactions, range],
  );
  return { earliestApprovedAt: earliest, pendingCount };
}
