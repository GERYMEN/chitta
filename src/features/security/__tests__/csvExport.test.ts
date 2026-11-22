import { csvFromTransactions, csvEscape, CSV_HEADER, csvFileName } from '../csvExport';
import type { Transaction } from '../../../domain/transactions/transaction.types';
import type { Account } from '../../../domain/accounts/account.types';
import type { Category } from '../../../domain/categories/category.types';

const ACCOUNT = { id: 'acc-1', name: 'QA Bank 1234' } as Account;
const ACCOUNT_2 = { id: 'acc-2', name: 'QA Wallet 9999' } as Account;
const CATEGORY = { id: 'cat-1', name: 'QA Food' } as Category;

function row(partial: Partial<Transaction>): Transaction {
  return {
    id: 't1',
    type: 'expense',
    status: 'approved',
    amountMinor: 12345,
    currency: 'INR',
    merchantName: 'QA-Merchant-01',
    categoryId: 'cat-1',
    accountId: 'acc-1',
    paymentMethod: 'upi',
    occurredAt: '2026-11-20T10:00:00.000Z',
    detectedAt: '2026-11-20T10:00:05.000Z',
    approvedAt: '2026-11-20T10:01:00.000Z',
    note: null,
    sourceType: 'sms',
    sourceReferenceHash: 'sms-1-1',
    sanitizedPreview: 'QA SECRET BODY text',
    confidenceScore: 0.9,
    parserVersion: 'sms-reader-v2',
    bulkBatchId: null,
    createdAt: '2026-11-20T10:00:05.000Z',
    updatedAt: '2026-11-20T10:00:05.000Z',
    ...partial,
  };
}

const lines = (csv: string) => csv.split('\r\n');

describe('csvEscape', () => {
  it('leaves plain fields, wraps comma/quote/newline, doubles inner quotes', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
    expect(csvEscape('line1\r\nline2')).toBe('"line1\r\nline2"');
    expect(csvEscape('')).toBe('');
  });
});

describe('csvFromTransactions', () => {
  it('header + one approved row with rupees from minor units', () => {
    const csv = csvFromTransactions([row({})], [ACCOUNT], [CATEGORY]);
    const out = lines(csv);
    expect(out[0]).toBe(CSV_HEADER);
    expect(CSV_HEADER).toBe('date,type,account,category,merchant,amount,notes');
    expect(out[1]).toBe('2026-11-20T10:00:00.000Z,expense,QA Bank 1234,QA Food,QA-Merchant-01,123.45,');
    expect(out).toHaveLength(2);
  });

  it('only approved rows: pending, rejected and invalid are excluded', () => {
    const csv = csvFromTransactions(
      [
        row({ id: 'a' }),
        row({ id: 'p', status: 'pending', merchantName: 'QA-Pending' }),
        row({ id: 'r', status: 'rejected', merchantName: 'QA-Rejected' }),
        row({ id: 'i', status: 'invalid', merchantName: 'QA-Invalid' }),
      ],
      [ACCOUNT],
      [CATEGORY],
    );
    expect(csv).toContain('QA-Merchant-01');
    expect(csv).not.toMatch(/QA-Pending|QA-Rejected|QA-Invalid/);
    expect(lines(csv)).toHaveLength(2);
  });

  it('escapes commas, quotes and newlines in merchant and notes', () => {
    const csv = csvFromTransactions(
      [row({ merchantName: 'QA, "Shop"', note: 'first\nsecond, third' })],
      [ACCOUNT],
      [CATEGORY],
    );
    expect(csv).toContain('"QA, ""Shop"""');
    expect(csv).toContain('"first\nsecond, third"');
  });

  it('never carries SMS text (sanitized preview / reference hash) and has no such column', () => {
    const csv = csvFromTransactions([row({})], [ACCOUNT], [CATEGORY]);
    expect(csv).not.toContain('QA SECRET BODY');
    expect(csv).not.toContain('sms-1-1');
    expect(CSV_HEADER.toLowerCase()).not.toMatch(/sms|sender|body|preview/);
  });

  it('transfer shows the type and falls back to blank names for missing ids', () => {
    const csv = csvFromTransactions(
      [row({ type: 'transfer', accountId: 'acc-1', transferAccountId: 'acc-2', categoryId: 'gone', amountMinor: 5 })],
      [ACCOUNT, ACCOUNT_2],
      [CATEGORY],
    );
    expect(lines(csv)[1]).toBe('2026-11-20T10:00:00.000Z,transfer,QA Bank 1234,,QA-Merchant-01,0.05,');
  });

  it('formats negative-free paise exactly (no float drift) and large values', () => {
    const csv = csvFromTransactions(
      [row({ amountMinor: 10 }), row({ amountMinor: 100 }), row({ amountMinor: 123456789 })],
      [ACCOUNT],
      [CATEGORY],
    );
    const amounts = lines(csv).slice(1).map(l => l.split(',')[5]);
    expect(amounts).toEqual(['0.10', '1.00', '1234567.89']);
  });

  it('sorts oldest first by occurredAt; empty input gives just the header', () => {
    const csv = csvFromTransactions(
      [
        row({ id: 'late', occurredAt: '2026-11-21T00:00:00.000Z' }),
        row({ id: 'early', occurredAt: '2026-11-01T00:00:00.000Z' }),
      ],
      [ACCOUNT],
      [CATEGORY],
    );
    expect(lines(csv)[1].startsWith('2026-11-01')).toBe(true);
    expect(csvFromTransactions([], [], [])).toBe(CSV_HEADER);
  });

  it('neutralises spreadsheet formula injection in text fields', () => {
    const csv = csvFromTransactions([row({ merchantName: '=SUM(A1)', note: '+cmd' })], [ACCOUNT], [CATEGORY]);
    expect(csv).toContain(",'=SUM(A1),");
    expect(csv.endsWith(",'+cmd")).toBe(true);
  });
});

describe('csvFileName', () => {
  it('is dated and ends in .csv', () => {
    expect(csvFileName(new Date('2026-11-22T08:00:00.000Z'))).toBe('tracker-transactions-2026-11-22.csv');
  });
});
