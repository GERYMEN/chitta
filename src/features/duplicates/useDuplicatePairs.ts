import { useMemo } from 'react';
import { useTransactionsStore } from '../transactions/state/transactionsStore';
import { DuplicatePair, findDuplicatePairs } from '../../domain/duplicates/duplicate.rules';
import { isDeletedAccount } from '../../domain/accounts/account.rules';

/**
 * R3b: suggested duplicate pairs over the store (pending AND approved rows on
 * active accounts), memoised on its inputs so the result is a stable
 * reference between renders (never a store selector returning a new array).
 */
export function useDuplicatePairs(): DuplicatePair[] {
  const transactions = useTransactionsStore(state => state.transactions);
  const accounts = useTransactionsStore(state => state.accounts);
  const dismissals = useTransactionsStore(state => state.duplicateDismissals);
  return useMemo(() => {
    const deleted = new Set(accounts.filter(isDeletedAccount).map(a => a.id));
    const live = deleted.size > 0 ? transactions.filter(t => !deleted.has(t.accountId)) : transactions;
    return findDuplicatePairs(live, dismissals);
  }, [transactions, accounts, dismissals]);
}
