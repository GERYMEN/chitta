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
  /**
   * R6: the balance (paise) the latest matched bank SMS reported, and when
   * (ISO of the SMS time). A fact about the account — never changes the
   * tracked balance. Optional so older fixtures/builders need not set them.
   */
  smsBalanceMinor?: number | null;
  smsBalanceAt?: string | null;
  /** R6: the `smsBalanceAt` the user dismissed the difference for. */
  smsBalanceDismissedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}
