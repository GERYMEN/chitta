import { formatSyncToast } from '../syncToast';

describe('formatSyncToast (R4b copy, counts only)', () => {
  it('omits the auto-approved part when zero', () => {
    expect(formatSyncToast({ scanned: 200, created: 3, autoApproved: 0 })).toBe(
      'Scanned 200 SMS · 3 new',
    );
  });

  it('includes the auto-approved count when non-zero', () => {
    expect(formatSyncToast({ scanned: 200, created: 3, autoApproved: 2 })).toBe(
      'Scanned 200 SMS · 3 new · 2 auto-approved',
    );
  });

  it('groups thousands, adds uncategorised and the Stopped prefix', () => {
    expect(
      formatSyncToast({
        scanned: 4800,
        created: 1200,
        autoApproved: 0,
        uncategorised: 5,
        cancelled: true,
      }),
    ).toBe('Stopped · Scanned 4,800 SMS · 1,200 new · 5 uncategorised');
  });
});
