/**
 * R5e T3 — the meaning card on a Pending item and the Settings rules list:
 * confirm (with / without "automatically next time"), "It's an expense",
 * "Choose account" (filtered picker), "Add … account" (prefill), Undo from the
 * snackbar, ≥ 48 dp targets and labelled controls. R5e-FIX: refund-linked
 * expense (M5) and Detail "Undo transfer" for a meaning transfer (K2).
 * SYNTHETIC data only.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import { MeaningCard } from '../components/MeaningCard';
import { MeaningRulesSection } from '../components/MeaningRulesSection';
import { REFUND_LINKED_NOTE } from '../meaningLabels';
import { TransactionDetailActions } from '../../transactions/components/TransactionDetailContent';
import { useTransactionsStore } from '../../transactions/state/transactionsStore';
import { useSnackbarStore } from '../../../shared/ui/Snackbar';
import { useDialogStore } from '../../../shared/ui/Dialog';
import type { Account, AccountType } from '../../../domain/accounts/account.types';
import type { Transaction } from '../../../domain/transactions/transaction.types';
import type { MeaningSuggestion } from '../../../domain/meaning/meaning.types';

jest.mock('../../../data/db/connection', () => ({ getDatabase: jest.fn(), runMigrations: jest.fn() }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}));

const T = '2026-11-05T10:00:00.000Z';
const acc = (id: string, name: string, type: AccountType, lastFour: string | null): Account => ({
  id, name, type, lastFour, openingBalanceMinor: 0, currency: 'INR', isActive: true,
  balanceAnchorMinor: null, balanceAnchorAt: null, deletedAt: null, createdAt: T, updatedAt: T,
});
const BANK = acc('bank', 'QA Axis Bank', 'bank', '1234');
const CARD = acc('card', 'QA Axis Credit Card', 'credit_card', '9999');
const CARD2 = acc('card2', 'QA Axis Platinum', 'credit_card', '9999');

const ROW = {
  id: 'tx-1', type: 'expense', status: 'pending', amountMinor: 500000, currency: 'INR', merchantName: 'QA-Merchant-60',
  categoryId: 'cat-uncategorised', accountId: 'bank', paymentMethod: 'other', occurredAt: T, detectedAt: T,
  approvedAt: null, note: null, sourceType: 'sms', sourceReferenceHash: 'sms-1-1', sanitizedPreview: null,
  confidenceScore: 85, parserVersion: 'sms-reader-v2', createdAt: T, updatedAt: T, transferAccountId: null,
  linkedTransactionId: null, linkKind: null,
} as unknown as Transaction;

const SUGGESTION: MeaningSuggestion = {
  transactionId: 'tx-1', kind: 'card_payment', targetAccountId: 'card', reason: 'unique', bankCanonical: 'axis',
  counterpartyKey: '9999', createdAt: T, resolvedAt: null, resolution: null,
};

const confirmMeaning = jest.fn(async () => true);
const dismissMeaning = jest.fn(async () => true);
const undoMeaning = jest.fn(async () => true);
const removeMeaningRule = jest.fn(async () => undefined);

function seed(accounts: Account[]) {
  useTransactionsStore.setState({
    accounts,
    transactions: [ROW],
    meaningRules: [],
    meaningSuggestions: [SUGGESTION],
    confirmMeaning,
    dismissMeaning,
    undoMeaning,
    removeMeaningRule,
  } as never);
}

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
async function render(node: React.ReactElement) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(node);
  });
  mounted.push(r);
  return r;
}
afterEach(() => {
  mounted.splice(0).forEach(r => ReactTestRenderer.act(() => r.unmount()));
  jest.clearAllMocks();
});
const byTestId = (r: ReactTestRenderer.ReactTestRenderer, id: string) => r.root.find(n => n.props.testID === id && typeof n.type !== 'string' && n.props.onPress);
const texts = (r: ReactTestRenderer.ReactTestRenderer) => r.root.findAllByType(Text).map(t => [].concat(t.props.children).join(''));

describe('R5e T3 — MeaningCard', () => {
  it('unique target: chip + "Confirm transfer to <account>"; confirm stores the rule by default; snackbar Undo undoes', async () => {
    seed([BANK, CARD]);
    const r = await render(<MeaningCard suggestion={SUGGESTION} transaction={ROW} />);
    expect(texts(r)).toEqual(expect.arrayContaining(['Card bill payment', 'Confirm transfer to QA Axis Credit Card ••••9999', "It's an expense", 'Do this automatically next time']));
    const checkbox = byTestId(r, 'meaning-remember');
    expect(checkbox.props.accessibilityRole).toBe('checkbox');
    expect(checkbox.props.accessibilityState).toEqual({ checked: true });
    await ReactTestRenderer.act(async () => byTestId(r, 'meaning-primary').props.onPress());
    expect(confirmMeaning).toHaveBeenCalledWith('tx-1', 'card', { remember: true });
    const snack = useSnackbarStore.getState().current;
    expect(snack?.message).toContain('Recorded as a transfer to QA Axis Credit Card');
    expect(snack?.actionLabel).toBe('Undo');
    await ReactTestRenderer.act(async () => snack?.onAction?.());
    expect(undoMeaning).toHaveBeenCalledWith('tx-1');
  });

  it('unticking "Do this automatically next time" confirms without a rule', async () => {
    seed([BANK, CARD]);
    const r = await render(<MeaningCard suggestion={SUGGESTION} transaction={ROW} />);
    await ReactTestRenderer.act(async () => byTestId(r, 'meaning-remember').props.onPress());
    expect(byTestId(r, 'meaning-remember').props.accessibilityState).toEqual({ checked: false });
    await ReactTestRenderer.act(async () => byTestId(r, 'meaning-primary').props.onPress());
    expect(confirmMeaning).toHaveBeenCalledWith('tx-1', 'card', { remember: false });
  });

  it('"It\'s an expense" dismisses the suggestion', async () => {
    seed([BANK, CARD]);
    const r = await render(<MeaningCard suggestion={SUGGESTION} transaction={ROW} />);
    await ReactTestRenderer.act(async () => byTestId(r, 'meaning-dismiss').props.onPress());
    expect(dismissMeaning).toHaveBeenCalledWith('tx-1');
    expect(useSnackbarStore.getState().current?.message).toBe('Kept as an expense');
  });

  it('ambiguous: "Choose account" opens the picker with only credit cards, never the item’s own account', async () => {
    seed([BANK, CARD, CARD2]);
    const r = await render(<MeaningCard suggestion={{ ...SUGGESTION, targetAccountId: null, reason: 'ambiguous' }} transaction={ROW} />);
    expect(texts(r)).toContain('Choose account');
    await ReactTestRenderer.act(async () => byTestId(r, 'meaning-primary').props.onPress());
    const options = r.root.findAll(
      n => typeof n.type !== 'string' && typeof n.props.onPress === 'function' && /^To /.test(String(n.props.accessibilityLabel ?? '')),
    );
    const labels = Array.from(new Set(options.map(o => o.props.accessibilityLabel)));
    expect(labels).toEqual(['To QA Axis Credit Card ••••9999', 'To QA Axis Platinum ••••9999']);
    const platinum = options.find(o => o.props.accessibilityLabel === 'To QA Axis Platinum ••••9999')!;
    await ReactTestRenderer.act(async () => platinum.props.onPress());
    expect(confirmMeaning).toHaveBeenCalledWith('tx-1', 'card2', { remember: true });
  });

  it('missing: "Add credit card ••9999 account" opens Add Account prefilled', async () => {
    seed([BANK]);
    const r = await render(<MeaningCard suggestion={{ ...SUGGESTION, targetAccountId: null, reason: 'missing' }} transaction={ROW} />);
    expect(texts(r)).toContain('Add credit card ••9999 account');
    await ReactTestRenderer.act(async () => byTestId(r, 'meaning-primary').props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('AddAccount', {
      prefill: { name: 'Axis Credit Card', type: 'credit_card', lastFour: '9999' },
    });
  });

  it('every control is at least 48 dp tall', async () => {
    seed([BANK, CARD]);
    const r = await render(<MeaningCard suggestion={SUGGESTION} transaction={ROW} />);
    const flat = (style: unknown): Record<string, unknown> =>
      Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : typeof style === 'function' ? flat(style({ pressed: false })) : ((style as Record<string, unknown>) ?? {});
    for (const id of ['meaning-primary', 'meaning-dismiss', 'meaning-remember']) {
      const style = flat(byTestId(r, id).props.style);
      expect(Number(style.minHeight ?? style.height ?? 0)).toBeGreaterThanOrEqual(48);
    }
  });
});

describe('R5e T3 — Settings → Automatic money rules', () => {
  it('lists rules (bank · kind · ••last4 → account) and Remove asks first, then removes', async () => {
    seed([BANK, CARD]);
    useTransactionsStore.setState({
      meaningRules: [{ id: 'mrule-1', bankCanonical: 'axis', kind: 'card_payment', counterpartyKey: '9999', targetAccountId: 'card', createdAt: T }],
    });
    const r = await render(<MeaningRulesSection />);
    expect(texts(r)).toContain('Axis · Card bill payment · ••9999 → QA Axis Credit Card ••••9999');
    const remove = byTestId(r, 'settings-meaning-rule-remove');
    expect(remove.props.accessibilityLabel).toContain('QA Axis Credit Card');
    let pending!: Promise<void>;
    await ReactTestRenderer.act(async () => {
      pending = remove.props.onPress();
    });
    const dialog = useDialogStore.getState().current;
    expect(dialog?.title).toBe('Remove this automatic rule?');
    await ReactTestRenderer.act(async () => {
      dialog?.actions?.find(a => a.label === 'Remove')?.onPress?.();
      await pending;
    });
    expect(removeMeaningRule).toHaveBeenCalledWith('mrule-1');
  });

  it('shows a hint when there are no rules', async () => {
    seed([BANK]);
    const r = await render(<MeaningRulesSection />);
    expect(texts(r).join(' ')).toContain('None yet');
  });
});

describe('R5e-FIX M5 / K2 — refund-linked card and the Detail "Undo transfer"', () => {
  it('M5: an expense with a linked refund offers only "It\'s an expense" and says why', async () => {
    seed([BANK, CARD]);
    const refund = {
      ...ROW, id: 'tx-r', type: 'income', amountMinor: 10000, linkedTransactionId: 'tx-1', linkKind: 'refund',
    } as unknown as Transaction;
    useTransactionsStore.setState({ transactions: [ROW, refund] });
    const r = await render(<MeaningCard suggestion={SUGGESTION} transaction={ROW} />);
    expect(texts(r)).toContain(REFUND_LINKED_NOTE);
    expect(r.root.findAll(n => n.props.testID === 'meaning-primary')).toHaveLength(0);
    expect(r.root.findAll(n => n.props.testID === 'meaning-remember')).toHaveLength(0);
    await ReactTestRenderer.act(async () => byTestId(r, 'meaning-dismiss').props.onPress());
    expect(dismissMeaning).toHaveBeenCalledWith('tx-1');
    expect(confirmMeaning).not.toHaveBeenCalled();
  });

  const TRANSFER = {
    ...ROW, type: 'transfer', status: 'approved', transferAccountId: 'card',
  } as unknown as Transaction;
  const detail = (onUndoTransfer: jest.Mock) => (
    <TransactionDetailActions
      transaction={TRANSFER}
      onApprove={jest.fn()}
      onEdit={jest.fn()}
      onReject={jest.fn()}
      onUndoTransfer={onUndoTransfer}
    />
  );

  it('K2: a meaning transfer with no twin shows "Undo transfer" on Detail', async () => {
    seed([BANK, CARD]);
    useTransactionsStore.setState({
      transactions: [TRANSFER],
      meaningSuggestions: [{ ...SUGGESTION, resolvedAt: T, resolution: 'transfer' }],
    });
    const onUndo = jest.fn();
    const r = await render(detail(onUndo));
    await ReactTestRenderer.act(async () => byTestId(r, 'detail-undo-transfer').props.onPress());
    expect(onUndo).toHaveBeenCalledWith(TRANSFER);
  });

  it('K2: a manual transfer with no twin and no meaning confirm has no "Undo transfer"', async () => {
    seed([BANK, CARD]);
    useTransactionsStore.setState({ transactions: [TRANSFER], meaningSuggestions: [] });
    const r = await render(detail(jest.fn()));
    expect(r.root.findAll(n => n.props.testID === 'detail-undo-transfer')).toHaveLength(0);
  });
});
