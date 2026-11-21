/**
 * R5i (G1) — message-type hardening:
 *  D-f 'failed' SMS: money did NOT move → never a transaction, never a bill,
 *      never "not understood" (it IS understood);
 *  D-g 'collect_request' SMS: a request to pay, not money moved → same;
 *  D-h multi-record (one SMS → 2 records via a template reparse) → 2
 *      candidates with distinct per-record reference hashes and correct amounts.
 * SYNTHETIC inputs only (QA names, XX1234 / XX234).
 */
import bundled from '../rules/rules.json';
import type { RulesDocument } from '../rules/rules.types';
import { compileRules } from '../rules/rulesLoader';
import { readSmsMessage, SmsInput } from '../parser/readSms';
import { runRulesEngine } from '../rules/rulesEngine';
import { readFromRules } from '../rules/ruleRead';
import { parseSender } from '../parser/senders';
import { billInputFromSms } from '../billIngest';
import { Account } from '../../../domain/accounts/account.types';

const rules = compileRules(bundled as unknown as RulesDocument);
const DATE = Date.parse('2026-11-05T06:00:00.000Z');
const HDFC = 'AD-HDFCBK-S';
const ICICI = 'AD-ICICIB-S';

const read = (address: string, body: string) =>
  readSmsMessage({ id: '9', address, body, date: DATE }, { rules, salt: 'qa-salt' });

/** The template-only read (the multi-record `reparse` path sync consumes). */
function templateRead(address: string, body: string) {
  const msg: SmsInput = { id: '9', address, body, date: DATE };
  const sender = parseSender(address);
  const engine = runRulesEngine(rules, { header: sender.header, senderKind: sender.kind, body, smsDate: DATE });
  return readFromRules(engine, { msg, sender, salt: 'qa-salt', rulesVersion: rules.version });
}

const account = (p: Partial<Account>): Account =>
  ({
    id: 'acc-1',
    name: 'QA Bank',
    type: 'bank',
    lastFour: '1234',
    openingBalanceMinor: 0,
    currency: 'INR',
    isActive: true,
    createdAt: 'x',
    updatedAt: 'x',
    ...p,
  }) as Account;

describe('D-f / D-g — failed and collect_request are dropped (no record, no bill, not "not understood")', () => {
  const cases: Array<[string, string, 'failed' | 'collect_request']> = [
    ['failed', 'Your txn of Rs.500.00 to QA PAYEE from A/c XX1234 has failed', 'failed'],
    [
      'collect_request',
      'QA PAYEE has requested Rs.500.00 from you. On approving, Rs.500.00 will be debited from A/c XX1234',
      'collect_request',
    ],
  ];

  it.each(cases)('%s → no transaction, no "not understood"', (_name, body, label) => {
    const r = read(HDFC, body);
    expect(r.label).toBe(label);
    expect(r.transaction).toBeNull();
    expect(r.extraTransactions ?? []).toHaveLength(0);
    // It IS understood — never recorded in "Messages not understood".
    expect(r.notUnderstood).toBeNull();
  });

  it.each(cases)('%s → never becomes a bill', (_name, body) => {
    const r = read(HDFC, body);
    const accounts = [account({})];
    const bill = billInputFromSms(r, { address: HDFC, body, date: DATE }, 'qa-salt', accounts);
    expect(bill).toBeNull();
  });
});

describe('D-h — multi-record (ATM withdrawal + fee) → 2 records, distinct hashes, correct amounts', () => {
  const body =
    'ICICI Bank Acct XX234 debited with INR 2,000.00 on 05-Nov-26 at ATM QA0001. Avl Bal INR 8,000.00. Rs 23.60 charged as ATM fee on Acct XX234.';

  it('the template emits a withdrawal record and a fee record with distinct per-record references', () => {
    const rule = templateRead(ICICI, body);
    const records = rule?.transactions ?? [];
    // The multi-record (reparse) path: one SMS → 2 transaction records.
    expect(records).toHaveLength(2);
    const amounts = records.map(t => t.amountMinor).sort((a, b) => a - b);
    expect(amounts).toEqual([2360, 200000]);
    // Distinct per-record reference hashes (second carries the #2 suffix) → 2
    // pending rows that dedupe independently.
    const hashes = records.map(t => t.sourceReferenceHash);
    expect(new Set(hashes).size).toBe(2);
    expect(hashes.some(h => h.endsWith('#2'))).toBe(true);
    // Distinct per-record content hashes too.
    const contentHashes = records.map(t => t.smsContentHash);
    expect(new Set(contentHashes).size).toBe(2);
  });
});
