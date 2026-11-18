/**
 * R5b (D-a): 'pay_later' is a liability account like 'credit_card' (BNPL /
 * pay-later lines). Everywhere a credit_card is treated as a card / liability
 * (balance sign, icons, account form, card bill payment meaning, credit
 * limit, bills), pay_later behaves the same.
 */
export type AccountType = 'bank' | 'cash' | 'credit_card' | 'pay_later' | 'upi' | 'other';

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
  /**
   * R5b (D-b): the user's credit limit in paise for credit_card / pay_later
   * accounts (manual entry). null when not set. Never overwritten by any SMS.
   */
  creditLimitMinor: number | null;
  createdAt: string;
  updatedAt: string;
}
