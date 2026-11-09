/**
 * R5d T3a / T3b / T3c — pure account-alias helpers (SYNTHETIC accounts only).
 */
import { Account } from '../../../domain/accounts/account.types';
import { ParsedSmsTransaction } from '../smsParser';
import { partitionCandidates, resolveAccountBySuffix } from '../smsSyncLogic';
import { debitCardLinkTarget, linkedNumbersFor, SuggestionGroup } from '../suggestionGroups';

const account = (id: string, name: string, lastFour: string | null, patch: Partial<Account> = {}): Account => ({
  id,
  name,
  type: 'bank',
  lastFour,
  openingBalanceMinor: 0,
  currency: 'INR',
  isActive: true,
  balanceAnchorMinor: null,
  balanceAnchorAt: null,
  deletedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...patch,
} as Account);

const parsed = (patch: Partial<ParsedSmsTransaction> = {}): ParsedSmsTransaction => ({
  type: 'expense',
  amountMinor: 1000,
  merchantName: 'QA STORE',
  occurredAt: '2026-11-03T05:00:00.000Z',
  confidenceScore: 85,
  sanitizedPreview: 'Debited ₹10 — QA STORE',
  sourceReferenceHash: 'sms-1-1',
  bankName: 'ICICI',
  bankCanonical: 'icici',
  accountKind: 'bank',
  lastFour: null,
  lastDigits: '888',
  ...patch,
});

const group = (patch: Partial<SuggestionGroup['suggestion']> = {}, bankCanonical = 'hdfc'): SuggestionGroup => ({
  key: 'k',
  decisionKey: 'd',
  bankCanonical,
  suggestion: { bankName: 'HDFC', accountKind: 'bank', lastFour: '5678', messageCount: 1, ...patch },
  items: [],
});

describe('T3a resolveAccountBySuffix', () => {
  it('one same-bank account ending in the digits → that account', () => {
    expect(resolveAccountBySuffix([account('a', 'ICICI Bank', '7888'), account('b', 'HDFC Bank', '1888')], parsed())).toBe('a');
  });

  it('no match / two matches / other bank / unknown bank / has a last-4 → null', () => {
    expect(resolveAccountBySuffix([account('a', 'ICICI Bank', '7889')], parsed())).toBeNull();
    expect(resolveAccountBySuffix([account('a', 'ICICI Bank', '7888'), account('b', 'ICICI Savings', '1888')], parsed())).toBeNull();
    expect(resolveAccountBySuffix([account('a', 'HDFC Bank', '7888')], parsed())).toBeNull();
    expect(resolveAccountBySuffix([account('a', 'My Bank', '7888')], parsed({ bankCanonical: 'unknown' }))).toBeNull();
    expect(resolveAccountBySuffix([account('a', 'ICICI Bank', '7888')], parsed({ lastFour: '7888' }))).toBeNull();
  });

  it('partitionCandidates: an ignored key still wins over a suffix match; deleted accounts never match', () => {
    const accounts = [account('a', 'ICICI Bank', '7888')];
    expect(partitionCandidates([parsed()], accounts, new Set()).matched[0].accountId).toBe('a');
    const ignored = { routes: new Map(), ignored: new Set(['icici:bank:']) };
    expect(partitionCandidates([parsed()], accounts, new Set(), ignored).dropped).toHaveLength(1);
    const deleted = [account('a', 'ICICI Bank', '7888', { deletedAt: '2026-10-02T00:00:00.000Z' })];
    expect(partitionCandidates([parsed()], deleted, new Set()).unmatched).toHaveLength(1);
  });
});

describe('T3b debitCardLinkTarget (owner decision O2)', () => {
  it('a bank-kind group whose bank has exactly one active bank account → that account', () => {
    const hdfc = account('h', 'HDFC Savings', '1234');
    expect(debitCardLinkTarget(group(), [hdfc, account('i', 'ICICI Bank', '9999')])?.id).toBe('h');
  });

  it('two active bank accounts at the bank, none, or a card / unknown group → null (no suggestion)', () => {
    expect(debitCardLinkTarget(group(), [account('h1', 'HDFC Savings', '1234'), account('h2', 'HDFC Salary', '4321')])).toBeNull();
    expect(debitCardLinkTarget(group(), [account('i', 'ICICI Bank', '9999')])).toBeNull();
    expect(debitCardLinkTarget(group({ accountKind: 'credit_card' }), [account('h', 'HDFC Savings', '1234')])).toBeNull();
    expect(debitCardLinkTarget(group({}, 'unknown'), [account('h', 'Unknown bank', '1234')])).toBeNull();
  });

  it('ignores deleted accounts and non-bank accounts of the same bank', () => {
    const accounts = [
      account('h', 'HDFC Savings', '1234'),
      account('hd', 'HDFC Old', '1111', { deletedAt: '2026-10-02T00:00:00.000Z' }),
      account('hc', 'HDFC Credit Card', '9999', { type: 'credit_card' }),
    ];
    expect(debitCardLinkTarget(group(), accounts)?.id).toBe('h');
  });
});

describe('T3c linkedNumbersFor', () => {
  it("lists only this account's 'linked' decisions as bank · kind · ••last4 (no SMS content)", () => {
    const rows = [
      { key: 'hdfc:bank:5678', bankCanonical: 'hdfc', accountKind: 'bank' as const, lastFour: '5678', decision: 'linked' as const, accountId: 'h' },
      { key: 'hdfc:credit_card:9999', bankCanonical: 'hdfc', accountKind: 'credit_card' as const, lastFour: '9999', decision: 'linked' as const, accountId: 'h' },
      { key: 'sbi:bank:1111', bankCanonical: 'sbi', accountKind: 'bank' as const, lastFour: '1111', decision: 'added' as const, accountId: 'h' },
      { key: 'axis:bank:2222', bankCanonical: 'axis', accountKind: 'bank' as const, lastFour: '2222', decision: 'linked' as const, accountId: 'other' },
      { key: 'paytm:other:', bankCanonical: 'paytm', accountKind: 'other' as const, lastFour: '', decision: 'linked' as const, accountId: 'h' },
    ];
    expect(linkedNumbersFor(rows, 'h').map(n => n.label)).toEqual([
      'HDFC · Bank · ••5678',
      'HDFC · Credit Card · ••9999',
      'Paytm · Other · no number',
    ]);
  });
});
