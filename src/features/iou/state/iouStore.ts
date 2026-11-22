import { create } from 'zustand';
import { iouShareRepository } from '../../../data/repositories/iouShare.repository';
import { newPerson, peopleRepository } from '../../../data/repositories/people.repository';
import {
  canLinkAsRepayment,
  linkRepaymentPatch,
  SplitError,
  unlinkRepaymentPatch,
  validateManualAmount,
  validateSplit,
} from '../../../domain/iou/iou.rules';
import { IouDirection, IouShare, Person, SplitShareInput } from '../../../domain/iou/iou.types';
import { Transaction } from '../../../domain/transactions/transaction.types';
import { generateId } from '../../../shared/utils/id';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';

/**
 * R10: a light store over the people + iou_shares repositories (the pattern of
 * billsStore / budgetsStore). Screens call `refresh()` on focus; every write
 * persists (row + audit in one db.transaction) and then reloads.
 *
 * The ledger is a PARALLEL layer: nothing here changes an expense's amount.
 * The only transaction write is linking an incoming credit as a repayment
 * (linkKind 'iou_repayment' + the source expense id) — the credit then no
 * longer counts as income.
 */

/** What an exact Undo of a settle needs. */
export interface IouSettlePrior {
  share: IouShare;
  /** The credit row as it was before linking (null = nothing was linked). */
  credit: Transaction | null;
}

export type SettleError = 'missing' | 'not-linkable';

interface IouState {
  people: Person[];
  shares: IouShare[];
  refresh: () => Promise<void>;
  /** Split (lent): shares of an approved expense. Null = saved, else why not. */
  splitExpense: (expense: Transaction, inputs: ReadonlyArray<SplitShareInput>) => Promise<SplitError | 'not-approved-expense' | null>;
  /** Manual entry (borrowed, or lent without an expense). Null = saved. */
  addManual: (input: {
    direction: IouDirection;
    personId: string | null;
    newName: string | null;
    amountMinor: number;
    note: string | null;
  }) => Promise<SplitError | null>;
  /** Settle in full. `transactionId` = the credit (lent) / expense (borrowed) linked as the repayment. */
  settle: (share: IouShare, transactionId: string | null) => Promise<IouSettlePrior | SettleError>;
  undoSettle: (prior: IouSettlePrior) => Promise<void>;
  remove: (share: IouShare) => Promise<void>;
  /** Undo of `remove`: put the same share back. */
  restore: (share: IouShare) => Promise<void>;
}

function replaceTransaction(row: Transaction): void {
  useTransactionsStore.setState(state => ({
    transactions: state.transactions.map(t => (t.id === row.id ? row : t)),
  }));
}

/** Resolve each input to an existing/new person (same typed name reuses one person). */
function resolvePeople(
  inputs: ReadonlyArray<SplitShareInput>,
  existing: ReadonlyArray<Person>,
): { newPeople: Person[]; personIds: string[] } {
  const created = new Map<string, Person>();
  const personIds: string[] = [];
  for (const input of inputs) {
    if (input.personId) {
      personIds.push(input.personId);
      continue;
    }
    const name = (input.newName ?? '').trim();
    const key = name.toLowerCase();
    const known = existing.find(p => p.name.trim().toLowerCase() === key) ?? created.get(key);
    if (known) {
      personIds.push(known.id);
      continue;
    }
    const person = newPerson(name);
    created.set(key, person);
    personIds.push(person.id);
  }
  return { newPeople: Array.from(created.values()), personIds };
}

export const useIouStore = create<IouState>((set, get) => ({
  people: [],
  shares: [],
  refresh: async () => {
    const [people, shares] = await Promise.all([
      peopleRepository.listAll().catch(() => [] as Person[]),
      iouShareRepository.listAll().catch(() => [] as IouShare[]),
    ]);
    set({ people, shares });
  },
  splitExpense: async (expense, inputs) => {
    if (expense.type !== 'expense' || expense.status !== 'approved') return 'not-approved-expense';
    const already = get()
      .shares.filter(s => s.direction === 'lent' && s.sourceTransactionId === expense.id)
      .reduce((sum, s) => sum + s.amountMinor, 0);
    const error = validateSplit(inputs, expense.amountMinor, already);
    if (error) return error;
    const now = new Date().toISOString();
    const { newPeople, personIds } = resolvePeople(inputs, get().people);
    const shares: IouShare[] = inputs.map((input, i) => ({
      id: generateId('iou'),
      personId: personIds[i],
      direction: 'lent',
      sourceTransactionId: expense.id,
      amountMinor: input.amountMinor,
      note: null,
      createdAt: now,
      settledAt: null,
      repaymentTransactionId: null,
    }));
    await iouShareRepository.addShares({ newPeople, shares });
    await get().refresh();
    return null;
  },
  addManual: async input => {
    const error = validateManualAmount(input.amountMinor);
    if (error) return error;
    if (!input.personId && !(input.newName ?? '').trim()) return 'no-person';
    const { newPeople, personIds } = resolvePeople(
      [{ personId: input.personId, newName: input.newName, amountMinor: input.amountMinor }],
      get().people,
    );
    const share: IouShare = {
      id: generateId('iou'),
      personId: personIds[0],
      direction: input.direction,
      sourceTransactionId: null,
      amountMinor: input.amountMinor,
      note: input.note?.trim() ? input.note.trim() : null,
      createdAt: new Date().toISOString(),
      settledAt: null,
      repaymentTransactionId: null,
    };
    await iouShareRepository.addShares({ newPeople, shares: [share] });
    await get().refresh();
    return null;
  },
  settle: async (share, transactionId) => {
    const now = new Date().toISOString();
    let priorCredit: Transaction | null = null;
    let linked: Transaction | null = null;
    if (transactionId && share.direction === 'lent') {
      const credit = useTransactionsStore.getState().transactions.find(t => t.id === transactionId);
      if (!credit) return 'missing';
      if (!canLinkAsRepayment(credit, get().shares)) return 'not-linkable';
      priorCredit = credit;
      linked = linkRepaymentPatch(credit, share.sourceTransactionId, now);
    }
    // Borrowed: the expense that repaid it is recorded on the share only — it
    // stays plain spend (nothing about it is excluded or relinked).
    const settled = await iouShareRepository.settle(share, now, transactionId, linked);
    if (linked) replaceTransaction(linked);
    await get().refresh();
    return { share: { ...settled, settledAt: null, repaymentTransactionId: null }, credit: priorCredit };
  },
  undoSettle: async prior => {
    const restored = prior.credit
      ? unlinkRepaymentPatch(
          useTransactionsStore.getState().transactions.find(t => t.id === prior.credit!.id) ?? prior.credit,
          new Date().toISOString(),
        )
      : null;
    await iouShareRepository.undoSettle(prior.share, restored);
    if (restored) replaceTransaction(restored);
    await get().refresh();
  },
  remove: async share => {
    const credit =
      share.direction === 'lent' && share.repaymentTransactionId
        ? useTransactionsStore.getState().transactions.find(t => t.id === share.repaymentTransactionId) ?? null
        : null;
    const unlinked = credit ? unlinkRepaymentPatch(credit, new Date().toISOString()) : null;
    await iouShareRepository.remove(share, unlinked);
    if (unlinked) replaceTransaction(unlinked);
    await get().refresh();
  },
  restore: async share => {
    const credit =
      share.direction === 'lent' && share.repaymentTransactionId
        ? useTransactionsStore.getState().transactions.find(t => t.id === share.repaymentTransactionId) ?? null
        : null;
    // Re-link only a credit that is still free (nobody linked it elsewhere meanwhile).
    const relinked =
      credit && credit.linkKind == null && credit.linkedTransactionId == null
        ? linkRepaymentPatch(credit, share.sourceTransactionId, new Date().toISOString())
        : null;
    await iouShareRepository.addShares({ newPeople: [], shares: [share], credit: relinked });
    if (relinked) replaceTransaction(relinked);
    await get().refresh();
  },
}));
