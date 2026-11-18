import { create } from 'zustand';
import { billRepository } from '../../../data/repositories/bill.repository';
import { Bill, BillPatch, CreateBillInput } from '../../../domain/bills/bill.types';

/**
 * R5b: a light store over `billRepository` (the pattern of linkedNumbersStore).
 * Screens call `refresh()` on focus; every write persists through the
 * repository (one db.transaction + its audit row) and then reloads.
 */
export interface BillPaidPrior {
  billId: string;
  paidMinor: number;
  paidTransactionId: string | null;
  status: Bill['status'];
}

interface BillsState {
  bills: Bill[];
  refresh: () => Promise<void>;
  addBill: (input: CreateBillInput) => Promise<Bill>;
  editBill: (bill: Bill, patch: BillPatch) => Promise<void>;
  /** Mark paid (manual or linked); returns the prior state for an exact Undo. */
  markPaid: (
    bill: Bill,
    options: { addMinor: number; transactionId: string | null; force: boolean },
  ) => Promise<BillPaidPrior>;
  undoMarkPaid: (prior: BillPaidPrior) => Promise<void>;
  dismiss: (bill: Bill) => Promise<void>;
  undoDismiss: (bill: Bill) => Promise<void>;
}

export const useBillsStore = create<BillsState>((set, get) => ({
  bills: [],
  refresh: async () => {
    const bills = await billRepository.listAll().catch(() => [] as Bill[]);
    set({ bills });
  },
  addBill: async input => {
    const bill = await billRepository.create(input);
    await get().refresh();
    return bill;
  },
  editBill: async (bill, patch) => {
    await billRepository.update(bill, patch);
    await get().refresh();
  },
  markPaid: async (bill, options) => {
    const prior: BillPaidPrior = {
      billId: bill.id,
      paidMinor: bill.paidMinor,
      paidTransactionId: bill.paidTransactionId,
      status: bill.status,
    };
    await billRepository.markPaid(bill, options);
    await get().refresh();
    return prior;
  },
  undoMarkPaid: async prior => {
    const bill = get().bills.find(b => b.id === prior.billId);
    if (!bill) return;
    await billRepository.reopen(bill, prior);
    await get().refresh();
  },
  dismiss: async bill => {
    await billRepository.dismiss(bill);
    await get().refresh();
  },
  undoDismiss: async bill => {
    await billRepository.undismiss(bill);
    await get().refresh();
  },
}));
