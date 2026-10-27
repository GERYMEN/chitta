import { z } from 'zod';
import { Account, AccountType } from '../../../domain/accounts/account.types';

/**
 * Zod schema for the Add Account form. `openingBalance` is typed as a
 * user-entered rupee string and only converted to integer paise at the
 * form-submit boundary (never stored or computed as a float). An opening
 * balance of 0 is valid (a fresh empty account).
 */
export const accountFormSchema = z.object({
  name: z.string().trim().min(1, 'Account name is required'),
  type: z.enum(['bank', 'cash', 'credit_card', 'upi', 'other']),
  lastFour: z.string().optional(),
  openingBalance: z
    .string()
    .trim()
    .min(1, 'Opening balance is required')
    .regex(/^\d+(\.\d{1,2})?$/, 'Enter a valid amount')
    .refine(value => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed >= 0;
    }, 'Balance must be zero or more'),
});

export type AccountFormValues = z.infer<typeof accountFormSchema>;

export interface AccountFormInitialValues {
  name?: string;
  type?: AccountType;
  lastFour?: string;
  openingBalance?: string;
}

/** Rupee input string (e.g. "5000.00") → integer paise. Only called on submit. */
export function openingBalanceInputToMinor(value: string): number {
  return Math.round(parseFloat(value) * 100);
}

export interface DuplicateAccountCandidate {
  name: string;
  type: AccountType;
  lastFour: string | null;
}

/**
 * True when an active account already shares the same `(type, name, lastFour)`
 * — names are compared trimmed + case-insensitive, lastFour trimmed. Used at
 * the Add Account submit boundary to block silent duplicates.
 */
export function findDuplicateAccount(
  accounts: Account[],
  candidate: DuplicateAccountCandidate,
): Account | undefined {
  const name = candidate.name.trim().toLowerCase();
  const lastFour = candidate.lastFour?.trim() ?? null;

  return accounts.find(account => {
    if (!account.isActive || account.deletedAt !== null) return false;
    if (account.type !== candidate.type) return false;
    if (account.name.trim().toLowerCase() !== name) return false;
    return (account.lastFour?.trim() ?? null) === lastFour;
  });
}
