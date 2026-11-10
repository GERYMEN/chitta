/**
 * R5d T0 — parser fixes from the 2026-11-08 review (SYNTHETIC inputs only:
 * QA names, XX1234 / XX9999, refs 000000000xxx, qa.x@okqa).
 */
import { readSmsMessage, readSmsWithReader, SmsReadResult } from '../readSms';
import { extractLastDigits, normalizeAccountKey } from '../../normalizeAccountKey';
import { normalizeAccountKeyV1 } from '../../legacy/normalizeAccountKeyV1';
import { R5D_REVIEW_FIXTURES } from '../../../../test/fixtures/smsReader.fixture';

const DATE = Date.parse('2026-11-03T05:00:00.000Z');
const read = (body: string, address = 'AD-HDFCBK-S'): SmsReadResult =>
  readSmsMessage({ id: '9', address, body, date: DATE });

describe('T0a — a debit that "has been reversed to your a/c" is a refund', () => {
  it.each([
    'Rs.500.00 debited on 01-11-26 for UPI Ref 000000000201 has been reversed to your A/c XX1234 on 03-11-26',
    'Rs.500.00 debited from A/c XX1234 on 01-11-26 is reversed into your A/c XX1234. Ref 000000000202',
    'Rs.500.00 debited on 01-11-26 was refunded to your a/c XX1234. UPI Ref 000000000203',
  ])('%s', body => {
    const r = read(body);
    expect(r.label).toBe('refund');
    expect(r.transaction!.type).toBe('income');
    expect(r.transaction!.amountMinor).toBe(50000);
    expect(r.transaction!.lastFour).toBe('1234');
  });

  it('C6 still holds: a debit that names a "reversal of credit" stays a debit', () => {
    const r = read('Rs.500.00 debited from your A/c XX1234 on 01-11-26 towards reversal of credit dated 30-10-26');
    expect(r.label).toBe('txn_debit');
    expect(r.transaction!.type).toBe('expense');
  });

  it('a future "will be reversed" footer never turns a debit into a refund', () => {
    const r = read('Rs.500.00 debited from A/c XX1234 to QA PAYEE on 01-11-26. If txn failed, amount will be reversed to your a/c in 3 days.');
    expect(r.label).toBe('txn_debit');
  });
});

describe('T0b — the receiving account of a credit', () => {
  it('a wallet top-up from a bank a/c belongs to the wallet; the bank digits are the counterparty', () => {
    const r = read('Rs.1,000.00 added to your Paytm Wallet from HDFC Bank A/c XX1234 on 03-11-26. Txn ID 000000000204', 'VM-IPAYTM-S');
    const t = r.transaction!;
    expect(t.type).toBe('income');
    expect(t.accountKind).toBe('other');
    expect(t.bankCanonical).toBe('paytm');
    expect(t.bankName).toBe('Paytm');
    expect(t.lastFour).toBeNull();
    expect(t.counterpartyLastFour).toBe('1234');
  });

  it('a credit naming the sender\'s a/c first lands on the OTHER (own) account', () => {
    const r = read('Rs.2,000.00 received from QA PAYEE A/c XX9999 in your A/c XX1234 on 03-11-26. IMPS Ref 000000000205', 'AD-KOTAKB-S');
    const t = r.transaction!;
    expect(t.type).toBe('income');
    expect(t.lastFour).toBe('1234');
    expect(t.counterpartyLastFour).toBe('9999');
  });

  it('a credit naming only the sender\'s a/c keeps it (no other account named)', () => {
    const r = read('Rs.2,000.00 credited from QA PAYEE A/c XX9999 on 03-11-26. IMPS Ref 000000000206', 'AD-KOTAKB-S');
    expect(r.transaction!.lastFour).toBe('9999');
    expect(r.transaction!.counterpartyLastFour).toBeUndefined();
  });

  it('a debit is never changed by T0b', () => {
    const r = read('Rs.300.00 debited from A/c XX1234 to QA PAYEE A/c XX9999 on 03-11-26');
    expect(r.transaction!.lastFour).toBe('1234');
    expect(r.transaction!.counterpartyLastFour).toBeUndefined();
  });

  it('a plain wallet top-up (no bank a/c named) is unchanged', () => {
    const r = read('Rs.1,000 added to your Paytm Wallet. Txn ID 000000000207. Updated Balance: Rs.1,380', 'VM-IPAYTM-S');
    expect(r.transaction!.accountKind).toBe('upi');
    expect(r.transaction!.counterpartyLastFour).toBeUndefined();
  });
});

describe('T0c — long masks ("XXXXX123456") give the last 4 of the digit run', () => {
  it('normalizer fallback', () => {
    expect(normalizeAccountKey('Your A/C XXXXX123456 Credited INR 2,000.00').lastFour).toBe('3456');
    expect(normalizeAccountKey('Your a/c **0000123456 is debited').lastFour).toBe('3456');
  });

  it('never changes a key v1 / v2 already produced', () => {
    for (const body of [
      'A/c XX1234 debited Rs.500',
      'card ** 12345 used',
      'A/C X1234 debited by 100.0',
      'A/c ending 1234',
    ]) {
      const v2 = normalizeAccountKey(body).lastFour;
      expect(v2).not.toBe('');
      expect(v2).toBe(normalizeAccountKeyV1(body).lastFour || v2);
    }
  });

  it('reader: SBI long mask', () => {
    const r = read('Your A/C XXXXX123456 Credited INR 2,000.00 on 03/11/26 -Deposit by transfer from QA PAYEE. Avl Bal INR 12,000.00-SBI', 'VM-SBIINB-S');
    expect(r.transaction!.lastFour).toBe('3456');
  });
});

describe('T0d — 3-digit masks', () => {
  it('extractLastDigits', () => {
    expect(extractLastDigits('ICICI Bank Acct XX888 debited for Rs 1,250.00')).toBe('888');
    expect(extractLastDigits('A/c *888 credited')).toBe('888');
    expect(extractLastDigits('A/c XX1234 debited')).toBeNull();
    expect(extractLastDigits('Rs 888 debited')).toBeNull();
  });

  it('reader: "Acct XX888" → lastDigits 888, lastFour null', () => {
    const r = read('ICICI Bank Acct XX888 debited for Rs 1,250.00 on 03-Nov-26; QA PAYEE credited. UPI:000000000208', 'AD-ICICIB-S');
    expect(r.transaction!.lastFour).toBeNull();
    expect(r.transaction!.lastDigits).toBe('888');
    expect(r.transaction!.accountKind).toBe('bank');
  });

  it('a 4-digit account has no lastDigits', () => {
    const r = read('Rs.500.00 debited from A/c XX1234 to QA PAYEE on 01-11-26');
    expect(r.transaction!.lastDigits).toBeUndefined();
  });
});

describe('T0e — credit card bill paid from a bank a/c', () => {
  it.each([
    'Rs.10,000.00 debited from A/c XX1234 on 03-11-26 towards HDFC Bank Credit Card XX9999 payment. Avl Bal Rs.5,000.00',
    'Rs.10,000.00 debited from your A/c XX1234 for payment of Credit Card XX9999 on 03-11-26',
    'Your A/c XX1234 is debited for Rs.10,000.00 on 03-11-26 towards Credit Card ending 9999 payment',
  ])('%s', body => {
    const r = read(body);
    const t = r.transaction!;
    expect(r.label).toBe('txn_debit');
    expect(t.type).toBe('expense');
    expect(t.amountMinor).toBe(1000000);
    expect(t.accountKind).toBe('bank');
    expect(t.lastFour).toBe('1234');
    expect(t.counterpartyLastFour).toBe('9999');
    expect(t.moneyHint).toBe('card_payment');
  });

  it('a card spend is not a card payment', () => {
    const r = read('Rs.500.00 spent on HDFC Bank Credit Card XX9999 at QA STORE on 03-11-26');
    expect(r.transaction!.moneyHint).toBeUndefined();
    expect(r.transaction!.accountKind).toBe('credit_card');
  });

  it('a card issuer\'s "payment received" credit is not a bank debit', () => {
    const body = 'Payment of Rs.5,000.00 received on your HDFC Bank Credit Card XX9999 on 03-11-26';
    // The reader alone: an income on the card, no bank-side card payment.
    const reader = readSmsWithReader({ id: '9', address: 'AD-HDFCCC-S', body, date: DATE });
    expect(reader.transaction!.type).toBe('income');
    expect(reader.transaction!.moneyHint).toBeUndefined();
    // R5g: the generic card-payment template agrees on type/amount/last-4 and
    // adds the meaning (card side of a bill payment) — held until R5e.
    const r = read(body, 'AD-HDFCCC-S');
    expect(r.source).toBe('rule');
    expect(r.transaction!.type).toBe('income');
    expect(r.transaction!.moneyHint).toBe('card_payment');
  });
});

describe('T0 — the review set (30 synthetic bodies)', () => {
  it('has 30 bodies', () => expect(R5D_REVIEW_FIXTURES).toHaveLength(30));

  it.each(R5D_REVIEW_FIXTURES.map(f => [f.name, f] as const))('%s', (_n, f) => {
    const r = read(f.body, f.address);
    expect(r.label).toBe(f.expect.label);
    if (f.expect.type === undefined) {
      expect(r.transaction).toBeNull();
      return;
    }
    const t = r.transaction!;
    expect(t.type).toBe(f.expect.type);
    expect(t.amountMinor).toBe(f.expect.amountMinor);
    expect(t.lastFour).toBe(f.expect.lastFour);
    expect(t.accountKind).toBe(f.expect.accountKind);
    if (f.expect.counterpartyLastFour !== undefined) {
      expect(t.counterpartyLastFour).toBe(f.expect.counterpartyLastFour);
    }
    if (f.expect.lastDigits !== undefined) expect(t.lastDigits).toBe(f.expect.lastDigits);
    if (f.expect.moneyHint !== undefined) expect(t.moneyHint).toBe(f.expect.moneyHint);
    if (f.expect.bankName !== undefined) expect(t.bankName).toBe(f.expect.bankName);
    // Nothing returned carries the body, the sender or the raw reference.
    const json = JSON.stringify(r);
    expect(json).not.toContain(f.address);
    expect(json).not.toMatch(/000000000[0-9]{3}/);
  });
});
