import { readSmsMessage, TRANSACTION_LABELS } from '../readSms';
import {
  ACCOUNT_EXPECT,
  BANK_GROUPS,
  CARD_WALLET_GROUPS,
  SMS_FIXTURES,
  SmsFixture,
  V1_REGRESSION_FIXTURES,
} from '../../../../test/fixtures/smsReader.fixture';

const DATE = Date.parse('2026-11-03T05:00:00.000Z');

function read(fixture: SmsFixture, id = '7') {
  return readSmsMessage({ id, address: fixture.address, body: fixture.body, date: DATE });
}

function check(fixture: SmsFixture) {
  const result = read(fixture);
  const e = fixture.expect;
  expect(result.label).toBe(e.label);
  if (e.institution !== undefined) expect(result.institution).toBe(e.institution);
  if (e.reason !== undefined) expect(result.notUnderstood?.reason).toBe(e.reason);

  if (TRANSACTION_LABELS.has(e.label)) {
    const t = result.transaction!;
    expect(t).not.toBeNull();
    if (e.type !== undefined) expect(t.type).toBe(e.type);
    if (e.amountMinor !== undefined) expect(t.amountMinor).toBe(e.amountMinor);
    if (e.lastFour !== undefined) expect(t.lastFour).toBe(e.lastFour);
    if (e.payee !== undefined) expect(t.merchantName).toBe(e.payee ?? 'Unknown');
    if (e.salary !== undefined) expect(t.salary).toBe(e.salary);
    // R5-fix U11: account kind + display bank asserted on EVERY transaction fixture.
    const account = ACCOUNT_EXPECT[`${fixture.group}: ${fixture.name}`];
    expect(account).toBeDefined();
    expect(t.accountKind).toBe(e.accountKind ?? account[0]);
    expect(t.bankName).toBe(e.bankName ?? account[1]);
    // Phone-number-like digits never become a merchant.
    expect(t.merchantName).not.toMatch(/\d{5,}/);
    expect(t.sourceReferenceHash).toBe(`sms-7-${DATE}`);
    expect(t.occurredAt).toBe(new Date(DATE).toISOString());
  } else {
    expect(result.transaction).toBeNull();
  }
}

describe('SMS reader v2 — institution fixtures (table-driven)', () => {
  it.each(SMS_FIXTURES.map(f => [`${f.group}: ${f.name}`, f] as const))('%s', (_n, fixture) =>
    check(fixture),
  );
});

describe('SMS reader v2 — v1 regression set', () => {
  it.each(V1_REGRESSION_FIXTURES.map(f => [f.name, f] as const))('%s', (_n, fixture) =>
    check(fixture),
  );

  it('integer amounts are not penalised (Rs.500 and Rs.500.00 score the same)', () => {
    const a = readSmsMessage({ id: '1', address: 'AD-HDFCBK-S', body: 'Rs.500 debited from A/c XX1234 to QA PAYEE', date: DATE });
    const b = readSmsMessage({ id: '2', address: 'AD-HDFCBK-S', body: 'Rs.500.00 debited from A/c XX1234 to QA PAYEE', date: DATE });
    expect(a.transaction!.confidenceScore).toBe(b.transaction!.confidenceScore);
    expect(a.transaction!.confidenceScore).toBeGreaterThanOrEqual(85);
  });

  it('known sender outranks an unknown one for the same body; never above 90', () => {
    const body = 'Rs.500.00 debited from A/c XX1234 to QA PAYEE. UPI Ref No 000000000001';
    const known = readSmsMessage({ id: '1', address: 'AD-HDFCBK-S', body, date: DATE }).transaction!;
    const unknown = readSmsMessage({ id: '1', address: 'AD-QABANK', body, date: DATE }).transaction!;
    expect(known.confidenceScore).toBeGreaterThan(unknown.confidenceScore);
    expect(known.confidenceScore).toBeLessThanOrEqual(90);
  });

  it('salary credits from a known sender with an account are high confidence', () => {
    const t = read(V1_REGRESSION_FIXTURES[0]).transaction!;
    expect(t.salary).toBe(true);
    expect(t.confidenceScore).toBe(90);
  });

  it('"salary account" alone is not a salary credit', () => {
    const r = readSmsMessage({
      id: '1',
      address: 'AD-HDFCBK-S',
      body: 'Rs.300.00 credited to your Salary A/c XX1234 from QA PAYEE',
      date: DATE,
    });
    expect(r.transaction!.salary).toBe(false);
  });

  it('owner multi-line format: payee is the To line, never the helpline or the From line', () => {
    const f = SMS_FIXTURES.find(x => x.name === 'multi-line UPI sent (owner format)')!;
    const t = read(f).transaction!;
    expect(t.merchantName).toBe('QA PAYEE');
    expect(t.merchantName).not.toMatch(/HDFC|7000000000|\d/);
    expect(t.amountMinor).toBe(1500000);
    expect(t.bankName).toBe('HDFC');
  });
});

describe('SMS reader v2 — coverage', () => {
  it('U11: ACCOUNT_EXPECT covers exactly the transaction fixtures', () => {
    const txnKeys = [...SMS_FIXTURES, ...V1_REGRESSION_FIXTURES]
      .filter(f => TRANSACTION_LABELS.has(f.expect.label))
      .map(f => `${f.group}: ${f.name}`);
    expect(new Set(txnKeys).size).toBe(txnKeys.length);
    expect(Object.keys(ACCOUNT_EXPECT).sort()).toEqual([...txnKeys].sort());
  });

  it.each([...BANK_GROUPS])('bank %s has >= 3 fixtures incl. a debit and a credit', group => {
    const rows = SMS_FIXTURES.filter(f => f.group === group);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.some(f => f.expect.type === 'expense')).toBe(true);
    expect(rows.some(f => f.expect.type === 'income')).toBe(true);
  });

  it.each([...CARD_WALLET_GROUPS])('card / wallet %s has >= 2 fixtures', group => {
    expect(SMS_FIXTURES.filter(f => f.group === group).length).toBeGreaterThanOrEqual(2);
  });

  it('every negative class is covered', () => {
    const labels = new Set(SMS_FIXTURES.map(f => f.expect.label));
    for (const label of [
      'otp', 'loan_or_promo', 'mandate_future', 'collect_request', 'failed', 'bill_due',
      'statement', 'balance_info', 'unknown_financial', 'not_financial', 'refund', 'card_spend',
    ]) {
      expect(labels.has(label as never)).toBe(true);
    }
  });
});

describe('SMS reader v2 — properties over every fixture', () => {
  const all = [...SMS_FIXTURES, ...V1_REGRESSION_FIXTURES];

  it.each(all.map(f => [`${f.group}: ${f.name}`, f] as const))(
    'no output field carries the raw body or sender: %s',
    (_n, fixture) => {
      const json = JSON.stringify(read(fixture));
      expect(json).not.toContain(fixture.body);
      expect(json).not.toContain(fixture.address);
      // The header ID is the sender; the result carries only the canonical id.
      const header = fixture.address.split('-')[1];
      if (header) expect(json).not.toContain(header);
      // The reference only survives hashed.
      expect(json).not.toContain('000000000001');
      expect(json).not.toContain('000000000002');
      // Long body fragments never leak (sanity: 25-char windows).
      for (let i = 0; i + 25 <= fixture.body.length; i += 25) {
        const window = fixture.body.slice(i, i + 25);
        if (/\d{3,}/.test(window) || /[a-z]{4,}\s[a-z]{4,}/i.test(window)) {
          expect(json).not.toContain(window);
        }
      }
    },
  );

  it.each(
    all
      .filter(f => f.expect.balanceMinor !== undefined && TRANSACTION_LABELS.has(f.expect.label))
      .map(f => [`${f.group}: ${f.name}`, f] as const),
  )('txn amount never equals the balance/limit figure: %s', (_n, fixture) => {
    expect(read(fixture).transaction!.amountMinor).not.toBe(fixture.expect.balanceMinor);
  });

  it('every transaction has a positive integer amount and a confidence in 30..90', () => {
    for (const fixture of all) {
      const t = read(fixture).transaction;
      if (!t) continue;
      expect(Number.isInteger(t.amountMinor)).toBe(true);
      expect(t.amountMinor).toBeGreaterThan(0);
      expect(t.confidenceScore).toBeGreaterThanOrEqual(30);
      expect(t.confidenceScore).toBeLessThanOrEqual(90);
    }
  });
});
