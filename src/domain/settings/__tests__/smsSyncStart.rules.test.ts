import { periodRange } from '../../periods/period.rules';
import {
  classifyStartChange,
  computeSyncWindow,
  formatCount,
  gapConfirmMessage,
  gapConfirmTitle,
  INCREMENTAL_OVERLAP_MS,
  largeScanMessage,
  laterStartMessage,
  needsLargeScanConfirm,
  nextLastSyncedAt,
  parseIsoOrNull,
  parseStartMode,
  scanProgressLabel,
  SMS_SYNC_START_OPTIONS,
  smsTransactionBounds,
  startForChoice,
  startForCustomDate,
  syncStartLabel,
  upgradeDefaultStart,
} from '../smsSyncStart.rules';

const NOW = new Date(2026, 10, 1, 15, 30, 0, 0); // 1 Nov 2026, local
const iso = (y: number, m: number, d: number) => new Date(y, m, d, 0, 0, 0, 0).toISOString();

describe('R4b start choices', () => {
  it('offers 4 choices with install date pre-selected/recommended and helper text', () => {
    expect(SMS_SYNC_START_OPTIONS.map(o => o.mode)).toEqual(['install', 'month', '3m', 'all']);
    expect(SMS_SYNC_START_OPTIONS.filter(o => o.recommended).map(o => o.mode)).toEqual(['install']);
    expect(SMS_SYNC_START_OPTIONS[0].helper).toMatch(/start empty/i);
  });

  it('install = now; month = 1st local midnight; 3m = the 3M period start; all = null', () => {
    expect(startForChoice('install', NOW)).toBe(NOW.toISOString());
    expect(startForChoice('month', NOW)).toBe(iso(2026, 10, 1));
    expect(startForChoice('3m', NOW)).toBe(periodRange('3M', NOW).from.toISOString());
    expect(startForChoice('3m', NOW)).toBe(iso(2026, 8, 1));
    expect(startForChoice('all', NOW)).toBeNull();
  });

  it('custom date = local midnight of the picked day', () => {
    expect(startForCustomDate(new Date(2026, 9, 14, 18, 45))).toBe(iso(2026, 9, 14));
  });

  it('parses stored values defensively', () => {
    expect(parseStartMode('3m')).toBe('3m');
    expect(parseStartMode('bogus')).toBeNull();
    expect(parseStartMode(null)).toBeNull();
    expect(parseIsoOrNull('')).toBeNull();
    expect(parseIsoOrNull('not a date')).toBeNull();
    expect(parseIsoOrNull(iso(2026, 9, 14))).toBe(iso(2026, 9, 14));
  });
});

describe('R4b sync window', () => {
  const nowMs = NOW.getTime();

  it('first sync: [start, now]', () => {
    const start = iso(2026, 9, 14);
    expect(computeSyncWindow({ startAt: start, lastSyncedAt: null, nowMs })).toEqual({
      sinceMs: Date.parse(start),
      beforeMs: nowMs + 1,
    });
  });

  it('whole inbox first sync starts at 0', () => {
    expect(computeSyncWindow({ startAt: null, lastSyncedAt: null, nowMs }).sinceMs).toBe(0);
  });

  it('later syncs: from lastSynced − 1 day overlap', () => {
    const last = new Date(2026, 9, 30, 12).toISOString();
    const window = computeSyncWindow({ startAt: iso(2026, 9, 14), lastSyncedAt: last, nowMs });
    expect(window.sinceMs).toBe(Date.parse(last) - INCREMENTAL_OVERLAP_MS);
  });

  it('a start later than lastSynced − 1 day wins (moved later in Settings)', () => {
    const last = new Date(2026, 9, 30, 12).toISOString();
    const start = iso(2026, 9, 31);
    expect(computeSyncWindow({ startAt: start, lastSyncedAt: last, nowMs }).sinceMs).toBe(
      Date.parse(start),
    );
  });

  it('cursor advances only forward', () => {
    const prev = new Date(2026, 9, 30).toISOString();
    expect(nextLastSyncedAt(prev, Date.parse(prev) + 5)).toBe(new Date(Date.parse(prev) + 5).toISOString());
    expect(nextLastSyncedAt(prev, Date.parse(prev) - 5)).toBe(prev);
    expect(nextLastSyncedAt(prev, null)).toBe(prev);
    expect(nextLastSyncedAt(null, null)).toBeNull();
  });
});

describe('R4b start moved in Settings', () => {
  it('earlier → gap only [new, old)', () => {
    const oldStart = iso(2026, 9, 14);
    const newStart = iso(2026, 8, 1);
    expect(classifyStartChange(oldStart, newStart)).toEqual({
      kind: 'earlier',
      gap: { sinceMs: Date.parse(newStart), beforeMs: Date.parse(oldStart) },
    });
  });

  it('whole inbox from a date → gap from the beginning', () => {
    expect(classifyStartChange(iso(2026, 9, 14), null)).toEqual({
      kind: 'earlier',
      gap: { sinceMs: 0, beforeMs: Date.parse(iso(2026, 9, 14)) },
    });
  });

  it('later → no gap, nothing deleted', () => {
    expect(classifyStartChange(iso(2026, 9, 14), iso(2026, 10, 1))).toEqual({ kind: 'later' });
    expect(classifyStartChange(null, iso(2026, 10, 1))).toEqual({ kind: 'later' });
    expect(laterStartMessage(iso(2026, 10, 1))).toBe(
      'Items already recorded stay; future syncs start from 1 Nov 2026.',
    );
  });

  it('same date → same', () => {
    expect(classifyStartChange(iso(2026, 9, 14), iso(2026, 9, 14))).toEqual({ kind: 'same' });
    expect(classifyStartChange(null, null)).toEqual({ kind: 'same' });
  });

  it('gap confirm copy uses dates and a count only', () => {
    expect(gapConfirmTitle(iso(2026, 8, 1), iso(2026, 9, 14))).toBe(
      'Scan SMS from 1 Sep 2026 to 14 Oct 2026?',
    );
    expect(gapConfirmTitle(null, iso(2026, 9, 14))).toBe('Scan SMS from the beginning to 14 Oct 2026?');
    expect(gapConfirmMessage(1234)).toBe('About 1,234 SMS.');
    expect(gapConfirmMessage(null)).toBeUndefined();
  });
});

describe('R4b upgrade default start', () => {
  const now = NOW;
  it('earliest of first sync run and earliest SMS row', () => {
    const run = Date.parse(iso(2026, 9, 14));
    expect(
      upgradeDefaultStart({ firstRunStartedAtMs: run, earliestSmsTransactionAt: iso(2026, 9, 20), now }),
    ).toBe(new Date(run).toISOString());
    expect(
      upgradeDefaultStart({ firstRunStartedAtMs: run, earliestSmsTransactionAt: iso(2026, 9, 2), now }),
    ).toBe(iso(2026, 9, 2));
  });

  it('only SMS rows → their earliest date', () => {
    expect(
      upgradeDefaultStart({ firstRunStartedAtMs: null, earliestSmsTransactionAt: iso(2026, 9, 14), now }),
    ).toBe(iso(2026, 9, 14));
  });

  it('only a sync run → its start', () => {
    const run = Date.parse(iso(2026, 9, 16));
    expect(
      upgradeDefaultStart({ firstRunStartedAtMs: run, earliestSmsTransactionAt: null, now }),
    ).toBe(iso(2026, 9, 16));
  });

  it('neither → the time of the upgrade', () => {
    expect(
      upgradeDefaultStart({ firstRunStartedAtMs: null, earliestSmsTransactionAt: null, now }),
    ).toBe(now.toISOString());
  });

  it('SMS bounds ignore manual rows', () => {
    expect(
      smsTransactionBounds([
        { sourceType: 'manual', occurredAt: iso(2026, 0, 1) },
        { sourceType: 'sms', occurredAt: iso(2026, 9, 20) },
        { sourceType: 'sms', occurredAt: iso(2026, 9, 14) },
      ]),
    ).toEqual({ earliest: iso(2026, 9, 14), newest: iso(2026, 9, 20) });
    expect(smsTransactionBounds([])).toEqual({ earliest: null, newest: null });
  });
});

describe('R4b estimate threshold and labels', () => {
  it('confirms only above 500', () => {
    expect(needsLargeScanConfirm(0)).toBe(false);
    expect(needsLargeScanConfirm(500)).toBe(false);
    expect(needsLargeScanConfirm(501)).toBe(true);
    expect(largeScanMessage(4800)).toBe(
      'About 4,800 SMS to scan — this may add many items to Pending.',
    );
  });

  it('labels', () => {
    expect(syncStartLabel(null)).toBe('Whole inbox');
    expect(syncStartLabel(iso(2026, 9, 14))).toBe('14 Oct 2026');
    expect(formatCount(1200)).toBe('1,200');
    expect(formatCount(1234567)).toBe('1,234,567');
    expect(scanProgressLabel(1200, 4800)).toBe('Scanning 1,200 / 4,800');
    expect(scanProgressLabel(0, 0)).toBe('Preparing scan…');
    expect(scanProgressLabel(10, 5)).toBe('Scanning 10 / 10');
    expect(scanProgressLabel(10, 50, true)).toBe('Stopping…');
  });
});
