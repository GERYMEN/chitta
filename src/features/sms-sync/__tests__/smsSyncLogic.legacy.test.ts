/**
 * R5-fix C1 — v1 decision keys after the reader v2 upgrade. SYNTHETIC SMS only.
 * Legacy keys come from the frozen v1 normalizer over the same raw body — never
 * a guessed bank 'unknown' variant.
 */
import { Account } from '../../../domain/accounts/account.types';
import { readSmsMessage } from '../parser/readSms';
import { normalizeAccountKeyV1, legacyKeyString } from '../legacy/normalizeAccountKeyV1';
import { decisionKeyFor, legacyDecisionKeyFor, partitionCandidates } from '../smsSyncLogic';

const DATE = Date.parse('2026-11-03T05:00:00.000Z');

const account = (overrides: Partial<Account> = {}): Account => ({
  id: 'acc-1',
  name: 'QA Account',
  type: 'bank',
  lastFour: null,
  openingBalanceMinor: 0,
  currency: 'INR',
  isActive: true,
  balanceAnchorMinor: null,
  balanceAnchorAt: null,
  deletedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

function txn(body: string, address = 'AD-HDFCBK-S') {
  const t = readSmsMessage({ id: '5', address, body, date: DATE }).transaction;
  if (!t) throw new Error(`not a transaction: ${body}`);
  return t;
}

const routes = (entries: Array<[string, string]>) => ({ routes: new Map(entries), ignored: new Set<string>() });
const ignored = (keys: string[]) => ({ routes: new Map<string, string>(), ignored: new Set(keys) });

/** v1 input → the exact key v1 (commit d76ee0e) produced for it. */
const V1_KEY_TABLE: ReadonlyArray<readonly [string, string]> = [
  ['Rs.500.00 debited from HDFC Bank A/c XX1234 to QA PAYEE', 'hdfc:bank:1234'],
  ['Rs.500.00 sent via HDFC UPI to qa.payee@okqa', 'hdfc:upi:'],
  ['Rs.500.00 debited from Central Bank of India A/c XX1234 to QA PAYEE', 'boi:bank:1234'],
  ['Rs.500.00 spent on Amex card ** 41006 at QA STORE', 'unknown:upi:'],
  ['Rs.500.00 spent on HDFC Bank Debit Card ending 1234 at QA STORE', 'hdfc:credit_card:1234'],
  ['Rs.500.00 spent on ICICI Bank Card XX1234 at QA STORE', 'icici:upi:1234'],
  ['Txn Rs.500.00 On HDFC Bank Card 1234 At QA STORE', 'hdfc:upi:1234'],
  ['Rs.500.00 spent on SBI Credit Card ending 1234 at QA STORE', 'sbi:credit_card:1234'],
  ['Rs.500.00 paid to QA PAYEE ending 1234', 'unknown:upi:'],
  ['Rs.500.00 debited from A/c XX1234 to QA PAYEE', 'unknown:bank:1234'],
];

describe('C1 — frozen v1 key derivation', () => {
  it.each(V1_KEY_TABLE.map(([b, k]) => [k, b] as const))('%s ← %s', (key, body) => {
    expect(legacyKeyString(normalizeAccountKeyV1(body))).toBe(key);
  });

  it('the reader carries the exact v1 key for every table body', () => {
    for (const [body, key] of V1_KEY_TABLE) {
      const t = txn(body);
      expect(legacyKeyString(t.legacyKey!)).toBe(key);
      const legacy = legacyDecisionKeyFor(t);
      // Never a guessed key: the legacy key is v1's or none (same as primary).
      expect(legacy === null ? decisionKeyFor(t) : legacy).toBe(key);
    }
  });
});

describe('C1 — v1 decisions keep routing exactly as in v1', () => {
  it('a v1 link on the v1 key routes the SMS to that account (Central Bank → boi)', () => {
    const t = txn('Rs.500.00 debited from Central Bank of India A/c XX1234 to QA PAYEE', 'AD-CENTBK-S');
    expect(decisionKeyFor(t)).not.toBe('boi:bank:1234');
    const out = partitionCandidates([t], [account({ id: 'acc-live' })], new Set(), routes([['boi:bank:1234', 'acc-live']]));
    expect(out.matched.map(m => m.accountId)).toEqual(['acc-live']);
  });

  it('a v1 ignore on the v1 key still drops the SMS (Amex 5-digit tail)', () => {
    const t = txn('Rs.500.00 spent on Amex card ** 41006 at QA STORE', 'AD-AMEXIN-S');
    expect(t.lastFour).toBe('1006');
    const out = partitionCandidates([t], [account()], new Set(), ignored(['unknown:upi:']));
    expect(out.dropped).toHaveLength(1);
    expect(out.unmatched).toHaveLength(0);
  });

  it('debit card re-kinded to bank by v2 still follows its v1 credit_card link', () => {
    const t = txn('Rs.500.00 spent on HDFC Bank Debit Card ending 1234 at QA STORE');
    expect(t.accountKind).toBe('bank');
    const out = partitionCandidates(
      [t],
      [account({ id: 'acc-card' })],
      new Set(),
      routes([['hdfc:credit_card:1234', 'acc-card']]),
    );
    expect(out.matched.map(m => m.accountId)).toEqual(['acc-card']);
  });

  it('debit card still matches the account v1 matched (v1 kind + last-4)', () => {
    const t = txn('Rs.500.00 spent on HDFC Bank Debit Card ending 1234 at QA STORE');
    const v1Account = account({ id: 'acc-v1', type: 'credit_card', lastFour: '1234' });
    const out = partitionCandidates([t], [v1Account], new Set());
    expect(out.matched.map(m => m.accountId)).toEqual(['acc-v1']);
  });

  it('a v1 ignore on "unknown:upi:" does NOT drop an SMS that names HDFC (v1 key hdfc:upi:)', () => {
    const t = txn('Rs.500.00 sent via HDFC UPI to qa.payee@okqa');
    const out = partitionCandidates([t], [account()], new Set(), ignored(['unknown:upi:']));
    expect(out.unmatched).toHaveLength(1);
    expect(out.dropped).toHaveLength(0);
  });

  it('a v1 link on "unknown:bank:" does NOT capture an SMS that names HDFC', () => {
    const t = txn('Rs.500.00 sent via HDFC UPI to qa.payee@okqa');
    const out = partitionCandidates([t], [account({ id: 'acc-live' })], new Set(), routes([['unknown:bank:', 'acc-live']]));
    expect(out.matched).toHaveLength(0);
  });

  it('a v1 D10 deleted key on the v1 key drops the SMS; an unrelated unknown key does not', () => {
    const t = txn('Rs.500.00 spent on Amex card ** 41006 at QA STORE', 'AD-AMEXIN-S');
    expect(partitionCandidates([t], [account()], new Set(['unknown:upi:'])).dropped).toHaveLength(1);
    const h = txn('Rs.500.00 sent via HDFC UPI to qa.payee@okqa');
    expect(partitionCandidates([h], [account()], new Set(['unknown:upi:'])).unmatched).toHaveLength(1);
  });

  it('the v2 key still routes first', () => {
    const t = txn('Rs.500.00 debited from Central Bank of India A/c XX1234 to QA PAYEE', 'AD-CENTBK-S');
    const out = partitionCandidates(
      [t],
      [account({ id: 'acc-v2' }), account({ id: 'acc-v1' })],
      new Set(),
      routes([[decisionKeyFor(t), 'acc-v2'], ['boi:bank:1234', 'acc-v1']]),
    );
    expect(out.matched.map(m => m.accountId)).toEqual(['acc-v2']);
  });
});
