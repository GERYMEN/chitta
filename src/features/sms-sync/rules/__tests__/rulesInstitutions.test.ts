/**
 * R5g T6 + N4 + T4(d) — institution sync with rules.json, normalizer v3
 * stability, and the strict validator rejecting malformed documents.
 * SYNTHETIC data only.
 */
import bundled from '../rules.json';
import type { RulesDocument } from '../rules.types';
import { compileRules } from '../rulesLoader';
import { issuerForHeader } from '../rulesEngine';
import { validateRulesDocument } from '../rulesValidator';
import { knownSenderHeaders, parseSender } from '../../parser/senders';
import { institutionDisplayName, knownInstitutions } from '../../parser/institutions';
import {
  ACCOUNT_KEY_NORMALIZER_VERSION,
  accountKeyToString,
  bankCanonicalForText,
  normalizeAccountKey,
} from '../../normalizeAccountKey';
import { legacyKeyString, normalizeAccountKeyV1 } from '../../legacy/normalizeAccountKeyV1';
import {
  R5D_REVIEW_FIXTURES,
  SMS_FIXTURES,
  V1_REGRESSION_FIXTURES,
} from '../../../../test/fixtures/smsReader.fixture';
import { ACCOUNT_KEYS_V1, ACCOUNT_KEYS_V2 } from '../../../../test/fixtures/accountKeySnapshot.fixture';

const doc = bundled as unknown as RulesDocument;
const rules = compileRules(doc);
const clone = (): RulesDocument => JSON.parse(JSON.stringify(doc));

describe('T6 — every rules.json issuer resolves the same through senders.ts and the engine', () => {
  const normal = doc.rules.filter(r => !r.scope);

  it.each(normal.map(r => [r.name, r] as const))('%s', (_n, issuer) => {
    expect(institutionDisplayName(issuer.name)).not.toBe('Unknown Bank');
    expect(knownInstitutions()).toContain(issuer.name);
    const headers =
      issuer.sender_status === 'unconfirmed'
        ? ['NKGSBB', 'NKGSBX', 'NKGABC'] // unconfirmed: sender_regexes only
        : issuer.senders;
    for (const header of headers) {
      const sender = parseSender(`AD-${header}-S`);
      expect([header, sender.kind, sender.institution]).toEqual([header, 'known', issuer.name]);
      expect([header, issuerForHeader(rules, header)?.name]).toEqual([header, issuer.name]);
    }
  });

  it("an 'unconfirmed' issuer has no exact sender entry in senders.ts", () => {
    for (const issuer of normal.filter(r => r.sender_status === 'unconfirmed')) {
      for (const header of issuer.senders) expect(knownSenderHeaders()).not.toContain(header);
    }
  });

  it('body names of the new banks resolve (v3 aliases)', () => {
    expect(bankCanonicalForText('Avl Bal Rs.100 -Bank of Maharashtra')).toBe('bom');
    expect(bankCanonicalForText('debited from your Karur Vysya Bank A/c')).toBe('kvb');
    expect(bankCanonicalForText('Bal INR 10 -Punjab & Sind Bank')).toBe('psb');
    expect(bankCanonicalForText('J&K Bank A/c XX1234')).toBe('jkb');
    expect(bankCanonicalForText('India Post Payments Bank A/c')).toBe('ippb');
    expect(bankCanonicalForText('Standard Chartered card')).toBe('stanc');
    expect(bankCanonicalForText('UCO Bank')).toBe('uco');
  });
});

describe('N4 — normalizer v3 never moves a v1 / v2 key', () => {
  const all = [...SMS_FIXTURES, ...V1_REGRESSION_FIXTURES, ...R5D_REVIEW_FIXTURES];

  it('is version 3', () => expect(ACCOUNT_KEY_NORMALIZER_VERSION).toBe(3));

  it('every v2 key of the fixture table is unchanged', () => {
    expect(all).toHaveLength(ACCOUNT_KEYS_V2.length);
    expect(all.map(f => accountKeyToString(normalizeAccountKey(f.body)))).toEqual(ACCOUNT_KEYS_V2);
  });

  it('every legacy v1 key of the fixture table is unchanged (frozen file)', () => {
    expect(all.map(f => legacyKeyString(normalizeAccountKeyV1(f.body)))).toEqual(ACCOUNT_KEYS_V1);
  });

  it('v1 / v2 aliases still win over a v3 alias in the same text', () => {
    // "City Union Bank" keeps the v1 'union' key (CUB is told apart by its sender).
    expect(bankCanonicalForText('City Union Bank')).toBe('union');
    expect(bankCanonicalForText('HDFC Bank and HSBC')).toBe('hdfc');
  });
});

describe('T4(d) — the validator rejects malformed documents', () => {
  it('the bundled document is valid in strict mode', () => {
    const v = validateRulesDocument(doc, { strict: true });
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
  });

  const cases: Array<[string, (d: RulesDocument) => void, string]> = [
    ['wrong schema_version', d => ((d as { schema_version: number }).schema_version = 3), 'schema_version'],
    ['bad regex', d => (d.rules[0].patterns[0].regex = '(unclosed'), 'bad regex'],
    ['group id beyond the group count', d => (d.rules[0].patterns[0].data_fields.amount = { group_id: 42 }), 'group_id 42'],
    ['duplicate sort_UID in an issuer', d => (d.rules[0].patterns[1].sort_UID = d.rules[0].patterns[0].sort_UID), 'duplicate sort_UID'],
    ['duplicate pattern_UID across issuers', d => (d.rules[1].patterns[0].pattern_UID = d.rules[0].patterns[0].pattern_UID), 'duplicate pattern_UID'],
    ['bad sms_type', d => ((d.rules[0].patterns[0] as { sms_type: string }).sms_type = 'sale'), 'bad sms_type'],
    ['bad account_type', d => ((d.rules[0].patterns[0] as { account_type: string }).account_type = 'piggy'), 'bad account_type'],
    ['transaction without amount', d => delete d.rules[0].patterns[0].data_fields.amount, 'without amount'],
    ['bad match_type', d => (d.rules[0].patterns.find(p => p.data_fields.chaining_rule)!.data_fields.chaining_rule!.parent_selection[0].match_type = 'fuzzy' as never), 'bad match_type'],
    ['transaction in an any_sender layer', d => {
      const layer = d.rules.find(r => r.scope === 'any_sender')!;
      layer.patterns[0].sms_type = 'transaction';
      layer.patterns[0].data_fields.transaction_type = 'debit';
    }, 'any_sender'],
    ['format_verified not boolean', d => ((d.rules[0] as { format_verified?: unknown }).format_verified = 'yes'), 'format_verified'],
    ['issuer without senders or scope', d => (d.rules[0].senders = []), 'no senders'],
    ['bad sender_regex', d => (d.rules[0].sender_regexes = ['[']), 'sender_regex'],
  ];

  it.each(cases)('%s', (_n, mutate, message) => {
    const d = clone();
    mutate(d);
    const v = validateRulesDocument(d);
    expect(v.ok).toBe(false);
    expect(v.errors.join('\n')).toContain(message);
    expect(() => compileRules(d)).toThrow('invalid rules document');
  });

  it('unknown keys: error in strict mode, warning at runtime', () => {
    const d = clone() as RulesDocument & { future_key?: number };
    d.future_key = 1;
    (d.rules[0].patterns[0] as unknown as Record<string, unknown>).new_flag = true;
    expect(validateRulesDocument(d, { strict: true }).ok).toBe(false);
    const runtime = validateRulesDocument(d);
    expect(runtime.ok).toBe(true);
    expect(runtime.warnings.length).toBe(2);
  });

  it('non-objects are rejected', () => {
    expect(validateRulesDocument(null).ok).toBe(false);
    expect(validateRulesDocument({ schema_version: 2, version: 1, min_app_version: '0.1.0', rules: 'x' }).ok).toBe(false);
  });
});
