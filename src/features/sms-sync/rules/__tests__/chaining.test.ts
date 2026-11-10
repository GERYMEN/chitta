/**
 * R5g item 21 — chaining: parent selection by match_type, outcomes are
 * suggestions + holds only (never a delete or merge). Synthetic ids only.
 */
import bundled from '../rules.json';
import type { RuleChainingRule, RulesDocument } from '../rules.types';
import type { RuleChainInfo } from '../ruleRead';
import {
  chainDuplicatePairs,
  chainOutcome,
  ChainParentFacts,
  ChainRow,
  findChainParent,
  isWaitingForMatchingAlert,
  INCOMPLETE_HOLD_MS,
  useChainSuggestions,
} from '../chaining';
import { findDuplicatePairs } from '../../../../domain/duplicates/duplicate.rules';
import { resolveChains } from '../../syncSms';
import { pendingTransactionFixtures } from '../../../../test/fixtures/transactions.fixture';
import type { Transaction } from '../../../../domain/transactions/transaction.types';

const doc = bundled as unknown as RulesDocument;
const ruleOf = (uid: string): RuleChainingRule => {
  for (const r of doc.rules) for (const p of r.patterns) if (p.pattern_UID === uid) return p.data_fields.chaining_rule!;
  throw new Error(uid);
};
const T = Date.parse('2026-11-05T06:00:00.000Z');
const MIN = 60_000;
const row = (id: string, over: Partial<ChainRow> = {}): ChainRow => ({
  id,
  status: 'pending',
  type: 'expense',
  amountMinor: 125000,
  accountId: 'acc-hdfc',
  occurredAt: new Date(T).toISOString(),
  refDigest: null,
  sourceType: 'sms',
  ...over,
});
const info = (rule: RuleChainingRule, extra: Partial<RuleChainInfo> = {}): RuleChainInfo => ({ rule, issuer: 'hdfc', incomplete: false, deleted: false, ...extra });
const parentOf = (r: ChainRow, parsed?: ChainParentFacts['parsed']): ChainParentFacts => ({ row: r, parsed });

describe('item 21: parent selection', () => {
  const dup = info(ruleOf('T-HDFC-0005')); // amount exact, account same_or_alias, date delta 1 h, type exact

  it('exact + same_or_alias + delta + exact type → closest parent in the window', () => {
    const child = { row: row('child'), parsed: { chain: dup } };
    const far = parentOf(row('far', { occurredAt: new Date(T - 50 * MIN).toISOString() }));
    const near = parentOf(row('near', { occurredAt: new Date(T - 5 * MIN).toISOString() }));
    const outside = parentOf(row('outside', { occurredAt: new Date(T - 70 * MIN).toISOString() }));
    expect(findChainParent(child, dup, [far, near, outside], () => true)?.row.id).toBe('near');
  });

  it('a different amount / account / direction / rejected row is never a parent', () => {
    const child = { row: row('child'), parsed: { chain: dup } };
    const cands = [
      parentOf(row('amt', { amountMinor: 1 })),
      parentOf(row('acct', { accountId: 'acc-other' })),
      parentOf(row('dir', { type: 'income' })),
      parentOf(row('rej', { status: 'rejected' })),
    ];
    expect(findChainParent(child, dup, cands, () => true)).toBeNull();
  });

  it('value / exact_if_present selectors (card payment chain)', () => {
    const chain = info(ruleOf('T-ICICI-0006'));
    const kinds = chain.rule.parent_selection.map(s => s.match_type);
    expect(kinds).toEqual(expect.arrayContaining(['value', 'exact_if_present', 'delta']));
    const child = { row: row('card-credit', { type: 'income', accountId: 'acc-card' }), parsed: { lastFour: '9999', chain } };
    const parent = parentOf(row('bank-debit', { occurredAt: new Date(T - DAY_MS).toISOString() }), { moneyKind: 'card_payment', counterpartyLastFour: '9999' });
    const wrongCard = parentOf(row('bank-debit-2'), { moneyKind: 'card_payment', counterpartyLastFour: '1111' });
    const noKind = parentOf(row('bank-debit-3'), { moneyKind: 'spend' });
    expect(findChainParent(child, chain, [parent, wrongCard, noKind], () => true)?.row.id).toBe('bank-debit');
  });

  it("'none' always passes; without an account selector the issuer must match", () => {
    const rule: RuleChainingRule = { parent_selection: [{ parent_field: 'amount', match_type: 'none' }] };
    const child = { row: row('child'), parsed: { chain: info(rule) } };
    const other = parentOf(row('p', { accountId: 'acc-sbi' }));
    expect(findChainParent(child, info(rule), [other], r => r.accountId === 'acc-hdfc')).toBeNull();
    expect(findChainParent(child, info(rule), [other], () => true)?.row.id).toBe('p');
  });
});

const DAY_MS = 24 * 60 * MIN;

describe('item 21: outcomes are suggestions + holds only', () => {
  it('deleted:true → duplicate suggestion, child held; no parent → nothing', () => {
    const chain = info(ruleOf('T-HDFC-0005'));
    const child = { row: row('c'), parsed: { chain } };
    const withParent = chainOutcome(child, chain, parentOf(row('p')));
    expect(withParent).toMatchObject({ kind: 'duplicate', hold: true, parentId: 'p', parentOverride: { incomplete: false } });
    expect(chainOutcome(child, chain, null)).toMatchObject({ kind: 'none', hold: false, parentId: null });
  });

  it("link 'refund' → refund-link suggestion; link 'transfer_twin' → held", () => {
    const refund = info(ruleOf('T-HDFC-0008'));
    expect(chainOutcome({ row: row('c'), parsed: { chain: refund } }, refund, parentOf(row('p'))).kind).toBe('refund_link');
    const twin = info(ruleOf('T-ICICI-0006'));
    expect(chainOutcome({ row: row('c'), parsed: { chain: twin } }, twin, parentOf(row('p'))).kind).toBe('transfer_twin');
  });

  it('incomplete → held and "waiting for the matching alert" for 24 h, completed by a child', () => {
    const rule: RuleChainingRule = { parent_selection: [{ parent_field: 'amount', child_field: 'amount', match_type: 'exact' }], parent_nomatch: { child_override: { incomplete: true } } };
    const chain = info(rule);
    const outcome = chainOutcome({ row: row('half'), parsed: { chain } }, chain, null);
    expect(outcome).toMatchObject({ kind: 'incomplete', hold: true });
    useChainSuggestions.getState().clear();
    useChainSuggestions.getState().add([outcome], T);
    const s = useChainSuggestions.getState().suggestions;
    expect(isWaitingForMatchingAlert(s, 'half', T + MIN)).toBe(true);
    expect(isWaitingForMatchingAlert(s, 'half', T + INCOMPLETE_HOLD_MS)).toBe(false);
    useChainSuggestions.getState().remove('half');
    expect(useChainSuggestions.getState().suggestions).toEqual([]);
  });

  it('a chain duplicate pair reaches R3b even outside its 10-minute window (no row is changed)', () => {
    const base = pendingTransactionFixtures[0];
    const a: Transaction = { ...base, id: 'a', occurredAt: new Date(T - 40 * MIN).toISOString(), refDigest: null };
    const b: Transaction = { ...base, id: 'b', occurredAt: new Date(T).toISOString(), refDigest: null };
    expect(findDuplicatePairs([a, b], [])).toEqual([]);
    const pairs = chainDuplicatePairs([{ kind: 'duplicate', childId: 'b', parentId: 'a', parentOverride: null, createdAt: T }]);
    const found = findDuplicatePairs([a, b], [], undefined, pairs);
    expect(found.map(p => [p.first.id, p.second.id])).toEqual([['a', 'b']]);
    expect(a.status).toBe('pending');
    expect(b.status).toBe('pending');
  });

  it('resolveChains (sync) finds the account-side alert for a debit-card alert', () => {
    const base = pendingTransactionFixtures[0];
    const chain = info(ruleOf('T-HDFC-0005'));
    const parent: Transaction = { ...base, id: 'acct-alert', accountId: 'acc-hdfc', type: 'expense', amountMinor: 125000, occurredAt: new Date(T - 20 * MIN).toISOString() };
    const child: Transaction = { ...base, id: 'card-alert', accountId: 'acc-hdfc', type: 'expense', amountMinor: 125000, occurredAt: new Date(T).toISOString() };
    const [outcome] = resolveChains(
      [{ row: child, parsed: { chain } }],
      [parent, child],
      [{ id: 'acc-hdfc', name: 'HDFC Bank' }],
      new Map(),
    );
    expect(outcome).toMatchObject({ kind: 'duplicate', parentId: 'acct-alert', childId: 'card-alert', hold: true });
  });
});
