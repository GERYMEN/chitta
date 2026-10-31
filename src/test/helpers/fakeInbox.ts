import type { SmsMessage } from '../../native/android/sms/smsReader';
import { compareRowsDesc, rowMatchesPage } from '../../features/sms-sync/inboxPaging';

/**
 * R4b test double of the native SmsReader paging: the same selection and
 * order as `readInboxPage` / `countInboxSince` (via the pure inboxPaging
 * mirror), over a synthetic in-memory inbox.
 */
export function fakeInboxModule(
  getInbox: () => ReadonlyArray<SmsMessage> | Promise<ReadonlyArray<SmsMessage>>,
) {
  return {
    readInboxPage: async (
      sinceMs: number,
      beforeMs: number,
      beforeId: number,
      limit: number,
    ): Promise<SmsMessage[]> => {
      const inbox = await getInbox();
      return inbox
        .filter(row => rowMatchesPage(row, sinceMs, { beforeMs, beforeId }))
        .sort(compareRowsDesc)
        .slice(0, limit)
        .map(row => ({ ...row }));
    },
    countInboxSince: async (sinceMs: number): Promise<number> => {
      const inbox = await getInbox();
      return inbox.filter(row => row.date >= sinceMs).length;
    },
    readSmsById: async () => null,
  };
}
