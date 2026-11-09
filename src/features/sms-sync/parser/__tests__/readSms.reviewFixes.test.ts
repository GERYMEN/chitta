/**
 * R5-fix — parser regressions from the R5 review (SYNTHETIC inputs only:
 * QA names, XX1234, refs 000000000123, qa.x@okqa).
 */
import { readSmsMessage, scoreConfidence } from '../readSms';
import { hasSalaryToken } from '../extract';
import { parseSender } from '../senders';

const DATE = Date.parse('2026-11-03T05:00:00.000Z');
const read = (body: string, address = 'AD-HDFCBK-S') => readSmsMessage({ id: '9', address, body, date: DATE });

describe('C5 — future / pre-debit notices are mandate_future, never an expense', () => {
  it.each([
    'Pre-debit notification: Rs.499.00 to be debited from A/c XX1234 on 05-11-26 for QA PAYEE e-mandate',
    'Your A/c XX1234 is due to be debited for Rs.499.00 on 05-11-26 towards QA PAYEE mandate',
    'SI debit of Rs.1,000.00 to QA PAYEE is scheduled for 05-11-26 from A/c XX1234',
    'Auto-debit of Rs.499.00 for QA PAYEE is scheduled on 05-11-26 from your A/c XX1234',
    'Upcoming auto-debit of Rs.499.00 for QA PAYEE on 05-11-26 from A/c XX1234',
    'Reminder: Your NACH debit of Rs.2,500.00 towards QA FINANCE is due on 05-11-26. Please maintain sufficient balance in A/c XX1234',
    'Your AutoPay debit of Rs.149.00 for QA PAYEE is due on 05-11-26 from A/c XX1234',
    'NACH debit of Rs.2,500.00 for QA FINANCE will be presented on 05-11-26. Maintain balance in A/c XX1234',
    'Rs.1,000.00 to be debited from A/c XX1234 on 05-11-26 for QA FUND SIP',
  ])('%s', body => {
    const r = read(body);
    expect(r.label).toBe('mandate_future');
    expect(r.transaction).toBeNull();
  });

  it('a completed debit next to a separate due-date sentence is still a debit', () => {
    const r = read('Rs.500.00 debited from A/c XX1234 to QA PAYEE on 01-11-26. Your loan EMI is due on 05-11-26.');
    expect(r.label).toBe('txn_debit');
  });
});

describe('C6 — a debit that mentions "reversal of credit" stays a debit', () => {
  it.each([
    ['AD-HDFCBK-S', 'Rs.500.00 debited from your A/c XX1234 on 01-11-26 towards reversal of credit dated 30-10-26'],
    ['AD-ICICIB-S', 'Your A/c XX1234 is debited for Rs.500.00 being reversal of wrong credit on 30-10-26'],
  ])('%s', (address, body) => {
    const r = read(body, address);
    expect(r.label).toBe('txn_debit');
    expect(r.transaction!.type).toBe('expense');
    expect(r.transaction!.amountMinor).toBe(50000);
  });

  it('a real refund credit is still a refund', () => {
    const r = read('Refund of Rs.500.00 has been credited to your A/c XX1234 from QA STORE');
    expect(r.label).toBe('refund');
    expect(r.transaction!.type).toBe('income');
  });
});

describe('C9 — confidence calibration at the production default (90)', () => {
  it('clean known-sender parse (verb + amount + account + payee) reaches 90', () => {
    const r = read('Rs.500.00 debited from A/c XX1234 to QA PAYEE on 01-11-26. UPI Ref 000000000123');
    expect(r.transaction!.confidenceScore).toBe(90);
  });

  it('known sender with no payee stays below 90', () => {
    const r = read('Rs.500.00 debited from A/c XX1234 on 01-11-26. UPI Ref 000000000123');
    expect(r.transaction!.merchantName).toBe('Unknown');
    expect(r.transaction!.confidenceScore).toBeLessThan(90);
  });

  it('known sender with no account last-4 stays below 90', () => {
    const r = read('Rs.500.00 paid to QA PAYEE via UPI on 01-11-26');
    expect(r.transaction!.confidenceScore).toBeLessThan(90);
  });

  it('unknown DLT sender never reaches 90', () => {
    const r = read('Rs.500.00 debited from A/c XX1234 to QA PAYEE on 01-11-26', 'AD-QABANK-S');
    expect(r.transaction!.confidenceScore).toBeLessThan(90);
  });

  it('scoreConfidence table', () => {
    const sender = parseSender('AD-HDFCBK-S');
    const bound = {
      amount: { start: 0, end: 9, minor: 50000, prefixed: true, role: 'txn' as const },
      verb: { start: 10, end: 17, direction: 'debit' as const, weak: false },
      distance: 1,
    };
    const base = { sender, bound, hasLastFour: true, hasMerchant: true, hasReference: false, salary: false };
    expect(scoreConfidence(base)).toBe(90);
    expect(scoreConfidence({ ...base, hasMerchant: false, hasReference: true })).toBeLessThan(90);
    expect(scoreConfidence({ ...base, hasLastFour: false })).toBeLessThan(90);
    expect(scoreConfidence({ ...base, bound: { ...bound, amount: { ...bound.amount, prefixed: false } } })).toBeLessThan(90);
    expect(scoreConfidence({ ...base, bound: { ...bound, distance: 60 } })).toBeLessThan(90);
  });
});

describe('U1 — footer / marketing words never drop a completed transaction', () => {
  it.each([
    'Rs.500.00 debited from A/c XX1234 to QA PAYEE on 01-11-26. Never share your OTP with anyone.',
    'Rs.500.00 debited from A/c XX1234 to QA PAYEE on 01-11-26. Never share OTP. Avl bal is 10000',
    'Rs.500.00 debited from A/c XX1234 to QA PAYEE on 01-11-26. Never approve a collect request from unknown persons.',
    'Rs.500.00 debited from A/c XX1234 to QA PAYEE on 01-11-26. Beware of payment request frauds.',
    'Rs.500.00 debited from A/c XX1234 to QA PAYEE on 01-11-26. Money is never received on approval of a request.',
    'Rs.500.00 debited from A/c XX1234 to QA PAYEE on 01-11-26. If txn failed, amount will be reversed in 3 days.',
  ])('%s', body => {
    const r = read(body);
    expect(r.label).toBe('txn_debit');
    expect(r.transaction!.amountMinor).toBe(50000);
  });

  it('wallet debit (no last-4) with an offer footer is a transaction', () => {
    const r = read('Rs.250.00 paid to QA STORE from your Paytm wallet. Click to win cashback offer!', 'AD-PAYTMB-S');
    expect(r.transaction).not.toBeNull();
    expect(r.transaction!.amountMinor).toBe(25000);
  });

  it('a real failure / collect / OTP / promo is still dropped', () => {
    expect(read('Your txn of Rs.500.00 to QA PAYEE from A/c XX1234 has failed').label).toBe('failed');
    expect(read('QA PAYEE has requested Rs.500.00 from you. On approving, Rs.500.00 will be debited from A/c XX1234').label).toBe('collect_request');
    expect(read('123456 is your OTP for txn of Rs.500.00 at QA STORE on card XX1234').label).toBe('otp');
    expect(read('Pre-approved loan of Rs.2,00,000 credited instantly. Click here to apply now').label).toBe('loan_or_promo');
  });
});

describe('U2 — bounce / return-charge debits are real debits', () => {
  it.each([
    'Cheque 000123 for Rs.5,000.00 returned unpaid. Charges Rs.500.00 debited from A/c XX1234 on 01-11-26',
    'Rs.590.00 debited from A/c XX1234 on 01-11-26 towards NACH return charges for insufficient balance',
    'ECS bounce charges of Rs.354.00 debited from A/c XX1234 on 01-11-26 as the payment was declined',
  ])('%s', body => {
    const r = read(body);
    expect(r.label).toBe('txn_debit');
    expect(r.transaction!.type).toBe('expense');
  });
});

describe('U3 — HDFC card formats', () => {
  it('"Txn Rs.X On HDFC Bank Card NNNN At <VPA>" is a credit-card spend', () => {
    const r = read('Txn Rs.500.00 On HDFC Bank Card 1234 At qa.payee@okqa by UPI 000000000123 On 03-11-26', 'AD-HDFCBK-S');
    expect(r.label).toBe('card_spend');
    expect(r.transaction!.amountMinor).toBe(50000);
    expect(r.transaction!.accountKind).toBe('credit_card');
    expect(r.transaction!.lastFour).toBe('1234');
    expect(r.transaction!.merchantName).toBe('qa.payee@okqa');
  });

  it('"Txn Rs.X On HDFC Bank Card NNNN At <merchant>"', () => {
    const r = read('Txn Rs.1,200.00 On HDFC Bank Card 1234 At QA STORE On 2026-11-03:10:20:30', 'AD-HDFCBK-S');
    expect(r.transaction!.accountKind).toBe('credit_card');
    expect(r.transaction!.merchantName).toBe('QA STORE');
  });

  it('a debit card "ending 1234" is a bank-account card, not a credit card', () => {
    const r = read('Rs.500.00 spent on HDFC Bank Debit Card ending 1234 at QA STORE on 03-11-26', 'AD-HDFCBK-S');
    expect(r.transaction!.accountKind).toBe('bank');
  });
});

describe('U4 — available credit / reward units are never a transaction amount', () => {
  it('"your available credit is Rs X" alone is not income', () => {
    const r = read('Your available credit is Rs.10,000.00 on card XX1234', 'AD-ICICIB-S');
    expect(r.transaction).toBeNull();
  });

  it('available credit limit figure is not bound as income', () => {
    const r = read('Rs.500.00 spent on ICICI Bank Card XX1234 at QA STORE on 03-11-26. Available credit Rs.10,000.00', 'AD-ICICIB-S');
    expect(r.transaction!.type).toBe('expense');
    expect(r.transaction!.amountMinor).toBe(50000);
  });

  it.each([
    'Congrats! 500 reward points credited to your card XX1234',
    'You have been credited with 250 coins in your QA wallet account',
    '1200 miles credited to your account XX1234',
  ])('%s', body => {
    const r = read(body, 'AD-ICICIB-S');
    expect(r.transaction).toBeNull();
  });
});

describe('U5 — salary tokens inside a VPA are not salary', () => {
  it('hasSalaryToken ignores VPAs / e-mails', () => {
    expect(hasSalaryToken('Rs.500.00 credited to A/c XX1234 from qa.sal@okqa')).toBe(false);
    expect(hasSalaryToken('Rs.500.00 credited to A/c XX1234 from sal.qa@okqa')).toBe(false);
    expect(hasSalaryToken('Rs.500.00 credited to A/c XX1234 NEFT-QA EMPLOYER-SAL OCT')).toBe(true);
  });

  it('a credit from a VPA with a sal segment is not salary', () => {
    const r = read('Rs.500.00 credited to A/c XX1234 by VPA qa.sal@okqa on 03-11-26');
    expect(r.transaction!.salary).toBe(false);
  });
});

describe('U6 — "ATM card" wording is not a cash withdrawal', () => {
  it.each([
    'Rs.500.00 spent using ATM cum Debit Card XX1234 at QA STORE on 03-11-26',
    'Rs.500.00 debited from A/c XX1234 for purchase at QA STORE using your ATM card',
  ])('%s', body => {
    const r = read(body);
    expect(r.transaction!.merchantName).not.toBe('ATM Withdrawal');
  });

  it('a real ATM withdrawal still is one', () => {
    const r = read('Rs.2,000.00 withdrawn at QA ATM from A/c XX1234 on 03-11-26');
    expect(r.transaction!.merchantName).toBe('ATM Withdrawal');
  });
});

describe('U7 — payee fallbacks never return junk', () => {
  it.each([
    ['Rs.500.00 debited from A/c XX1234 on date 01Nov26. Refno 000000000123', /date|01Nov26/i],
    ['Rs.500.00 debited from A/c XX1234 on Nov 01. Ref 000000000123', /^Nov/i],
    ['Rs.500.00 debited from A/c XX1234 to Refno 000000000123', /refno/i],
    ['Rs.500.00 debited from A/c XX1234 and is to be debited', /be debited/i],
  ])('%s', (body, junk) => {
    const r = read(body);
    if (r.transaction) expect(r.transaction.merchantName).not.toMatch(junk);
  });
});

describe('U8 — numeric senders', () => {
  it('personal 10-digit numbers stay dropped', () => {
    expect(parseSender('+919000000001').kind).toBe('personal');
    expect(read('Rs.500.00 debited from A/c XX1234 to QA PAYEE', '+919000000001').label).toBe('not_financial');
  });

  it('a 5-6 digit short code reaches the classifier with a low prior', () => {
    expect(parseSender('57575').kind).toBe('other');
    const r = read('Rs.500.00 debited from A/c XX1234 to QA PAYEE on 01-11-26', '57575');
    expect(r.label).toBe('txn_debit');
    expect(r.transaction!.confidenceScore).toBeLessThanOrEqual(80);
  });
});
