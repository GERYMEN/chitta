import { MASK_VOCABULARY, maskSender, maskSmsPattern, sharePatternMessage } from '../maskSmsPattern';
import { SMS_FIXTURES, V1_REGRESSION_FIXTURES } from '../../../../test/fixtures/smsReader.fixture';

const ALL = [...SMS_FIXTURES, ...V1_REGRESSION_FIXTURES];
const PLACEHOLDER = /^<(?:W|AMT|ACCT|REF|N|DATE|TIME|VPA|URL|EMAIL)>$/;

/** Every word-ish token of a masked text. */
function words(text: string): string[] {
  return text.match(/<[A-Z]+>|a\/c|[^\s.,:;!?()\-/'"&+*#%=_[\]]+/gi) ?? [];
}

describe('maskSmsPattern — properties over every fixture', () => {
  it.each(ALL.map(f => [`${f.group}: ${f.name}`, f] as const))('%s', (_n, fixture) => {
    const { text, sender } = maskSmsPattern(fixture.body, fixture.address);
    // never a digit
    expect(text).not.toMatch(/\d/);
    expect(sender).not.toMatch(/\d/);
    // never a word outside the vocabulary (placeholders and X/* masks aside)
    for (const w of words(text)) {
      const ok = PLACEHOLDER.test(w) || MASK_VOCABULARY.has(w.toLowerCase()) || /^[x*₹]+$/i.test(w);
      if (!ok) throw new Error(`word outside vocabulary: ${w}`);
    }
    // never a VPA / URL / e-mail / synthetic name
    expect(text).not.toMatch(/@|https?:|www\.|qa\.example|qa\.payee|okqa/i);
    expect(text).not.toMatch(/\bQA\b|PAYEE|EMPLOYER|STORE|CAFE|QABK|QAEMP/i);
  });

  it('keeps the shape: banking words, placeholders, punctuation', () => {
    const { text, sender } = maskSmsPattern(
      'Rs.250.00 debited from A/c XX1234 on 03-11-2026 to VPA qa.payee@okqa (UPI Ref No 000000000001). Avl Bal Rs.1,000.00',
      'AD-QABANK-S',
    );
    expect(text).toBe(
      'Rs <AMT> debited from A/c <ACCT> on <DATE> to VPA <VPA> (UPI Ref No <REF>). Avl Bal Rs <AMT>',
    );
    expect(sender).toBe('QABANK');
  });

  it('collapses runs of unknown words and masks other scripts', () => {
    const { text } = maskSmsPattern('Paid to QA SOME LONG NAME नमस्ते via UPI', 'AD-QABANK');
    expect(text).toBe('Paid to <W> via UPI');
  });

  it('masks urls, e-mails, times, short numbers', () => {
    const { text } = maskSmsPattern(
      'Visit https://qa.example/x or mail qa@qa.example at 10:30 code 42',
      'AD-QABANK',
    );
    expect(text).toBe('<W> <URL> or <W> <EMAIL> at <TIME> code <N>');
  });

  it('sender: header ID only, <NUMBER> for numbers, <SENDER> otherwise', () => {
    expect(maskSender('JD-QABANK-T')).toBe('QABANK');
    expect(maskSender('+919000000001')).toBe('<NUMBER>');
    expect(maskSender('57575')).toBe('<NUMBER>');
    expect(maskSender('AD-0000000000')).toBe('<NUMBER>');
    expect(maskSender('Some Name')).toBe('<SENDER>');
  });

  it('share message prefix', () => {
    const msg = sharePatternMessage({
      pattern: { sender: 'QABANK', text: 'Rs <AMT> debited' },
      reasonLabel: 'No amount found',
      appVersion: '0.9.0-beta',
      parserVersion: 2,
    });
    expect(msg.split('\n')[0]).toBe('Tracker SMS pattern — No amount found · App v0.9.0-beta · Parser v2');
    expect(msg).toContain('Sender: QABANK');
  });
});

describe('R5-fix C12 — vocabulary words never let a name through', () => {
  /** Review examples (synthetic): each name token must be gone. */
  const CASES: ReadonlyArray<readonly [string, string[]]> = [
    ['INR 1,299.00 spent on ICICI Bank Card XX1234 on 02-Nov-26 at AMAZON PAY INDIA PVT LTD. Avl Limit: INR 11,006.13', ['AMAZON', 'INDIA', 'PVT', 'LTD']],
    ['Rs.499.00 debited from A/c XX1234 to AIRTEL PAYMENTS BANK via UPI Ref 000000000123', ['AIRTEL', 'PAYMENTS']],
    ['Rs 2000 sent to BAL KRISHNA KOTAK via UPI on 03-11-26', ['BAL', 'KRISHNA', 'KOTAK']],
    ['Rs 500 credited to your a/c by MAY JUNE BILL from BOB', ['MAY', 'JUNE', 'BILL', 'BOB']],
    ['Rs 750 sent to A U SHARMA', ['A', 'U', 'SHARMA']],
    ['Rs 300 paid to CASH MOBILE PAY on 03-11-26', ['CASH', 'MOBILE', 'PAY']],
    ['Rs 300 paid to QA-BILL & CO on 03-11-26', ['QA', 'BILL', 'CO']],
  ];

  it.each(CASES.map(([body, names]) => [body, names] as const))('%s', (body, names) => {
    const { text } = maskSmsPattern(body, 'AD-QABANK-S');
    const tokens = new Set(words(text).map(w => w.toUpperCase()));
    for (const name of names) expect(tokens.has(name)).toBe(false);
    expect(text).not.toMatch(/\d/);
  });

  it('institution / brand / month / single-letter words are not in the vocabulary', () => {
    for (const w of ['amazon', 'airtel', 'paytm', 'payments', 'india', 'kotak', 'bob', 'state', 'express',
      'may', 'june', 'nov', 'a', 'u', 'pvt', 'ltd', 'hdfc', 'sbi', 'icici', 'federal']) {
      expect(MASK_VOCABULARY.has(w)).toBe(false);
    }
  });

  it('month names become <DATE>', () => {
    expect(maskSmsPattern('Rs 500 debited on Nov 01', 'AD-QABANK').text).toBe('Rs <AMT> debited on <DATE> <N>');
  });

  it('own-account phrases after "to" keep their shape', () => {
    expect(maskSmsPattern('Rs 500 credited to your A/c XX1234 by QA PAYEE', 'AD-QABANK').text).toBe(
      'Rs <AMT> credited to your A/c <ACCT> by <W>',
    );
  });

  it.each(ALL.filter(f => f.expect.payee && f.body.includes(f.expect.payee)).map(f => [`${f.group}: ${f.name}`, f] as const))(
    'fixture payee never survives: %s',
    (_n, fixture) => {
      const { text } = maskSmsPattern(fixture.body, fixture.address);
      expect(text).not.toContain(fixture.expect.payee!);
      for (const token of fixture.expect.payee!.split(/[^A-Za-z]+/).filter(t => t.length >= 2)) {
        if (MASK_VOCABULARY.has(token.toLowerCase())) continue;
        expect(words(text)).not.toContain(token);
      }
    },
  );
});
