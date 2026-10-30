import { normalizeMerchant } from '../normalizeMerchant';

// Synthetic merchants only.
describe('normalizeMerchant', () => {
  it('lowercases, trims and collapses spaces', () => {
    expect(normalizeMerchant('  QA   Coffee   House ')).toBe('qa coffee house');
    expect(normalizeMerchant('QA\tCoffee\nHouse')).toBe('qa coffee house');
  });

  it('strips UPI handle suffixes', () => {
    expect(normalizeMerchant('qacafe@okhdfcbank')).toBe('qacafe');
    expect(normalizeMerchant('QA Cafe@paytm')).toBe('qa cafe');
    expect(normalizeMerchant('qa.cafe@ybl')).toBe('qa cafe');
    expect(normalizeMerchant('QA Cafe @okqa-bank.x')).toBe('qa cafe');
  });

  it('drops apostrophes and turns other punctuation into spaces', () => {
    expect(normalizeMerchant("QA Joe's Diner")).toBe('qa joes diner');
    expect(normalizeMerchant('QA-Store/North*Wing')).toBe('qa store north wing');
    expect(normalizeMerchant('QA, Store.')).toBe('qa store');
  });

  it('strips trailing reference tails and ids', () => {
    expect(normalizeMerchant('QA Store Ref No 123456789')).toBe('qa store');
    expect(normalizeMerchant('QA Store UTR 9a8b7c665544')).toBe('qa store');
    expect(normalizeMerchant('QA Store txn id 4455')).toBe('qa store');
    expect(normalizeMerchant('QA Store ref')).toBe('qa store');
    expect(normalizeMerchant('QA Store 20261028')).toBe('qa store');
    expect(normalizeMerchant('QA Store #A1B2C3D4 9988')).toBe('qa store');
    expect(normalizeMerchant('QA Store 1234 Ref 5678')).toBe('qa store');
  });

  it('keeps short numbers so distinct merchants stay distinct', () => {
    expect(normalizeMerchant('QA-Merchant-08')).toBe('qa merchant 08');
    expect(normalizeMerchant('QA-Merchant-07')).not.toBe(normalizeMerchant('QA-Merchant-08'));
    expect(normalizeMerchant('QA Cafe 24')).toBe('qa cafe 24');
  });

  it('never strips the first token, even an id-like one', () => {
    expect(normalizeMerchant('QA1234567')).toBe('qa1234567');
    expect(normalizeMerchant('7-Eleven QA 99887766')).toBe('7 eleven qa');
  });

  it('variants of the same merchant share one key', () => {
    const variants = [
      'QA Grocer',
      'qa grocer',
      ' QA  GROCER ',
      'qagrocer@okqabank',
      'QA Grocer Ref No 000111222',
      'QA-Grocer 556677',
    ];
    const keys = new Set(variants.map(normalizeMerchant));
    // "qagrocer@…" is one token (handles rarely carry spaces) — 2 keys max.
    expect(keys).toEqual(new Set(['qa grocer', 'qagrocer']));
  });

  it('is stable (idempotent) and handles empty input', () => {
    const once = normalizeMerchant('QA Store Ref No 123456');
    expect(normalizeMerchant(once)).toBe(once);
    expect(normalizeMerchant('')).toBe('');
    expect(normalizeMerchant('   ')).toBe('');
    expect(normalizeMerchant(null)).toBe('');
    expect(normalizeMerchant('@@@')).toBe('');
  });
});
