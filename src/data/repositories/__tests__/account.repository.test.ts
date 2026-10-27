import { accountRepository } from '../account.repository';
import { getDatabase } from '../../db/connection';

jest.mock('../../db/connection', () => ({
  getDatabase: jest.fn(),
}));

const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;

describe('accountRepository listing', () => {
  let executedSql: string[];

  beforeEach(() => {
    executedSql = [];

    const db = {
      execute: jest.fn(async (sql: string) => {
        executedSql.push(sql);
        return { rows: [] };
      }),
    };

    mockGetDatabase.mockReturnValue(db as never);
  });

  afterEach(() => {
    mockGetDatabase.mockReset();
  });

  it('listActiveAccounts filters to deleted_at IS NULL', async () => {
    await accountRepository.listActiveAccounts();
    expect(executedSql).toEqual([
      'SELECT * FROM accounts WHERE deleted_at IS NULL ORDER BY created_at ASC',
    ]);
  });

  it('listAllAccounts does not filter on deleted_at', async () => {
    await accountRepository.listAllAccounts();
    expect(executedSql).toEqual(['SELECT * FROM accounts ORDER BY created_at ASC']);
  });

  it('listAllAccounts is identical to the existing listAll SQL', async () => {
    await accountRepository.listAllAccounts();
    await accountRepository.listAll();
    expect(executedSql[0]).toBe(executedSql[1]);
    expect(executedSql[0]).not.toContain('deleted_at');
  });
});
