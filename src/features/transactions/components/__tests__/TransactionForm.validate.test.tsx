import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { TransactionForm } from '../TransactionForm';
import { useTransactionsStore } from '../../state/transactionsStore';

jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('../../../../data/db/connection', () => ({
  getDatabase: jest.fn(),
  runMigrations: jest.fn(async () => undefined),
}));

const INITIAL = {
  type: 'income' as const,
  amount: '100.00',
  merchantName: 'QA-Merchant-10',
  categoryId: 'cat-shopping',
  accountId: 'acc-bank',
  paymentMethod: 'upi' as const,
  occurredAt: '2026-10-21T10:00:00.000Z',
  note: '',
};

beforeEach(() => {
  useTransactionsStore.setState({
    accounts: [
      {
        id: 'acc-bank',
        name: 'QA Delete Bank 9999',
        type: 'bank',
        lastFour: '9999',
        openingBalanceMinor: 0,
        currency: 'INR',
        isActive: true,
        balanceAnchorMinor: null,
        balanceAnchorAt: null,
        deletedAt: null,
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
    ],
    categories: [
      { id: 'cat-shopping', name: 'Shopping', parentId: null, type: 'both', icon: 'x', isSystem: true, archivedAt: null, color: null },
    ],
  });
});

async function submit(validate: jest.Mock, onSubmit: jest.Mock) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(
      <TransactionForm initialValues={INITIAL} onSubmit={onSubmit} validate={validate} />,
    );
  });
  const save = r.root.findAll(n => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function').pop()!;
  await ReactTestRenderer.act(async () => {
    save.props.onPress();
  });
  return r;
}

describe('TransactionForm validate (R3b.1 F1)', () => {
  it('a refused edit shows the message inline and does not submit', async () => {
    const onSubmit = jest.fn();
    const validate = jest.fn(() => ({ field: 'type' as const, message: 'A linked refund must stay income. Unlink the refund first.' }));
    const r = await submit(validate, onSubmit);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(JSON.stringify(r.toJSON())).toContain('A linked refund must stay income. Unlink the refund first.');
  });

  it('an allowed edit submits', async () => {
    const onSubmit = jest.fn();
    await submit(jest.fn(() => null), onSubmit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
