import {
  accountFormSchema,
  findDuplicateAccount,
  openingBalanceInputToMinor,
} from '../accountForm.schema';
import { Account } from '../../../../domain/accounts/account.types';

const account = (overrides: Partial<Account> = {}): Account => ({
  id: 'acc-1',
  name: 'HDFC Bank',
  type: 'bank',
  lastFour: '1234',
  openingBalanceMinor: 0,
  currency: 'INR',
  isActive: true,
  balanceAnchorMinor: null,
  balanceAnchorAt: null,
  deletedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

const base = {
  name: 'HDFC Bank',
  type: 'bank' as const,
  lastFour: '1234',
  openingBalance: '5000.00',
};

describe('accountFormSchema', () => {
  it('accepts a valid bank account form', () => {
    expect(accountFormSchema.safeParse(base).success).toBe(true);
  });

  it('accepts a cash account with no lastFour', () => {
    expect(
      accountFormSchema.safeParse({ ...base, type: 'cash', lastFour: '' }).success,
    ).toBe(true);
  });

  it('accepts an opening balance of zero', () => {
    expect(accountFormSchema.safeParse({ ...base, openingBalance: '0' }).success).toBe(true);
  });

  it('accepts a decimal opening balance', () => {
    expect(
      accountFormSchema.safeParse({ ...base, openingBalance: '1500.50' }).success,
    ).toBe(true);
  });

  it('rejects a missing name', () => {
    expect(accountFormSchema.safeParse({ ...base, name: '  ' }).success).toBe(false);
  });

  it.each(['-5', 'abc', '', '.50', '450.', '450.999'])(
    'rejects invalid opening balance %p',
    openingBalance => {
      expect(accountFormSchema.safeParse({ ...base, openingBalance }).success).toBe(false);
    },
  );
});

describe('opening balance conversion helper', () => {
  it('converts rupee string to integer paise', () => {
    expect(openingBalanceInputToMinor('5000.00')).toBe(500000);
    expect(openingBalanceInputToMinor('0')).toBe(0);
    expect(openingBalanceInputToMinor('1500.50')).toBe(150050);
    expect(openingBalanceInputToMinor('0.01')).toBe(1);
  });
});

describe('findDuplicateAccount', () => {
  it('matches an active account with identical type/name/lastFour', () => {
    const accounts = [account({ name: 'HDFC Bank', type: 'bank', lastFour: '1234' })];
    expect(
      findDuplicateAccount(accounts, { name: 'HDFC Bank', type: 'bank', lastFour: '1234' }),
    ).toBeDefined();
  });

  it('is case-insensitive and trims the name', () => {
    const accounts = [account({ name: 'HDFC Bank', type: 'bank', lastFour: '1234' })];
    expect(
      findDuplicateAccount(accounts, { name: '  hdfc bank ', type: 'bank', lastFour: '1234' }),
    ).toBeDefined();
  });

  it('ignores a differing type, lastFour, or name', () => {
    const accounts = [account({ name: 'HDFC Bank', type: 'bank', lastFour: '1234' })];
    expect(
      findDuplicateAccount(accounts, { name: 'HDFC Bank', type: 'credit_card', lastFour: '1234' }),
    ).toBeUndefined();
    expect(
      findDuplicateAccount(accounts, { name: 'HDFC Bank', type: 'bank', lastFour: '9999' }),
    ).toBeUndefined();
    expect(
      findDuplicateAccount(accounts, { name: 'Other', type: 'bank', lastFour: '1234' }),
    ).toBeUndefined();
  });

  it('ignores inactive and soft-deleted accounts', () => {
    const accounts = [
      account({ isActive: false, name: 'HDFC Bank', type: 'bank', lastFour: '1234' }),
      account({
        deletedAt: '2026-10-02T00:00:00.000Z',
        name: 'HDFC Bank',
        type: 'bank',
        lastFour: '1234',
      }),
    ];
    expect(
      findDuplicateAccount(accounts, { name: 'HDFC Bank', type: 'bank', lastFour: '1234' }),
    ).toBeUndefined();
  });
});
