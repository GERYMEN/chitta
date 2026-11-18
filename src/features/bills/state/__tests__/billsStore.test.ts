import { useBillsStore } from '../billsStore';
import { billRepository } from '../../../../data/repositories/bill.repository';
import { Bill } from '../../../../domain/bills/bill.types';

jest.mock('../../../../data/repositories/bill.repository', () => ({
  billRepository: {
    listAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    markPaid: jest.fn(),
    reopen: jest.fn(),
    dismiss: jest.fn(),
    undismiss: jest.fn(),
  },
}));

const repo = billRepository as jest.Mocked<typeof billRepository>;

function bill(p: Partial<Bill> = {}): Bill {
  return {
    id: p.id ?? 'b1',
    accountId: null,
    kind: 'manual',
    payee: 'QA',
    amountDueMinor: 100000,
    minDueMinor: null,
    statementDate: null,
    dueDate: '2026-11-20T06:30:00.000Z',
    status: p.status ?? 'open',
    paidMinor: p.paidMinor ?? 0,
    paidTransactionId: p.paidTransactionId ?? null,
    source: 'manual',
    sourceHash: null,
    repeat: 'none',
    createdAt: 'x',
    updatedAt: 'x',
    ...p,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  useBillsStore.setState({ bills: [] });
});

it('markPaid returns the exact prior state and undo reopens with it', async () => {
  const b = bill({ paidMinor: 20000, status: 'open', paidTransactionId: null });
  repo.listAll.mockResolvedValue([b]);
  repo.markPaid.mockResolvedValue(bill({ status: 'paid', paidMinor: 100000 }));
  const prior = await useBillsStore.getState().markPaid(b, { addMinor: 80000, transactionId: 'txn-1', force: false });
  expect(prior).toEqual({ billId: 'b1', paidMinor: 20000, paidTransactionId: null, status: 'open' });

  // undo uses the prior snapshot against the live bill.
  useBillsStore.setState({ bills: [bill({ status: 'paid', paidMinor: 100000 })] });
  repo.reopen.mockResolvedValue(b);
  await useBillsStore.getState().undoMarkPaid(prior);
  expect(repo.reopen).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1' }), prior);
});

it('dismiss / undoDismiss call the repository and refresh', async () => {
  const b = bill();
  repo.listAll.mockResolvedValue([]);
  await useBillsStore.getState().dismiss(b);
  expect(repo.dismiss).toHaveBeenCalledWith(b);
  await useBillsStore.getState().undoDismiss(b);
  expect(repo.undismiss).toHaveBeenCalledWith(b);
});
