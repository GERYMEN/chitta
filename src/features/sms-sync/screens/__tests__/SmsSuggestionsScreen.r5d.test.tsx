/**
 * R5d T3b (O2) — "New accounts found" suggests linking a debit card's number
 * to its bank's only account. Suggestion only: the user confirms in the
 * existing link dialog. SYNTHETIC accounts / items only.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import { SmsSuggestionsScreen } from '../SmsSuggestionsScreen';
import { useTransactionsStore } from '../../../transactions/state/transactionsStore';
import { useSuggestionSession } from '../../suggestionSession';
import { groupUnmatchedCandidates } from '../../suggestionGroups';
import { ParsedSmsTransaction } from '../../smsParser';
import { Account } from '../../../../domain/accounts/account.types';
import { useDialogStore } from '../../../../shared/ui/Dialog';

jest.mock('../../../../data/db/connection', () => ({ getDatabase: jest.fn(), runMigrations: jest.fn() }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
var mockRunId = 'run-qa';
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: { runId: mockRunId } }),
}));

const account = (id: string, name: string, lastFour: string, type: Account['type'] = 'bank'): Account => ({
  id,
  name,
  type,
  lastFour,
  openingBalanceMinor: 0,
  currency: 'INR',
  isActive: true,
  balanceAnchorMinor: null,
  balanceAnchorAt: null,
  deletedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});

const item = (hash: string): ParsedSmsTransaction => ({
  type: 'expense',
  amountMinor: 30000,
  merchantName: 'QA CAFE',
  occurredAt: '2026-11-03T05:00:00.000Z',
  confidenceScore: 85,
  sanitizedPreview: 'Debited ₹300 — QA CAFE',
  sourceReferenceHash: hash,
  bankName: 'HDFC',
  bankCanonical: 'hdfc',
  accountKind: 'bank',
  lastFour: '5678',
});

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
async function render() {
  let r!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(<SmsSuggestionsScreen />);
  });
  mounted.push(r);
  return r;
}
const texts = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAllByType(Text).map(t => [].concat(t.props.children).join(''));

beforeEach(() => {
  useSuggestionSession.getState().clear();
  mockRunId = useSuggestionSession.getState().merge(groupUnmatchedCandidates([item('sms-1-1')]), new Set());
});

afterEach(() => {
  for (const r of mounted.splice(0)) ReactTestRenderer.act(() => r.unmount());
});

describe('SmsSuggestionsScreen — debit-card link suggestion', () => {
  it('shows "Looks like your debit card for <account>" and pre-selects it; the dialog confirms', async () => {
    useTransactionsStore.setState({ accounts: [account('acc-h', 'HDFC Savings', '1234'), account('acc-i', 'ICICI Bank', '9999')] });
    const r = await render();
    expect(texts(r)).toContain('Looks like your debit card for HDFC Savings ••••1234');
    const button = r.root.findByProps({ testID: `link-debit-${useSuggestionSession.getState().groups[0].key}` });
    await ReactTestRenderer.act(async () => button.props.onPress());
    const dialog = useDialogStore.getState().current;
    expect(dialog?.title).toBe('Link to HDFC Savings ••••1234?');
    expect(dialog?.message).toMatch(/^Looks like your debit card for HDFC Savings ••••1234\. 1 waiting transaction will be added/);
    // Nothing is linked until the user confirms.
    expect(useTransactionsStore.getState().transactions ?? []).toHaveLength(0);
  });

  it('no suggestion when the bank has two active bank accounts', async () => {
    useTransactionsStore.setState({
      accounts: [account('acc-h1', 'HDFC Savings', '1234'), account('acc-h2', 'HDFC Salary', '4321')],
      transactions: [],
    });
    const r = await render();
    expect(texts(r).some(t => t.startsWith('Looks like your debit card'))).toBe(false);
  });
});
