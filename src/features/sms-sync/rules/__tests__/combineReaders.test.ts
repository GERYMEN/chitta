/**
 * R5g N1 (owner 2026-11-10) — one test per branch of "template vs reader".
 * SYNTHETIC bodies only (QA names, XX1234 / XX9999).
 */
import type { RuleDataFields, RuleIssuer, RulePattern } from '../rules.types';
import { compileRules } from '../rulesLoader';
import { transactionsAgree } from '../combineReaders';
import { readSmsMessage, readSmsWithReader, SmsInput } from '../../parser/readSms';
import { isRuleDisagreementRow, parserVersionFor } from '../../smsSyncLogic';

const DATE = Date.parse('2026-11-05T06:00:00.000Z');
const HDFC = 'AD-HDFCBK-S';
const DEBIT = 'Rs.500.00 debited from A/c XX1234 to QA PAYEE on 05-11-26';
const DEBIT_RE = 'rs\\.([\\d,.]+) debited from a/c xx(\\d{4}) to ([a-z ]+?) on';
const BASE: RuleDataFields = {
  transaction_type: 'debit',
  money_kind: 'spend',
  amount: { group_id: 1 },
  pan: { group_id: 2 },
  pos: { group_id: 3 },
  date: { use_sms_time: true },
};

function rulesWith(pattern: Partial<RulePattern>, issuer: Partial<RuleIssuer> = {}) {
  return compileRules({
    schema_version: 2,
    version: 9,
    min_app_version: '0.1.0',
    rules: [
      {
        name: 'hdfc',
        full_name: 'HDFC Bank',
        institution_kind: 'bank',
        senders: ['HDFCBK'],
        ...issuer,
        patterns: [
          { pattern_UID: 'T-QA-0001', sort_UID: 1, sms_type: 'transaction', account_type: 'bank', flags: 'i', regex: DEBIT_RE, data_fields: BASE, ...pattern },
        ],
      },
    ],
  });
}

const msg = (body: string): SmsInput => ({ id: '3', address: HDFC, body, date: DATE });
const both = (body: string, rules: ReturnType<typeof rulesWith>) => ({
  reader: readSmsWithReader(msg(body), { salt: 'qa-salt' }),
  combined: readSmsMessage(msg(body), { rules, salt: 'qa-salt' }),
});

describe('N1 — template vs reader', () => {
  it('no pattern hit → the reader result, exactly as before', () => {
    const body = 'Rs.250.00 credited to HDFC Bank A/c XX1234 from QA PAYEE';
    const { reader, combined } = both(body, rulesWith({}));
    expect(combined).toEqual({ ...reader, source: 'reader' });
  });

  it('rules engine off (rules: null) → the reader result', () => {
    expect(readSmsMessage(msg(DEBIT), { rules: null })).toEqual({ ...readSmsWithReader(msg(DEBIT)), source: 'reader' });
  });

  it('pattern hit + reader found nothing → the template wins (source rule)', () => {
    const body = 'QA ODD OUT 123.45 AC 1234 TO QA STORE';
    const rules = rulesWith({ regex: 'qa odd out ([\\d.,]+) ac (\\d{4}) to ([a-z ]+)' });
    const { reader, combined } = both(body, rules);
    expect(reader.transaction).toBeNull();
    expect(['unknown_financial', 'not_financial']).toContain(reader.label);
    expect(combined.source).toBe('rule');
    expect(combined.label).toBe('txn_debit');
    expect(combined.transaction!.amountMinor).toBe(12345);
    expect(combined.transaction!.lastFour).toBe('1234');
    expect(combined.transaction!.merchantName).toBe('QA STORE');
    expect(combined.transaction!.ruleDisagreement).toBeUndefined();
    expect(parserVersionFor(combined.transaction!)).toBe('sms-reader-v2+rules-v9:T-QA-0001');
  });

  it('both read a transaction and AGREE → the template record (source rule), not held', () => {
    const { reader, combined } = both(DEBIT, rulesWith({}));
    expect(transactionsAgree(reader.transaction!, combined.transaction!)).toBe(true);
    expect(combined.source).toBe('rule');
    expect(combined.transaction!.source).toBe('rule');
    expect(combined.transaction!.patternUid).toBe('T-QA-0001');
    expect(combined.ruleDisagreement).toBeUndefined();
    expect(isRuleDisagreementRow({ parserVersion: parserVersionFor(combined.transaction!) })).toBe(false);
  });

  it.each([
    ['amount', { amount: { value: '999.00' } }],
    ['direction', { transaction_type: 'credit' as const, money_kind: 'income' as const }],
    ['last-4', { pan: { value: '9999' } }],
  ])('DISAGREE on %s → one item with the READER values, held + tagged', (_n, override) => {
    const { reader, combined } = both(DEBIT, rulesWith({ data_fields: { ...BASE, ...override } }));
    expect(combined.ruleDisagreement).toBe(true);
    expect(combined.source).toBe('reader');
    expect(combined.extraTransactions ?? []).toHaveLength(0);
    const t = combined.transaction!;
    expect(t.type).toBe(reader.transaction!.type);
    expect(t.amountMinor).toBe(reader.transaction!.amountMinor);
    expect(t.lastFour).toBe(reader.transaction!.lastFour);
    expect(t.ruleDisagreement).toBe(true);
    const version = parserVersionFor(t);
    expect(version).toBe('sms-reader-v2+rules-v9:disagree:T-QA-0001');
    expect(isRuleDisagreementRow({ parserVersion: version })).toBe(true);
  });

  it('reader transaction vs template statement → DISAGREE, reader values held', () => {
    const rules = rulesWith({ sms_type: 'statement', data_fields: { statement_type: 'credit_card_bill', amount: { group_id: 1 }, pan: { group_id: 2 } } });
    const { reader, combined } = both(DEBIT, rules);
    expect(combined.ruleDisagreement).toBe(true);
    expect(combined.label).toBe(reader.label);
    expect(combined.transaction!.amountMinor).toBe(50000);
  });

  it('reader specific class (mandate) vs template transaction → DISAGREE, template values held', () => {
    const body = 'Rs.500.00 will be debited from your A/c XX1234 on 07-11-26 towards QA OTT';
    const rules = rulesWith({ regex: 'rs\\.([\\d,.]+) will be debited from your a/c xx(\\d{4}) on [\\d-]+ towards ([a-z ]+)' });
    const { reader, combined } = both(body, rules);
    expect(reader.label).toBe('mandate_future');
    expect(reader.transaction).toBeNull();
    expect(combined.ruleDisagreement).toBe(true);
    expect(combined.transaction!.amountMinor).toBe(50000);
    expect(combined.transaction!.ruleDisagreement).toBe(true);
  });

  it('neither side has a transaction → the reader class is kept', () => {
    const body = 'Rs.500.00 will be debited from your A/c XX1234 on 07-11-26 towards QA OTT';
    const rules = rulesWith({
      sms_type: 'notice',
      regex: 'rs\\.([\\d,.]+) will be debited from your a/c xx(\\d{4})',
      data_fields: { notice_type: 'emi_due', amount: { group_id: 1 }, pan: { group_id: 2 } },
    });
    const { reader, combined } = both(body, rules);
    expect(combined.label).toBe(reader.label);
    expect(combined.source).toBe('reader');
    expect(combined.transaction).toBeNull();
    expect(combined.ruleDisagreement).toBeUndefined();
  });

  it('format_verified true → the template wins outright over a disagreeing reader', () => {
    const rules = rulesWith({ data_fields: { ...BASE, amount: { value: '999.00' } } }, { format_verified: true });
    const { combined } = both(DEBIT, rules);
    expect(combined.source).toBe('rule');
    expect(combined.ruleDisagreement).toBeUndefined();
    expect(combined.transaction!.amountMinor).toBe(99900);
  });

  it('format_verified false (explicit) → still held', () => {
    const rules = rulesWith({ data_fields: { ...BASE, amount: { value: '999.00' } } }, { format_verified: false });
    expect(both(DEBIT, rules).combined.ruleDisagreement).toBe(true);
  });

  it('agreement ignores a missing last-4 on one side', () => {
    const rules = rulesWith({ data_fields: { ...BASE, pan: undefined } });
    const { combined } = both(DEBIT, rules);
    expect(combined.source).toBe('rule');
    expect(combined.transaction!.lastFour).toBe('1234'); // filled from the reader
  });
});
