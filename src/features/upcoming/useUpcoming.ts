import { useMemo } from 'react';
import { useTransactionsStore } from '../transactions/state/transactionsStore';
import { useNow } from '../../shared/hooks/useNow';
import { detectRecurring, upcomingWithin } from '../../domain/recurring/recurring.rules';
import { RecurringSeries } from '../../domain/recurring/recurring.types';
import { useDismissedRecurringStore } from './state/dismissedRecurringStore';

/** R8a: detected recurring series (minus session-dismissed) + the upcoming subset. */
export function useUpcoming(): { now: Date; all: RecurringSeries[]; upcoming: RecurringSeries[] } {
  const transactions = useTransactionsStore(state => state.transactions);
  const dismissed = useDismissedRecurringStore(state => state.dismissed);
  const now = useNow(transactions);
  const all = useMemo(
    () => detectRecurring(transactions, now).filter(s => !dismissed.includes(s.merchantKey)),
    [transactions, now, dismissed],
  );
  const upcoming = useMemo(() => upcomingWithin(all, now), [all, now]);
  return { now, all, upcoming };
}
