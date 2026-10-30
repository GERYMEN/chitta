import { useMemo } from 'react';
import { useTransactionsStore } from '../transactions/state/transactionsStore';
import { findTransferPairs, TransferPair } from '../../domain/transfers/transfer.rules';

/**
 * R3a: suggested transfer pairs over the whole store (pending AND approved
 * rows), memoised on the three inputs so the result is a stable reference
 * between renders (never a store selector that returns a new array).
 */
export function useTransferPairs(): TransferPair[] {
  const transactions = useTransactionsStore(state => state.transactions);
  const accounts = useTransactionsStore(state => state.accounts);
  const dismissals = useTransactionsStore(state => state.transferDismissals);
  return useMemo(
    () => findTransferPairs(transactions, accounts, dismissals),
    [transactions, accounts, dismissals],
  );
}
