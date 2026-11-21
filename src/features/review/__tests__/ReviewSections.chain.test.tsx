/**
 * R5i (G3, T2) — the Review "Linked by rules" section: a refund_link
 * suggestion renders; Accept reuses the refund-link store action and
 * re-checks at tap time (a stale pair → "This pair changed — not recorded" +
 * status superseded); Dismiss keeps the items apart with a 5 s Undo.
 * SYNTHETIC data only.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ReviewSections } from '../components/ReviewSections';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { useChainSuggestions } from '../../sms-sync/rules/chaining';
import { useSnackbarStore } from '../../../shared/ui/Snackbar';
import type { Account } from '../../../domain/accounts/account.types';
import type { Transaction } from '../../../domain/transactions/transaction.types';
import type { ChainSuggestion } from '../../sms-sync/rules/chaining';

jest.mock('../../../data/db/connection', () => ({ getDatabase: jest.fn(), runMigrations: jest.fn() }));

const T = '2026-11-21T10:00:00.000Z';
const acc = (id: string, name: string): Account => ({
  id, name, type: 'bank', lastFour: '1234', openingBalanceMinor: 0, currency: 'INR', isActive: true,
  balanceAnchorMinor: null, balanceAnchorAt: null, deletedAt: null, creditLimitMinor: null, createdAt: T, updatedAt: T,
});
const tx = (p: Partial<Transaction> & { id: string }): Transaction => ({
  type: 'expense', status: 'pending', amountMinor: 50000, currency: 'INR', merchantName: 'QA Merchant',
  categoryId: 'cat-uncategorised', accountId: 'acc-1', paymentMethod: 'other', occurredAt: T, detectedAt: T,
  approvedAt: null, note: null, sourceType: 'sms', sourceReferenceHash: null, sanitizedPreview: null,
  confidenceScore: 85, parserVersion: null, bulkBatchId: null, createdAt: T, updatedAt: T,
  transferAccountId: null, linkedTransactionId: null, linkKind: null, ...p,
} as Transaction);

const CHILD = tx({ id: 'child', type: 'income', merchantName: 'QA Refund' });
const PARENT = tx({ id: 'parent', type: 'expense' });

const linkRefund = jest.fn();

function setup(suggestion: ChainSuggestion) {
  useTransactionsStore.setState({
    accounts: [acc('acc-1', 'QA Bank')],
    transactions: [CHILD, PARENT],
    transferDismissals: [],
    duplicateDismissals: [],
    meaningSuggestions: [],
    linkRefund,
  } as never);
  useChainSuggestions.setState({ suggestions: [suggestion] });
}

const suggestion = (): ChainSuggestion => ({
  id: 's1', kind: 'refund_link', childId: 'child', parentId: 'parent', parentOverride: null, createdAt: 0,
});

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
async function render() {
  let r!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(<ReviewSections />);
  });
  mounted.push(r);
  return r;
}
afterEach(() => {
  mounted.splice(0).forEach(r => ReactTestRenderer.act(() => r.unmount()));
  jest.clearAllMocks();
});
const byTestId = (r: ReactTestRenderer.ReactTestRenderer, id: string) =>
  r.root.find(n => n.props.testID === id && typeof n.type !== 'string' && n.props.onPress);

describe('ReviewSections — Linked by rules', () => {
  it('renders a refund_link suggestion and Accept links it (reusing linkRefund)', async () => {
    linkRefund.mockResolvedValue(null); // success
    setup(suggestion());
    const r = await render();
    expect(byTestId(r, 'chain-accept')).toBeTruthy();
    await ReactTestRenderer.act(async () => byTestId(r, 'chain-accept').props.onPress());
    expect(linkRefund).toHaveBeenCalledWith('child', 'parent');
    expect(useSnackbarStore.getState().current?.message).toBe('Linked by rules');
    expect(useChainSuggestions.getState().suggestions).toHaveLength(0);
  });

  it('a stale pair (ok=false) → "This pair changed — not recorded" and the row leaves open', async () => {
    linkRefund.mockResolvedValue('missing'); // re-check failed
    setup(suggestion());
    const r = await render();
    await ReactTestRenderer.act(async () => byTestId(r, 'chain-accept').props.onPress());
    expect(useSnackbarStore.getState().current?.message).toBe('This pair changed — not recorded');
    expect(useChainSuggestions.getState().suggestions).toHaveLength(0);
  });

  it('Dismiss keeps the items apart with a 5 s Undo that reopens the suggestion', async () => {
    setup(suggestion());
    const r = await render();
    await ReactTestRenderer.act(async () => byTestId(r, 'chain-dismiss').props.onPress());
    const snack = useSnackbarStore.getState().current;
    expect(snack?.message).toBe('Kept as separate items');
    expect(snack?.actionLabel).toBe('Undo');
    expect(useChainSuggestions.getState().suggestions).toHaveLength(0);
    await ReactTestRenderer.act(async () => snack?.onAction?.());
    expect(useChainSuggestions.getState().suggestions.map(s => s.childId)).toEqual(['child']);
  });
});
