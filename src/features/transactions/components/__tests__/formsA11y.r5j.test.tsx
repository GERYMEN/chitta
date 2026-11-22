/** R5j T4 — Add Record selectors expose radio role + selected state. Synthetic. */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { TransactionForm } from '../TransactionForm';
import { TransferForm } from '../TransferForm';
import { useTransactionsStore } from '../../state/transactionsStore';
import { prefillFromReconcile } from '../../screens/AddRecordScreen';

jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('../../../../data/db/connection', () => ({
  getDatabase: jest.fn(),
  runMigrations: jest.fn(async () => undefined),
}));

const account = (id: string, name: string, lastFour: string) => ({
  id,
  name,
  type: 'bank' as const,
  lastFour,
  openingBalanceMinor: 0,
  currency: 'INR' as const,
  isActive: true,
  balanceAnchorAt: null,
  balanceAnchorMinor: null,
  deletedAt: null,
  creditLimitMinor: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});

beforeEach(() => {
  useTransactionsStore.setState({
    accounts: [account('acc-a', 'QA Bank A', '9999'), account('acc-b', 'QA Bank B', '1111')],
    categories: [
      { id: 'cat-shopping', name: 'Shopping', parentId: null, type: 'both', icon: 'x', isSystem: true, archivedAt: null, color: null },
    ],
  });
});

async function mount(el: React.ReactElement) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(el);
  });
  return r;
}
const radio = (r: ReactTestRenderer.ReactTestRenderer, label: string) =>
  r.root.findAll(
    n => n.props.accessibilityRole === 'radio' && n.props.accessibilityLabel === label && typeof n.props.onPress === 'function',
  )[0];
const selectedOf = (n: ReactTestRenderer.ReactTestInstance) => n.props.accessibilityState?.selected;

describe('TransactionForm selectors', () => {
  it('account options are radios with selected state that follows the choice', async () => {
    const r = await mount(<TransactionForm initialValues={{ accountId: 'acc-a' }} onSubmit={jest.fn()} />);
    expect(selectedOf(radio(r, 'QA Bank A'))).toBe(true);
    expect(selectedOf(radio(r, 'QA Bank B'))).toBe(false);
    await ReactTestRenderer.act(async () => {
      radio(r, 'QA Bank B').props.onPress();
    });
    expect(selectedOf(radio(r, 'QA Bank B'))).toBe(true);
    expect(selectedOf(radio(r, 'QA Bank A'))).toBe(false);
  });

  it('kind (Expense / Income) selector: radios, exactly the current kind selected', async () => {
    const r = await mount(<TransactionForm initialValues={{ type: 'income' }} onSubmit={jest.fn()} />);
    expect(selectedOf(radio(r, 'Expense'))).toBe(false);
    expect(selectedOf(radio(r, 'Income'))).toBe(true);
  });

  it('the reconcile "Add missing" prefill still pre-selects account + kind', async () => {
    const initial = prefillFromReconcile({ accountId: 'acc-b', type: 'expense', amountMinor: 5000 });
    const r = await mount(<TransactionForm initialValues={initial} onSubmit={jest.fn()} />);
    expect(selectedOf(radio(r, 'QA Bank B'))).toBe(true);
    expect(selectedOf(radio(r, 'Expense'))).toBe(true);
  });
});

describe('TransferForm selectors', () => {
  it('From / To accounts: radio + selected; kind row marks Transfer selected', async () => {
    const r = await mount(
      <TransferForm initialValues={{ fromAccountId: 'acc-a', toAccountId: 'acc-b' }} onChooseType={jest.fn()} onSubmit={jest.fn()} />,
    );
    expect(selectedOf(radio(r, 'From QA Bank A'))).toBe(true);
    expect(selectedOf(radio(r, 'From QA Bank B'))).toBe(false);
    expect(selectedOf(radio(r, 'To QA Bank B'))).toBe(true);
    const kind = r.root.findAll(n => n.props.accessibilityRole === 'radio' && n.props.accessibilityLabel === 'Transfer')[0];
    expect(selectedOf(kind)).toBe(true);
    expect(selectedOf(radio(r, 'Expense'))).toBe(false);
  });
});
