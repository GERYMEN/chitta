import { z } from 'zod';
import { PaymentMethod, TransactionType } from '../../../domain/transactions/transaction.types';

/**
 * Zod schema for the shared Add/Edit transaction form. Amount is typed as a
 * user-entered rupee string and only converted to integer paise at the
 * form-submit boundary (never stored or computed as a float).
 */
/** Rupee amount string, > 0, at most 2 decimals (shared by every money form). */
export const amountFieldSchema = z
  .string()
  .trim()
  .min(1, 'Amount is required')
  .regex(/^\d+(\.\d{1,2})?$/, 'Enter a valid amount')
  .refine(value => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0;
  }, 'Amount must be greater than 0');

export const transactionFormSchema = z.object({
  type: z.enum(['income', 'expense']),
  amount: amountFieldSchema,
  merchantName: z.string().trim().min(1, 'Merchant name is required'),
  categoryId: z.string().min(1, 'Category is required'),
  accountId: z.string().min(1, 'Account is required'),
  paymentMethod: z.enum(['bank', 'upi', 'cash', 'card', 'other']),
  occurredAt: z.string().min(1, 'Date is required'),
  note: z.string().optional(),
});

export type TransactionFormValues = z.infer<typeof transactionFormSchema>;

export interface TransactionFormInitialValues {
  type?: Exclude<TransactionType, 'transfer'>;
  amount?: string;
  merchantName?: string;
  categoryId?: string;
  accountId?: string;
  paymentMethod?: PaymentMethod;
  occurredAt?: string;
  note?: string;
}

/** Rupee input string (e.g. "450.50") → integer paise. Only called on submit. */
export function amountInputToMinor(value: string): number {
  return Math.round(parseFloat(value) * 100);
}

/** Integer paise → rupee input string for pre-filling the edit form. */
export function minorToAmountInput(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}

/**
 * R3a Add Record → Transfer / Edit transfer. No category (transfers always use
 * the hidden system "Transfer" category). From and To must be two different
 * accounts.
 */
export const transferFormSchema = z
  .object({
    fromAccountId: z.string().min(1, 'Choose the account the money left'),
    toAccountId: z.string().min(1, 'Choose the account the money went to'),
    amount: amountFieldSchema,
    occurredAt: z.string().min(1, 'Date is required'),
    note: z.string().optional(),
  })
  .refine(values => values.fromAccountId !== values.toAccountId, {
    message: 'From and To must be different accounts',
    path: ['toAccountId'],
  });

export type TransferFormValues = z.infer<typeof transferFormSchema>;

export interface TransferFormInitialValues {
  fromAccountId?: string;
  toAccountId?: string;
  amount?: string;
  occurredAt?: string;
  note?: string;
}
