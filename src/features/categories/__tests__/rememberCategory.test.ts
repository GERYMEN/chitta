import { promptRememberCategory } from '../rememberCategory';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { useDialogStore } from '../../../shared/ui/Dialog/dialogStore';
import { useSnackbarStore } from '../../../shared/ui/Snackbar/snackbarStore';
import { Transaction } from '../../../domain/transactions/transaction.types';
import { Category } from '../../../domain/categories/category.types';

jest.mock('../../../data/db/connection', () => ({
  getDatabase: jest.fn(),
  runMigrations: jest.fn(async () => undefined),
}));

const cat = (id: string, name: string): Category => ({
  id, name, parentId: null, type: 'both', icon: 'x', isSystem: true, archivedAt: null, color: null,
});

const tx = (id: string, categoryId: string): Transaction => ({
  id, type: 'expense', status: 'pending', amountMinor: 1000, currency: 'INR',
  merchantName: 'QA-Merchant-08', categoryId, accountId: 'acc-qa', paymentMethod: 'upi',
  occurredAt: '2026-10-28T10:00:00.000Z', detectedAt: '2026-10-28T10:00:00.000Z', approvedAt: null,
  note: null, sourceType: 'manual', sourceReferenceHash: null, sanitizedPreview: null,
  confidenceScore: null, parserVersion: null, bulkBatchId: null,
  createdAt: '2026-10-28T10:00:00.000Z', updatedAt: '2026-10-28T10:00:00.000Z',
});

const flush = () => new Promise<void>(resolve => setImmediate(() => resolve()));

let saveMerchantRule: jest.Mock;
let applyCategoryChanges: jest.Mock;
let undoCategoryChanges: jest.Mock;

beforeEach(() => {
  saveMerchantRule = jest.fn(async () => undefined);
  applyCategoryChanges = jest.fn(async changes => changes);
  undoCategoryChanges = jest.fn(async () => undefined);
  useDialogStore.setState({ current: null });
  useSnackbarStore.setState({ current: null });
  useTransactionsStore.setState({
    transactions: [tx('t1', 'cat-food'), tx('t2', 'cat-uncategorised')],
    categories: [cat('cat-food', 'Food & Dining'), cat('cat-uncategorised', 'Uncategorised')],
    merchantRules: {},
    saveMerchantRule,
    applyCategoryChanges,
    undoCategoryChanges,
  });
});

const event = {
  transactionId: 't1',
  merchantName: 'QA-Merchant-08',
  previousCategoryId: 'cat-uncategorised',
  newCategoryId: 'cat-food',
};

function pressAction(label: string) {
  const current = useDialogStore.getState().current!;
  const action = current.actions.find(a => a.label === label)!;
  useDialogStore.getState().press(action);
}

describe('promptRememberCategory (T2 flow)', () => {
  it('Always → saves the rule → offers "Apply to 1 other" → apply → Undo snackbar', async () => {
    promptRememberCategory(event);
    expect(useDialogStore.getState().current?.title).toBe('Always use Food & Dining for QA-Merchant-08?');
    expect(useDialogStore.getState().current?.actions.map(a => a.label)).toEqual(['Just this one', 'Always']);

    pressAction('Always');
    await flush();
    expect(saveMerchantRule).toHaveBeenCalledWith('QA-Merchant-08', 'cat-food', 't1');
    expect(useDialogStore.getState().current?.title).toBe('Apply to 1 other QA-Merchant-08 item?');

    pressAction('Apply to 1');
    await flush();
    expect(applyCategoryChanges).toHaveBeenCalledWith([
      { id: 't2', accountId: 'acc-qa', fromCategoryId: 'cat-uncategorised', toCategoryId: 'cat-food' },
    ]);
    const snack = useSnackbarStore.getState().current!;
    expect(snack.actionLabel).toBe('Undo');
    useSnackbarStore.getState().press();
    await flush();
    expect(undoCategoryChanges).toHaveBeenCalledWith(applyCategoryChanges.mock.calls[0][0]);
  });

  it('Just this one saves nothing', async () => {
    promptRememberCategory(event);
    pressAction('Just this one');
    await flush();
    expect(saveMerchantRule).not.toHaveBeenCalled();
    expect(useDialogStore.getState().current).toBeNull();
  });

  it('no prompt for Uncategorised or an unchanged category', () => {
    promptRememberCategory({ ...event, newCategoryId: 'cat-uncategorised', previousCategoryId: 'cat-food' });
    promptRememberCategory({ ...event, previousCategoryId: 'cat-food' });
    expect(useDialogStore.getState().current).toBeNull();
  });

  it('when the rule already matches, skips "Always?" and offers apply directly', () => {
    useTransactionsStore.setState({ merchantRules: { 'qa merchant 08': 'cat-food' } });
    promptRememberCategory(event);
    expect(useDialogStore.getState().current?.title).toBe('Apply to 1 other QA-Merchant-08 item?');
  });
});
