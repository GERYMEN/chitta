import { formatSyncToast } from '../syncToast';

describe('formatSyncToast', () => {
  it('omits the auto-approved part when zero', () => {
    expect(formatSyncToast({ scanned: 200, created: 3, autoApproved: 0 })).toBe(
      'Synced: scanned 200, found 3 new',
    );
  });

  it('includes the auto-approved count when non-zero', () => {
    expect(formatSyncToast({ scanned: 200, created: 3, autoApproved: 2 })).toBe(
      'Synced: scanned 200, found 3 new, 2 auto-approved',
    );
  });
});
