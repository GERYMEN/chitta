import { budgetRepository } from '../budget.repository';
import { getDatabase } from '../../db/connection';
import { createFakeDb, FakeDb } from '../../../test/fakeDb';

jest.mock('../../db/connection', () => ({ getDatabase: jest.fn() }));
const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;

let db: FakeDb;
beforeEach(() => {
  db = createFakeDb();
  mockGetDatabase.mockReturnValue(db as never);
});
afterEach(() => mockGetDatabase.mockReset());

function rows(): Record<string, unknown>[] {
  return Array.from(db.tables.get('budgets')?.values() ?? []);
}
function audits(eventType: string): Record<string, unknown>[] {
  return db.auditInserts().map(a => a.row).filter(r => r.event_type === eventType);
}

describe('budgetRepository.setBudget', () => {
  it('inserts a new overall budget + one budget_set audit, in a transaction', async () => {
    const budget = await budgetRepository.setBudget({ categoryId: null, amountMinor: 100000 });
    expect(budget.categoryId).toBeNull();
    expect(budget.period).toBe('monthly');
    expect(rows()).toHaveLength(1);
    expect(rows()[0].category_id).toBeNull();
    expect(audits('budget_set')).toHaveLength(1);
    expect(db.transactionCount()).toBe(1);
  });

  it('inserts a per-category budget', async () => {
    await budgetRepository.setBudget({ categoryId: 'cat-food', amountMinor: 20000 });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].category_id).toBe('cat-food');
    expect(audits('budget_set')).toHaveLength(1);
  });

  it('replaces (not duplicates) an existing key: a second set UPDATES the amount', async () => {
    await budgetRepository.setBudget({ categoryId: 'cat-food', amountMinor: 20000 });
    const updated = await budgetRepository.setBudget({ categoryId: 'cat-food', amountMinor: 35000 });
    // Still one row for cat-food, with the new amount.
    const foodRows = rows().filter(r => r.category_id === 'cat-food');
    expect(foodRows).toHaveLength(1);
    expect(foodRows[0].amount_minor).toBe(35000);
    expect(updated.amountMinor).toBe(35000);
    expect(audits('budget_updated')).toHaveLength(1);
    // Only the FIRST set emitted budget_set.
    expect(audits('budget_set')).toHaveLength(1);
  });

  it('enforces a single overall budget across resets', async () => {
    await budgetRepository.setBudget({ categoryId: null, amountMinor: 100000 });
    await budgetRepository.setBudget({ categoryId: null, amountMinor: 150000 });
    expect(rows().filter(r => r.category_id == null)).toHaveLength(1);
    expect(rows()[0].amount_minor).toBe(150000);
  });

  it('re-setting the same amount is a no-op (no audit, no transaction)', async () => {
    await budgetRepository.setBudget({ categoryId: 'cat-food', amountMinor: 20000 });
    const before = db.transactionCount();
    await budgetRepository.setBudget({ categoryId: 'cat-food', amountMinor: 20000 });
    expect(db.transactionCount()).toBe(before);
    expect(audits('budget_updated')).toHaveLength(0);
  });

  it('keeps overall and per-category budgets independent', async () => {
    await budgetRepository.setBudget({ categoryId: null, amountMinor: 100000 });
    await budgetRepository.setBudget({ categoryId: 'cat-food', amountMinor: 20000 });
    await budgetRepository.setBudget({ categoryId: 'cat-shopping', amountMinor: 30000 });
    expect(rows()).toHaveLength(3);
  });
});

describe('budgetRepository.removeBudget', () => {
  it('deletes the row + writes budget_deleted; returns it for Undo', async () => {
    const budget = await budgetRepository.setBudget({ categoryId: 'cat-food', amountMinor: 20000 });
    const removed = await budgetRepository.removeBudget(budget);
    expect(rows()).toHaveLength(0);
    expect(audits('budget_deleted')).toHaveLength(1);
    expect(removed.id).toBe(budget.id);
    // Undo: re-setting restores it.
    await budgetRepository.setBudget({ categoryId: removed.categoryId, amountMinor: removed.amountMinor });
    expect(rows()).toHaveLength(1);
  });
});

describe('budgetRepository.listAll', () => {
  it('maps rows back to Budget objects', async () => {
    await budgetRepository.setBudget({ categoryId: null, amountMinor: 100000 });
    await budgetRepository.setBudget({ categoryId: 'cat-food', amountMinor: 20000 });
    const all = await budgetRepository.listAll();
    expect(all).toHaveLength(2);
    expect(all.every(b => b.period === 'monthly')).toBe(true);
  });
});
