import { buildDaySections, dayLabel } from '../daySections';

// Local wall-clock dates → ISO, so the tests hold in any timezone.
const local = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min).toISOString();

type Row = {
  id: string;
  type: 'income' | 'expense' | 'transfer';
  amountMinor: number;
  occurredAt: string;
  linkKind?: 'refund' | null;
  linkedTransactionId?: string | null;
};

describe('B1: day headers use the injected now (never a fixture date)', () => {
  it('TODAY / YESTERDAY follow `now`', () => {
    const now = new Date(2026, 9, 31, 10, 0); // 31 Oct 2026
    expect(dayLabel(local(2026, 10, 31, 0, 5), now)).toBe('TODAY');
    expect(dayLabel(local(2026, 10, 31, 23, 59), now)).toBe('TODAY');
    expect(dayLabel(local(2026, 10, 30, 8), now)).toBe('YESTERDAY');
    // The old fixture "today" (1 Oct 2026) is just a date now.
    const older = dayLabel(local(2026, 10, 1), now);
    expect(older).not.toBe('TODAY');
    expect(older).not.toBe('YESTERDAY');
    expect(older).toMatch(/OCT/);
  });

  it('a different injected now moves the labels (the screen re-reads the clock on focus)', () => {
    const row = local(2026, 11, 2, 9);
    expect(dayLabel(row, new Date(2026, 10, 2, 18))).toBe('TODAY');
    expect(dayLabel(row, new Date(2026, 10, 3, 7))).toBe('YESTERDAY');
    expect(dayLabel(row, new Date(2026, 10, 4, 7))).not.toMatch(/TODAY|YESTERDAY/);
  });

  it('YESTERDAY across a month and a year boundary', () => {
    expect(dayLabel(local(2026, 10, 31), new Date(2026, 10, 1, 9))).toBe('YESTERDAY');
    expect(dayLabel(local(2026, 12, 31), new Date(2027, 0, 1, 9))).toBe('YESTERDAY');
  });

  it('buildDaySections: newest day first, titles from now, nets via the single totals rule', () => {
    const now = new Date(2026, 9, 31, 20, 0);
    const rows: Row[] = [
      { id: 'a', type: 'expense', amountMinor: 5000, occurredAt: local(2026, 10, 31, 9) },
      { id: 'b', type: 'income', amountMinor: 20000, occurredAt: local(2026, 10, 31, 8) },
      { id: 'c', type: 'transfer', amountMinor: 99999, occurredAt: local(2026, 10, 30, 10) },
      {
        id: 'd',
        type: 'income',
        amountMinor: 1000,
        occurredAt: local(2026, 10, 30, 9),
        linkKind: 'refund',
        linkedTransactionId: 'x',
      },
      { id: 'e', type: 'expense', amountMinor: 700, occurredAt: local(2026, 10, 12) },
    ];
    const sections = buildDaySections(rows, now);
    expect(sections.map(s => s.title.replace(/\s+/g, ' '))).toEqual([
      'TODAY',
      'YESTERDAY',
      expect.stringMatching(/12 OCT/),
    ]);
    expect(sections.map(s => s.data.map(r => r.id))).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
    // Transfers never move a day's net; a linked refund lowers spend (+1000 net).
    expect(sections.map(s => s.netMinor)).toEqual([15000, 1000, -700]);
  });
});
