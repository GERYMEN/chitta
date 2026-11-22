import { Transaction } from '../../transactions/transaction.types';
import {
  detectRecurring,
  upcomingWithin,
  relativeDueLabel,
  daysUntilDue,
} from '../recurring.rules';

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).toISOString();
const NOW = new Date(2026, 10, 20, 9); // 20 Nov 2026

let seq = 0;
function tx(merchant: string, when: string, amountMinor = 19900, patch: Partial<Transaction> = {}): Transaction {
  seq += 1;
  return {
    id: `t${seq}`,
    type: 'expense',
    status: 'approved',
    amountMinor,
    currency: 'INR',
    merchantName: merchant,
    categoryId: 'cat-qa',
    accountId: 'acc-qa',
    paymentMethod: 'upi',
    occurredAt: when,
    detectedAt: when,
    approvedAt: when,
    note: null,
    sourceType: 'manual',
    sourceReferenceHash: null,
    sanitizedPreview: null,
    confidenceScore: null,
    parserVersion: null,
    bulkBatchId: null,
    createdAt: when,
    updatedAt: when,
    ...patch,
  };
}

const monthly = (name: string, amount = 19900) => [
  tx(name, at(2026, 8, 5), amount),
  tx(name, at(2026, 9, 5), amount),
  tx(name, at(2026, 10, 5), amount),
];

describe('detectRecurring', () => {
  it('detects a monthly series with median amount and nextDue', () => {
    const [s] = detectRecurring(monthly('QA Streamer'), NOW);
    expect(s.cadence).toBe('monthly');
    expect(s.typicalAmountMinor).toBe(19900);
    expect(s.occurrenceCount).toBe(3);
    expect(new Date(s.nextDueAt).getMonth()).toBe(10);
    expect(new Date(s.nextDueAt).getDate()).toBe(5);
  });

  it('detects weekly', () => {
    const rows = [1, 8, 15, 22].map(d => tx('QA Paper', at(2026, 11, d), 5000));
    const [s] = detectRecurring(rows, NOW);
    expect(s.cadence).toBe('weekly');
    expect(new Date(s.nextDueAt).getDate()).toBe(29);
  });

  it('detects yearly', () => {
    const rows = [tx('QA Domain', at(2023, 11, 25), 90000), tx('QA Domain', at(2024, 11, 24), 90000), tx('QA Domain', at(2025, 11, 25), 90000)];
    const [s] = detectRecurring(rows, NOW);
    expect(s.cadence).toBe('yearly');
    expect(new Date(s.nextDueAt).getFullYear()).toBe(2026);
  });

  it('rejects fewer than 3 occurrences', () => {
    expect(detectRecurring(monthly('QA X').slice(0, 2), NOW)).toEqual([]);
  });

  it('rejects amounts outside +/-10% of the median but accepts within', () => {
    const bad = [tx('QA Y', at(2026, 8, 5), 10000), tx('QA Y', at(2026, 9, 5), 10000), tx('QA Y', at(2026, 10, 5), 12000)];
    expect(detectRecurring(bad, NOW)).toEqual([]);
    const ok = [tx('QA Y', at(2026, 8, 5), 10000), tx('QA Y', at(2026, 9, 5), 10000), tx('QA Y', at(2026, 10, 5), 10900)];
    expect(detectRecurring(ok, NOW)).toHaveLength(1);
  });

  it('rejects irregular gaps', () => {
    const rows = [tx('QA Z', at(2026, 8, 5)), tx('QA Z', at(2026, 8, 20)), tx('QA Z', at(2026, 10, 5))];
    expect(detectRecurring(rows, NOW)).toEqual([]);
  });

  it('excludes transfers, pending, rejected, income and duplicates', () => {
    const base = monthly('QA Mixed');
    const polluted = [
      base[0],
      base[1],
      { ...base[2], type: 'transfer' as const },
    ];
    expect(detectRecurring(polluted, NOW)).toEqual([]);
    expect(detectRecurring([base[0], base[1], { ...base[2], status: 'pending' as const }], NOW)).toEqual([]);
    expect(detectRecurring([base[0], base[1], { ...base[2], status: 'rejected' as const }], NOW)).toEqual([]);
    expect(detectRecurring([base[0], base[1], { ...base[2], type: 'income' as const }], NOW)).toEqual([]);
    expect(detectRecurring([base[0], base[1], { ...base[2], linkKind: 'duplicate' as const }], NOW)).toEqual([]);
  });

  it('groups by normalized merchant key', () => {
    const rows = [
      tx('QA Streamer', at(2026, 8, 5)),
      tx('qa streamer ref 123456', at(2026, 9, 5)),
      tx('QA STREAMER', at(2026, 10, 5)),
    ];
    expect(detectRecurring(rows, NOW)).toHaveLength(1);
  });
});

describe('upcomingWithin', () => {
  const rows = [
    ...monthly('QA Due Soon'), // next 5 Nov (overdue 15d at NOW) -> excluded
    tx('QA Late', at(2026, 8, 17), 7000),
    tx('QA Late', at(2026, 9, 17), 7000),
    tx('QA Late', at(2026, 10, 17), 7000), // next 17 Nov = 3 days overdue
    tx('QA Soon', at(2026, 8, 28), 8000),
    tx('QA Soon', at(2026, 9, 28), 8000),
    tx('QA Soon', at(2026, 10, 28), 8000), // next 28 Nov = in 8 days
    tx('QA Early', at(2026, 8, 22), 9000),
    tx('QA Early', at(2026, 9, 22), 9000),
    tx('QA Early', at(2026, 10, 22), 9000), // next 22 Nov = in 2 days
    tx('QA Far', at(2026, 9, 10), 9000),
    tx('QA Far', at(2026, 10, 10), 9000),
    tx('QA Far', at(2026, 11, 10), 9000), // next 10 Dec = in 20 days
  ];
  it('includes overdue-in-window, excludes too old and too far, sorted by due', () => {
    const up = upcomingWithin(detectRecurring(rows, NOW), NOW, 14);
    expect(up.map(s => s.displayName)).toEqual(['QA Late', 'QA Early', 'QA Soon']);
  });
  it('relative labels', () => {
    expect(daysUntilDue(at(2026, 11, 22), NOW)).toBe(2);
    expect(relativeDueLabel(at(2026, 11, 20), NOW)).toBe('today');
    expect(relativeDueLabel(at(2026, 11, 21), NOW)).toBe('tomorrow');
    expect(relativeDueLabel(at(2026, 11, 25), NOW)).toBe('in 5 days');
    expect(relativeDueLabel(at(2026, 11, 19), NOW)).toBe('1 day overdue');
    expect(relativeDueLabel(at(2026, 11, 17), NOW)).toBe('3 days overdue');
  });
});
