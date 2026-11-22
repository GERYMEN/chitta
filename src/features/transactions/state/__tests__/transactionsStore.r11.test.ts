/**
 * R11 — tags + receipt through the store, against real SQLite. Synthetic data.
 */
import { useTransactionsStore } from '../transactionsStore';
import { getDatabase } from '../../../../data/db/connection';
import { migrateTo, openTestSqlite, sqliteAvailable, TestSqlite } from '../../../../test/sqliteDb';
import { deleteReceiptFile } from '../../../../native/android/receipts/receiptNative';

jest.mock('../../../../data/db/connection', () => ({
  getDatabase: jest.fn(),
  runMigrations: jest.fn(async () => undefined),
}));
jest.mock('../../../../native/android/receipts/receiptNative', () => ({
  deleteReceiptFile: jest.fn(async () => undefined),
  receiptsAvailable: () => true,
  pickReceipt: jest.fn(),
  receiptUri: jest.fn(),
}));
const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;
const describeSql = sqliteAvailable() ? describe : describe.skip;

describeSql('R11 store: tags + receipt', () => {
  let t: TestSqlite;
  beforeEach(async () => {
    t = openTestSqlite();
    migrateTo(t, 16);
    t.raw
      .prepare(
        `INSERT INTO transactions (id,type,status,amount_minor,currency,merchant_name,category_id,account_id,payment_method,occurred_at,detected_at,source_type,receipt_path,created_at,updated_at)
         VALUES ('qa-t1','expense','approved',100,'INR','QA','c','a','upi','2026-01-01','2026-01-01','manual','qa-t1-1.jpg','2026-01-01','2026-01-01')`,
      )
      .run();
    mockGetDatabase.mockReturnValue(t.db as never);
    (deleteReceiptFile as jest.Mock).mockClear();
    await useTransactionsStore.getState().reloadFromDatabase();
  });
  afterEach(() => {
    t.close();
    mockGetDatabase.mockReset();
  });

  it('adds a custom tag once (normalized) and removes it', async () => {
    const s = useTransactionsStore.getState();
    const tag = await s.addTagToTransaction('qa-t1', '#QA Trip');
    expect(tag?.name).toBe('QA Trip');
    await useTransactionsStore.getState().addTagToTransaction('qa-t1', 'qa trip');
    expect(useTransactionsStore.getState().tagLinks['qa-t1']).toEqual([tag!.id]);
    expect(useTransactionsStore.getState().tags).toHaveLength(1);
    expect(await useTransactionsStore.getState().removeTagFromTransaction('qa-t1', tag!.id)).toBe(true);
    expect(useTransactionsStore.getState().tagLinks['qa-t1']).toEqual([]);
  });

  it('rejects an empty tag name', async () => {
    expect(await useTransactionsStore.getState().addTagToTransaction('qa-t1', ' # ')).toBeNull();
  });

  it('clears and restores the receipt path in state and database', async () => {
    const s = useTransactionsStore.getState();
    expect(s.transactions[0].receiptPath).toBe('qa-t1-1.jpg');
    await s.setReceiptPath('qa-t1', null);
    expect(useTransactionsStore.getState().transactions[0].receiptPath).toBeNull();
    await useTransactionsStore.getState().setReceiptPath('qa-t1', 'qa-t1-1.jpg');
    expect(t.rows('transactions')[0].receipt_path).toBe('qa-t1-1.jpg');
  });

  it('deleting a transaction deletes its receipt file and tag links', async () => {
    await useTransactionsStore.getState().addTagToTransaction('qa-t1', 'qa');
    await useTransactionsStore.getState().deleteTransaction('qa-t1');
    expect(deleteReceiptFile).toHaveBeenCalledWith('qa-t1-1.jpg');
    expect(t.rows('transaction_tags')).toHaveLength(0);
    expect(useTransactionsStore.getState().tagLinks['qa-t1'] ?? []).toEqual([]);
  });
});
