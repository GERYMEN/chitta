import type { SmsSyncResult } from './syncSms';

/**
 * Toast copy after a sync; the auto-approved and uncategorised parts are
 * omitted when 0. Counts only — never merchants or amounts.
 */
export function formatSyncToast(
  result: Pick<SmsSyncResult, 'scanned' | 'created' | 'autoApproved'> &
    Partial<Pick<SmsSyncResult, 'uncategorised'>>,
): string {
  let text = `Synced: scanned ${result.scanned}, found ${result.created} new`;
  if (result.autoApproved > 0) text += `, ${result.autoApproved} auto-approved`;
  if ((result.uncategorised ?? 0) > 0) text += `, ${result.uncategorised} uncategorised`;
  return text;
}
