import type { SmsSyncResult } from './syncSms';

/** Toast copy after a sync; the auto-approved part is omitted when 0. */
export function formatSyncToast(
  result: Pick<SmsSyncResult, 'scanned' | 'created' | 'autoApproved'>,
): string {
  const base = `Synced: scanned ${result.scanned}, found ${result.created} new`;
  return result.autoApproved > 0 ? `${base}, ${result.autoApproved} auto-approved` : base;
}
