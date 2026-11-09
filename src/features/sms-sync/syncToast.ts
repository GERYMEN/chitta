import type { SmsSyncResult } from './syncSms';
import { formatCount } from '../../domain/settings/smsSyncStart.rules';

/**
 * Toast copy after a sync (R4b): "Scanned N SMS · M new", plus the
 * auto-approved and uncategorised parts when > 0, and a "Stopped" prefix
 * after Cancel. Counts only — never merchants, amounts or SMS text.
 */
export function formatSyncToast(
  result: Pick<SmsSyncResult, 'scanned' | 'created' | 'autoApproved'> &
    Partial<Pick<SmsSyncResult, 'uncategorised' | 'cancelled' | 'notUnderstood'>>,
): string {
  let text = `Scanned ${formatCount(result.scanned)} SMS · ${formatCount(result.created)} new`;
  if (result.autoApproved > 0) text += ` · ${formatCount(result.autoApproved)} auto-approved`;
  if ((result.uncategorised ?? 0) > 0) {
    text += ` · ${formatCount(result.uncategorised ?? 0)} uncategorised`;
  }
  if ((result.notUnderstood ?? 0) > 0) {
    text += ` · ${formatCount(result.notUnderstood ?? 0)} not understood`;
  }
  return result.cancelled ? `Stopped · ${text}` : text;
}
