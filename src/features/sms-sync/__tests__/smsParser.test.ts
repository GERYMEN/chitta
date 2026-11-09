import { parseSmsMessage, PARSER_VERSION } from '../smsParser';
import { SMS_PARSER_VERSION } from '../smsSyncLogic';

/**
 * R5: the v1 contract of `parseSmsMessage` (a transaction or null) on top of
 * reader v2. Class-by-class behaviour lives in parser/__tests__.
 */
const msg = (id: string, body: string, date = 1700000000000, address = 'AD-QABANK-S') => ({
  id,
  address,
  body,
  date,
});

describe('parseSmsMessage — contract', () => {
  it('parses a debit: amount in paise, merchant, SMS date', () => {
    const result = parseSmsMessage(
      msg('1', 'Rs.250.00 debited from your account at QA STORE on 25-Oct-2026. Avl bal Rs.12,345.67'),
    );
    expect(result?.type).toBe('expense');
    expect(result?.amountMinor).toBe(25000);
    expect(result?.merchantName).toBe('QA STORE');
    expect(result?.occurredAt).toBe('2023-11-14T22:13:20.000Z');
  });

  it('parses a credit with a payer', () => {
    const result = parseSmsMessage(msg('2', 'Rs.50000.00 received in your A/c XX1234 from QA PAYEE on 01-Oct-2026.'));
    expect(result?.type).toBe('income');
    expect(result?.amountMinor).toBe(5000000);
    expect(result?.merchantName).toBe('QA PAYEE');
  });

  it('strips grouping commas', () => {
    expect(parseSmsMessage(msg('3', 'INR 1,250.50 debited from A/c XX1234 at QA STORE'))?.amountMinor).toBe(125050);
  });

  it('returns null for OTP, promo, no amount, no direction', () => {
    expect(parseSmsMessage(msg('4', 'Your OTP for login is 482913. Do not share it.'))).toBeNull();
    expect(parseSmsMessage(msg('5', 'Congratulations! You are eligible for a pre-approved offer. Apply now'))).toBeNull();
    expect(parseSmsMessage(msg('6', 'Hello, your package is out for delivery today.'))).toBeNull();
    expect(parseSmsMessage(msg('7', 'Your bill of Rs.300.00 is ready.'))).toBeNull();
  });

  it('falls back to Unknown merchant and still returns a transaction', () => {
    const result = parseSmsMessage(msg('8', 'Rs.500 debited from your account on 25-Oct.'));
    expect(result?.merchantName).toBe('Unknown');
    expect(result?.amountMinor).toBe(50000);
  });

  it('"your account" is not a merchant', () => {
    expect(parseSmsMessage(msg('9', 'Rs.100.00 credited to your account by NEFT.'))?.merchantName).toBe('Unknown');
  });
});

describe('parseSmsMessage — hash + preview + privacy', () => {
  it('sourceReferenceHash is unchanged from v1: sms-<id>-<date>', () => {
    expect(
      parseSmsMessage(msg('42', 'Rs.250.00 debited from A/c XX1234 at QA STORE', 1700000000000))
        ?.sourceReferenceHash,
    ).toBe('sms-42-1700000000000');
  });

  it('sanitizedPreview is built from parsed fields only', () => {
    const result = parseSmsMessage(msg('43', 'Rs.250.00 debited from A/c XX1234 at QA STORE'));
    expect(result?.sanitizedPreview).toBe('Debited ₹250 — QA STORE');
  });

  it('never returns the address or the body', () => {
    const body = 'Rs.250.00 debited from A/c XX1234 at QA STORE';
    const json = JSON.stringify(parseSmsMessage(msg('44', body, 1700000000000, 'AD-QABANK-S')));
    expect(json).not.toContain('QABANK');
    expect(json).not.toContain(body);
  });

  it('parser version tag follows PARSER_VERSION', () => {
    expect(PARSER_VERSION).toBe(2);
    expect(SMS_PARSER_VERSION).toBe('sms-reader-v2');
  });
});

describe('parseSmsMessage — source account (v1 keys kept)', () => {
  it('bank a/c with masked last-4 + bank name in the body', () => {
    const result = parseSmsMessage(
      msg('51', 'Rs.1,200.00 debited from a/c X1859 to QA PAYEE. Avl bal Rs.5,000.00 -Federal Bank'),
    );
    expect(result?.accountKind).toBe('bank');
    expect(result?.bankName).toBe('Federal');
    expect(result?.lastFour).toBe('1859');
  });

  it('credit card ending digits', () => {
    const result = parseSmsMessage(msg('52', 'Rs.450.00 debited from HDFC Bank card ending 8123 at QA STORE'));
    expect(result?.accountKind).toBe('credit_card');
    expect(result?.bankName).toBe('HDFC');
    expect(result?.lastFour).toBe('8123');
  });

  it('unknown bank → Unknown Bank, no last-4 from an amount', () => {
    const result = parseSmsMessage(
      msg('54', 'Rs.1234.00 debited from your account at QA STORE. Avl bal Rs.99,999.00'),
    );
    expect(result?.bankName).toBe('Unknown Bank');
    expect(result?.lastFour).toBeNull();
  });

  it('"State Bank of India" → SBI; a known sender names the bank when the body does not', () => {
    expect(parseSmsMessage(msg('57', 'Rs.500.00 debited from State Bank of India A/C X4444'))?.bankName).toBe('SBI');
    const fromSender = parseSmsMessage(msg('58', 'Rs.500.00 debited from A/C X4444 to QA PAYEE', 1, 'AD-SBIUPI-S'));
    expect(fromSender?.bankCanonical).toBe('sbi');
  });
});
