export type AccountType = 'bank' | 'cash' | 'credit_card' | 'upi' | 'other';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  lastFour: string | null;
  openingBalanceMinor: number;
  currency: 'INR';
  isActive: boolean;
  balanceAnchorMinor: number | null;
  balanceAnchorAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
