import { settingsRepository } from '../settings.repository';
import { getDatabase } from '../../db/connection';

jest.mock('../../db/connection', () => ({
  getDatabase: jest.fn(),
}));

const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;

describe('settingsRepository', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map<string, string>();

    const db = {
      execute: jest.fn(async (sql: string, params?: unknown[]) => {
        if (/^SELECT/.test(sql)) {
          const key = params?.[0] as string;
          const value = store.get(key);
          return value === undefined ? { rows: [] } : { rows: [{ value }] };
        }
        if (/INSERT OR REPLACE/.test(sql)) {
          store.set(params?.[0] as string, params?.[1] as string);
        }
        return { rows: [] };
      }),
    };

    mockGetDatabase.mockReturnValue(db as never);
  });

  afterEach(() => {
    mockGetDatabase.mockReset();
  });

  it('returns null for a missing key', async () => {
    await expect(settingsRepository.getValue('missing')).resolves.toBeNull();
  });

  it('round-trips a value through set then get', async () => {
    await settingsRepository.setValue('has_onboarded', 'true');
    await expect(settingsRepository.getValue('has_onboarded')).resolves.toBe('true');
  });

  it('replaces an existing value', async () => {
    await settingsRepository.setValue('k', 'old');
    await settingsRepository.setValue('k', 'new');
    await expect(settingsRepository.getValue('k')).resolves.toBe('new');
  });
});
