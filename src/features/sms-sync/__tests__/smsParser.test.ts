import { parseSmsMessage } from '../smsParser';

const msg = (id: string, body: string, date = 1700000000000) => ({
  id,
  address: 'AD-0000000000',
  body,
  date,
});

describe('parseSmsMessage — clean matches', () => {
  it('parses a clean debit message', () => {
    const result = parseSmsMessage(
      msg('1', 'Rs.250.00 debited from your account at Amazon on 25-Oct-2026. Avl bal Rs.12,345.67'),
    );

    expect(result).not.toBeNull();
    expect(result?.type).toBe('expense');
    expect(result?.amountMinor).toBe(25000);
    expect(result?.merchantName).toBe('Amazon');
    expect(result?.confidenceScore).toBe(90);
    expect(result?.occurredAt).toBe('2023-11-14T22:13:20.000Z');
  });

  it('parses a clean credit message with a merchant', () => {
    const result = parseSmsMessage(
      msg('2', 'Rs.50000.00 received from Acme Corp on 01-Oct-2026.'),
    );

    expect(result).not.toBeNull();
    expect(result?.type).toBe('income');
    expect(result?.amountMinor).toBe(5000000);
    expect(result?.merchantName).toBe('Acme Corp');
    expect(result?.confidenceScore).toBe(90);
  });

  it('strips commas before converting amount to paise', () => {
    const result = parseSmsMessage(msg('3', 'INR 1,250.50 debited at BigBasket'));
    expect(result?.amountMinor).toBe(125050);
  });
});

describe('parseSmsMessage — rejection rules', () => {
  it('rejects an OTP message', () => {
    expect(parseSmsMessage(msg('4', 'Your OTP for login is 482913. Do not share it.'))).toBeNull();
  });

  it('rejects a promotional message', () => {
    expect(
      parseSmsMessage(msg('5', 'Congratulations! You won a gift voucher. Claim your offer now.')),
    ).toBeNull();
  });

  it('rejects a message with no amount', () => {
    expect(
      parseSmsMessage(msg('6', 'Hello, your package is out for delivery today.')),
    ).toBeNull();
  });

  it('rejects a message with an amount but no direction', () => {
    expect(parseSmsMessage(msg('7', 'Your bill of Rs.300.00 is ready.'))).toBeNull();
  });
});

describe('parseSmsMessage — merchant fallback', () => {
  it('falls back to Unknown when no merchant is extractable, still returns non-null', () => {
    const result = parseSmsMessage(msg('8', 'Rs.500 debited from your account on 25-Oct.'));

    expect(result).not.toBeNull();
    expect(result?.type).toBe('expense');
    expect(result?.amountMinor).toBe(50000);
    expect(result?.merchantName).toBe('Unknown');
    expect(result?.confidenceScore).toBe(40);
  });

  it('does not treat "your account" as a merchant', () => {
    const result = parseSmsMessage(msg('9', 'Rs.100.00 credited to your account by salary.'));
    expect(result?.merchantName).toBe('Unknown');
    expect(result?.confidenceScore).toBe(60);
  });
});

describe('parseSmsMessage — hash + sanitized preview shape', () => {
  it('derives sourceReferenceHash only from id + date', () => {
    const result = parseSmsMessage(
      msg('42', 'Rs.250.00 debited at Amazon', 1700000000000),
    );
    expect(result?.sourceReferenceHash).toBe('sms-42-1700000000000');
  });

  it('builds sanitizedPreview from parsed fields only (never raw body)', () => {
    const result = parseSmsMessage(msg('43', 'Rs.250.00 debited at Amazon'));
    expect(result?.sanitizedPreview).toBe('Debited ₹250 — Amazon');
    expect(result?.sanitizedPreview).not.toContain('AD-0000000000');
    expect(result?.sanitizedPreview).not.toContain('debited at Amazon');
  });

  it('never leaks address or body into the returned object', () => {
    const result = parseSmsMessage(msg('44', 'Rs.250.00 debited at Amazon'))!;
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('AD-0000000000');
    expect(serialized).not.toContain('Rs.250.00 debited at Amazon');
  });
});

describe('parseSmsMessage — source account extraction', () => {
  it('extracts bankName, accountKind=bank, lastFour from a bank UPI debit', () => {
    const result = parseSmsMessage(
      msg('51', 'Rs.1,200.00 debited from a/c X1859 to GPay. Avl bal Rs.5,000.00 -Federal Bank'),
    );
    expect(result?.accountKind).toBe('bank');
    expect(result?.bankName).toBe('Federal');
    expect(result?.lastFour).toBe('1859');
  });

  it('extracts credit_card kind and card ending digits', () => {
    const result = parseSmsMessage(
      msg('52', 'Rs.450.00 debited from HDFC Bank card ending 8123 at Amazon'),
    );
    expect(result?.accountKind).toBe('credit_card');
    expect(result?.bankName).toBe('HDFC');
    expect(result?.lastFour).toBe('8123');
  });

  it('extracts bankName word before "Bank" and masked lastFour', () => {
    const result = parseSmsMessage(
      msg('53', 'Rs.300.00 debited from HDFC Bank A/C *7302 on 25-Oct'),
    );
    expect(result?.accountKind).toBe('bank');
    expect(result?.bankName).toBe('HDFC');
    expect(result?.lastFour).toBe('7302');
  });

  it('falls back to Unknown Bank and upi when no bank/card wording exists', () => {
    const result = parseSmsMessage(msg('54', 'Rs.100.00 debited from UPI app'));
    expect(result?.accountKind).toBe('upi');
    expect(result?.bankName).toBe('Unknown Bank');
    expect(result?.lastFour).toBeNull();
  });

  it('does not false-match a 4-digit amount or balance as lastFour', () => {
    const result = parseSmsMessage(
      msg('55', 'Rs.1234.00 debited at BigBasket. Avl bal Rs.99,999.00'),
    );
    expect(result?.lastFour).toBeNull();
  });

  it('resolves "SBI Card ending ####" to SBI (not Unknown Bank)', () => {
    const result = parseSmsMessage(
      msg('56', 'Rs.500.00 debited from SBI Card ending 4444 to Amazon'),
    );
    expect(result?.accountKind).toBe('credit_card');
    expect(result?.bankName).toBe('SBI');
    expect(result?.lastFour).toBe('4444');
  });

  it('resolves "State Bank of India" to SBI (not truncated to "State")', () => {
    const result = parseSmsMessage(
      msg('57', 'Rs.500.00 debited from State Bank of India A/C X4444'),
    );
    expect(result?.accountKind).toBe('bank');
    expect(result?.bankName).toBe('SBI');
    expect(result?.lastFour).toBe('4444');
  });
});
