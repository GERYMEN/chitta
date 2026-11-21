/** R6 T0 — SMS-balance snapshot columns, latest-wins writer, dismiss, old-row compat. REAL sqlite. */
import { accountRepository, buildAccount } from '../account.repository';
import { getDatabase } from '../../db/connection';
import { rowToAccount } from '../../mappers/account.mapper';
import { migrateTo, openTestSqlite, sqliteAvailable, TestSqlite } from '../../../test/sqliteDb';

jest.mock('../../db/connection', () => ({ getDatabase: jest.fn() }));
const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;
const describeSql = sqliteAvailable() ? describe : describe.skip;

describeSql('accountRepository sms balance snapshot', () => {
  let t: TestSqlite;
  let id: string;
  beforeEach(async () => {
    t = openTestSqlite();
    migrateTo(t, 14);
    mockGetDatabase.mockReturnValue(t.db as never);
    const a = await accountRepository.create({
      name: 'QA Bank', type: 'bank', lastFour: '1234', openingBalanceMinor: 0, currency: 'INR', isActive: true,
    });
    id = a.id;
  });
  afterEach(() => {
    t.close();
    mockGetDatabase.mockReset();
  });

  it('a new account has no snapshot', async () => {
    const a = (await accountRepository.getById(id))!;
    expect(a.smsBalanceMinor).toBeNull();
    expect(a.smsBalanceAt).toBeNull();
    expect(a.smsBalanceDismissedAt).toBeNull();
  });

  it('writes a snapshot and reads it back', async () => {
    expect(await accountRepository.setSmsBalanceSnapshot(id, 123456, 1_760_000_000_000)).toBe(true);
    const a = (await accountRepository.getById(id))!;
    expect(a.smsBalanceMinor).toBe(123456);
    expect(a.smsBalanceAt).toBe(new Date(1_760_000_000_000).toISOString());
  });

  it('latest wins: an older SMS never overwrites a newer snapshot', async () => {
    await accountRepository.setSmsBalanceSnapshot(id, 5000, 2_000);
    expect(await accountRepository.setSmsBalanceSnapshot(id, 1111, 1_000)).toBe(false);
    expect((await accountRepository.getById(id))!.smsBalanceMinor).toBe(5000);
    expect(await accountRepository.setSmsBalanceSnapshot(id, 7000, 3_000)).toBe(true);
    expect((await accountRepository.getById(id))!.smsBalanceMinor).toBe(7000);
  });

  it('an equal timestamp is not newer (no churn)', async () => {
    await accountRepository.setSmsBalanceSnapshot(id, 5000, 2_000);
    expect(await accountRepository.setSmsBalanceSnapshot(id, 9999, 2_000)).toBe(false);
    expect((await accountRepository.getById(id))!.smsBalanceMinor).toBe(5000);
  });

  it('unknown account id is a no-op', async () => {
    expect(await accountRepository.setSmsBalanceSnapshot('nope', 1, 1)).toBe(false);
  });

  it('does not touch updated_at, balances or the anchor', async () => {
    const before = (await accountRepository.getById(id))!;
    await accountRepository.setSmsBalanceSnapshot(id, 5000, 2_000);
    const after = (await accountRepository.getById(id))!;
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.balanceAnchorMinor).toBe(before.balanceAnchorMinor);
    expect(after.balanceAnchorAt).toBe(before.balanceAnchorAt);
    expect(after.openingBalanceMinor).toBe(before.openingBalanceMinor);
  });

  it('dismiss keys to the current snapshot; a newer snapshot re-surfaces', async () => {
    await accountRepository.setSmsBalanceSnapshot(id, 5000, 2_000);
    await accountRepository.dismissSmsBalanceDifference(id);
    let a = (await accountRepository.getById(id))!;
    expect(a.smsBalanceDismissedAt).toBe(a.smsBalanceAt);
    await accountRepository.setSmsBalanceSnapshot(id, 6000, 3_000);
    a = (await accountRepository.getById(id))!;
    expect(a.smsBalanceDismissedAt).not.toBe(a.smsBalanceAt);
  });

  it('dismiss without a snapshot is a no-op', async () => {
    await accountRepository.dismissSmsBalanceDifference(id);
    expect((await accountRepository.getById(id))!.smsBalanceDismissedAt).toBeNull();
  });

  it('update() (e.g. Use bank balance) keeps the snapshot', async () => {
    await accountRepository.setSmsBalanceSnapshot(id, 5000, 2_000);
    await accountRepository.update(id, { balanceAnchorMinor: 5000, balanceAnchorAt: new Date().toISOString() });
    const a = (await accountRepository.getById(id))!;
    expect(a.smsBalanceMinor).toBe(5000);
    expect(a.balanceAnchorMinor).toBe(5000);
  });

  it('a pre-R6 row (columns NULL / absent) maps to a null snapshot', () => {
    const a = rowToAccount({
      id: 'x', name: 'n', type: 'bank', last_four: null, opening_balance_minor: 0, currency: 'INR',
      is_active: 1, created_at: 'c', updated_at: 'u',
    });
    expect(a.smsBalanceMinor).toBeNull();
    expect(a.smsBalanceAt).toBeNull();
    expect(a.smsBalanceDismissedAt).toBeNull();
    expect(buildAccount).toBeDefined();
  });
});
