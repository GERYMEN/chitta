/**
 * R5g T4(c) — engine features 1–27 (SYNTHETIC bodies only: QA names,
 * XX1234 / XX9999, refs 000000000xxx, qa.x@okqa). Bundled samples are read
 * from rules.json by pattern_UID; mini documents are written inline.
 */
import bundled from '../rules.json';
import type { RuleIssuer, RulePattern, RulesDocument } from '../rules.types';
import { compileRules, pickRulesDocument, rulesAboutLabel, rulesInfo } from '../rulesLoader';
import { issuerForHeader, normalizeRuleBody, runLayer, runRulesEngine } from '../rulesEngine';
import { panDigits, readFromRules, ruleConfidence, trackerAccountType } from '../ruleRead';
import { parseWithFormat, resolveRuleDate } from '../ruleDates';
import { parseSender } from '../../parser/senders';
import { readSmsMessage, readSmsWithReader, SmsInput } from '../../parser/readSms';
import { parserVersionFor, ruleHoldReasonFor } from '../../smsSyncLogic';
import { proposedAccountBaseName } from '../../suggestionGroups';

const doc = bundled as unknown as RulesDocument;
const rules = compileRules(doc);
const DATE = Date.parse('2026-11-05T06:00:00.000Z'); // 11:30 IST
const DAY = 24 * 60 * 60 * 1000;
const SALT = 'qa-salt';

function sample(uid: string, index = 0): string {
  for (const issuer of doc.rules) {
    for (const p of issuer.patterns) if (p.pattern_UID === uid) return (p.samples ?? [])[index].body;
  }
  throw new Error(`no sample ${uid}`);
}

function ruleRead(address: string, body: string, compiled = rules, date = DATE) {
  const msg: SmsInput = { id: '5', address, body, date };
  const sender = parseSender(address);
  const engine = runRulesEngine(compiled, { header: sender.header, senderKind: sender.kind, body, smsDate: date });
  return { engine, read: readFromRules(engine, { msg, sender, salt: SALT, rulesVersion: compiled.version }) };
}

function mini(patterns: Array<Partial<RulePattern>>, issuer: Partial<RuleIssuer> = {}, top: Partial<RulesDocument> = {}) {
  return compileRules({
    schema_version: 2,
    version: 7,
    min_app_version: '0.1.0',
    blacklist_regex: '\\botp\\b',
    rules: [
      {
        name: 'hdfc',
        full_name: 'HDFC Bank',
        institution_kind: 'bank',
        senders: ['HDFCBK'],
        ...issuer,
        patterns: patterns.map((p, i) => ({
          pattern_UID: `T-QA-${i + 1}`,
          sort_UID: 100 + i,
          sms_type: 'transaction',
          account_type: 'bank',
          flags: 'i',
          data_fields: {},
          ...p,
        })),
      },
    ],
    ...top,
  });
}

/** "QA ODD OUT 123.45 AC 1234 TO QA STORE" — a shape the reader cannot read. */
const ODD = { regex: 'qa odd out ([\\d.,]+) ac (\\d{4}) to ([a-z ]+?)(?:;|$)', data_fields: { transaction_type: 'debit' as const, money_kind: 'spend' as const, amount: { group_id: 1 }, pan: { group_id: 2 }, pos: { group_id: 3 }, date: { use_sms_time: true } } };

describe('items 1–2: sender lookup', () => {
  it('exact header, then sender_regexes; first issuer wins', () => {
    expect(issuerForHeader(rules, 'HDFCBK')?.name).toBe('hdfc');
    expect(issuerForHeader(rules, 'CNRBXY')?.name).toBe('canara');
    expect(issuerForHeader(rules, 'NKGSBX')?.name).toBe('nkgsb');
    expect(issuerForHeader(rules, 'MAHAXY')?.name).toBe('bom');
    expect(issuerForHeader(rules, 'QABANK')).toBeNull();
    expect(issuerForHeader(rules, null)).toBeNull();
  });

  it('sender_regexes never steal a header listed under another issuer (validate_v2 port)', () => {
    for (const issuer of rules.issuers) {
      for (const header of issuer.def.senders) expect([header, issuerForHeader(rules, header)?.name]).toEqual([header, issuer.name]);
    }
  });
});

describe('item 3: global blacklist', () => {
  const otp = '123456 is your OTP for txn of INR 2,500.00 at QA STORE on HDFC Bank card ending 9999. Do not share.';

  it('hit = no pattern tried; the reader result becomes / stays otp', () => {
    expect(runRulesEngine(rules, { header: 'HDFCBK', senderKind: 'known', body: otp, smsDate: DATE }).blacklisted).toBe(true);
    const r = readSmsMessage({ id: '1', address: 'AD-HDFCBK-S', body: otp, date: DATE });
    expect(r.label).toBe('otp');
    expect(r.transaction).toBeNull();
  });

  it('a blacklist hit is not a pattern hit: a reader transaction is kept as is', () => {
    const body = 'Rs.500.00 debited from A/c XX1234 to QA PAYEE on 05-11-26. Never share your OTP with anyone.';
    const reader = readSmsWithReader({ id: '1', address: 'AD-HDFCBK-S', body, date: DATE });
    const r = readSmsMessage({ id: '1', address: 'AD-HDFCBK-S', body, date: DATE });
    expect(reader.transaction).not.toBeNull();
    expect(r.transaction).toEqual(reader.transaction);
    expect(r.source).toBe('reader');
  });
});

describe('item 4: sort_UID order, first match wins', () => {
  it('the lower sort_UID wins even when listed later', () => {
    const compiled = mini([
      { ...ODD, sort_UID: 200, pattern_UID: 'T-QA-LATE' },
      { ...ODD, sort_UID: 10, pattern_UID: 'T-QA-EARLY' },
    ]);
    const run = runLayer(compiled.issuers[0], 'QA ODD OUT 10.00 AC 1234 TO QA STORE', DATE, null);
    expect(run.records[0].pattern.def.pattern_UID).toBe('T-QA-EARLY');
  });
});

describe('item 5: obsolete / obsolete_after', () => {
  const after = Date.parse('2026-06-01T00:00:00.000Z');
  const compiled = mini([{ ...ODD, obsolete: true, obsolete_after: after }]);
  const body = 'QA ODD OUT 10.00 AC 1234 TO QA STORE';

  it('still parses an old SMS (re-scan)', () => {
    expect(runRulesEngine(compiled, { header: 'HDFCBK', senderKind: 'known', body, smsDate: after - DAY }).records).toHaveLength(1);
  });

  it('is skipped for an SMS dated after obsolete_after', () => {
    expect(runRulesEngine(compiled, { header: 'HDFCBK', senderKind: 'known', body, smsDate: after + DAY }).records).toHaveLength(0);
  });

  it('obsolete without obsolete_after keeps matching (the bundled HDFC sample)', () => {
    expect(ruleRead('AD-HDFCBK-S', sample('T-HDFC-0003')).read?.patternUid).toBe('T-HDFC-0003');
  });
});

describe('item 6: preprocessor', () => {
  it('issuer preprocessor normalizes a glued balance before matching (BOB)', () => {
    expect(ruleRead('AD-BOBTXN-S', sample('T-BOB-0001')).read?.patternUid).toBe('T-BOB-0001');
    const copy = JSON.parse(JSON.stringify(doc)) as RulesDocument;
    delete copy.rules.find(r => r.name === 'bob')!.preprocessor;
    const without = ruleRead('AD-BOBTXN-S', sample('T-BOB-0001'), compileRules(copy));
    expect(without.read?.patternUid).not.toBe('T-BOB-0001');
  });

  it('works on a COPY: pattern preprocessor does not change what the next pattern sees', () => {
    const compiled = mini([
      { ...ODD, sort_UID: 1, regex: 'never ([\\d.,]+) ac (\\d{4}) to ([a-z ]+)', preprocessor: [{ find: 'qa odd', replace: 'zz', flags: 'gi' }] },
      { ...ODD, sort_UID: 2 },
    ]);
    expect(runLayer(compiled.issuers[0], 'QA ODD OUT 1.00 AC 1234 TO QA STORE', DATE, null).records[0].pattern.def.pattern_UID).toBe('T-QA-2');
  });
});

describe('item 7: reparse', () => {
  it('two records from one SMS, each with its own #n reference hash', () => {
    const { read } = ruleRead('AD-ICICIB-S', sample('T-ICICI-0003'));
    expect(read!.transactions).toHaveLength(2);
    const [a, b] = read!.transactions;
    expect(a.amountMinor).toBe(200000);
    expect(a.moneyHint).toBe('atm');
    expect(b.amountMinor).toBe(2360);
    expect(a.sourceReferenceHash).toBe(`sms-5-${DATE}`);
    expect(b.sourceReferenceHash).toBe(`sms-5-${DATE}#2`);
    expect(b.smsContentHash).toBe(`${a.smsContentHash}#2`);
  });

  it('caps at 3 records; extras reach the read result when the reader found nothing', () => {
    const compiled = mini([{ ...ODD, reparse: true }]);
    const body = 'QA ODD OUT 1.00 AC 1234 TO QA STORE; QA ODD OUT 2.00 AC 1234 TO QA CAFE; QA ODD OUT 3.00 AC 1234 TO QA MART; QA ODD OUT 4.00 AC 1234 TO QA FOODS';
    expect(runLayer(compiled.issuers[0], body, DATE, null).records).toHaveLength(3);
    const r = readSmsMessage({ id: '5', address: 'AD-HDFCBK-S', body, date: DATE }, { rules: compiled, salt: SALT });
    expect(r.source).toBe('rule');
    expect(r.transaction!.amountMinor).toBe(100);
    expect(r.extraTransactions!.map(t => t.sourceReferenceHash)).toEqual([`sms-5-${DATE}#2`, `sms-5-${DATE}#3`]);
  });
});

describe('item 8: sms_type', () => {
  it('statement / notice / balance → SmsNonTransaction; ignore → failed', () => {
    const statement = ruleRead('AD-HDFCBK-S', sample('S-HDFC-0001')).read!;
    expect(statement.label).toBe('statement');
    expect(statement.nonTransaction).toEqual({ label: 'statement', amountMinor: 1200000, minDueMinor: 60000, lastFour: '9999' });
    expect(ruleRead('AD-HDFCBK-S', sample('N-HDFC-0001')).read!.label).toBe('mandate_future');
    const balance = ruleRead('AD-AXISBK-S', sample('B-AXIS-0001')).read!;
    expect(balance.label).toBe('balance_info');
    expect(balance.nonTransaction!.amountMinor).toBe(1234567);
    const ignore = ruleRead('AD-SBIBNK-S', sample('I-SBI-0001')).read!;
    expect(ignore.label).toBe('failed');
    expect(ignore.ignoreReason).toBe('failed');
    expect(ignore.transactions).toHaveLength(0);
  });

  it('event → typed SmsEvent, no record (item 23)', () => {
    const compiled = mini([
      {
        sms_type: 'event',
        regex: 'qa trip pnr (\\d{6}) on (\\d{2}-\\d{2}-\\d{2}) at ([a-z ]+)',
        data_fields: { event_type: 'travel', pnr: { group_id: 1 }, date: { group_id: 2, formats: [{ format: 'dd-MM-yy' }] }, event_location: { group_id: 3 } },
      },
    ]);
    const body = 'QA TRIP PNR 000123 ON 06-11-26 AT QA STATION';
    const r = readSmsMessage({ id: '5', address: 'AD-HDFCBK-S', body, date: DATE }, { rules: compiled });
    expect(r.transaction).toBeNull();
    expect(r.event).toEqual({
      eventType: 'travel',
      patternUid: 'T-QA-1',
      occursAt: new Date(Date.parse('2026-11-06T06:30:00.000Z')).toISOString(),
      hasPnr: true,
      hasLocation: true,
      reminderSpan: null,
    });
    expect(JSON.stringify(r)).not.toContain('000123');
  });
});

describe('items 9 / 27: account type mapping + acc_type_override', () => {
  it('maps rule account types to Tracker types', () => {
    expect(trackerAccountType('bank')).toBe('bank');
    expect(trackerAccountType('debit_card')).toBe('bank');
    expect(trackerAccountType('credit_card')).toBe('credit_card');
    expect(trackerAccountType('wallet')).toBe('other');
    expect(trackerAccountType('prepaid')).toBe('other');
    expect(trackerAccountType('pay_later')).toBe('other');
    expect(trackerAccountType('loan')).toBeNull();
    expect(trackerAccountType('utility')).toBeNull();
    expect(trackerAccountType('insurance')).toBeNull();
  });

  it('"credit card" vs "debit card" in one generic template overrides the account type', () => {
    const credit = ruleRead('AD-QABANK-S', sample('T-GENERIC_BANK-0010', 0)).read!.transactions[0];
    const debit = ruleRead('AD-QABANK-S', sample('T-GENERIC_BANK-0010', 1)).read!.transactions[0];
    expect(credit.accountKind).toBe('credit_card');
    expect(credit.label).toBe('card_spend');
    expect(debit.accountKind).toBe('bank');
    expect(debit.panKind).toBe('debit_card');
  });

  it('a loan-account transaction template is a non-transaction', () => {
    const r = ruleRead('AD-BAJAJF-S', sample('T-BAJAJ-0002')).read!;
    expect(r.transactions).toHaveLength(0);
    expect(r.nonTransaction?.amountMinor).toBe(249900);
  });
});

describe('item 10: data fields', () => {
  it('pan → lastFour, 3 digits only with min_digits 3, constants are not digits', () => {
    expect(panDigits('XX1234', undefined)).toEqual({ lastFour: '1234', lastDigits: null });
    expect(panDigits('234', 3)).toEqual({ lastFour: null, lastDigits: '234' });
    expect(panDigits('234', undefined)).toEqual({ lastFour: null, lastDigits: null });
    expect(panDigits('wallet', undefined)).toEqual({ lastFour: null, lastDigits: null });
    expect(ruleRead('AD-ICICIB-S', sample('T-ICICI-0003')).read!.transactions[0].lastDigits).toBe('234');
  });

  it('amounts in Indian and western grouping → paise; reference → salted digest only', () => {
    const t = ruleRead('AD-HDFCBK-S', sample('T-HDFC-0006')).read!.transactions[0];
    expect(t.amountMinor).toBe(8500000);
    expect(t.balanceMinor).toBe(10200000);
    const upi = ruleRead('AD-HDFCBK-S', sample('T-HDFC-0002')).read!.transactions[0];
    expect(upi.refDigest).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(upi)).not.toContain('000000000201');
  });

  it('currency: non-INR → not understood (foreign_currency) until R5e', () => {
    const { read } = ruleRead('AD-ICICIB-S', sample('T-ICICI-0005', 1));
    expect(read!.transactions).toHaveLength(0);
    expect(read!.notUnderstood).toEqual({ reason: 'foreign_currency' });
    const r = readSmsMessage({ id: '5', address: 'AD-ICICIB-S', body: sample('T-ICICI-0005', 1), date: DATE });
    expect(r.transaction).toBeNull();
    expect(r.notUnderstood).toEqual({ reason: 'foreign_currency' });
    // INR on the same template is a transaction.
    expect(ruleRead('AD-ICICIB-S', sample('T-ICICI-0005', 0)).read!.transactions[0].amountMinor).toBe(320000);
  });
});

describe('item 11: date formats + window', () => {
  it('parses tokens in Asia/Kolkata', () => {
    expect(parseWithFormat('2026-11-05:12:30:00', 'yyyy-MM-dd:HH:mm:ss', DATE)).toEqual({ ms: Date.parse('2026-11-05T07:00:00.000Z'), hasTime: true });
    expect(parseWithFormat('05-Nov-26', 'dd-MMM-yy', DATE)?.ms).toBe(Date.parse('2026-11-04T18:30:00.000Z'));
    expect(parseWithFormat('05 November 2026 at 02:15 pm', "dd MMMM yyyy 'at' hh:mm a", DATE)?.ms).toBe(Date.parse('2026-11-05T08:45:00.000Z'));
    expect(parseWithFormat('05Nov26', 'ddMMMyy', DATE)?.hasTime).toBe(false);
    expect(parseWithFormat('31-02-26', 'dd-MM-yy', DATE)).toBeNull();
    // No year: a date after the SMS belongs to last year.
    expect(parseWithFormat('20 Dec', 'dd MMM', DATE)?.ms).toBe(Date.parse('2025-12-19T18:30:00.000Z'));
  });

  it('uses the date only inside [sms − 45 d, sms + 1 d]; same-day date-only keeps the SMS time', () => {
    const formats = [{ format: 'dd-MM-yy HH:mm' }];
    expect(resolveRuleDate('05-11-26 09:00', formats, DATE)).toBe(Date.parse('2026-11-05T03:30:00.000Z'));
    expect(resolveRuleDate('01-08-26 09:00', formats, DATE)).toBe(DATE);
    expect(resolveRuleDate('08-11-26 09:00', formats, DATE)).toBe(DATE);
    expect(resolveRuleDate('05-11-26', [{ format: 'dd-MM-yy' }], DATE)).toBe(DATE);
    expect(resolveRuleDate('03-11-26', [{ format: 'dd-MM-yy' }], DATE)).toBe(Date.parse('2026-11-03T06:30:00.000Z'));
    expect(resolveRuleDate('03-11-26', [{ format: 'immediate' }], DATE)).toBe(DATE);
    expect(resolveRuleDate('03-11-26', [{ format: 'dd-MM-yy', use_sms_time: true }], DATE)).toBe(DATE);
    expect(resolveRuleDate(undefined, formats, DATE)).toBe(DATE);
  });
});

describe('items 12–19: direction, money kind, type / pos rules, overrides', () => {
  it('12/13: direction + money_kind → moneyHint (held kinds)', () => {
    const card = ruleRead('AD-HDFCBK-S', sample('T-HDFC-0007')).read!.transactions[0];
    expect(card.type).toBe('expense');
    expect(card.moneyHint).toBe('card_payment');
    expect(card.counterpartyLastFour).toBe('9999');
    expect(ruleHoldReasonFor({ moneyHint: 'atm' })).toBe('atm');
    expect(ruleHoldReasonFor({ moneyHint: 'card_payment' })).toBeNull(); // R5d's own hold
    expect(ruleHoldReasonFor({ ruleDisagreement: true, moneyHint: 'refund' })).toBe('rule_disagreement');
    expect(ruleHoldReasonFor({})).toBeNull();
  });

  it('14/17: transaction_type_rule pos_override + set_no_pos → no confidence penalty', () => {
    const t = ruleRead('AD-UNIONB-S', sample('T-UNION-0001')).read!.transactions[0];
    expect(t.merchantName).toBe('Net Banking');
    expect(t.setNoPos).toBe(true);
    expect(t.confidenceScore).toBe(90);
  });

  it('15: pos_type_rules salary → salary; income_flag_override false → refund', () => {
    expect(ruleRead('AD-HDFCBK-S', sample('T-HDFC-0006')).read!.transactions[0].salary).toBe(true);
    const compiled = mini([
      {
        regex: 'qa odd in ([\\d.,]+) ac (\\d{4}) note ([a-z ]+)',
        data_fields: { transaction_type: 'credit', money_kind: 'income', amount: { group_id: 1 }, pan: { group_id: 2 }, note: { group_id: 3 }, pos_type_rules: { group_id: 3, rules: [{ value: 'refund', category: 'refund', income_flag_override: false }] } },
      },
    ]);
    const t = ruleRead('AD-HDFCBK-S', 'QA ODD IN 5.00 AC 1234 NOTE QA REFUND', compiled).read!.transactions[0];
    expect(t.moneyKind).toBe('refund');
    expect(t.label).toBe('refund');
    expect(t.categoryHint).toBe('refund');
  });

  it('16: network reference type rule', () => {
    expect(ruleRead('AD-HDFCBK-S', sample('T-HDFC-0002')).read!.transactions[0].refType).toBe('upi');
  });

  it('18: account_name_override → the proposed account name', () => {
    const t = ruleRead('AD-SBICRD-S', sample('T-SBI-0007')).read!.transactions[0];
    expect(t.accountNameOverride).toBe('SBI Card');
    expect(proposedAccountBaseName({ bankName: 'SBI', accountKind: 'credit_card', accountName: t.accountNameOverride })).toBe('SBI Card');
    expect(proposedAccountBaseName({ bankName: 'SBI', accountKind: 'credit_card' })).toBe('SBI Credit Card');
  });

  it('19: set_account_as_expense (wallet)', () => {
    const t = ruleRead('AD-IPAYTM-S', sample('T-PAYTM-0002')).read!.transactions[0];
    expect(t.setAccountAsExpense).toBe(true);
    expect(t.accountKind).toBe('other');
  });

  it('20: create_txn false → parsed for balance only, no record', () => {
    const compiled = mini([{ ...ODD, create_txn: false, data_fields: { ...ODD.data_fields, account_balance: { group_id: 1 } } }]);
    const r = ruleRead('AD-HDFCBK-S', 'QA ODD OUT 10.00 AC 1234 TO QA STORE', compiled).read!;
    expect(r.transactions).toHaveLength(0);
    expect(r.label).toBe('balance_info');
    expect(r.nonTransaction!.amountMinor).toBe(1000);
  });
});

describe('item 24: version / min_app_version picker', () => {
  const v = (version: number, min: string) => ({ ...doc, version, min_app_version: min });

  it('picks the highest version whose min_app_version ≤ the app version', () => {
    const picked = pickRulesDocument(
      [
        { source: 'bundled', doc: v(4, '0.9.0') },
        { source: 'stored', doc: v(6, '0.9.0') },
        { source: 'stored', doc: v(9, '1.2.0') },
        { source: 'stored', doc: { ...v(12, '0.1.0'), schema_version: 3 } },
      ],
      '0.9.0-beta',
    );
    expect(picked?.source).toBe('stored');
    expect((picked?.doc as RulesDocument).version).toBe(6);
    expect(pickRulesDocument([{ source: 'bundled', doc: v(4, '2.0.0') }], '0.9.0')).toBeNull();
  });

  it('About shows "SMS rules v<n> · <issuer count> banks" (generic layers excluded)', () => {
    expect(rulesInfo(rules)).toEqual({ version: 4, issuerCount: 49 });
    expect(rulesAboutLabel(rulesInfo(rules))).toBe('SMS rules v4 · 49 banks');
    expect(rulesAboutLabel(null)).toBe('SMS rules not loaded');
  });
});

describe('items 25–26: generic layers + institution', () => {
  it('financial_fallback serves an unknown DLT bank sender; institution from the body', () => {
    const body = 'Rs.500.00 debited from your A/c XX1234 on 05-11-26 via IMPS to QA LANDLORD. Ref No 000000000301 - Canara Bank';
    const { engine, read } = ruleRead('AD-QABANK-S', body);
    expect(engine.records[0].layer.name).toBe('generic_bank');
    expect(read!.institution).toBe('canara');
    expect(read!.transactions[0].bankCanonical).toBe('canara');
  });

  it('a known issuer whose own patterns miss falls through to the generic layer', () => {
    const body = 'Rs.15,000.00 debited from your A/c XX1234 on 05-11-26 via IMPS to QA LANDLORD. Ref No 000000000301';
    const { engine, read } = ruleRead('AD-KOTAKB-S', body);
    expect(engine.records[0].layer.name).toBe('generic_bank');
    expect(read!.institution).toBe('kotak');
  });

  it('a short-code sender skips financial_fallback (any_sender only); promo / personal never reach the engine', () => {
    const body = 'Rs.15,000.00 debited from your A/c XX1234 on 05-11-26 via IMPS to QA LANDLORD. Ref No 000000000301';
    expect(runRulesEngine(rules, { header: null, senderKind: 'other', body, smsDate: DATE }).records).toHaveLength(0);
    expect(runRulesEngine(rules, { header: 'QABANK', senderKind: 'promo', body, smsDate: DATE }).records).toHaveLength(0);
    expect(runRulesEngine(rules, { header: null, senderKind: 'personal', body, smsDate: DATE }).records).toHaveLength(0);
  });

  it('any_sender yields only statement / notice / ignore', () => {
    for (const layer of rules.anySender) for (const p of layer.patterns) expect(p.def.sms_type).not.toBe('transaction');
  });
});

describe('T3: parser_version stamp + confidence', () => {
  it('stamps rule and disagreement rows; reader rows keep the plain tag', () => {
    expect(parserVersionFor({})).toBe('sms-reader-v2');
    expect(parserVersionFor({ patternUid: 'T-HDFC-0001', rulesVersion: 4 })).toBe('sms-reader-v2+rules-v4:T-HDFC-0001');
    expect(parserVersionFor({ patternUid: 'T-HDFC-0001', rulesVersion: 4, ruleDisagreement: true })).toBe('sms-reader-v2+rules-v4:disagree:T-HDFC-0001');
  });

  it('known sender: amount + pan + payee → 90, no pan → 85; unknown senders keep their caps', () => {
    expect(ruleConfidence({ senderKind: 'known', issuerResolved: true, hasPan: true, hasMerchant: true, setNoPos: false })).toBe(90);
    expect(ruleConfidence({ senderKind: 'known', issuerResolved: true, hasPan: false, hasMerchant: true, setNoPos: false })).toBe(85);
    expect(ruleConfidence({ senderKind: 'known', issuerResolved: true, hasPan: true, hasMerchant: false, setNoPos: false })).toBe(85);
    expect(ruleConfidence({ senderKind: 'unknown_dlt', issuerResolved: false, hasPan: true, hasMerchant: true, setNoPos: false })).toBe(85);
    expect(ruleConfidence({ senderKind: 'other', issuerResolved: false, hasPan: true, hasMerchant: true, setNoPos: false })).toBe(80);
  });

  it('a rule-sourced result carries derived fields only (no body, sender or reference)', () => {
    const body = sample('T-HDFC-0002');
    const r = readSmsMessage({ id: '5', address: 'AD-HDFCBK-S', body, date: DATE }, { salt: SALT });
    expect(r.source).toBe('rule');
    const json = JSON.stringify(r);
    expect(json).not.toContain(normalizeRuleBody(body).slice(0, 30));
    expect(json).not.toContain('HDFCBK');
    expect(json).not.toContain('000000000201');
  });
});
