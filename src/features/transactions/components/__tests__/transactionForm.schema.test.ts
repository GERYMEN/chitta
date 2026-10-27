import {
  amountInputToMinor,
  minorToAmountInput,
  transactionFormSchema,
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
