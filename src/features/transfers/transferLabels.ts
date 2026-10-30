import { Account } from '../../domain/accounts/account.types';
import { accountDisplayLabel } from '../../domain/accounts/account.rules';
import { Transaction } from '../../domain/transactions/transaction.types';
import { transferDirection, TransferPair } from '../../domain/transfers/transfer.rules';
import { formatRupeesFromMinor } from '../../shared/utils/currency';
import { formatTransactionTimestamp } from '../../shared/utils/date';

/**
 * R3a pure display strings for transfers (lists, detail, Pending pairs,
 * Home nudge). Account names always go through `accountDisplayLabel`.
 */

type AccountLookup = ReadonlyArray<Pick<Account, 'id' | 'name' | 'lastFour' | 'deletedAt'>>;

function find(accounts: AccountLookup, id: string | null | undefined) {
  return id ? accounts.find(a => a.id === id) ?? null : null;
}

/** "From A → To B". */
export function transferRouteLabel(
  t: Pick<Transaction, 'accountId'> & Partial<Pick<Transaction, 'transferAccountId'>>,
  accounts: AccountLookup,
): string {
  return `From ${accountDisplayLabel(find(accounts, t.accountId))} → To ${accountDisplayLabel(
    find(accounts, t.transferAccountId),
  )}`;
}

/**
 * List subtitle of a transfer row. In a per-account view (`accountId` set) it
 * says which way the money went for THAT account: "Out to B" on A, "In from
 * A" on B. Otherwise "A → B". Always followed by the timestamp.
 */
export function transferRowSubtitle(
  t: Pick<Transaction, 'type' | 'accountId' | 'occurredAt'> &
    Partial<Pick<Transaction, 'transferAccountId'>>,
  accounts: AccountLookup,
  accountId: string | null = null,
): string {
  const when = formatTransactionTimestamp(t.occurredAt);
  const from = accountDisplayLabel(find(accounts, t.accountId));
  const to = accountDisplayLabel(find(accounts, t.transferAccountId));
  const direction = accountId ? transferDirection(t, accountId) : null;
  if (direction === 'out') return `Out to ${to} · ${when}`;
  if (direction === 'in') return `In from ${from} · ${when}`;
  return `${from} → ${to} · ${when}`;
}

/** Pending pair card title: "₹500.00 from A to B". */
export function transferPairTitle(pair: TransferPair, accounts: AccountLookup): string {
  return `${formatRupeesFromMinor(pair.debit.amountMinor, { showPaise: true })} from ${accountDisplayLabel(
    find(accounts, pair.debit.accountId),
  )} to ${accountDisplayLabel(find(accounts, pair.credit.accountId))}`;
}

/** Both dates of a pair: "Out: <when> · In: <when>". */
export function transferPairDates(pair: TransferPair): string {
  return `Out: ${formatTransactionTimestamp(pair.debit.occurredAt)} · In: ${formatTransactionTimestamp(
    pair.credit.occurredAt,
  )}`;
}

/** Home nudge: "1 possible transfer" / "3 possible transfers". */
export function possibleTransfersLabel(count: number): string {
  return `${count} possible transfer${count === 1 ? '' : 's'}`;
}
