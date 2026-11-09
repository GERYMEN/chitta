import { readerHintVisible, rescanWindow, unparsedReasonLabel, visibleUnparsed } from '../smsReaderStore';
import { prefillFromSms } from '../../transactions/screens/AddRecordScreen';
import { describeSmsRun } from '../../activity/activityFeed';
import { sanitizeAuditMetadata } from '../../../domain/audit/audit.rules';

jest.mock('../../../data/db/connection', () => ({ getDatabase: jest.fn(), runMigrations: jest.fn() }));

const v1Row = { sourceType: 'sms' as const, parserVersion: 'sms-heuristic-v1' };
const v2Row = { sourceType: 'sms' as const, parserVersion: 'sms-reader-v2' };

describe('reader upgrade hint', () => {
  const base = { loaded: true, hasOnboarded: true, readerVersionSeen: null, current: 2 };
  it('only where v1 recorded SMS items, until seen with the current version', () => {
    expect(readerHintVisible({ ...base, transactions: [v1Row] })).toBe(true);
    expect(readerHintVisible({ ...base, transactions: [v2Row] })).toBe(false); // new install
    expect(readerHintVisible({ ...base, transactions: [] })).toBe(false);
    expect(readerHintVisible({ ...base, readerVersionSeen: 2, transactions: [v1Row] })).toBe(false);
    expect(readerHintVisible({ ...base, hasOnboarded: false, transactions: [v1Row] })).toBe(false);
    expect(readerHintVisible({ ...base, loaded: false, transactions: [v1Row] })).toBe(false);
  });
});

describe('rescan window + visible rows', () => {
  it('sync start → now (+1); whole inbox when no start', () => {
    expect(rescanWindow('2026-10-01T00:00:00.000Z', 1000)).toEqual({
      sinceMs: Date.parse('2026-10-01T00:00:00.000Z'),
      beforeMs: 1001,
    });
    expect(rescanWindow(null, 1000)).toEqual({ sinceMs: 0, beforeMs: 1001 });
  });

  it('rows already recorded by SMS reference are hidden', () => {
    const rows = [
      { smsId: '1', smsDate: 10, reasonCode: 'no_amount' as const, institution: 'sbi', parserVersion: 2, detectedAt: '', dismissedAt: null, resolvedAt: null },
      { smsId: '2', smsDate: 20, reasonCode: 'no_direction' as const, institution: 'unknown', parserVersion: 2, detectedAt: '', dismissedAt: null, resolvedAt: null },
    ];
    expect(visibleUnparsed(rows, [{ sourceReferenceHash: 'sms-1-10' }]).map(r => r.smsId)).toEqual(['2']);
    expect(unparsedReasonLabel('no_direction')).toBe('Not sure if money went in or out');
  });
});

describe('Add as transaction prefill', () => {
  const accounts = [
    { id: 'a', lastFour: '1234' },
    { id: 'b', lastFour: '9999' },
  ];
  it('best-guess type, amount, SMS date and the one account with that last-4', () => {
    expect(
      prefillFromSms({ smsId: '1', smsDate: Date.parse('2026-11-03T05:00:00.000Z'), type: 'income', amountMinor: 50050, lastFour: '1234' }, accounts),
    ).toEqual({ type: 'income', amount: '500.50', occurredAt: '2026-11-03T05:00:00.000Z', accountId: 'a' });
  });
  it('no guess → expense, empty amount, no account', () => {
    expect(prefillFromSms({ smsId: '1', smsDate: 0, type: null, amountMinor: null, lastFour: null }, accounts)).toMatchObject({
      type: 'expense',
      amount: undefined,
      accountId: undefined,
    });
  });
});

describe('R5 audit payloads (counts / ids only)', () => {
  it('run counts are whitelisted integers', () => {
    expect(
      sanitizeAuditMetadata({
        kind: 'auto_read',
        counts: { scanned: 3, created: 1, notUnderstood: -1, autoApproved: 1.5, body: 'x' } as never,
      }),
    ).toEqual({ kind: 'auto_read', counts: { scanned: 3, created: 1, notUnderstood: 0, autoApproved: 0 } });
  });
  it('link payload keeps bank id, kind and count only', () => {
    expect(
      sanitizeAuditMetadata({
        kind: 'account_linked',
        bankCanonical: 'Rs 500 QA',
        accountKind: 'bank',
        items: 2,
        lastFour: '1234',
      } as never),
    ).toEqual({ kind: 'account_linked', bankCanonical: 'unknown', accountKind: 'bank', items: 2 });
  });
  it('activity copy', () => {
    expect(describeSmsRun('auto_read', { scanned: 4, created: 2, notUnderstood: 1, autoApproved: 0 }).sentence).toBe(
      'Read automatically: 2 new · 1 not understood',
    );
    expect(describeSmsRun('sms_rescan', { scanned: 40, created: 3, notUnderstood: 0, autoApproved: 0 }).impact?.text).toBe(
      'Scanned 40 SMS · existing items unchanged',
    );
  });
});
