/**
 * R5e T3 — meaning card copy + live resolution, the "Automatic money rules"
 * line, masked last-4 in REDACTED mode. SYNTHETIC accounts only.
 */
import type { Account, AccountType } from '../../../domain/accounts/account.types';
import type { MeaningSuggestion } from '../../../domain/meaning/meaning.types';
import { setRedacted } from '../../../shared/privacy/redaction';
import {
  confirmedSnackbarText,
  meaningCardModel,
  meaningChipLabel,
  meaningRuleLabel,
  missingAccountAction,
} from '../meaningLabels';

const T = '2026-11-05T10:00:00.000Z';
const acc = (id: string, name: string, type: AccountType, lastFour: string | null): Account => ({
  id, name, type, lastFour, openingBalanceMinor: 0, currency: 'INR', isActive: true,
  balanceAnchorMinor: null, balanceAnchorAt: null, deletedAt: null, creditLimitMinor: null, createdAt: T, updatedAt: T,
});
const BANK = acc('bank', 'QA Axis Bank', 'bank', '1234');
const CARD = acc('card', 'QA Axis Credit Card', 'credit_card', '9999');
const CARD2 = acc('card2', 'QA Axis Platinum', 'credit_card', '9999');
const PAYTM = acc('paytm', 'QA Paytm Wallet', 'other', null);

const suggestion = (patch: Partial<MeaningSuggestion>): MeaningSuggestion => ({
  transactionId: 'tx-1',
  kind: 'card_payment',
  targetAccountId: null,
  reason: 'unique',
  bankCanonical: 'axis',
  counterpartyKey: '9999',
  createdAt: T,
  resolvedAt: null,
  resolution: null,
  ...patch,
});
const expenseOnBank = { accountId: 'bank', type: 'expense' as const };

afterEach(() => setRedacted(false));

describe('R5e T3 — meaning card model', () => {
  it('chips per kind (and the in side of a transfer)', () => {
    expect(meaningChipLabel('card_payment')).toBe('Card bill payment');
    expect(meaningChipLabel('atm')).toBe('Cash withdrawal');
    expect(meaningChipLabel('wallet_load')).toBe('Wallet top-up');
    expect(meaningChipLabel('transfer')).toBe('Transfer to own account');
    expect(meaningChipLabel('transfer', 'in')).toBe('Transfer from own account');
  });

  it('unique → "Confirm transfer to <account display label>" (a11y label says the account too)', () => {
    const m = meaningCardModel(suggestion({}), expenseOnBank, [BANK, CARD], []);
    expect(m.chip).toBe('Card bill payment');
    expect(m.action).toEqual({ kind: 'confirm', target: CARD });
    expect(m.primaryLabel).toBe('Confirm transfer to QA Axis Credit Card ••••9999');
    expect(m.primaryA11y).toContain('QA Axis Credit Card');
    expect(m.secondaryLabel).toBe("It's an expense");
    expect(m.pickerTypes).toEqual(['credit_card', 'pay_later']);
  });

  it('ambiguous → "Choose account"', () => {
    const m = meaningCardModel(suggestion({}), expenseOnBank, [BANK, CARD, CARD2], []);
    expect(m.action).toEqual({ kind: 'choose' });
    expect(m.primaryLabel).toBe('Choose account');
  });

  it('missing → "Add credit card ••9999 account" with the AddAccount prefill; once added, it resolves live', () => {
    const m = meaningCardModel(suggestion({}), expenseOnBank, [BANK], []);
    expect(m.primaryLabel).toBe('Add credit card ••9999 account');
    expect(m.action).toEqual({ kind: 'add', prefill: { name: 'Axis Credit Card', type: 'credit_card', lastFour: '9999' } });
    const after = meaningCardModel(suggestion({}), expenseOnBank, [BANK, CARD], []);
    expect(after.action).toEqual({ kind: 'confirm', target: CARD });
  });

  it('missing Cash / wallet / other own account', () => {
    expect(missingAccountAction(suggestion({ kind: 'atm', counterpartyKey: '' }), 'bank')).toEqual({
      label: 'Add Cash account',
      prefill: { name: 'Cash', type: 'cash', lastFour: null },
    });
    expect(missingAccountAction(suggestion({ kind: 'wallet_load', counterpartyKey: 'paytm' }), 'bank')).toEqual({
      label: 'Add Paytm account',
      prefill: { name: 'Paytm', type: 'other', lastFour: null },
    });
    expect(missingAccountAction(suggestion({ kind: 'transfer', counterpartyKey: '5678' }), 'bank')).toEqual({
      label: 'Add account ••5678',
      prefill: { name: 'Axis account', type: 'bank', lastFour: '5678' },
    });
  });

  it('income side (wallet alert): "Confirm transfer from <bank>", "It\'s income"', () => {
    const m = meaningCardModel(
      suggestion({ kind: 'wallet_load', counterpartyKey: 'in:1234', bankCanonical: 'paytm' }),
      { accountId: 'paytm', type: 'income' },
      [BANK, PAYTM],
      [],
    );
    expect(m.primaryLabel).toBe('Confirm transfer from QA Axis Bank ••••1234');
    expect(m.secondaryLabel).toBe("It's income");
    expect(m.chip).toBe('Wallet top-up');
  });

  it('REDACTED mode masks every last-4 (labels, Add copy, rules list, snackbar)', () => {
    setRedacted(true);
    const m = meaningCardModel(suggestion({}), expenseOnBank, [BANK, CARD], []);
    expect(m.primaryLabel).not.toContain('9999');
    expect(missingAccountAction(suggestion({}), 'bank').label).not.toContain('9999');
    const rule = { id: 'r', bankCanonical: 'axis', kind: 'card_payment' as const, counterpartyKey: '9999', targetAccountId: 'card', createdAt: T };
    expect(meaningRuleLabel(rule, [CARD])).not.toMatch(/9999/);
    expect(confirmedSnackbarText(CARD, true)).not.toMatch(/9999/);
  });

  it('rules list line: bank · kind · ••last4 → account', () => {
    const rule = { id: 'r', bankCanonical: 'axis', kind: 'card_payment' as const, counterpartyKey: '9999', targetAccountId: 'card', createdAt: T };
    expect(meaningRuleLabel(rule, [CARD])).toBe('Axis · Card bill payment · ••9999 → QA Axis Credit Card ••••9999');
    expect(meaningRuleLabel({ ...rule, kind: 'atm', counterpartyKey: '', targetAccountId: 'gone' }, [CARD])).toBe('Axis · Cash withdrawal → Unknown');
    expect(meaningRuleLabel({ ...rule, kind: 'wallet_load', counterpartyKey: 'paytm', targetAccountId: 'paytm' }, [PAYTM])).toBe(
      'Axis · Wallet top-up · Paytm → QA Paytm Wallet',
    );
  });

  it('snackbar copy', () => {
    expect(confirmedSnackbarText(CARD, false)).toBe('Recorded as a transfer to QA Axis Credit Card ••••9999');
    expect(confirmedSnackbarText(BANK, true, 'in')).toBe('Recorded as a transfer from QA Axis Bank ••••1234 · next time automatically');
  });
});
