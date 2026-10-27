import { Account } from '../../domain/accounts/account.types';

export const accountFixtures: Account[] = [
  {
    id: 'acc-hdfc-salary',
    name: 'HDFC Bank (Salary)',
    type: 'bank',
    lastFour: '4021',
    openingBalanceMinor: 0,
    currency: 'INR',
    isActive: true,
    balanceAnchorMinor: null,
    balanceAnchorAt: null,
    deletedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 'acc-sbi-savings',
    name: 'State Bank of India',
    type: 'bank',
    lastFour: '6789',
    openingBalanceMinor: 1825000,
    currency: 'INR',
    isActive: true,
    balanceAnchorMinor: null,
    balanceAnchorAt: null,
    deletedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 'acc-cash',
    name: 'Cash in Hand',
    type: 'cash',
    lastFour: null,
    openingBalanceMinor: 220000,
    currency: 'INR',
    isActive: true,
    balanceAnchorMinor: null,
    balanceAnchorAt: null,
    deletedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 'acc-hdfc-credit',
    name: 'HDFC Millennia Credit Card',
    type: 'credit_card',
    lastFour: '4321',
    openingBalanceMinor: 0,
    currency: 'INR',
    isActive: true,
    balanceAnchorMinor: null,
    balanceAnchorAt: null,
    deletedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
];

export function accountById(id: string): Account | undefined {
  return accountFixtures.find(account => account.id === id);
}
