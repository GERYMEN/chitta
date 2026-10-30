import {
  amountInputToMinor,
  minorToAmountInput,
  transactionFormSchema,
  transferFormSchema,
} from '../transactionForm.schema';

const base = {
  type: 'expense' as const,
  amount: '450.50',
  merchantName: 'Swiggy',
  categoryId: 'cat-food',
  accountId: 'acc-1',
  paymentMethod: 'upi' as const,
  occurredAt: '2026-10-04T12:00:00.000Z',
  note: '',
};

describe('transactionFormSchema', () => {
  it('accepts a valid expense form', () => {
    expect(transactionFormSchema.safeParse(base).success).toBe(true);
  });

  it('accepts a valid income form', () => {
    expect(
      transactionFormSchema.safeParse({ ...base, type: 'income', categoryId: 'cat-salary' }).success,
    ).toBe(true);
  });

  it.each(['0', '-5', 'abc', '', '.50', '450.', '450.999'])(
    'rejects invalid amount %p',
    amount => {
      const result = transactionFormSchema.safeParse({ ...base, amount });
      expect(result.success).toBe(false);
    },
  );

  it('rejects missing merchant name', () => {
    expect(transactionFormSchema.safeParse({ ...base, merchantName: '  ' }).success).toBe(false);
  });

  it('rejects empty category', () => {
    expect(transactionFormSchema.safeParse({ ...base, categoryId: '' }).success).toBe(false);
  });

  it('rejects empty account', () => {
    expect(transactionFormSchema.safeParse({ ...base, accountId: '' }).success).toBe(false);
  });

  it('rejects empty date', () => {
    expect(transactionFormSchema.safeParse({ ...base, occurredAt: '' }).success).toBe(false);
  });
});

describe('amount conversion helpers', () => {
  it('converts rupee string to integer paise', () => {
    expect(amountInputToMinor('450.50')).toBe(45050);
    expect(amountInputToMinor('450')).toBe(45000);
    expect(amountInputToMinor('0.01')).toBe(1);
  });

  it('converts paise back to a two-decimal rupee string', () => {
    expect(minorToAmountInput(45050)).toBe('450.50');
    expect(minorToAmountInput(45000)).toBe('450.00');
  });
});

describe('R3a transferFormSchema', () => {
  const transfer = {
    fromAccountId: 'acc-bank',
    toAccountId: 'acc-wallet',
    amount: '500.00',
    occurredAt: '2026-10-30T10:00:00.000Z',
    note: 'QA transfer',
  };

  it('accepts two different accounts', () => {
    expect(transferFormSchema.safeParse(transfer).success).toBe(true);
  });

  it('rejects From = To with an error on toAccountId', () => {
    const result = transferFormSchema.safeParse({ ...transfer, toAccountId: 'acc-bank' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['toAccountId']);
      expect(result.error.issues[0].message).toBe('From and To must be different accounts');
    }
  });

  it('requires both accounts and a valid amount; has no category field', () => {
    expect(transferFormSchema.safeParse({ ...transfer, fromAccountId: '' }).success).toBe(false);
    expect(transferFormSchema.safeParse({ ...transfer, toAccountId: '' }).success).toBe(false);
    expect(transferFormSchema.safeParse({ ...transfer, amount: '0' }).success).toBe(false);
    expect(transferFormSchema.safeParse({ ...transfer, amount: '1.234' }).success).toBe(false);
    const parsed = transferFormSchema.safeParse({ ...transfer, categoryId: 'cat-food' });
    expect(parsed.success && 'categoryId' in parsed.data).toBe(false);
  });
});
